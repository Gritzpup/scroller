// ==UserScript==
// @name         Reddit Auto-Scroller Control
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Receive scroll commands from the Scroller control panel via postMessage
// @author       Claude
// @match        *://old.reddit.com/*
// @match        *://reddit.com/*
// @icon         https://www.reddit.com/favicon.ico
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // Mark that this script is loaded (for detection)
  window.REDDIT_AUTOSCROLLER_LOADED = true;

  let scrolling = false;
  let scrollSpeed = 3;
  let animFrameId = null;
  let lastTimestamp = null;
  let exactScrollY = 0;

  console.log('✅ Reddit Auto-Scroller Script Loaded!');
  console.log('📍 URL:', window.location.href);
  console.log('🔍 Window opener:', window.opener ? 'EXISTS' : 'NO OPENER');

  try {
    // Listen for messages from the control panel
    window.addEventListener('message', (event) => {
      // Validate message comes from our control panel
      const validOrigins = [
        'http://localhost:5177',
        'http://192.168.1.51:5177'
      ];

      if (!validOrigins.includes(event.origin)) {
        console.warn('Rejected message from unknown origin:', event.origin);
        return;
      }

      const data = event.data;

      // Only process our scroller messages
      if (!data || typeof data !== 'object' || !data.type || !data.type.startsWith('SCROLLER_')) {
        return;
      }

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
        if (animFrameId) {
          cancelAnimationFrame(animFrameId);
          animFrameId = null;
        }
        lastTimestamp = null;
      } else if (data.type === 'SCROLLER_UPDATE_SPEED') {
        scrollSpeed = data.scrollSpeed;
        console.log('📏 Updated scroll speed:', scrollSpeed);
      } else if (data.type === 'SCROLLER_ENSURE_ACTIVE') {
        // Make sure we're scrolling if we're supposed to be
        if (!scrolling) {
          console.log('🔄 Reactivating scroll (was stopped)');
          scrollSpeed = data.scrollSpeed;
          scrolling = true;
          startScrolling();
        } else {
          // Just update speed
          scrollSpeed = data.scrollSpeed;
        }
      }
    });

    function startScrolling() {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
      lastTimestamp = null;
      exactScrollY = window.scrollY;

      function scrollStep(timestamp) {
        if (!scrolling) return;

        if (lastTimestamp !== null) {
          const delta = (timestamp - lastTimestamp) / 1000;
          const currentActual = window.scrollY;
          // Re-sync if user scrolled manually
          if (Math.abs(currentActual - Math.round(exactScrollY)) > 1) {
            exactScrollY = currentActual;
          }
          exactScrollY += scrollSpeed * delta;
          window.scrollTo(0, exactScrollY);
        }

        lastTimestamp = timestamp;
        animFrameId = requestAnimationFrame(scrollStep);
      }

      animFrameId = requestAnimationFrame(scrollStep);
    }

    // Send READY signal to control panel
    if (window.opener && !window.opener.closed) {
      console.log('📡 Sending READY signal to control panel...');
      try {
        window.opener.postMessage({ type: 'SCROLLER_READY' }, '*');
        console.log('✅ READY signal sent successfully!');
      } catch (err) {
        console.error('❌ Failed to send READY signal:', err);
      }
    } else {
      console.warn('⚠️ No window.opener available (not opened via window.open)');
    }

    console.log('✅ Reddit Auto-Scroller ready to receive commands!');
  } catch (err) {
    console.error('❌ Error in Reddit Auto-Scroller script:', err);
  }
})();
