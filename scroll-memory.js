// FreeZone BD - remembers where I was in the feed (per tab), also after a reload.
// A place is "the post at the top of the screen + how far from the top edge it sits", so it survives new posts and resizes.
// createScrollMemory({ container, tab, storageKey }) -> { note, restoreFor, step, pending, clear }
const MAX_AGE = 30 * 60 * 1000;
const MIN_Y = 200;    // closer to the top than this: nothing to remember
const HEADER = 64;    // the sticky header

export function createScrollMemory({ container, tab, storageKey = "fz_feed_scroll" }) {
  const places = {};  // tab -> { id, offset }
  let want = null;    // a place waiting to be scrolled to

  const articles = () => Array.from(container.children).filter((el) => el.tagName === "ARTICLE" && el.dataset.postId);
  const topPost = () => articles().find((el) => el.getBoundingClientRect().bottom > HEADER + 8) || null;
  const persist = () => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ t: Date.now(), places })); } catch (error) { /* not remembered across reloads */ }
  };

  // from storage: the places of the last visit
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (saved && Date.now() - saved.t < MAX_AGE && saved.places) Object.assign(places, saved.places);
  } catch (error) { /* ignore */ }

  return {
    /** Call on scroll: stores the place of the current tab (or forgets it near the top). Does nothing while a restore waits. */
    note(currentTab) {
      if (want) return;
      if (window.scrollY < MIN_Y) delete places[currentTab];
      else {
        const el = topPost();
        if (!el) return;
        places[currentTab] = { id: el.dataset.postId, offset: Math.round(el.getBoundingClientRect().top) };
      }
      persist();
    },
    /** Ask to go back to the place of this tab. Returns true when there is one. */
    restoreFor(currentTab) {
      want = places[currentTab] ? { ...places[currentTab] } : null;
      return !!want;
    },
    get pending() { return !!want; },
    clear() { want = null; },
    /** Call after every draw. Returns "done", "wait" (the post is not loaded yet: load more) or "idle". */
    step() {
      if (!want) return "idle";
      const el = articles().find((a) => a.dataset.postId === want.id);
      if (!el) return "wait";
      window.scrollBy(0, el.getBoundingClientRect().top - want.offset);
      want = null;
      return "done";
    },
    /** Give up (the post is gone and nothing more can be loaded). */
    giveUp(currentTab) { want = null; delete places[currentTab]; persist(); }
  };
}
