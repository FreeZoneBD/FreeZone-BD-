// FreeZone BD - Facebook-style bars.
// Scroll down: the top bar, the For you / Following tabs, the bottom menu and the + button slide away.
// Scroll up, reach the top, or stop scrolling for a moment: they slide back.
(function () {
  "use strict";
  if (window.__fzHideBars) return;
  window.__fzHideBars = true;

  var HIDE_AFTER = 12;   // px scrolled down before hiding
  var SHOW_AFTER = 6;    // px scrolled up before showing
  var IDLE_MS = 380;     // stopped scrolling this long -> show again
  var TOP_ZONE = 24;     // near the top the bars are always visible

  var css = [
    ".fz-topbar{transition:translate .24s ease;will-change:translate;}",
    ".fz-bottomnav{transition:translate .24s ease;will-change:translate;}",
    ".fz-feed-tabs{transition:translate .24s ease;will-change:translate;}",
    ".fz-fab{transition:translate .24s ease,transform .15s,box-shadow .15s,filter .15s;}",
    "html.fz-bars-off .fz-topbar{translate:0 -100%;}",
    "html.fz-bars-off .fz-bottomnav{translate:0 100%;}",
    "html.fz-bars-off .fz-feed-tabs{translate:0 calc(-100% - 52px - var(--fz-top, 0px));}",
    "html.fz-bars-off .fz-fab{translate:0 calc(52px + var(--fz-bottom, env(safe-area-inset-bottom, 0px)));}",
    "@media (prefers-reduced-motion:reduce){.fz-topbar,.fz-bottomnav,.fz-fab,.fz-feed-tabs{transition:none;}}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var root = document.documentElement;
  var lastY = window.scrollY || 0;
  var anchorY = lastY;       // where the current direction started
  var dir = 0;               // 1 down, -1 up
  var idle = null;
  var ticking = false;

  function setHidden(h) {
    if (root.classList.contains("fz-bars-off") !== h) root.classList.toggle("fz-bars-off", h);
  }

  function onFrame() {
    ticking = false;
    var y = window.scrollY || 0;
    if (y < 0) return;                       // iOS rubber band
    if (y <= TOP_ZONE) { setHidden(false); lastY = y; anchorY = y; dir = 0; return; }
    var d = y - lastY;
    lastY = y;
    if (d === 0) return;
    var nd = d > 0 ? 1 : -1;
    if (nd !== dir) { dir = nd; anchorY = y - d; }
    var moved = y - anchorY;
    if (dir === 1 && moved > HIDE_AFTER) setHidden(true);
    else if (dir === -1 && -moved > SHOW_AFTER) setHidden(false);
    clearTimeout(idle);
    idle = setTimeout(function () { setHidden(false); dir = 0; }, IDLE_MS);
  }

  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onFrame); }
  }, { passive: true });

  // typing in a field always brings the bars back
  window.addEventListener("focusin", function () { setHidden(false); });
})();
