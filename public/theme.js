// Apply the saved theme before first paint so there is no flash. A file, not an inline
// script, so the Content-Security-Policy can forbid inline scripts.
try {
  var pref = localStorage.getItem('cadence-theme') || 'dark'
  var light = pref === 'light' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
  if (light) document.documentElement.dataset.theme = 'light'
} catch (e) {
  // Storage unavailable: keep the dark theme.
}
