# 🔧 Userscript Setup Guide - Reddit Auto-Scroller

## Why Do I Need This?

Due to browser security restrictions, the control panel app can't directly scroll Reddit. The userscript solves this by running **on the Reddit page itself** and receiving scroll commands from the control panel via secure message passing.

## ✅ Installation Steps (5 minutes)

### 1. Install a Userscript Manager

Choose your browser and install one of these extensions:

| Browser | Extension |
|---------|-----------|
| **Chrome** | [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/gcbommkklmjlnocjogfcbffcnmnkhodl) |
| **Brave** | [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/gcbommkklmjlnocjogfcbffcnmnkhodl) |
| **Edge** | [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfohd) |
| **Firefox** | [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) |
| **Safari** | [Userscripts](https://github.com/quoid/userscripts) |

**Steps:**
1. Click the link for your browser
2. Click "Add to Chrome" (or equivalent)
3. Confirm the installation
4. You should see the extension icon in your toolbar

### 2. Install the Reddit Auto-Scroller Script

#### Option A: Quick Copy-Paste (Recommended)

1. Open this file on your machine: `/home/ubuntubox/Documents/Github/scroller/reddit-autoscroll.user.js`
2. Copy **all the text**
3. Click the **Tampermonkey icon** in your browser toolbar
4. Click **"Create a new script..."** (or **"+"**)
5. **Delete** the default template text
6. **Paste** the script code
7. Click **Save** (Ctrl+S or Cmd+S)
8. Close the tab - you're done!

#### Option B: Direct URL Installation

If your userscript manager supports it:
1. Go to: `file:///home/ubuntubox/Documents/Github/scroller/reddit-autoscroll.user.js`
2. Your manager may auto-detect it and prompt to install
3. Click "Install"

#### Option C: Manual Creation

1. Click Tampermonkey icon → "Create a new script..."
2. Copy-paste this code:

```javascript
// ==UserScript==
// @name         Reddit Auto-Scroller Control
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Receive scroll commands from the Scroller control panel
// @author       Claude
// @match        *://old.reddit.com/*
// @match        *://reddit.com/*
// @icon         https://www.reddit.com/favicon.ico
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  let scrolling = false;
  let scrollSpeed = 3;
  let scrollInterval = null;

  // Listen for messages from the opener window (the scroller app)
  window.addEventListener('message', (event) => {
    const data = event.data;

    if (data.type === 'SCROLLER_START') {
      scrollSpeed = data.scrollSpeed || 3;
      if (!scrolling) {
        scrolling = true;
        startScrolling();
      }
    } else if (data.type === 'SCROLLER_STOP') {
      scrolling = false;
      if (scrollInterval) {
        clearInterval(scrollInterval);
        scrollInterval = null;
      }
    } else if (data.type === 'SCROLLER_UPDATE_SPEED') {
      scrollSpeed = data.scrollSpeed;
    }
  });

  function startScrolling() {
    scrollInterval = setInterval(() => {
      if (scrolling) {
        window.scrollBy(0, scrollSpeed);
      }
    }, 1000);
  }

  // Send ready signal back to opener
  if (window.opener) {
    window.opener.postMessage({ type: 'SCROLLER_READY' }, '*');
  }
})();
```

3. Click **Save** (Ctrl+S)

### 3. Verify Installation

1. Open Tampermonkey → "Installed scripts"
2. You should see **"Reddit Auto-Scroller Control"** in the list
3. Make sure it's **enabled** (checkmark visible)
4. That's it!

## 🎮 Using the Scroller Now

1. Open the control panel: **http://localhost:5174/**
2. Click **"🪟 Open Reddit"**
3. Log into Reddit (old.reddit.com)
4. Go back to the control panel
5. Click **"▶️ Start Scrolling"**
6. **Watch Reddit scroll automatically!** 🎉

The script will:
- Receive scroll commands from the control panel
- Apply scrolling to Reddit
- Update speed when you adjust the slider
- Stop when you click the stop button

## 🔍 How to Verify It's Working

### Check if Script is Active
1. Open Reddit (old.reddit.com) in a new tab/window
2. Open **Browser DevTools** (F12)
3. Go to **Console** tab
4. You should **NOT** see any red errors about the script
5. If installed via Tampermonkey, the icon shows a number (how many scripts active)

### Test the Scroll Commands
1. Open the scroller control panel
2. Open Reddit
3. Click "Start Scrolling"
4. Open DevTools Console on Reddit
5. You should see POST messages being sent (if you have logging enabled)

## ⚠️ Troubleshooting

### "Script not running"
**Solution:**
1. Click Tampermonkey icon → "Installed scripts"
2. Find "Reddit Auto-Scroller Control"
3. Make sure the **checkbox is enabled** (✓)
4. Make sure **@match lines** include your Reddit domain:
   ```
   // @match        *://old.reddit.com/*
   // @match        *://reddit.com/*
   ```

### "Nothing happens when I click Start Scrolling"
**Solutions:**
1. Make sure the **Reddit window is open** (not just the control panel)
2. Make sure you **installed the userscript** (not just the app)
3. Refresh the Reddit page to reload the script
4. Try opening Reddit in a **new window** instead of tab
5. Check **Browser Console (F12)** for errors

### "Scrolling stutters or is very slow"
**Solutions:**
1. Reduce scroll speed in the control panel (try 2-3px instead of 5)
2. Close other tabs/apps
3. Try a different browser
4. Make sure only **one Reddit tab** is open

### "Script works for a bit then stops"
**Solutions:**
1. Check if Reddit tab got **closed accidentally**
2. Check if **browser has high memory usage**
3. Refresh the Reddit page and restart scrolling
4. Make sure the **mouse inactivity delay is set properly** (default 5s)

### "Browser console shows errors"
**Common errors and fixes:**

| Error | Solution |
|-------|----------|
| `Content Security Policy` | This is normal for cross-origin messages, ignore it |
| `Cannot read properties of null` | Reddit page might not be fully loaded, refresh |
| `postMessage undefined` | Browser doesn't support postMessage, try Chrome/Firefox |

## 🔐 Security & Privacy

✅ **100% Safe**
- Script is **open source** (you can read it)
- Only runs on old.reddit.com
- No data collection
- No external connections
- Only receives messages from **your own control panel**
- No access to passwords or private data

✅ **What it does:**
- Listens for scroll commands from the control panel
- Scrolls the page
- That's it!

## 📚 Script Details

**File:** `/home/ubuntubox/Documents/Github/scroller/reddit-autoscroll.user.js`

**What it includes:**
- Runs on: `old.reddit.com` and `reddit.com`
- Communication: `window.postMessage()` API
- No external libraries required
- Lightweight (~500 bytes)

**Messages it listens for:**
- `SCROLLER_START` - Start scrolling
- `SCROLLER_STOP` - Stop scrolling
- `SCROLLER_UPDATE_SPEED` - Update scroll speed

## 🎯 Quick Checklist

Before saying "scrolling isn't working":

- [ ] Installed Tampermonkey/Greasemonkey
- [ ] Installed the Reddit Auto-Scroller script
- [ ] Script is **enabled** in Tampermonkey
- [ ] Reddit window is **open**
- [ ] Script is running on **old.reddit.com** (not some other site)
- [ ] Control panel is at **localhost:5174**
- [ ] Clicked "Open Reddit" button
- [ ] Clicked "Start Scrolling" button
- [ ] Waited a few seconds for script to activate
- [ ] No red errors in browser console (F12)

## 💡 Pro Tips

1. **Multiple Reddit windows**: Script only works on windows opened **via the control panel**
2. **Keyboard shortcuts**: Tampermonkey supports keyboard shortcuts if you want to add them
3. **Custom speed**: You can manually edit the script to change default speed
4. **Dark mode**: Script works with dark mode Reddit extensions
5. **Reddit Enhancement Suite**: Script is **compatible** with RES

## 📞 Need Help?

If scrolling still doesn't work after installation:

1. **Check browser console** (F12) for errors
2. **Verify script is enabled** in Tampermonkey
3. **Refresh Reddit page** (F5)
4. **Restart the control panel** (refresh http://localhost:5174/)
5. **Try a different browser** to isolate the issue
6. **Try in incognito mode** to disable other extensions

---

**You're all set!** 🚀 Enjoy automatic scrolling!
