// password-toggle.js
// Adds a "show/hide password" eye button to every password field on the
// page. Include this on any page with password inputs — no setup needed,
// it finds them automatically.
//
//   <script src="password-toggle.js" defer></script>

(function () {
  function wrapField(input) {
    // Skip if already wrapped (safety against double-init)
    if (input.parentElement.classList.contains("password-field-wrap")) return;

    const wrap = document.createElement("div");
    wrap.className = "password-field-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "password-toggle-btn";
    toggleBtn.setAttribute("aria-label", "Show password");
    toggleBtn.textContent = "👁️";
    wrap.appendChild(toggleBtn);

    toggleBtn.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      toggleBtn.textContent = isHidden ? "🙈" : "👁️";
      toggleBtn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  }

  function init() {
    document.querySelectorAll('input[type="password"]').forEach(wrapField);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();