<script>
  import { onMount, onDestroy } from 'svelte';

  let isScrolling = false;
  let scrollSpeed = parseFloat(localStorage.getItem('scrollerSpeed')) || 30;
  $: localStorage.setItem('scrollerSpeed', scrollSpeed);
  let showControls = false;
  let animFrameId = null;
  let lastTimestamp = null;
  let exactScrollY = 0;
  let iframeElement = null;
  let proxyUrl = '';

  onMount(() => {
    proxyUrl = '/api/';
    checkLoginStatus();
    scheduleAutoRefresh();

    // Listen for messages from the popup (if used)
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SCROLLER_BOTTOM_REACHED') {
        console.log('Popup reached bottom. Refreshing...');
        // For popup, we might want to tell it to reload or just trigger a reload here
        // If it's the iframe, reloadIframe() works. 
        // If it's a popup, we might not have a direct way to reload it unless we keep the reference.
        // But the iframe is the primary use case for this app's main view.
        reloadIframe();
      }
    });

    // Auto-resume scrolling if it was active before refresh
    if (localStorage.getItem('scrollerActive') === 'true') {
      // Wait for iframe to load before starting
      const waitForIframe = () => {
        if (iframeElement && iframeElement.contentWindow) {
          startScrolling();
        } else {
          setTimeout(waitForIframe, 200);
        }
      };
      setTimeout(waitForIframe, 500);
    }
  });

  // Auto-refresh every 4 hours to keep content fresh
  const REFRESH_INTERVAL = 4 * 60 * 60 * 1000;
  let refreshTimer = null;

  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      console.log('Auto-refreshing scroller (4-hour interval)');
      reloadIframe();
    }, REFRESH_INTERVAL);
  }

  onDestroy(() => {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
  });

  function toggleControls() {
    showControls = !showControls;
  }

  let lastScrollY = -1;
  let bottomReachedTimestamp = null;
  const BOTTOM_WAIT_TIME = 5000; // 5 seconds

  function scrollFrame(timestamp) {
    if (!isScrolling) return;

    if (lastTimestamp !== null) {
      const delta = (timestamp - lastTimestamp) / 1000;

      if (iframeElement) {
        try {
          const iframeWin = iframeElement.contentWindow;
          const iframeDoc = iframeElement.contentDocument || iframeWin?.document;
          
          if (iframeWin) {
            const currentActual = iframeWin.scrollY;
            
            // Re-sync if user scrolled manually
            if (Math.abs(currentActual - Math.round(exactScrollY)) > 1) {
              exactScrollY = currentActual;
            }
            
            exactScrollY += scrollSpeed * delta;
            iframeWin.scrollTo(0, exactScrollY);

            // Check if we've reached the bottom
            // Using scrollHeight, clientHeight, and scrollY
            if (iframeDoc) {
              const scrollHeight = iframeDoc.documentElement.scrollHeight || iframeDoc.body.scrollHeight;
              const clientHeight = iframeDoc.documentElement.clientHeight || iframeWin.innerHeight;
              const currentPos = iframeWin.scrollY;

              const isAtBottom = currentPos + clientHeight >= scrollHeight - 5;
              const isStuck = Math.abs(currentPos - lastScrollY) < 0.1;

              // Only refresh if we hit the bottom AND stopped scrolling for 5 seconds
              if (isAtBottom && isStuck) {
                if (currentPos > 100) { // Only count as bottom if we've actually scrolled down a bit
                  if (!bottomReachedTimestamp) {
                    bottomReachedTimestamp = Date.now();
                    console.log('Bottom reached. Waiting 5s before refresh...');
                  } else if (Date.now() - bottomReachedTimestamp >= BOTTOM_WAIT_TIME) {
                    console.log('Bottom reached and waited 5s. Refreshing...');
                    bottomReachedTimestamp = null;
                    reloadIframe();
                    lastScrollY = -1;
                    exactScrollY = 0;
                    lastTimestamp = timestamp;
                    animFrameId = requestAnimationFrame(scrollFrame);
                    return;
                  }
                }
              } else {
                if (bottomReachedTimestamp) {
                  console.log('Moved away from bottom or resumed scrolling. Resetting refresh timer.');
                  bottomReachedTimestamp = null;
                }
              }
              lastScrollY = currentPos;
            }
          }
        } catch (e) {
          console.log('Cannot scroll iframe:', e.message);
        }
      }
    }

    lastTimestamp = timestamp;
    animFrameId = requestAnimationFrame(scrollFrame);
  }

  function startScrolling() {
    if (isScrolling) return;
    isScrolling = true;
    localStorage.setItem('scrollerActive', 'true');
    lastTimestamp = null;
    try {
      exactScrollY = iframeElement?.contentWindow?.scrollY || 0;
    } catch (e) {
      exactScrollY = 0;
    }
    animFrameId = requestAnimationFrame(scrollFrame);
  }

  function stopScrolling() {
    isScrolling = false;
    localStorage.setItem('scrollerActive', 'false');
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    lastTimestamp = null;
  }

  let loginStatus = '';
  let currentUser = null;
  let storedAccounts = [];

  async function checkLoginStatus() {
    try {
      const resp = await fetch('/auth/status');
      const data = await resp.json();
      currentUser = data.loggedIn ? data.username : null;
      storedAccounts = data.accounts || [];
      if (currentUser) loginStatus = '';
    } catch (e) {}
  }

  async function logout() {
    try {
      const resp = await fetch('/auth/logout', { method: 'POST' });
      const data = await resp.json();
      currentUser = null;
      storedAccounts = data.accounts || [];
      loginStatus = '';
      reloadIframe();
    } catch (e) {}
  }

  async function switchAccount(username) {
    loginStatus = 'Switching...';
    try {
      const resp = await fetch('/auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await resp.json();
      if (data.ok) {
        currentUser = data.username;
        loginStatus = '';
        reloadIframe();
      } else {
        loginStatus = data.error;
      }
    } catch (e) {
      loginStatus = 'Error switching';
    }
  }

  function addAccount() {
    const w = 500, h = 600;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    const popup = window.open(
      '/auth/login-page',
      'reddit_login',
      `width=${w},height=${h},left=${left},top=${top}`
    );
    loginStatus = 'Log in with the popup...';
    const poll = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        loginStatus = 'Extracting session...';
        try {
          const resp = await fetch('/auth/add-account');
          const data = await resp.json();
          if (data.ok) {
            currentUser = data.username;
            storedAccounts = data.accounts || [];
            loginStatus = '';
            reloadIframe();
          } else {
            loginStatus = data.error;
          }
        } catch (e) {
          loginStatus = 'Error extracting session';
        }
      }
    }, 500);
  }

  function reloadIframe() {
    if (iframeElement) {
      iframeElement.src = proxyUrl + '?t=' + Date.now();
    }
  }
