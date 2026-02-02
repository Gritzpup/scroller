# Reddit Auto-Scroller Setup & Usage Guide

## ⚡ IMPORTANT: Userscript Required

**Scrolling won't work without installing the userscript!** This is due to browser security restrictions on cross-origin windows.

👉 **[Read USERSCRIPT_SETUP.md for detailed installation instructions](./USERSCRIPT_SETUP.md)** ← Start here!

Quick summary:
1. Install Tampermonkey browser extension
2. Install the `reddit-autoscroll.user.js` script
3. Then scrolling will work!

---

## 🎯 Overview

The Reddit Auto-Scroller is a Svelte web app that provides a control panel for automatically scrolling Reddit with intelligent mouse activity detection. It opens old.reddit.com (compatible with Reddit Enhancement Suite) in a separate window and controls scrolling from a dedicated control panel.

## 📋 Features

- **Auto-Scroll Control**: Start/stop scrolling with simple buttons
- **Mouse Activity Detection**: Automatically pauses scrolling when you move your mouse
- **5-Second Inactivity Delay**: Resumes scrolling after 5 seconds of no mouse movement
- **Adjustable Settings**:
  - Scroll speed: 1-20 pixels per check
  - Inactivity delay: 1-15 seconds (default: 5s)
- **Real-Time Status**: Shows scrolling status, mouse status, and window status
- **Network Accessible**: Access from any device on your network
- **Full Interaction**: You can still click, select, copy links, and interact normally with Reddit

## 🚀 Quick Start

### Option 1: Run Standalone
```bash
cd /home/ubuntubox/Documents/Github/scroller
npm install
npm run dev
```

Access at:
- **Local**: http://localhost:5174/
- **Network**: http://192.168.1.51:5174/ (or your machine's IP:5174)

### Option 2: Run via Tilt
```bash
cd /home/ubuntubox/Documents/Github
tilt up

# In another terminal, start the scroller service
tilt trigger scroller
```

Access at: http://localhost:5174/

## ⚙️ Required: Install the Userscript

For scrolling to work, you need to install a userscript manager and our Reddit script:

