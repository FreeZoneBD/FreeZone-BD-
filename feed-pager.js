// FreeZone BD - loads the feed a page at a time instead of every post at once.
// createFeedPager({ db, pageSize, onData, onError }) keeps a LIVE window of the newest posts (likes, edits and deletes show at once).
// loadMore() makes the window bigger by one page. onData(posts, { hasMore, capped }) is called on every change, newest first.
// watchEnd(element, callback) calls callback when the element (a marker under the last post) comes near the screen.
import { ref, query, orderByChild, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

export const PAGE_SIZE = 20;
const MAX_WINDOW = 400; // the feed never keeps more than this many posts live

export function createFeedPager({ db, pageSize = PAGE_SIZE, onData, onError }) {
  let limit = pageSize;
  let stop = null;
  let exhausted = false;
  let loading = true; // the first page is loading
  const waiting = []; // refresh() calls waiting for the next list

  const subscribe = () => {
    const next = onValue(
      query(ref(db, "posts"), orderByChild("createdAt"), limitToLast(limit)),
      (snapshot) => {
        const list = [];
        snapshot.forEach((child) => {
          list.push({ id: child.key, ...child.val() });
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        exhausted = list.length < limit; // fewer than asked for: there are no older posts
        loading = false;
        onData(list, { hasMore: !exhausted && limit < MAX_WINDOW, capped: !exhausted && limit >= MAX_WINDOW });
        while (waiting.length) waiting.shift()();
      },
      (error) => {
        loading = false;
        onError?.(error);
        while (waiting.length) waiting.shift()();
      }
    );
    const old = stop;
    stop = next;
    if (old) old(); // the new window is already listening, so nothing flickers
  };
  subscribe();

  return {
    /** One more page. Returns false when there is nothing more to load or a page is already loading. */
    loadMore() {
      if (loading || exhausted || limit >= MAX_WINDOW) return false;
      loading = true;
      limit = Math.min(limit + pageSize, MAX_WINDOW);
      subscribe();
      return true;
    },
    /** Starts again from the newest page (the window shrinks back to one page). Resolves when the fresh list has arrived. */
    refresh() {
      return new Promise((resolve) => {
        waiting.push(resolve);
        limit = pageSize;
        exhausted = false;
        loading = true;
        subscribe();
      });
    },
    get loading() { return loading; },
    get hasMore() { return !exhausted && limit < MAX_WINDOW; },
    destroy() { if (stop) stop(); stop = null; }
  };
}

/** Calls `callback` while `element` is on (or close to) the screen. Returns { check, stop }: call check() after the list changed. */
export function watchEnd(element, callback, margin = 700) {
  const near = () => {
    if (!element.isConnected || element.style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.top < (window.innerHeight || document.documentElement.clientHeight) + margin;
  };
  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting) && near()) callback(); }, { rootMargin: `${margin}px 0px` }); // near() re-checks: the entry can be older than the last render
    observer.observe(element);
  }
  // The observer only fires when the marker moves in or out of view. After a page loads the marker can still be in view (very short pages, hidden posts), so look again.
  const check = () => requestAnimationFrame(() => { if (near()) callback(); });
  const onScroll = () => { if (near()) callback(); };
  if (!observer) window.addEventListener("scroll", onScroll, { passive: true });
  return { check, stop() { observer?.disconnect(); window.removeEventListener("scroll", onScroll); } };
}