</script>

<div class="container">
  <!-- Full-screen Reddit iframe (via proxy to bypass X-Frame-Options) -->
  {#if proxyUrl}
    <iframe
      bind:this={iframeElement}
      title="Reddit"
      src={proxyUrl}
      class="reddit-frame"
    ></iframe>
  {/if}

  <!-- Floating control panel (bottom-right) -->
  <div class="floating-controls">
    <!-- Cog icon button -->
    <button
      class="cog-button"
      on:click={toggleControls}
      title="Toggle autoscroll controls"
      aria-label="Toggle controls"
    >
      ⚙️
    </button>

    <!-- Control panel (shown/hidden) -->
    {#if showControls}
      <div class="control-panel">
        <h3>Auto-Scroll</h3>


        {#if currentUser}
          <div class="login-status">u/{currentUser}</div>
          <div class="controls">
            <button class="btn btn-logout" on:click={logout}>Logout</button>
          </div>
        {:else}
          {#each storedAccounts as acct}
            <div class="controls">
              <button class="btn btn-account" on:click={() => switchAccount(acct)}>u/{acct}</button>
            </div>
          {/each}
          <div class="controls">
            <button class="btn btn-login" on:click={addAccount}>+ Add Account</button>
          </div>
        {/if}
        {#if loginStatus}
          <div class="login-status">{loginStatus}</div>
        {/if}

        <div class="controls">
          {#if !isScrolling}
            <button class="btn btn-start" on:click={startScrolling}>
              ▶️ Start
            </button>
          {:else}
            <button class="btn btn-stop" on:click={stopScrolling}>
              ⏹️ Stop
            </button>
          {/if}
        </div>

        <div class="settings">
                    <label for="speed" class="speed-label">
                      Speed:
                      <input
                        type="number"
                        class="speed-input"
                        min="0.1"
                        max="200"
                        step="0.1"
                        bind:value={scrollSpeed}
                      />
                      <span>px/s</span>
                    </label>
                    <input
                      id="speed"
                      type="range"
                      min="0.1"
                      max="200"
                      step="0.1"
                      bind:value={scrollSpeed}
                    />          <small>Pixels per second</small>
        </div>

        <div class="status">
          {#if isScrolling}
            <span class="status-active">✅ Scrolling</span>
          {:else}
            <span class="status-inactive">⏸️ Paused</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #000;
    width: 100%;
    height: 100%;
  }

  :global(html) {
    margin: 0;
    padding: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  :global(#app) {
    width: 100%;
    height: 100%;
    display: flex;
  }

  .container {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    position: relative;
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
  }

  .reddit-frame {
    width: 100vw;
    height: 100vh;
    border: none !important;
    display: block !important;
    flex: 1;
    margin: 0 !important;
    padding: 0 !important;
    position: absolute;
    top: 0;
    left: 0;
  }

  .floating-controls {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: auto;
  }

  .cog-button {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    border: none;
    background: #272729;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    font-size: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    padding: 0;
  }

  .cog-button:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
  }

  .cog-button:active {
    transform: scale(0.95);
  }

  .control-panel {
    position: absolute;
    bottom: 80px;
    right: 0;
    background: #1a1a1b;
    border: 1px solid #343536;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    padding: 20px;
    width: 240px;
    animation: slideUp 0.2s ease;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .control-panel h3 {
    margin: 0 0 15px 0;
    font-size: 16px;
    color: #d7dadc;
  }

  .controls {
    display: flex;
    gap: 10px;
    margin-bottom: 15px;
  }

  .btn {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 13px;
    white-space: nowrap;
  }

  .btn-start {
    background: #28a745;
    color: white;
  }

  .btn-start:hover {
    background: #218838;
    transform: translateY(-1px);
  }

  .btn-stop {
    background: #dc3545;
    color: white;
  }

  .btn-stop:hover {
    background: #c82333;
    transform: translateY(-1px);
  }

  .btn-login {
    background: #0079d3;
    color: white;
    width: 100%;
  }

  .btn-login:hover {
    background: #005fa3;
    transform: translateY(-1px);
  }

  .btn-logout {
    background: #343536;
    color: #d7dadc;
    width: 100%;
  }

  .btn-logout:hover {
    background: #4a4a4c;
    transform: translateY(-1px);
  }

  .btn-account {
    background: #272729;
    color: #4fbcff;
    width: 100%;
    border: 1px solid #343536;
  }

  .btn-account:hover {
    background: #343536;
    transform: translateY(-1px);
  }

  .login-status {
    font-size: 11px;
    color: #576f76;
    text-align: center;
    margin-bottom: 10px;
    word-break: break-word;
  }

  .settings {
    margin-bottom: 15px;
    padding-bottom: 15px;
    border-bottom: 1px solid #343536;
  }

  .settings label.speed-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .speed-input {
    width: 70px;
    background: #272729;
    border: 1px solid #343536;
    border-radius: 4px;
    color: #d7dadc;
    font-weight: 600;
    padding: 4px 6px;
    text-align: center;
  }

  .settings input[type="range"] {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: #343536;
    outline: none;
    -webkit-appearance: none;
    cursor: pointer;
    margin-top: 8px; /* Add some space between input and slider */
  }

  .settings input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #28a745;
    cursor: pointer;
  }

  .settings input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #28a745;
    cursor: pointer;
    border: none;
  }

  .settings small {
    display: block;
    color: #818384;
    font-size: 11px;
    margin-top: 4px;
  }

  .status {
    text-align: center;
    font-size: 12px;
    font-weight: 600;
  }

  .status-active {
    color: #28a745;
  }

  .status-inactive {
    color: #818384;
  }
</style>
