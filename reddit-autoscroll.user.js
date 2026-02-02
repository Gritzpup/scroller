// ==UserScript==
// @name         Reddit Auto-Scroller Control
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Receive scroll commands from the Scroller control panel via postMessage
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

  console.log('✅ Reddit Auto-Scroller Script Loaded!');

  // Listen for messages from any window
  window.addEventListener('message', (event) => {
    const data = event.data;

    // Only process our scroller messages
    if (!data || !data.type || !data.type.startsWith('SCROLLER_')) {
      return;
    }

    console.log('📨 Received command:', data.type);

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
  });

  function startScrolling() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
    }

    scrollInterval = setInterval(() => {
      if (scrolling) {
        window.scrollBy(0, scrollSpeed);
      }
    }, 1000);
  }

  console.log('✅ Reddit Auto-Scroller ready to receive commands!');
})();
