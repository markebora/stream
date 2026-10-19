// Disciples: Stream server
// 1) serves the app from ./public
// 2) /link  : relays PreCenter slides to Stream (same pairing code = same room)
// 3) /      : receives the video from Stream and sends it to YouTube/Facebook/etc. with ffmpeg
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn, spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const PUB = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const CODE_FILE = path.join(process.env.DATA_DIR || __dirname, 'pairing-code.txt');
const VIDEO_KBPS = +process.env.VIDEO_KBPS || 2500, AUDIO_KBPS = +process.env.AUDIO_KBPS || 160;

/* ---- pairing code: env PAIR_CODE, else saved file, else a new random one ---- */
function getCode() {
  if (process.env.PAIR_CODE) return process.env.PAIR_CODE.trim();
  try { const c = fs.readFileSync(CODE_FILE, 'utf8').trim(); if (c) return c; } catch {}
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let c = '';
  for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
  try { fs.writeFileSync(CODE_FILE, c); } catch {}
  return c;
}
const CODE = getCode();
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];

/* ---- static files ---- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/api/info') {   // only the computer running the server may read the pairing code
    const a = req.socket.remoteAddress || '';
    if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(a)) { res.writeHead(403); return res.end(); }
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ code: CODE, port: PORT, ips }));
  }
  if (p === '/remux') {   // converts an uploaded recording to MP4 with ffmpeg
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (new URL(req.url, 'http://x').searchParams.get('code') !== CODE) { res.writeHead(401, cors); return res.end('wrong code'); }
    if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
    if (!hasFfmpeg) { res.writeHead(501, cors); return res.end('ffmpeg missing'); }
    const f = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
    res.writeHead(200, Object.assign({ 'Content-Type': 'video/mp4' }, cors));
    req.pipe(f.stdin); f.stdin.on('error', () => {}); f.stdout.pipe(res); f.stderr.on('data', (d) => process.stdout.write('remux: ' + d));
    f.on('exit', () => { try { res.end(); } catch {} }); res.on('close', () => { try { f.kill('SIGTERM'); } catch {} });
    return;
  }
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  });
});

/* ---- PreCenter link: rooms keyed by pairing code ---- */
const rooms = new Map();
const linkWss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
linkWss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams, code = (q.get('code') || '').trim(), role = q.get('role') || 'remote';
  if (code !== CODE) { ws.close(4001, 'wrong code'); return; }
  if (!rooms.has(code)) rooms.set(code, new Set());
  const room = rooms.get(code), me = { ws, role }; room.add(me); ws.isAlive = true; ws.on('pong', () => ws.isAlive = true);
  log(`link: ${role} connected (${room.size} in room)`);
  const tell = () => { const n = [...room].filter((p) => p.role !== 'overlay').length, msg = JSON.stringify({ t: 'peers', n }); for (const p of room) if (p.role === 'overlay' && p.ws.readyState === 1) p.ws.send(msg); };
  tell();
  ws.on('message', (data, isBin) => {
    if (!isBin && data.length < 40 && data.toString().includes('"hb"')) { try { ws.send('{"t":"hb"}'); } catch {} return; }   // heartbeat from Stream: answered here, never relayed
    for (const p of room) if (p !== me && p.ws.readyState === 1) p.ws.send(data, { binary: isBin });
  });
  ws.on('close', () => { room.delete(me); log(`link: ${role} left`); tell(); });
});

/* ---- stream out: Stream sends {rtmpUrl}, then WebM chunks; ffmpeg pushes them to the service ---- */
const hasFfmpeg = !spawnSync(FF, ['-version']).error;
const outWss = new WebSocketServer({ noServer: true, maxPayload: 16 << 20 });
outWss.on('connection', (ws) => {
  let ff = null;
  ws.on('message', (data, isBin) => {
    if (!ff) {
      let m; try { m = JSON.parse(data.toString()); } catch { return ws.close(1003, 'expected settings'); }
      if (String(m.code || '') !== CODE) return ws.close(4001, 'wrong code');
      const url = String(m.rtmpUrl || '');
      if (!/^rtmps?:\/\//i.test(url)) return ws.close(1008, 'bad stream address');
      if (!hasFfmpeg) { log('ffmpeg not found: install it and restart'); return ws.close(1011, 'ffmpeg missing'); }
      const num = (v, lo, hi, d) => { v = +v; return v >= lo && v <= hi ? Math.round(v) : d; };
      const vk = num(m.vkbps, 300, 30000, VIDEO_KBPS), ak = num(m.akbps, 32, 512, AUDIO_KBPS), gop = num(m.gop, 10, 600, 60);
      const preset = PRESETS.includes(m.preset) ? m.preset : 'veryfast';
      log('stream: starting (' + url.replace(/^(rtmps?:\/\/[^/]+).*/i, '$1') + '/…) ' + vk + 'k, ' + preset);
      ff = spawn(FF, ['-hide_banner', '-loglevel', 'warning', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', preset, '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', String(gop),
        '-b:v', vk + 'k', '-maxrate', vk + 'k', '-bufsize', vk * 2 + 'k',
        '-c:a', 'aac', '-b:a', ak + 'k', '-ar', '44100', '-ac', '2', '-f', 'flv', url]);
      ff.stderr.on('data', (d) => process.stdout.write('ffmpeg: ' + d));
      ff.stdin.on('error', () => {});
      ff.on('exit', (c) => { log('stream: ffmpeg ended (' + c + ')'); ff = null; try { ws.close(); } catch {} });
      return;
    }
    if (isBin && ff.stdin.writable) ff.stdin.write(data);
  });
  ws.on('close', () => { if (ff) { try { ff.stdin.end(); ff.kill('SIGTERM'); } catch {} ff = null; log('stream: stopped'); } });
});

server.on('upgrade', (req, sock, head) => {
  const w = (req.url || '').split('?')[0] === '/link' ? linkWss : outWss;
  w.handleUpgrade(req, sock, head, (ws) => w.emit('connection', ws, req));
});
setInterval(() => rooms.forEach((r) => r.forEach((p) => { if (p.ws.isAlive === false) return p.ws.terminate(); p.ws.isAlive = false; try { p.ws.ping(); } catch {} })), 25000);

const log = (t) => console.log(new Date().toLocaleTimeString() + '  ' + t);
server.on('error', (e) => console.log(e.code === 'EADDRINUSE' ? '  Port ' + PORT + ' is already in use. Close the other Stream server first.' : String(e)));
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  Disciples: Stream server is running\n');
  console.log('  Open Stream here:   http://localhost:' + PORT);
  ips.forEach((ip) => console.log('  On your network:    http://' + ip + ':' + PORT));
  console.log('\n  PAIRING CODE:  ' + CODE + '\n  (enter it in Stream and in PreCenter)\n');
  if (!hasFfmpeg) console.log('  WARNING: ffmpeg was not found. Linking works, but Go Live will not.\n  Install ffmpeg (ffmpeg.org) and make sure the command "ffmpeg" works, then restart.\n');
});

module.exports = { CODE, PORT };
