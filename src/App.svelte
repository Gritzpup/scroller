<script>
  import { onMount, onDestroy } from "svelte";

  // Prevent inception: if loaded inside an iframe (proxy fallback), don't render
  let isTopLevel = true;
  try { isTopLevel = window.self === window.top; } catch (e) { isTopLevel = false; }

  let isScrolling = false;
  let scrollSpeed = parseFloat(localStorage.getItem("scrollerSpeed")) || 30;
  $: localStorage.setItem("scrollerSpeed", scrollSpeed);
  let showControls = false;
  let animFrameId = null;
  let lastTimestamp = null;

  // State for Reddit
  let exactScrollYReddit = 0;
  let redditIframe = null;
  let proxyUrlReddit = "";
  let lastScrollYReddit = -1;
  let bottomReachedTimestampReddit = null;

  // State for Facebook
  let exactScrollYFb = 0;
  let fbIframe = null;
  let proxyUrlFb = "";
  let lastScrollYFb = -1;
  let bottomReachedTimestampFb = null;

  const BOTTOM_WAIT_TIME = 5000; // 5 seconds

  // Facebook auth state
  let fbUid = null;
  let fbLoginStatus = "";

  // Resizing state
  let isDragging = false;
  let redditFlexGrow = parseFloat(localStorage.getItem("redditFlexGrow")) || 1;

  function handleDividerMouseDown() {
    isDragging = true;
    document.body.classList.add('is-dragging');
  }

  function handleMouseMove(e) {
    if (!isDragging) return;

    const redditPane = document.querySelector(".reddit-pane");
    const fbPane = document.querySelector(".fb-pane");
    const divider = document.querySelector(".divider");

    if (!redditPane || !fbPane || !divider) return;

    const redditRect = redditPane.getBoundingClientRect();
    const fbRect = fbPane.getBoundingClientRect();
    const totalUsableWidth = redditRect.width + fbRect.width;

    const ratio = (e.clientX - redditRect.left) / totalUsableWidth;

    // Clamp between 0.2 and 0.8 ratio
    const clamped = Math.max(0.2, Math.min(0.8, ratio));
    redditFlexGrow = clamped / (1 - clamped);

    localStorage.setItem("redditFlexGrow", redditFlexGrow);
  }

  function handleMouseUp() {
    isDragging = false;
    document.body.classList.remove('is-dragging');
  }

  onMount(() => {
    proxyUrlReddit = "/api/";
    proxyUrlFb = "/fb-api/";
    checkLoginStatus();
    checkFbLoginStatus();
    scheduleAutoRefresh();

    // Auto-resume scrolling if it was active before refresh
    if (localStorage.getItem("scrollerActive") === "true") {
      const waitForIframes = () => {
        if ((redditIframe && redditIframe.contentWindow) && (fbIframe && fbIframe.contentWindow)) {
          startScrolling();
        } else {
          setTimeout(waitForIframes, 200);
        }
      };
      setTimeout(waitForIframes, 500);
    }
  });

  const REFRESH_INTERVAL = 4 * 60 * 60 * 1000;
  let refreshTimer = null;

  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      console.log("Auto-refreshing scroller (4-hour interval)");
      reloadReddit();
      reloadFb();
    }, REFRESH_INTERVAL);
  }

  onDestroy(() => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (refreshTimer) clearInterval(refreshTimer);
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  });

  $: {
    if (typeof window !== "undefined") {
      if (isDragging) {
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
      } else {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      }
    }
  }

  function toggleControls() {
    showControls = !showControls;
  }

  function handleScrollLogic(iframeEl, state) {
    if (!iframeEl) return false;
    try {
      const win = iframeEl.contentWindow;
      const doc = iframeEl.contentDocument || win?.document;

      if (win) {
        const currentActual = win.scrollY;

        // Re-sync if user scrolled manually
        if (Math.abs(currentActual - Math.round(state.exactScrollY)) > 1) {
          state.exactScrollY = currentActual;
        }

        state.exactScrollY += scrollSpeed * state.delta;
        win.scrollTo(0, state.exactScrollY);

        if (doc) {
          const scrollHeight = doc.documentElement.scrollHeight || doc.body.scrollHeight;
          const clientHeight = doc.documentElement.clientHeight || win.innerHeight;
          const currentPos = win.scrollY;

          const isAtBottom = currentPos + clientHeight >= scrollHeight - 5;
          const isStuck = Math.abs(currentPos - state.lastScrollY) < 0.1;

          if (isAtBottom && isStuck) {
            if (currentPos > 100) {
              if (!state.bottomReachedTimestamp) {
                state.bottomReachedTimestamp = Date.now();
                console.log(state.name + " bottom reached. Waiting 5s...");
              } else if (Date.now() - state.bottomReachedTimestamp >= BOTTOM_WAIT_TIME) {
                console.log(state.name + " bottom reached and waited 5s. Refreshing...");
                state.bottomReachedTimestamp = null;
                state.reloadFn();
                state.lastScrollY = -1;
                state.exactScrollY = 0;
                return true; // Indicate refresh happened
              }
            }
          } else {
            if (state.bottomReachedTimestamp) {
              state.bottomReachedTimestamp = null;
            }
          }
          state.lastScrollY = currentPos;
        }
      }
    } catch (e) {
      console.log("Cannot scroll " + state.name + ":", e.message);
    }
    return false;
  }

  function scrollFrame(timestamp) {
    if (!isScrolling) return;

    if (lastTimestamp !== null) {
      const delta = (timestamp - lastTimestamp) / 1000;

      // Handle Reddit
      let redditState = {
        name: "Reddit",
        delta,
        exactScrollY: exactScrollYReddit,
        lastScrollY: lastScrollYReddit,
        bottomReachedTimestamp: bottomReachedTimestampReddit,
        reloadFn: reloadReddit
      };

      let redditRefreshed = handleScrollLogic(redditIframe, redditState);
      exactScrollYReddit = redditState.exactScrollY;
      lastScrollYReddit = redditState.lastScrollY;
      bottomReachedTimestampReddit = redditState.bottomReachedTimestamp;

      // Update Reddit state
      if (!redditRefreshed && redditIframe) {
        try {
           exactScrollYReddit = redditIframe.contentWindow?.scrollY || 0;
           lastScrollYReddit = exactScrollYReddit;
        } catch(e) {}
      } else if (redditRefreshed) {
        exactScrollYReddit = 0;
        lastScrollYReddit = -1;
      }

      // Handle Facebook
      let fbState = {
        name: "Facebook",
        delta,
        exactScrollY: exactScrollYFb,
        lastScrollY: lastScrollYFb,
        bottomReachedTimestamp: bottomReachedTimestampFb,
        reloadFn: reloadFb
      };

      let fbRefreshed = handleScrollLogic(fbIframe, fbState);
      exactScrollYFb = fbState.exactScrollY;
      lastScrollYFb = fbState.lastScrollY;
      bottomReachedTimestampFb = fbState.bottomReachedTimestamp;

      // Update FB state
      if (!fbRefreshed && fbIframe) {
        try {
           exactScrollYFb = fbIframe.contentWindow?.scrollY || 0;
           lastScrollYFb = exactScrollYFb;
        } catch(e) {}
      } else if (fbRefreshed) {
        exactScrollYFb = 0;
        lastScrollYFb = -1;
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
    try { exactScrollYReddit = redditIframe?.contentWindow?.scrollY || 0; } catch (e) { exactScrollYReddit = 0; }
    try { exactScrollYFb = fbIframe?.contentWindow?.scrollY || 0; } catch (e) { exactScrollYFb = 0; }
    animFrameId = requestAnimationFrame(scrollFrame);
  }

  function stopScrolling() {
    isScrolling = false;
    localStorage.setItem("scrollerActive", "false");
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    lastTimestamp = null;
  }

  function reloadReddit() {
    if (redditIframe) redditIframe.src = proxyUrlReddit + "?t=" + Date.now();
  }

  function reloadFb() {
    if (fbIframe) fbIframe.src = proxyUrlFb + "?t=" + Date.now();
  }
  async function checkFbLoginStatus() {
    try {
      const resp = await fetch("/fb-auth/status");
      const data = await resp.json();
      fbUid = data.loggedIn ? data.uid : null;
      if (!fbUid) fbLoginStatus = "Not logged in";
      else fbLoginStatus = "";
    } catch (e) { fbLoginStatus = "Error"; }
  }

  async function pullFbFromBrave() {
    fbLoginStatus = "Pulling from Brave...";
    try {
      const resp = await fetch("/fb-auth/pull");
      const data = await resp.json();
      if (data.ok) {
        fbUid = data.uid;
        fbLoginStatus = "";
        reloadFb();
      } else {
        fbLoginStatus = data.error || "Failed";
      }
    } catch (e) {
      fbLoginStatus = "Connection error";
    }
  }

  async function fbLogout() {
    try {
      await fetch("/fb-auth/logout", { method: "POST" });
      fbUid = null;
      fbLoginStatus = "Not logged in";
      reloadFb();
    } catch (e) {}
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
      if (data.ok) {
        currentUser = data.username;
        loginStatus = "";
        reloadReddit();
      } else {
        loginStatus = data.error;
      }
    } catch (e) {
      loginStatus = "Error switching";
    }
  }

  function addAccount() {
    const w = 500, h = 600;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    const popup = window.open(
      "/auth/login-page",
      "reddit_login",
      `width=${w},height=${h},left=${left},top=${top}`
    );
    loginStatus = "Log in with the popup...";
    const poll = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        loginStatus = "Extracting session...";
        try {
          const resp = await fetch("/auth/add-account");
          const data = await resp.json();
          if (data.ok) {
            currentUser = data.username;
            storedAccounts = data.accounts || [];
            loginStatus = "";
            reloadReddit();
          } else {
            loginStatus = data.error;
          }
        } catch (e) {
          loginStatus = "Error extracting session";
        }
      }
    }, 500);
  }
