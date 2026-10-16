# Disciples Stream (desktop)

The installer includes everything: no Node.js or ffmpeg to install. The app starts its own server and bundles ffmpeg.

## Build the installer (Windows)
Easy way: put this folder on GitHub, open Actions > "Build Windows installer" > Run workflow, then download `Disciples-Stream-Setup` (the .exe).
Or on your PC (needs Node.js once): `npm install` then `npm run dist`. The installer appears in `dist/`.

## Use
Install, open Disciples Stream, sign in. App > "Show pairing code…" gives the code for PreCenter (Screens > Stream link). Stream on this computer is already paired.
Windows may ask to allow the app through the firewall the first time: allow it if PreCenter is on another computer.
To test without building: `npm install` then `npm start`.
