// FreeZone BD - the two feed tabs: "For you" (everyone) and "Following" (only people you follow, and you).
// createFeedTabs({ before, onChange }) puts the tab bar in front of `before` and calls onChange("foryou" | "following") when it changes.
// inFeedTab(tab, post, me, followingIds) says if a post belongs in the tab.
const KEY = "fz_feed_tab";
const SORT_KEY = "fz_feed_sort";   // "top" (the ranking of feed-algorithm.js) or "latest" (newest first)

export const inFeedTab = (tab, post, me, followingIds = {}) =>
  tab !== "following" || post.uid === me || !!(followingIds && followingIds[post.uid]);

const readSaved = () => {
  try { return localStorage.getItem(KEY) === "following" ? "following" : "foryou"; } catch (error) { return "foryou"; }
};

const readSort = () => {
  return "top"; // no Top/Latest button any more: always Top
  try { return localStorage.getItem(SORT_KEY) === "latest" ? "latest" : "top"; } catch (error) { return "top"; }
};

export function createFeedTabs({ before, onChange, onSortChange = () => {} }) {
  let tab = readSaved();
  let sort = readSort();
  const el = document.createElement("div");
  el.className = "fz-feed-tabs sticky z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-0 bg-background/95 backdrop-blur-md flex items-stretch gap-0 border-b border-slate-border/60";
  el.style.top = "52px"; // right under the header (52px)
  el.setAttribute("role", "tablist");
  el.innerHTML = [["foryou", "For you"], ["following", "Following"]]
    .map(([id, label]) => `<button type="button" role="tab" class="fz-feed-tab flex-1 relative h-11 font-label-lg text-label-lg font-semibold transition-colors" data-tab="${id}">${label}</button>`)
    .join("");
  const paintSort = () => {
    const btn = el.querySelector(".fz-sort");
    if (!btn) return; // the Top/Latest button was removed
    btn.querySelector(".fz-sort-icon").textContent = sort === "top" ? "auto_awesome" : "schedule";
    btn.querySelector(".fz-sort-label").textContent = sort === "top" ? "Top" : "Latest";
    btn.setAttribute("aria-label", sort === "top" ? "Sorted by Top. Tap to show the latest posts first" : "Sorted by Latest. Tap to show Top posts");
  };
  const paint = () => {
    el.querySelectorAll(".fz-feed-tab").forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", String(on));
      btn.className = "fz-feed-tab flex-1 relative h-11 font-label-lg text-label-lg font-semibold transition-colors " + (on ? "text-on-surface font-bold" : "text-slate-muted");
      btn.style.boxShadow = on ? "inset 0 -3px 0 0 currentColor" : "none";
    });
  };
  paint();
  paintSort();
  el.addEventListener("click", (event) => {
    if (event.target.closest(".fz-sort")) {
      sort = sort === "top" ? "latest" : "top";
      try { localStorage.setItem(SORT_KEY, sort); } catch (error) { /* just not remembered */ }
      paintSort();
      onSortChange(sort);
      return;
    }
    const btn = event.target.closest(".fz-feed-tab");
    if (!btn || btn.dataset.tab === tab) return;
    tab = btn.dataset.tab;
    try { localStorage.setItem(KEY, tab); } catch (error) { /* no storage: the tab is just not remembered */ }
    paint();
    onChange(tab);
  });
  before.before(el);
  return { el, get tab() { return tab; }, get sort() { return sort; } };
}