### Step 1: Install Userscript Manager
Choose one (browser extension):
- **Chrome/Brave/Edge**: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/gcbommkklmjlnocjogfcbffcnmnkhodl)
- **Firefox**: [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) or [Greasemonkey](https://addons.mozilla.org/firefox/addon/greasemonkey/)
- **Safari**: [Userscripts](https://github.com/quoid/userscripts)

### Step 2: Install the Reddit Auto-Scroller Script
1. Open the script file: `/home/ubuntubox/Documents/Github/scroller/reddit-autoscroll.user.js`
2. Copy the entire contents
3. Click your userscript manager icon → "Create New Script"
4. Paste the contents
5. Click "Save"
6. Done! The script will activate on old.reddit.com

**Alternative**: Visit [this link](http://localhost:5174/) and look for the script installation button (if available)

### What This Script Does
- Listens for scroll commands from the control panel
- Applies scrolling to the Reddit page
- Works seamlessly with the control panel app
- Disables automatically when you disable scrolling

## 🔧 How to Use

### Step 1: Open Reddit
1. Click the **"🪟 Open Reddit"** button
2. A new window will open with old.reddit.com
3. **Log into your Reddit account** if needed
4. (Make sure your browser's popup blocker allows this)

### Step 2: Start Auto-Scrolling
1. Click the **"▶️ Start Scrolling"** button
2. The page will begin auto-scrolling down
3. Watch the status panel to confirm scrolling is active

### Step 3: Use Normally
- **Move your mouse** on the Reddit window to pause scrolling
- **Wait 5 seconds** of no mouse movement to resume scrolling
- **Click, select, and copy** links as you normally would
- All your mouse interactions are tracked automatically

### Step 4: Adjust as Needed
- Use the **"📏 Scroll Speed"** slider to adjust how fast it scrolls
- Use the **"⏱️ Inactivity Delay"** slider to change when scrolling resumes
- Click **"⏸️ Stop Scrolling"** to pause manually
- Click **"❌ Close Reddit"** to close the window

## 📊 Status Panel

The control panel shows three status indicators:

| Status | Meaning |
|--------|---------|
| **Scrolling: ✅ ACTIVE** | Auto-scroll is running |
| **Scrolling: ⏸️ INACTIVE** | Auto-scroll is stopped |
| **Mouse: 🖱️ ACTIVE** | Mouse has been moving recently |
| **Mouse: ⏱️ INACTIVE (5s+)** | Mouse hasn't moved for 5+ seconds |
| **Reddit: 🪟 OPEN** | Reddit window is open |
| **Reddit: ❌ CLOSED** | Reddit window is closed |

## ⚙️ Settings Reference

### Scroll Speed (1-20 pixels)
- **Lower (1-3px)**: Slower, smoother scrolling (default: 3px)
- **Higher (10-20px)**: Faster scrolling, good for quickly scanning

### Inactivity Delay (1-15 seconds)
- **Lower (1-2s)**: Quick resume after any mouse movement
- **Higher (5-10s)**: More tolerance for mouse hovering (default: 5s)

## 🎮 Tips & Tricks

1. **For Long Sessions**: Use lower scroll speed (2-3px) for a comfortable reading pace
2. **For Quick Browsing**: Use higher scroll speed (8-10px) to scan quickly
3. **For Link Copying**: Use longer inactivity delay (8-10s) so moving to copy a link doesn't pause scrolling
4. **Multiple Monitors**: Great for a secondary monitor - let it auto-scroll while you work elsewhere
5. **Reddit Enhancement Suite**: Make sure RES is installed for the classic Reddit look

## 🔍 Browser Console Tips

If you open your browser's developer console (F12), you might see:
- `Cross-origin window detected, using polling for activity` - Normal message
- No errors means everything is working correctly

## 🐛 Troubleshooting

### Reddit window won't open
- **Check popup blocker**: Make sure scroller.localhost is allowed
- **Alternative**: Click the link "🔗 Visit old.reddit.com directly" in the footer
- Then click "Open Reddit" again to focus that window

### Scrolling seems stuttery
- Lower the scroll speed slider (try 2-3px instead of 5+)
- Close other tabs/apps consuming resources
- Try a different browser

### Mouse activity not detecting
- This is normal if Reddit is in a separate window
- The app uses polling as a fallback
- Just move your mouse on the Reddit window - it will detect the pause

### Can't login to Reddit
- Make sure you're using old.reddit.com
- Check your browser cookies/login settings
- Try in an incognito window if login is stuck

## 🔐 Privacy & Security

- All scrolling happens **locally** in your browser
- No data is sent to external servers
- No tracking or analytics
- You control your Reddit login completely

## 🌐 Network Access

The app is configured with `--host` so you can access it from other machines:

```
http://[YOUR_MACHINE_IP]:5174/
```

Example: If your machine IP is 192.168.1.100:
```
http://192.168.1.100:5174/
```

Find your IP with:
```bash
hostname -I
```

## 📦 Dependencies

- **Svelte 5**: Modern, reactive UI framework
- **Vite**: Lightning-fast build tool
- **CSS Grid**: Responsive, modern styling

## 🏗️ Project Structure

```
scroller/
├── src/
│   ├── App.svelte         # Main component with all logic
│   ├── main.js            # Entry point
│   └── app.css            # Global styles
├── index.html             # HTML template
├── vite.config.js         # Vite configuration (--host enabled)
├── package.json           # Dependencies & scripts
└── README.md              # Vite default README
```

## 🚀 Development

### Build for Production
```bash
npm run build
```
Output will be in the `dist/` folder

### Preview Production Build
```bash
npm run preview
```

## 📝 Notes

- Tested with old.reddit.com (with Reddit Enhancement Suite)
- Works in any modern browser (Chrome, Firefox, Safari, Edge)
- Responsive design works on different screen sizes
- All settings are reset when you refresh the page

## 🎨 Customization

You can edit `src/App.svelte` to:
- Change default scroll speed
- Change default inactivity delay
- Modify the UI colors and styling
- Change the scroll interval check frequency

## 💡 Future Enhancements

Possible improvements:
- Save settings to localStorage
- Support for other websites besides Reddit
- Keyboard shortcuts for control panel
- Profiles for different scroll speeds
- Dark mode toggle

---

**Happy scrolling!** 🎉
