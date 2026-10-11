// FreeZone BD - the offline message.
// A thin bar under the header: "You're offline" while there is no connection, and a short green "Back online" when it returns.
// Offline = the phone says so (navigator.onLine) OR the database has been disconnected for a few seconds (the phone can be wrong).
// createOfflineBar({ top, graceMs, backMs }) -> { setDatabase(connected), el, offline }
export function createOfflineBar({ top = 64, graceMs = 4000, backMs = 2500, parent = document.body } = {}) {
  const el = document.createElement("div");
  el.className = "fz-offline fixed left-0 right-0 z-[60] text-center text-[13px] font-semibold py-1.5 px-3 text-white";
  el.style.top = top + "px";
  el.style.display = "none";
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
      el.textContent = "You're offline. Showing what is already loaded.";
      el.style.display = "";
    } else if (wasOffline) {
      wasOffline = false;
      el.style.background = "#16a34a";
      el.textContent = "Back online";
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
