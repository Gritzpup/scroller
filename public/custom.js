/* Handle selftext expandos — content is lazy-loaded (expando-uninitialized),
   so we fetch it via Reddit JSON API and inject it.
   Image/video expandos work natively through media proxy + setAttribute rewriting. */
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    const button = e.target.closest(".expando-button.selftext");
    if (!button) return;

    e.preventDefault();
    e.stopPropagation();

    const thing = button.closest(".thing");
    if (!thing) return;
    const expando = thing.querySelector(".expando");
    if (!expando) return;

    // If already expanded, just collapse
    if (button.classList.contains("expanded")) {
      expando.style.display = "none";
      button.classList.remove("expanded");
      button.classList.add("collapsed");
      return;
    }

    // If content already loaded, just show it
    if (expando.dataset.loaded) {
      expando.style.display = "block";
      button.classList.remove("collapsed");
      button.classList.add("expanded");
      return;
    }

    // Fetch selftext via JSON API
    const fullname = thing.getAttribute("data-fullname");
    if (!fullname) return;

    expando.style.display = "block";
    expando.innerHTML = '<div style="padding:8px;color:#818384;">Loading...</div>';
    button.classList.remove("collapsed");
    button.classList.add("expanded");

    fetch("/api/by_id/" + fullname + ".json")
      .then((r) => r.json())
      .then((data) => {
        const post = data.data.children[0].data;
        const html = post.selftext_html;
        if (html) {
          // selftext_html is HTML-entity-encoded, decode it
          const txt = document.createElement("textarea");
          txt.innerHTML = html;
          expando.innerHTML =
            '<div class="usertext-body may-blank-within md-container">' +
            txt.value +
            "</div>";
        } else {
          expando.innerHTML =
            '<div style="padding:8px;color:#818384;">No text content</div>';
        }
        expando.dataset.loaded = "true";
      })
      .catch(() => {
        expando.innerHTML =
          '<div style="padding:8px;color:#ff4500;">Failed to load post</div>';
      });
  }, true);
});
