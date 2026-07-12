// dashboard-theme.js
// Shared dark/light theme toggle for all dashboards. Reuses the same
// body.dark class and localStorage key as the main site's theme toggle,
// so the choice stays consistent across the whole app.

function initDashboardTheme() {
  const toggleBtn = document.getElementById("themeToggleDash");
  if (!toggleBtn) return;

  const body = document.body;

  if (localStorage.getItem("attendx-theme") === "dark") {
    body.classList.add("dark");
    toggleBtn.textContent = "☀️";
  } else {
    toggleBtn.textContent = "🌙";
  }

  toggleBtn.addEventListener("click", () => {
    body.classList.toggle("dark");
    const isDark = body.classList.contains("dark");
    toggleBtn.textContent = isDark ? "☀️" : "🌙";
    localStorage.setItem("attendx-theme", isDark ? "dark" : "light");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboardTheme);
} else {
  initDashboardTheme();
}