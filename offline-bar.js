// FreeZone BD - the offline message.
// A small pill above the bottom menu: "Offline" while there is no connection, and a short green "Online" when it returns.
// It floats in the middle at the bottom, so it never covers the header or a post and does not move the layout.
// Offline = the phone says so (navigator.onLine) OR the database has been disconnected for a few seconds (the phone can be wrong).
// createOfflineBar({ graceMs, backMs }) -> { setDatabase(connected), el, offline }
export function createOfflineBar({ graceMs = 4000, backMs = 2500, parent = document.body } = {}) {
  const el = document.createElement("div");
  el.className = "fz-offline fixed z-[60] text-center font-semibold text-white";
  el.style.cssText = "left:50%;transform:translateX(-50%);bottom:calc(var(--fz-bottom,env(safe-area-inset-bottom,0px)) + 76px);" +
    "font-size:12px;line-height:1;padding:7px 14px;border-radius:999px;max-width:70vw;white-space:nowrap;pointer-events:none;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.25);display:none;";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  parent.appendChild(el);

  let phoneOnline = navigator.onLine !== false;
  let dbConnected = true;      // unknown at first: not a reason for a bar
  let dbTimer = null;
  let dbDown = false;          // disconnected for longer than the grace time
  let wasOffline = false;
  let backTimer = null;

  const isOffline = () => !phoneOnline || dbDown;

  const paint = () => {
    clearTimeout(backTimer);
    if (isOffline()) {
      wasOffline = true;
      el.style.background = "#475569";
      el.textContent = "Offline";
      el.style.display = "";
    } else if (wasOffline) {
      wasOffline = false;
      el.style.background = "#16a34a";
      el.textContent = "Online";
      el.style.display = "";
      backTimer = setTimeout(() => { el.style.display = "none"; }, backMs);
    } else {
      el.style.display = "none";
    }
  };

  window.addEventListener("offline", () => { phoneOnline = false; paint(); });
  window.addEventListener("online", () => { phoneOnline = true; paint(); });

  paint();
  return {
    el,
    get offline() { return isOffline(); },
    /** Feed the database state in (.info/connected). */
    setDatabase(connected) {
      dbConnected = !!connected;
      clearTimeout(dbTimer);
      if (dbConnected) { dbDown = false; paint(); return; }
      dbTimer = setTimeout(() => { dbDown = true; paint(); }, graceMs);
    }
  };
}
