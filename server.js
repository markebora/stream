// Minimal relay: browser (WebSocket, WebM chunks) -> FFmpeg -> RTMP
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let ffmpeg = null;

  ws.on('message', (data, isBinary) => {
    // First message: JSON with the RTMP URL (+ stream key)
    if (!isBinary && !ffmpeg) {
      const { rtmpUrl } = JSON.parse(data.toString());
      ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p', '-g', '60',
        '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'flv', rtmpUrl,
      ]);
      ffmpeg.stderr.on('data', (d) => process.stdout.write(d));
      ffmpeg.on('close', () => ws.close());
      return;
    }
    // Everything after: binary media chunks
    if (ffmpeg && ffmpeg.stdin.writable) ffmpeg.stdin.write(data);
  });

  ws.on('close', () => {
    if (ffmpeg) { ffmpeg.stdin.end(); ffmpeg.kill('SIGINT'); }
  });
});

server.listen(3000, () => console.log('Open http://localhost:3000'));
