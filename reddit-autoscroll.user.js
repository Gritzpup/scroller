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
    // Accept messages from any origin since we trust our own scroller
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