</script>

{#if isTopLevel}
<div class="container">
  <div class="split-view">
    <div class="pane reddit-pane" style="flex-grow: {redditFlexGrow}">
      {#if proxyUrlReddit}
        <iframe
          bind:this={redditIframe}
          title="Reddit"
          src={proxyUrlReddit}
          class="content-frame"
        ></iframe>
      {/if}
    </div>

    <div
      class="divider"
      class:dragging={isDragging}
      on:mousedown={handleDividerMouseDown}
      role="separator"
      tabindex="0"
    ></div>

    <div class="pane fb-pane" style="flex-grow: 1">
      {#if proxyUrlFb}
        <iframe
          bind:this={fbIframe}
          title="Facebook"
          src={proxyUrlFb}
          class="content-frame"
        ></iframe>
      {/if}
    </div>
  </div>

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

        <div class="section-label">Facebook</div>
        {#if fbUid}
          <div class="login-status fb-uid">FB uid: {fbUid} &#10004;&#65039;</div>
          <div class="controls"><button class="btn btn-fb-logout" on:click={fbLogout}>Clear FB Session</button></div>
        {:else}
          <div class="login-status fb-warn">{fbLoginStatus || "Not connected"}</div>
          <div class="controls"><button class="btn btn-fb-pull" on:click={pullFbFromBrave}>Pull FB from Brave</button></div>
        {/if}

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
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; padding: 0; overflow: hidden; background: #000; width: 100%; height: 100%; }
  :global(html) { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
  :global(#app) { width: 100%; height: 100%; display: flex; }

  .container { width: 100vw; height: 100vh; position: relative; display: flex; flex-direction: column; margin: 0; padding: 0; overflow: hidden; }

  .split-view {
    display: flex;
    flex-direction: row;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .pane {
    flex: 1;
    position: relative;
    overflow: hidden;
    min-width: 0;
  }

  .content-frame {
    width: calc(100% + 20px);
    height: 100%;
    border: none !important;
    display: block !important;
    pointer-events: auto;
  }

  :global(body.is-dragging) .content-frame {
    pointer-events: none;
  }

  .divider {
    width: 4px;
    height: 100%;
    background-color: #333;
    z-index: 10;
    cursor: col-resize;
    user-select: none;
    transition: background-color 0.2s ease;
    flex: 0 0 4px;
  }

  .divider:hover {
    background-color: #555;
  }

  .divider.dragging {
    background-color: #0079d3;
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
  .fb-uid { color: #28a745 !important; }
  .fb-warn { color: #e4a11b !important; }
  .btn-fb-pull { background: #1877f2; color: white; width: 100%; }
  .btn-fb-pull:hover { background: #1466d1; }
  .btn-fb-logout { background: #343536; color: #d7dadc; width: 100%; }
</style>
