# Disciples Stream (desktop)

The installer includes everything: no Node.js or ffmpeg to install. The app starts its own server and bundles ffmpeg.

## Build the installer (Windows)
Easy way: put this folder on GitHub, open Actions > "Build Windows installer" > Run workflow, then download `Disciples-Stream-Setup` (the .exe).
Or on your PC (needs Node.js once): `npm install` then `npm run dist`. The installer appears in `dist/`.

## Use
Install, open Disciples Stream, sign in. Tools > App > "Link PreCenter (address and code)…" gives the code for PreCenter (Screens > Stream link). Tools > View has Reload, Full screen, Zoom and Developer tools. Stream on this computer is already paired.
Windows may ask to allow the app through the firewall the first time: allow it if PreCenter is on another computer.
To test without building: `npm install` then `npm start`.


## PreCenter lyrics
Tools > Select PreCenter Lyrics selects the lyrics source at any time. On the preview: click the words (or the dashed "Lyrics" guide), drag to move, drag a corner to resize, double-click for Properties, Alt+click to pick what is underneath. Ctrl+K searches every function.


## New in this version
- Undo / Redo (Ctrl+Z / Ctrl+Y), Multiview and projector windows (View menu), per-scene and per-source hotkeys (Settings > Hotkeys)
- Resizable, floatable, lockable docks (Docks menu), accent color, reduce motion, system tray option (desktop)
- Output: recording formats, output scaling, encoder preset / keyframe interval, 6 audio tracks, monitoring device
- Stream auto-reconnect, live Stats, Scripts (Tools > Scripts), backup export / import, Remux to MP4 (needs the server)
