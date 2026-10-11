// FreeZone BD - pull to refresh: drag the page down while it is at the very top, let go, and `onRefresh()` runs.
// attachPullToRefresh({ onRefresh, enabled })
//   onRefresh()  -> may return a promise; the spinner stays until it finishes (at least half a second, so it is seen)
//   enabled()    -> return false while something else covers the feed (a profile, a post page, a sheet): then pulling does nothing
const THRESHOLD = 72; // how far (px of finger movement) counts as a pull
const MAX_PULL = 120; // the circle never goes lower than this

export function attachPullToRefresh({ onRefresh, enabled = () => true, parent = document.body }) {
  // The phone's own "pull to reload the whole page" must be off, or both would fire
  document.documentElement.style.overscrollBehaviorY = "contain";

  const el = document.createElement("div");
  el.className = "fz-ptr fixed left-1/2 z-40 w-10 h-10 rounded-full bg-slate-surface shadow-lg ring-1 ring-slate-border/60 flex items-center justify-center text-primary pointer-events-none";
  el.style.cssText = "top:64px;left:50%;opacity:0;display:none;transform:translate(-50%,-60px)";
  el.innerHTML = `<span class="fz-ptr-icon material-symbols-outlined text-[22px]" style="transition:transform .1s">arrow_downward</span>`;
  parent.appendChild(el);
  const icon = el.querySelector(".fz-ptr-icon");

  let startY = null;
  let pull = 0;
  let busy = false;
  let spinTimer = null;

  const paint = (distance) => {
    const eased = Math.min(MAX_PULL, distance * 0.6);
    el.style.display = "flex";
    el.style.opacity = String(Math.min(1, distance / THRESHOLD));
    el.style.transform = `translate(-50%, ${eased - 60}px)`;
    icon.style.transform = `rotate(${distance >= THRESHOLD ? 180 : 0}deg)`;
  };
  const hide = () => {
    el.style.transition = "opacity .2s, transform .2s";
    el.style.opacity = "0";
    el.style.transform = "translate(-50%,-60px)";
    setTimeout(() => { el.style.display = "none"; el.style.transition = ""; icon.textContent = "arrow_downward"; icon.style.animation = ""; }, 220);
  };

  const onStart = (event) => {
    if (busy || event.touches.length !== 1 || window.scrollY > 0 || !enabled()) { startY = null; return; }
    startY = event.touches[0].clientY;
    pull = 0;
  };
  const onMove = (event) => {
    if (startY === null) return;
    if (window.scrollY > 0 || !enabled()) { startY = null; hide(); return; }
    pull = event.touches[0].clientY - startY;
    if (pull <= 0) { pull = 0; el.style.display = "none"; return; }
    el.style.transition = "";
    paint(pull);
  };
  const onEnd = async () => {
    if (startY === null) return;
    const done = pull >= THRESHOLD;
    startY = null;
    pull = 0;
    if (!done) return hide();

    busy = true;
    icon.textContent = "progress_activity";
    icon.style.transform = "";
    icon.style.animation = "fz-ptr-spin .8s linear infinite";
    el.style.transform = "translate(-50%, 16px)";
    el.style.opacity = "1";
    try {
      await Promise.all([Promise.resolve(onRefresh()), new Promise((r) => (spinTimer = setTimeout(r, 600)))]);
    } catch (error) {
      console.warn("Refresh failed:", error);
    }
    busy = false;
    hide();
  };

  if (!document.getElementById("fz-ptr-style")) {
    const style = document.createElement("style");
    style.id = "fz-ptr-style";
    style.textContent = "@keyframes fz-ptr-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
  }

  window.addEventListener("touchstart", onStart, { passive: true });
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onEnd, { passive: true });
  window.addEventListener("touchcancel", () => { startY = null; pull = 0; if (!busy) hide(); }, { passive: true });

  return {
    el,
    stop() {
      clearTimeout(spinTimer);
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      el.remove();
    }
  };
}
