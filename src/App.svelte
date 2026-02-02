<script>
  import { onMount } from 'svelte';

  let isScrolling = false;
  let mouseInactive = false;
  let mouseInactiveTimer = null;
  let scrollInterval = null;
  let lastMouseTime = Date.now();
  let scrollSpeed = 3; // pixels per scroll event
  let inactivityDelay = 5000; // 5 seconds in milliseconds
  let redditWindow = null;

  const SCROLL_INTERVAL = 1000; // Check every 1 second if should scroll

  // Start auto-scroll
  function startScrolling() {
    if (isScrolling) return;
    isScrolling = true;

    scrollInterval = setInterval(() => {
      // Only scroll if window is still open
      if (redditWindow && !redditWindow.closed) {
        // Check if mouse has been inactive for long enough
        const timeSinceLastMouse = Date.now() - lastMouseTime;

        if (timeSinceLastMouse > inactivityDelay) {
          // Scroll the Reddit window
          redditWindow.scrollBy(0, scrollSpeed);
        }
      }
    }, SCROLL_INTERVAL);
  }

  // Stop auto-scroll
  function stopScrolling() {
    isScrolling = false;
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  // Handle mouse activity in the Reddit window
  function handleMouseActivity() {
    lastMouseTime = Date.now();
    mouseInactive = false;

    // Reset the inactivity timer
    if (mouseInactiveTimer) {
      clearTimeout(mouseInactiveTimer);
    }

    // Start counting inactivity again
    mouseInactiveTimer = setTimeout(() => {
      mouseInactive = true;
    }, inactivityDelay);
  }

  // Open Reddit
  function openReddit() {
    // Check if window already open
    if (redditWindow && !redditWindow.closed) {
      redditWindow.focus();
      return;
    }

    // Open Reddit with old.reddit.com to match RES
    redditWindow = window.open('https://old.reddit.com/', 'redditWindow', 'width=1200,height=800');

    if (redditWindow) {
      // Add event listeners to the Reddit window
      try {
        redditWindow.addEventListener('mousemove', handleMouseActivity);
        redditWindow.addEventListener('mousedown', handleMouseActivity);
        redditWindow.addEventListener('wheel', handleMouseActivity);
        redditWindow.addEventListener('keydown', handleMouseActivity);
      } catch (e) {
        // Cross-origin restriction - use polling instead
        console.log('Cross-origin window detected, using polling for activity');
        startMouseActivityPolling();
      }
    }
  }

  // Fallback: Poll for activity since we can't directly listen to cross-origin windows
  function startMouseActivityPolling() {
    setInterval(() => {
      // Reset activity timer periodically - user will reset when they interact
      handleMouseActivity();
    }, 100);
  }

  // Close Reddit window
  function closeReddit() {
    if (redditWindow && !redditWindow.closed) {
      redditWindow.close();
      redditWindow = null;
    }
    stopScrolling();
  }

  onMount(() => {
    // Initialize
    handleMouseActivity();

    return () => {
      // Cleanup
      if (scrollInterval) clearInterval(scrollInterval);
      if (mouseInactiveTimer) clearTimeout(mouseInactiveTimer);
      closeReddit();
    };
  });

  // Track mouse activity on the control panel itself
  function onControlPanelMouseMove() {
    if (redditWindow && !redditWindow.closed) {
      handleMouseActivity();
    }
  }
</script>

<div class="container">
  <div class="control-panel">
    <h1>🔄 Reddit Auto-Scroller</h1>

    <div class="info-box">
      <p>👉 <strong>Instructions:</strong></p>
      <ul>
        <li>Click "Open Reddit" to log in and view Reddit</li>
        <li>You'll be using old.reddit.com (with Reddit Enhancement Suite)</li>
        <li>Click "Start Scrolling" to enable auto-scroll</li>
        <li>Move your mouse on Reddit to pause scrolling</li>
        <li>After 5 seconds of no mouse activity, auto-scroll resumes</li>
        <li>You can still click, copy links, and interact normally</li>
      </ul>
    </div>

    <div class="status-panel">
      <div class="status-row">
        <span class="label">Scrolling Status:</span>
        <span class="status" class:active={isScrolling}>
          {isScrolling ? '✅ ACTIVE' : '⏸️ INACTIVE'}
        </span>
      </div>
      <div class="status-row">
        <span class="label">Mouse Status:</span>
        <span class="status" class:active={!mouseInactive}>
          {mouseInactive ? '⏱️ INACTIVE (5s+)' : '🖱️ ACTIVE'}
        </span>
      </div>
      <div class="status-row">
        <span class="label">Reddit Window:</span>
        <span class="status" class:active={redditWindow && !redditWindow.closed}>
          {redditWindow && !redditWindow.closed ? '🪟 OPEN' : '❌ CLOSED'}
        </span>
      </div>
    </div>

    <div class="controls">
      <button
        on:click={openReddit}
        class="btn btn-primary"
      >
        🪟 Open Reddit
      </button>

      <button
        on:click={startScrolling}
        disabled={!redditWindow || redditWindow.closed || isScrolling}
        class="btn btn-success"
      >
        ▶️ Start Scrolling
      </button>

      <button
        on:click={stopScrolling}
        disabled={!isScrolling}
        class="btn btn-warning"
      >
        ⏸️ Stop Scrolling
      </button>

      <button
        on:click={closeReddit}
        disabled={!redditWindow || redditWindow.closed}
        class="btn btn-danger"
      >
        ❌ Close Reddit
      </button>
    </div>

    <div class="settings">
      <div class="setting-group">
        <label for="scrollSpeed">
          📏 Scroll Speed: <strong>{scrollSpeed}px</strong>
        </label>
        <input
          id="scrollSpeed"
          type="range"
          min="1"
          max="20"
          bind:value={scrollSpeed}
          on:mousemove={onControlPanelMouseMove}
        />
        <small>Pixels to scroll per check</small>
      </div>

      <div class="setting-group">
        <label for="inactivityDelay">
          ⏱️ Inactivity Delay: <strong>{inactivityDelay / 1000}s</strong>
        </label>
        <input
          id="inactivityDelay"
          type="range"
          min="1000"
          max="15000"
          step="1000"
          bind:value={inactivityDelay}
          on:mousemove={onControlPanelMouseMove}
        />
        <small>Time before auto-scroll resumes after mouse movement</small>
      </div>
    </div>

    <div class="footer">
      <p>🔗 Visit <a href="https://old.reddit.com/" target="_blank">old.reddit.com</a> directly if popup blocker prevents opening</p>
      <p>💡 <strong>Tips:</strong> Use Reddit Enhancement Suite for the old Reddit look</p>
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    min-height: 100vh;
  }

  .container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }

  .control-panel {
    background: white;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    padding: 40px;
    max-width: 500px;
    width: 100%;
  }

  h1 {
    margin: 0 0 30px 0;
    color: #333;
    text-align: center;
    font-size: 28px;
  }

  .info-box {
    background: #f0f4ff;
    border-left: 4px solid #667eea;
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 30px;
  }

  .info-box p {
    margin: 0 0 15px 0;
    font-weight: 600;
    color: #333;
  }

  .info-box ul {
    margin: 0;
    padding-left: 20px;
    color: #555;
    line-height: 1.8;
  }

  .info-box li {
    margin-bottom: 8px;
  }

  .status-panel {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 30px;
    border: 1px solid #e0e0e0;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #eee;
  }

  .status-row:last-child {
    border-bottom: none;
  }

  .label {
    font-weight: 600;
    color: #555;
  }

  .status {
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    background: #f0f0f0;
    color: #666;
  }

  .status.active {
    background: #d4edda;
    color: #155724;
  }

  .controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 30px;
  }

  .btn {
    padding: 12px 16px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #667eea;
    color: white;
    grid-column: 1 / -1;
  }

  .btn-primary:hover:not(:disabled) {
    background: #5568d3;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(102, 126, 234, 0.4);
  }

  .btn-success {
    background: #28a745;
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: #218838;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(40, 167, 69, 0.4);
  }

  .btn-warning {
    background: #ffc107;
    color: #333;
  }

  .btn-warning:hover:not(:disabled) {
    background: #e0a800;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(255, 193, 7, 0.4);
  }

  .btn-danger {
    background: #dc3545;
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: #c82333;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(220, 53, 69, 0.4);
  }

  .settings {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
    border: 1px solid #e0e0e0;
  }

  .setting-group {
    margin-bottom: 20px;
  }

  .setting-group:last-child {
    margin-bottom: 0;
  }

  .setting-group label {
    display: block;
    font-weight: 600;
    color: #333;
    margin-bottom: 8px;
    font-size: 14px;
  }

  .setting-group input[type="range"] {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: #ddd;
    outline: none;
    -webkit-appearance: none;
  }

  .setting-group input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #667eea;
    cursor: pointer;
    transition: all 0.2s;
  }

  .setting-group input[type="range"]::-webkit-slider-thumb:hover {
    background: #5568d3;
    transform: scale(1.2);
  }

  .setting-group input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #667eea;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }

  .setting-group input[type="range"]::-moz-range-thumb:hover {
    background: #5568d3;
    transform: scale(1.2);
  }

  .setting-group small {
    display: block;
    color: #999;
    font-size: 12px;
    margin-top: 6px;
  }

  .footer {
    text-align: center;
    padding-top: 20px;
    border-top: 1px solid #e0e0e0;
  }

  .footer p {
    margin: 8px 0;
    font-size: 13px;
    color: #666;
    line-height: 1.6;
  }

  .footer a {
    color: #667eea;
    text-decoration: none;
    font-weight: 600;
  }

  .footer a:hover {
    text-decoration: underline;
  }

  @media (max-width: 600px) {
    .control-panel {
      padding: 20px;
    }

    h1 {
      font-size: 22px;
      margin-bottom: 20px;
    }

    .controls {
      grid-template-columns: 1fr;
    }

    .btn-primary {
      grid-column: 1;
    }
  }
</style>
