<script>
  import { onMount, onDestroy } from "svelte";

  const isTauri = !!window.__TAURI_INTERNALS__;
  let invoke;
  if (isTauri) {
    import('@tauri-apps/api/core').then(m => { invoke = m.invoke; });
  }

  let isScrolling = false;
  let scrollSpeed = parseFloat(localStorage.getItem("scrollerSpeed")) || 30;
  $: localStorage.setItem("scrollerSpeed", scrollSpeed);
  let showControls = false;
  let animFrameId = null;
  let lastTimestamp = null;

  let exactScrollY = 0;
  let redditIframe = null;
  let proxyUrl = "";
  let lastScrollY = -1;
  let bottomReachedTimestamp = null;

  const BOTTOM_WAIT_TIME = 5000;

  onMount(() => {
    proxyUrl = "/api/";
    checkLoginStatus();
    scheduleAutoRefresh();

    if (localStorage.getItem("scrollerActive") === "true") {
      const waitForIframe = () => {
        if (redditIframe && redditIframe.contentWindow) {
          startScrolling();
        } else {
          setTimeout(waitForIframe, 200);
        }
      };
      setTimeout(waitForIframe, 500);
    }
  });

  const REFRESH_INTERVAL = 4 * 60 * 60 * 1000;
  let refreshTimer = null;

  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      reloadReddit();
    }, REFRESH_INTERVAL);
  }

  onDestroy(() => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (refreshTimer) clearInterval(refreshTimer);
  });

  function toggleControls() {
    showControls = !showControls;
  }

  function scrollFrame(timestamp) {
    if (!isScrolling) return;

    if (lastTimestamp !== null) {
      const delta = (timestamp - lastTimestamp) / 1000;

      if (redditIframe) {
        try {
          const win = redditIframe.contentWindow;
          const doc = redditIframe.contentDocument || win?.document;

          if (win) {
            const currentActual = win.scrollY;
            if (Math.abs(currentActual - Math.round(exactScrollY)) > 1) {
              exactScrollY = currentActual;
            }
            exactScrollY += scrollSpeed * delta;
            win.scrollTo(0, exactScrollY);

            if (doc) {
              const scrollHeight = doc.documentElement.scrollHeight || doc.body.scrollHeight;
              const clientHeight = doc.documentElement.clientHeight || win.innerHeight;
              const currentPos = win.scrollY;
              const isAtBottom = currentPos + clientHeight >= scrollHeight - 5;
              const isStuck = Math.abs(currentPos - lastScrollY) < 0.1;

              if (isAtBottom && isStuck && currentPos > 100) {
                if (!bottomReachedTimestamp) {
                  bottomReachedTimestamp = Date.now();
                } else if (Date.now() - bottomReachedTimestamp >= BOTTOM_WAIT_TIME) {
                  bottomReachedTimestamp = null;
                  reloadReddit();
                  lastScrollY = -1;
                  exactScrollY = 0;
                  lastTimestamp = timestamp;
                  animFrameId = requestAnimationFrame(scrollFrame);
                  return;
                }
              } else {
                if (bottomReachedTimestamp) bottomReachedTimestamp = null;
              }
              lastScrollY = currentPos;
            }
          }
        } catch (e) {}
      }
    }

    lastTimestamp = timestamp;
    animFrameId = requestAnimationFrame(scrollFrame);
  }

  function startScrolling() {
    if (isScrolling) return;
    isScrolling = true;
    localStorage.setItem("scrollerActive", "true");
    lastTimestamp = null;
    try { exactScrollY = redditIframe?.contentWindow?.scrollY || 0; } catch (e) { exactScrollY = 0; }
    animFrameId = requestAnimationFrame(scrollFrame);
  }

  function stopScrolling() {
    isScrolling = false;
    localStorage.setItem("scrollerActive", "false");
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    lastTimestamp = null;
  }

  function reloadReddit() {
    if (redditIframe) redditIframe.src = proxyUrl + "?t=" + Date.now();
  }

  let currentUser = null;
  let storedAccounts = [];
  let loginStatus = "";

  async function checkLoginStatus() {
    try {
      const resp = await fetch("/auth/status");
      const data = await resp.json();
      currentUser = data.loggedIn ? data.username : null;
      storedAccounts = data.accounts || [];
      if (currentUser) loginStatus = "";
    } catch (e) {}
  }

  async function logout() {
    try {
      const resp = await fetch("/auth/logout", { method: "POST" });
      const data = await resp.json();
      currentUser = null;
      storedAccounts = data.accounts || [];
      loginStatus = "";
      reloadReddit();
    } catch (e) {}
  }

  async function switchAccount(username) {
    loginStatus = "Switching...";
    try {
      const resp = await fetch("/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
      });
      const data = await resp.json();
      if (data.ok) { currentUser = data.username; loginStatus = ""; reloadReddit(); }
      else { loginStatus = data.error; }
    } catch (e) { loginStatus = "Error switching"; }
  }

  function addAccount() {
    const w = 500, h = 600;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    const popup = window.open("/auth/login-page", "reddit_login", `width=${w},height=${h},left=${left},top=${top}`);
    loginStatus = "Log in with the popup...";
    const poll = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        loginStatus = "Extracting session...";
        try {
          const resp = await fetch("/auth/add-account");
          const data = await resp.json();
          if (data.ok) { currentUser = data.username; storedAccounts = data.accounts || []; loginStatus = ""; reloadReddit(); }
          else { loginStatus = data.error; }
        } catch (e) { loginStatus = "Error extracting session"; }
      }
    }, 500);
  }
