# Disciples Stream (web)

Static web version of Disciples Stream. Vercel hosts the page; no build step.

## Deploy
0. If you get `500 FUNCTION_INVOCATION_FAILED`, your repo contains desktop files. Delete `server.js`, `main.js`, `preload.js`, `package.json`, `build/`, `.github/` and `public/` from it. Only the files below should remain.
1. Create a new GitHub repo and upload these files at the repo root: `index.html`, `vercel.json`, `.gitignore`, `README.md`.
2. In Vercel: Add New > Project > import the repo.
3. Framework Preset: **Other**. Leave Build Command, Output Directory and Install Command empty. Deploy.
4. In Firebase console > Authentication > Settings > Authorized domains, add your new `*.vercel.app` domain (and your custom domain if you add one). Sign-in will not work until you do.

## What works on Vercel, and what needs a server
Vercel cannot run WebSockets or ffmpeg, so two features need `server.js` (from the desktop project) running somewhere:
- **PreCenter lyrics link** (Screens > Stream link in PreCenter)
- **Go Live / Start Streaming** (sends video to YouTube, Facebook, etc.)

Everything else (scenes, sources, capture, mixer, recording, studio mode, transitions, settings) runs fully in the browser.

Easiest setup: run the Disciples Stream desktop app (or `node server.js`) on the same computer, open the Vercel page, then in **StreamLink** set Server to `localhost:3000` and enter the pairing code shown by the desktop app.
Other computer or always-on: host `server.js` on Render, Railway or Fly (needs Node and ffmpeg) and put its address in the Server field (the page uses wss:// automatically for https addresses).
