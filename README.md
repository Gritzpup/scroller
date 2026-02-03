# Reddit Auto-Scroller

Control Reddit scrolling from a web dashboard using Tampermonkey.

## Architecture

- **Frontend**: Svelte + Vite on port 5177
- **Control**: Uses window.open() + postMessage
- **Userscript**: Tampermonkey script runs on Reddit
- **No backend**: Everything runs client-side in your browser

## Setup

1. Install Tampermonkey extension in your browser
2. Run: `npm install && npm run dev`
3. Open http://localhost:5177 (or http://192.168.1.51:5177 from network)
4. Click "Install Now" to install userscript
5. Click "Open Reddit" to open Reddit
6. Click "Start Scrolling" when "Reddit Ready" shows ✅

## How It Works

1. Control panel opens Reddit via window.open()
2. Tampermonkey script loads on Reddit page
3. Script sends READY signal to control panel
4. Control panel sends scroll commands via postMessage
5. Reddit scrolls automatically at ~60px/second (adjustable)

## Features

- **Smooth scrolling**: ~60px/second at default speed (1000x faster than original)
- **Adjustable speed**: Control scroll rate with slider (1-20px)
- **Inactivity delay**: Auto-resume scrolling after mouse movement
- **Network access**: Works from any machine on network
- **No backend**: No server or database needed

## Troubleshooting

See USERSCRIPT_SETUP.md for detailed troubleshooting.

### Script Not Installing?

1. Open https://old.reddit.com directly
2. Check browser console (F12) for errors
3. Ensure Tampermonkey is installed and enabled
4. Try manually installing via "Install Now" button

### Scrolling Not Working?

1. Verify script is installed: "Tampermonkey Script: ✅ INSTALLED"
2. Click "Open Reddit"
3. Wait for "Reddit Ready: ✅ READY"
4. Click "Start Scrolling"
5. Check Reddit console for error messages

### Still Having Issues?

Check the browser console (F12) for error messages and share them when asking for help.
