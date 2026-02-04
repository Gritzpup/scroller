<script>
  import { onMount, onDestroy } from 'svelte';

  let isScrolling = false;
  let scrollSpeed = parseInt(localStorage.getItem('scrollerSpeed'), 10) || 30;
  $: localStorage.setItem('scrollerSpeed', scrollSpeed);
  let showControls = false;
  let animFrameId = null;
  let lastTimestamp = null;
  let exactScrollY = 0;
  let iframeElement = null;
  let proxyUrl = '';

  onMount(() => {
    // Use same origin for proxy (combined frontend + backend)
    proxyUrl = '/api/';

    console.log('📡 Proxy URL:', proxyUrl);

  });

  onDestroy(() => {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
    }
  });

  function toggleControls() {
    showControls = !showControls;
  }

  function scrollFrame(timestamp) {
    if (!isScrolling) return;

    if (lastTimestamp !== null) {
      const delta = (timestamp - lastTimestamp) / 1000;

      if (iframeElement) {
        try {
          const iframeWin = iframeElement.contentWindow;
          if (iframeWin) {
            const currentActual = iframeWin.scrollY;
            if (Math.abs(currentActual - Math.round(exactScrollY)) > 1) {
              exactScrollY = currentActual;
            }
            exactScrollY += scrollSpeed * delta;
            iframeWin.scrollTo(0, exactScrollY);
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
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    lastTimestamp = null;
  }

  let loginStatus = '';

  async function loginToReddit() {
    console.log('🔐 Auto-extracting Reddit session from Brave...');
    loginStatus = 'Connecting...';
    try {
      const resp = await fetch('/auth/login');
      const data = await resp.json();
      if (data.ok) {
        loginStatus = `Logged in as u/${data.username}`;
        console.log(`✅ ${loginStatus}`);
        // Reload iframe to show logged-in Reddit
        const frame = document.querySelector('iframe');
        if (frame) {
          frame.src = proxyUrl + '?t=' + Date.now();
        }
      } else {
        loginStatus = data.error;
        console.error('❌ Login failed:', data.error);
      }
    } catch (err) {
      loginStatus = 'Connection error';
      console.error('❌ Login error:', err);
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


        <div class="controls">
          <button class="btn btn-login" on:click={loginToReddit}>
            🔐 Login
          </button>
        </div>
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
          <label for="speed">
            Speed: <strong>{scrollSpeed}px/s</strong>
          </label>
          <input
            id="speed"
            type="range"
            min="1"
            max="200"
            step="5"
            bind:value={scrollSpeed}
          />
          <small>Pixels per second</small>
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

  .settings label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #d7dadc;
    margin-bottom: 8px;
  }

  .settings input[type="range"] {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: #343536;
    outline: none;
    -webkit-appearance: none;
    cursor: pointer;
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
