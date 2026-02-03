<script>
  import { onMount } from 'svelte';

  let redditWindow = null;
  let redditReady = false;
  let isScrolling = false;
  let scrollSpeed = 3;
  let inactivityDelay = 5000;
  let error = '';
  let statusMessage = '';
  let messageQueue = [];
  let lastMouseTime = Date.now();
  let scrollInterval = null;
  let scriptInstalled = false;
  let checkingScript = false;
  let testWindow = null;

  const SCROLL_INTERVAL = 100; // Check every 100ms if we should scroll
  const SCRIPT_CHECK_TIMEOUT = 10000; // 10 seconds to detect script

  // Listen for messages from Reddit window
  onMount(() => {
    window.addEventListener('message', (event) => {
      // Only accept messages from Reddit
      if (!event.origin.includes('reddit.com')) {
        return;
      }

      const data = event.data;

      if (!data || !data.type) {
        return;
      }

      console.log('📨 Message from Reddit:', data.type);

      if (data.type === 'SCROLLER_READY') {
        console.log('✅ Reddit window is ready!');

        // Check if this is from the test window (during script detection)
        if (checkingScript && testWindow) {
          console.log('✅ Script installation confirmed!');
          scriptInstalled = true;
          checkingScript = false;

          // CRITICAL: Clear the timeout!
          if (testWindow._checkTimeoutId) {
            clearTimeout(testWindow._checkTimeoutId);
            testWindow._checkTimeoutId = null;
          }

          // Close test window after a short delay
          setTimeout(() => {
            if (testWindow && !testWindow.closed) {
              testWindow.close();
            }
            testWindow = null;
          }, 500);
          return;
        }

        // Otherwise, this is from the main Reddit window
        redditReady = true;

        // Flush any queued messages
        if (messageQueue.length > 0) {
          console.log('🔄 Flushing message queue:', messageQueue.length, 'messages');
          messageQueue.forEach(msg => {
            if (redditWindow && !redditWindow.closed) {
              redditWindow.postMessage(msg, '*');
            }
          });
          messageQueue = [];
        }
      }
    });

    // Track mouse movement
    document.addEventListener('mousemove', () => {
      lastMouseTime = Date.now();
    });

    // Add window polling to detect closed Reddit window
    const windowCheckInterval = setInterval(() => {
      if (redditWindow && redditWindow.closed) {
        console.log('🪟 Reddit window was closed');
        redditWindow = null;
        redditReady = false;
        isScrolling = false;
        if (scrollInterval) {
          clearInterval(scrollInterval);
          scrollInterval = null;
        }
      }
    }, 1000);

    return () => {
      if (scrollInterval) {
        clearInterval(scrollInterval);
      }
      if (windowCheckInterval) {
        clearInterval(windowCheckInterval);
      }
      if (testWindow && !testWindow.closed) {
        testWindow.close();
      }
    };
  });

  // Check if Tampermonkey script is installed
  function checkScriptInstalled() {
    if (checkingScript) return;

    console.log('🔍 Checking if Tampermonkey script is installed...');
    console.log('⏳ Opening Reddit and waiting for script to send READY signal...');
    checkingScript = true;
    scriptInstalled = false;

    // Open with normal size so user can see what's happening
    testWindow = window.open(
      'https://old.reddit.com/',
      'scriptTestWindow',
      'width=800,height=600'
    );

    if (!testWindow) {
      console.log('❌ Could not open test window (popups blocked?)');
      error = 'Popups are blocked. Please allow popups and try again.';
      checkingScript = false;
      scriptInstalled = false;
      return;
    }

    console.log('🪟 Test window opened. Waiting for script to respond...');
    statusMessage = 'Testing Tampermonkey script... (watch the opened window\'s console)';

    // Set timeout - if we don't get READY signal in time, script isn't installed
    const timeoutId = setTimeout(() => {
      if (checkingScript && testWindow && !testWindow.closed) {
        console.log('⏱️ Script check timeout - script may not be installed');
        console.log('💡 Try opening old.reddit.com manually and checking the console for error messages');
        checkingScript = false;
        scriptInstalled = false;
        statusMessage = '';
        error = 'Script check timeout. Open the test window\'s console (F12) to see errors. Script may not be installed correctly.';
        testWindow.close();
        testWindow = null;
      }
    }, SCRIPT_CHECK_TIMEOUT);

    // Store timeout ID for cleanup
    testWindow._checkTimeoutId = timeoutId;
  }

  // Manually install the script
  function installScript() {
    const scriptUrl = `${window.location.origin}/reddit-autoscroll.user.js`;
    console.log('🔗 Opening userscript URL for installation:', scriptUrl);
    statusMessage = 'Opening Tampermonkey installer... Please click "Install" when prompted';
    error = '';

    window.open(scriptUrl, 'scriptInstaller', 'width=1200,height=800');

    // Auto-check after a longer delay to give time for installation
    // User should have completed the install in Tampermonkey by then
    setTimeout(() => {
      console.log('⏳ Auto-checking script installation...');
      checkScriptInstalled();
    }, 6000);
  }

  // Retry script check
  function retryScriptCheck() {
    checkScriptInstalled();
  }

  // Send message to Reddit window
  function sendMessageToReddit(command) {
    if (!redditWindow || redditWindow.closed) {
      console.log('❌ Reddit window not open');
      return false;
    }

    // If Reddit isn't ready yet, queue the message
    if (!redditReady) {
      console.log('⏳ Reddit not ready, queueing message:', command.type);
      messageQueue.push(command);
      return true;
    }

    try {
      redditWindow.postMessage(command, '*');
      console.log('📤 Sent to Reddit:', command.type);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  // Open Reddit in a new window
  function openReddit() {
    if (redditWindow && !redditWindow.closed) {
      console.log('🪟 Reddit window already open, focusing...');
      redditWindow.focus();
      return;
    }

    console.log('🪟 Opening Reddit in new window...');
    redditReady = false;
    messageQueue = [];

    redditWindow = window.open(
      'https://old.reddit.com/',
      'redditWindow',
      'width=1200,height=800'
    );

    if (!redditWindow) {
      error = 'Failed to open Reddit. Check if popups are blocked.';
      return;
    }

    statusMessage = '⏳ Waiting for Reddit to load...';
    error = '';
  }

  // Start scrolling
  function startScrolling() {
    if (!redditWindow || redditWindow.closed) {
      error = 'Reddit window is not open';
      return;
    }

    if (!redditReady) {
      error = 'Reddit is not ready yet. Please wait...';
      return;
    }

    if (isScrolling) {
      return;
    }

    console.log('▶️ Starting scroll with speed:', scrollSpeed);
    isScrolling = true;
    error = '';
    statusMessage = '✅ Scrolling started!';

    sendMessageToReddit({
      type: 'SCROLLER_START',
      scrollSpeed
    });

    // Polling: continuously ensure Reddit knows we want to scroll
    scrollInterval = setInterval(() => {
      if (isScrolling && redditWindow && !redditWindow.closed) {
        const timeSinceLastMouse = Date.now() - lastMouseTime;

        if (timeSinceLastMouse > inactivityDelay) {
          // Only focus if there's been inactivity
          redditWindow.focus();
        }

        // Keep sending ENSURE_ACTIVE to handle timing issues
        sendMessageToReddit({
          type: 'SCROLLER_ENSURE_ACTIVE',
          scrollSpeed
        });
      }
    }, SCROLL_INTERVAL);
  }

  // Stop scrolling
  function stopScrolling() {
    if (!isScrolling) {
      return;
    }

    console.log('⏹️ Stopping scroll');
    isScrolling = false;
    error = '';
    statusMessage = '✅ Scrolling stopped!';

    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }

    sendMessageToReddit({
      type: 'SCROLLER_STOP'
    });
  }

  // Update scroll speed
  function updateSpeed() {
    if (isScrolling) {
      console.log('📏 Updating scroll speed:', scrollSpeed);
      statusMessage = `📏 Speed: ${scrollSpeed}px`;

      sendMessageToReddit({
        type: 'SCROLLER_UPDATE_SPEED',
        scrollSpeed
      });
    }
  }

  // Close Reddit window
  function closeReddit() {
    if (redditWindow && !redditWindow.closed) {
      console.log('❌ Closing Reddit window...');
      redditWindow.close();
    }

    redditWindow = null;
    redditReady = false;
    isScrolling = false;
    error = '';
    statusMessage = '✅ Reddit closed!';

    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  // Watch scroll speed changes
  $: if (isScrolling) {
    updateSpeed();
  }
</script>

<div class="container">
  <div class="control-panel">
    <h1>🔄 Reddit Auto-Scroller</h1>

    <div class="info-box">
      <p>👉 <strong>Instructions:</strong></p>
      <ul>
        <li><strong>First time:</strong> Install Tampermonkey extension, then click "Install Now" below</li>
        <li>Click "Open Reddit" to open Reddit in YOUR browser</li>
        <li>Wait for script to load (watch the "Tampermonkey Script" status)</li>
        <li>When "Reddit Ready" shows ✅, click "Start Scrolling"</li>
        <li>Adjust scroll speed anytime with the slider</li>
        <li>Click "Stop Scrolling" to pause, or "Close Reddit" to exit</li>
      </ul>
    </div>

    <div class="status-panel">
      <div class="status-row">
        <span class="label">Tampermonkey Script:</span>
        <span class="status" class:active={scriptInstalled}>
          {scriptInstalled ? '✅ INSTALLED' : '❌ NOT INSTALLED'}
        </span>
      </div>
      {#if !scriptInstalled}
        {#if !checkingScript}
          <div class="status-row">
            <button on:click={installScript} class="status-action">Install Now</button>
            <button on:click={retryScriptCheck} class="status-action">Check Again</button>
          </div>
        {:else}
          <div class="status-row">
            <span class="status-message">🔍 Checking script installation (this may take a few seconds)...</span>
          </div>
        {/if}
      {/if}
      <div class="status-row">
        <span class="label">Scrolling Status:</span>
        <span class="status" class:active={isScrolling}>
          {isScrolling ? '✅ ACTIVE' : '⏸️ INACTIVE'}
        </span>
      </div>
      <div class="status-row">
        <span class="label">Reddit Window:</span>
        <span class="status" class:active={redditWindow && !redditWindow.closed}>
          {redditWindow && !redditWindow.closed ? '🪟 OPEN' : '❌ CLOSED'}
        </span>
      </div>
      <div class="status-row">
        <span class="label">Reddit Ready:</span>
        <span class="status" class:active={redditReady}>
          {redditReady ? '✅ READY' : '⏳ LOADING...'}
        </span>
      </div>
      {#if statusMessage}
        <div class="status-row">
          <span class="label">Status:</span>
          <span class="status-message">{statusMessage}</span>
        </div>
      {/if}
      {#if error}
        <div class="status-row error">
          <span class="label">Error:</span>
          <span class="error-message">{error}</span>
        </div>
      {/if}
    </div>

    <div class="controls">
      <button
        on:click={openReddit}
        disabled={redditWindow && !redditWindow.closed}
        class="btn btn-primary"
      >
        🪟 Open Reddit
      </button>

      <button
        on:click={startScrolling}
        disabled={!redditWindow || redditWindow.closed || isScrolling || !redditReady}
        class="btn btn-success"
        title={!redditReady ? 'Waiting for Reddit to load...' : ''}
      >
        {!redditReady && redditWindow && !redditWindow.closed ? '⏳ Waiting...' : '▶️ Start Scrolling'}
      </button>

      <button
        on:click={stopScrolling}
        disabled={!isScrolling}
        class="btn btn-warning"
      >
        ⏹️ Stop Scrolling
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
          disabled={!isScrolling}
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
          disabled={isScrolling}
        />
        <small>Time before auto-scroll resumes after mouse movement</small>
      </div>
    </div>

    <div class="footer">
      <p>🌐 <strong>How it works:</strong> Control panel opens Reddit in your browser</p>
      <p>🤖 <strong>Tampermonkey script:</strong> Automatically scrolls via postMessage</p>
      <p>💡 <strong>No backend:</strong> Everything runs client-side in your browser</p>
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

  .status-row.error {
    background: #ffe0e0;
    padding: 10px;
    border-radius: 4px;
    border: none;
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

  .status-message {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 14px;
    background: #d4edda;
    color: #155724;
  }

  .status-action {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
    background: #17a2b8;
    color: white;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    margin-right: 8px;
  }

  .status-action:hover {
    background: #138496;
    transform: translateY(-1px);
  }

  .status-action:active {
    transform: translateY(0);
  }

  .error-message {
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 14px;
    background: #ffdddd;
    color: #cc0000;
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

  .setting-group input[type="range"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
