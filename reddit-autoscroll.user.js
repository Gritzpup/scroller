// ==UserScript==
// @name         Reddit Auto-Scroller Control
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Receive scroll commands from the Scroller control panel via localStorage
// @author       Claude
// @match        *://old.reddit.com/*
// @match        *://reddit.com/*
// @icon         https://www.reddit.com/favicon.ico
// @grant        unsafeWindow
// ==/UserScript==

(function() {
  'use strict';

  let scrolling = false;
  let scrollSpeed = 3;
  let scrollInterval = null;
  let lastCommandId = null;

  console.log('🔄 Reddit Auto-Scroller Script Loaded!');

  // Check localStorage for scroll commands
  function checkForCommands() {
    try {
      const command = localStorage.getItem('REDDIT_SCROLLER_CMD');

      if (command) {
        const data = JSON.parse(command);

        // Ignore if we've already processed this command
        if (data.id === lastCommandId) {
          return;
        }

        lastCommandId = data.id;
        console.log('📨 Received command:', data.type, data);

        if (data.type === 'SCROLLER_START') {
          scrollSpeed = data.scrollSpeed || 3;
          if (!scrolling) {
            console.log('▶️ Starting scroll with speed:', scrollSpeed);
            scrolling = true;
            startScrolling();
          }
        } else if (data.type === 'SCROLLER_STOP') {
          console.log('⏹️ Stopping scroll');
          scrolling = false;
          if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
          }
        } else if (data.type === 'SCROLLER_UPDATE_SPEED') {
          scrollSpeed = data.scrollSpeed;
          console.log('📏 Updated scroll speed:', scrollSpeed);
        }
      }
    } catch (error) {
      console.error('❌ Error checking commands:', error);
    }
  }

  function startScrolling() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
    }

    scrollInterval = setInterval(() => {
      if (scrolling) {
        const currentScroll = window.scrollY || window.pageYOffset;
        window.scrollBy(0, scrollSpeed);
        const newScroll = window.scrollY || window.pageYOffset;

        // Debug log every 10 scrolls
        if (Math.random() < 0.1) {
          console.log('📜 Scrolling... Position:', Math.round(newScroll));
        }
      }
    }, 1000);
  }

  // Check for commands every 500ms
  setInterval(checkForCommands, 500);

  console.log('✅ Reddit Auto-Scroller initialized and listening!');
})();