</script>

<div class="container">
  {#if proxyUrl}
    <iframe
      bind:this={redditIframe}
      title="Reddit"
      src={proxyUrl}
      class="reddit-frame"
    ></iframe>
  {/if}

  <div class="floating-controls">
    <button class="cog-button" on:click={toggleControls} title="Toggle controls">&#9881;&#65039;</button>
    {#if showControls}
      <div class="control-panel">
        <h3>Auto-Scroll</h3>

        <div class="section-label">Reddit</div>
        {#if currentUser}
          <div class="login-status">u/{currentUser}</div>
          <div class="controls"><button class="btn btn-logout" on:click={logout}>Logout</button></div>
        {:else}
          {#each storedAccounts as acct}
            <div class="controls"><button class="btn btn-account" on:click={() => switchAccount(acct)}>u/{acct}</button></div>
          {/each}
          <div class="controls"><button class="btn btn-login" on:click={addAccount}>+ Add Account</button></div>
        {/if}
        {#if loginStatus}<div class="login-status">{loginStatus}</div>{/if}

        <div class="controls">
          {#if !isScrolling}
            <button class="btn btn-start" on:click={startScrolling}>&#9654;&#65039; Start</button>
          {:else}
            <button class="btn btn-stop" on:click={stopScrolling}>&#9209;&#65039; Stop</button>
          {/if}
        </div>
        <div class="settings">
          <label for="speed" class="speed-label">
            Speed: <input type="number" class="speed-input" min="0.1" max="200" step="0.1" bind:value={scrollSpeed} /> <span>px/s</span>
          </label>
          <input id="speed" type="range" min="0.1" max="200" step="0.1" bind:value={scrollSpeed} />
          <small>Pixels per second</small>
        </div>
        <div class="status">
          {#if isScrolling}<span class="status-active">&#10004;&#65039; Scrolling</span>{:else}<span class="status-inactive">&#9208;&#65039; Paused</span>{/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; padding: 0; overflow: hidden; background: #000; width: 100%; height: 100%; }
  :global(html) { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
  :global(#app) { width: 100%; height: 100%; display: flex; }

  .container { width: 100vw; height: 100vh; position: relative; margin: 0; padding: 0; overflow: hidden; }

  .reddit-frame {
    width: 100%;
    height: 100%;
    border: none !important;
    display: block !important;
  }

  .floating-controls { position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: sans-serif; pointer-events: auto; }
  .cog-button { width: 60px; height: 60px; border-radius: 50%; border: none; background: #272729; box-shadow: 0 4px 12px rgba(0,0,0,0.4); cursor: pointer; font-size: 28px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; padding: 0; }
  .cog-button:hover { transform: scale(1.1); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5); }
  .cog-button:active { transform: scale(0.95); }
  .control-panel { position: absolute; bottom: 80px; right: 0; background: #1a1a1b; border: 1px solid #343536; border-radius: 12px; padding: 20px; width: 240px; color: #d7dadc; animation: slideUp 0.2s ease; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .control-panel h3 { margin: 0 0 15px 0; font-size: 16px; }
  .controls { display: flex; gap: 10px; margin-bottom: 15px; }
  .btn { flex: 1; padding: 10px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
  .btn-start { background: #28a745; color: white; }
  .btn-stop { background: #dc3545; color: white; }
  .btn-login { background: #0079d3; color: white; width: 100%; }
  .btn-logout { background: #343536; color: #d7dadc; width: 100%; }
  .btn-account { background: #272729; color: #4fbcff; width: 100%; border: 1px solid #343536; }
  .login-status { font-size: 11px; color: #576f76; text-align: center; margin-bottom: 10px; }
  .settings { margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #343536; }
  .settings label { display: flex; justify-content: space-between; align-items: center; }
  .speed-input { width: 70px; background: #272729; border: 1px solid #343536; color: #d7dadc; padding: 4px; border-radius: 4px; text-align: center; font-weight: 600; }
  .settings input[type="range"] { width: 100%; margin-top: 8px; cursor: pointer; }
  .settings small { display: block; color: #818384; font-size: 11px; margin-top: 4px; }
  .status { text-align: center; font-size: 12px; font-weight: 600; }
  .status-active { color: #28a745; }
  .status-inactive { color: #818384; }
  .section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #818384; text-transform: uppercase; margin: 8px 0 6px; border-top: 1px solid #343536; padding-top: 8px; }
</style>
