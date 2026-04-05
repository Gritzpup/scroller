document.addEventListener("DOMContentLoaded", () => {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.matches(".expando-button")) {
            addExpandoListener(node);
          }
          if (node.nodeType === 1 && node.querySelectorAll) {
            node.querySelectorAll(".expando-button").forEach(addExpandoListener);
          }
        });
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function addExpandoListener(button) {
    if (button.dataset.listenerAdded) return;
    
    button.dataset.listenerAdded = "true";
    button.addEventListener("click", (e) => {
      if (button.classList.contains("selftext")) {
        return; // Allow default Reddit JS to handle text posts
      }
      e.preventDefault();
      e.stopPropagation();

      const postBody = button.closest(".thing").querySelector(".expando");
      if (postBody) {
        if (postBody.style.display === "none" || postBody.classList.contains("hidden")) {
          postBody.style.display = "block";
          postBody.classList.remove("hidden");
          button.classList.remove("collapsed");
          button.classList.add("expanded");
        } else {
          postBody.style.display = "none";
          postBody.classList.add("hidden");
          button.classList.remove("expanded");
          button.classList.add("collapsed");
        }
      }
    }, true);
  }

  document.querySelectorAll(".expando-button").forEach(addExpandoListener);
});