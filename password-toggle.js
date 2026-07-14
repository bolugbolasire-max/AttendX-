// password-toggle.js
// Adds a "show/hide password" eye button to every password field on the
// page. Include this on any page with password inputs — no setup needed,
// it finds them automatically.
//
//   <script src="password-toggle.js" defer></script>

(function () {
  const EYE_OPEN_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;

  const EYE_CLOSED_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-6.06M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
  `;

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
    toggleBtn.innerHTML = EYE_OPEN_SVG;
    wrap.appendChild(toggleBtn);

    toggleBtn.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      toggleBtn.innerHTML = isHidden ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
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