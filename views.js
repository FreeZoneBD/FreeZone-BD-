// FreeZone BD - post views (feed algorithm part 8).
// A post counts as "seen" when at least half of it stays on the screen for `dwellMs` (default 2.5 s).
//   - the seen list is kept on this phone (localStorage "fz_seen"): the feed pushes seen posts down a little
//   - viewsCount on the post is raised once per person per post, saved in groups (cheap on the database):
//     when `batch` views are waiting, when the tab is hidden, or when the page closes.
// My own posts are never counted. A failed save is dropped (a view is not important enough to retry).

const KEY = "fz_seen";
const KEEP_DAYS = 7;
const KEEP_MAX = 600;

export function loadSeen(now = Date.now()) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (error) { map = {}; }
  const limit = now - KEEP_DAYS * 86400000;
  Object.keys(map).forEach((id) => { if (!(map[id] > limit)) delete map[id]; });
  return map;
}

function saveSeen(map) {
  const ids = Object.keys(map);
  if (ids.length > KEEP_MAX) ids.sort((a, b) => map[a] - map[b]).slice(0, ids.length - KEEP_MAX).forEach((id) => delete map[id]);
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (error) { /* storage full or blocked */ }
}

/**
 * createViewTracker({ seen, getMe, save, dwellMs, batch })
 *   seen:  the object from loadSeen() (it is updated in place, so the feed sees new views at once)
 *   getMe: () => my uid
 *   save:  (ids[]) => Promise   writes viewsCount (the feed gives this, the tracker has no database inside)
 * Returns { watch(container), stop(), flush() }. Call watch() after every draw of the list.
 */
export function createViewTracker({ seen, getMe, save, onSeen, dwellMs = 2500, batch = 20 }) {
  let observer = null;
  const timers = new Map();
  let queue = [];

  const flush = () => {
    if (!queue.length) return;
    const ids = queue;
    queue = [];
    try { Promise.resolve(save(ids)).catch(() => {}); } catch (error) { /* ignore */ }
  };

  const counted = (id, uid) => {
    const first = !seen[id];
    seen[id] = Date.now();
    saveSeen(seen);
    if (first && uid && uid !== getMe()) {
      try { onSeen?.(id); } catch (error) { /* ignore */ }
      queue.push(id);
      if (queue.length >= batch) flush();
    }
  };

  const clear = (el) => {
    const t = timers.get(el);
    if (t) { clearTimeout(t); timers.delete(el); }
  };

  const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", flush);

  return {
    watch(container) {
      if (observer) observer.disconnect();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      if (!container || typeof IntersectionObserver === "undefined") return;
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const el = entry.target;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (timers.has(el)) return;
            timers.set(el, setTimeout(() => {
              timers.delete(el);
              if (document.visibilityState === "hidden") return;
              const id = el.dataset.postId;
              if (id) counted(id, el.dataset.authorUid);
            }, dwellMs));
          } else clear(el);
        });
      }, { threshold: [0, 0.5, 1] });
      container.querySelectorAll("article[data-post-id]").forEach((el) => observer.observe(el));
    },
    stop() {
      if (observer) observer.disconnect();
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      flush();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
    },
    flush
  };
}
