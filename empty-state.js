// FreeZone BD - the "nothing here" messages of the feed.
// emptyKind(...) picks which message fits; renderEmpty(el, kind, actions) draws it.
const TEXTS = {
  none: { icon: "forum", title: "No posts yet", text: "Be the first to share something with the community!", actions: ["create"] },
  filtered: { icon: "visibility_off", title: "Nothing to show right now", text: "The posts here are hidden: they are from accounts you blocked or muted, or they are private.", actions: ["refresh"] },
  "follow-none": { icon: "group_add", title: "You are not following anyone yet", text: "Follow people to see their posts here.", actions: ["find"] },
  "follow-quiet": { icon: "hourglass_empty", title: "No recent posts from people you follow", text: "When they post, it will show up here.", actions: ["foryou", "find"] },
  error: { icon: "cloud_off", title: "Could not load posts", text: "", actions: ["retry"] }
};
const LABELS = {
  create: "Create a post", refresh: "Refresh", find: "Find people", foryou: "See For you", retry: "Try again"
};

/** which message: "none" | "filtered" | "follow-none" | "follow-quiet" | null (not empty) */
export function emptyKind({ visibleCount, loadedCount, hasMore, tab, followingCount }) {
  if (visibleCount > 0 || hasMore) return null;
  if (tab === "following") return followingCount > 0 ? "follow-quiet" : "follow-none";
  return loadedCount > 0 ? "filtered" : "none";
}

/** handlers: { create, refresh, find, foryou, retry }; text overrides the sentence (used for errors) */
export function renderEmpty(el, kind, handlers = {}, text = "") {
  const spec = TEXTS[kind];
  if (!spec) { el.hidden = true; el.style.display = "none"; return; }
  el.hidden = false; el.style.display = "";
  const key = kind + "|" + text;
  if (el.dataset.kind === key) return;       // already showing it: do not redraw
  el.dataset.kind = key;
  el.innerHTML = "";
  const icon = document.createElement("div");
  icon.className = "w-16 h-16 mx-auto mb-4 rounded-full bg-primary-fixed/50 flex items-center justify-center";
  icon.innerHTML = `<span class="material-symbols-outlined text-[32px] text-primary"></span>`;
  icon.firstChild.textContent = spec.icon;
  const title = document.createElement("p");
  title.className = "font-headline-sm text-headline-sm text-on-surface font-semibold mb-1";
  title.textContent = spec.title;
  const sub = document.createElement("p");
  sub.className = "text-slate-muted font-body-sm text-body-sm mb-4 break-words";
  sub.textContent = text || spec.text;
  el.append(icon, title, sub);
  const row = document.createElement("div");
  row.className = "flex flex-wrap gap-2 justify-center";
  spec.actions.forEach((name, index) => {
    if (!handlers[name]) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.action = name;
    btn.className = "px-5 py-2.5 rounded-full font-label-lg text-label-lg font-semibold active:scale-95 transition-all " +
      (index === 0 ? "bg-primary-container text-white" : "bg-surface-container text-on-surface");
    btn.textContent = LABELS[name];
    btn.addEventListener("click", handlers[name]);
    row.appendChild(btn);
  });
  if (row.children.length) el.appendChild(row);
}
