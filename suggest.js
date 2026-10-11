// FreeZone BD - "People you may like" card inside the feed.
// pickSuggestions: authors of the loaded posts that I do not follow yet, the most active first.
// createSuggestCard: compact swipe row of small round-photo cards with Follow and Remove, "See all" under it. Hidden for a day from the ⋯ menu.
import { escapeHtml } from "./post.js";
import { isRequested } from "./privacy.js";

const KEY = "fz_suggest_hide";
const DAY = 86400000;
const REMOVED_KEY = "fz_suggest_removed";

// People I took off the list with "Remove" (kept on this phone; they do not come back)
function removedMap() {
  try { return JSON.parse(localStorage.getItem(REMOVED_KEY) || "{}") || {}; } catch (error) { return {}; }
}
function rememberRemoved(uid) {
  const map = removedMap();
  map[uid] = Date.now();
  const ids = Object.keys(map);
  if (ids.length > 300) ids.sort((a, b) => map[a] - map[b]).slice(0, ids.length - 300).forEach((id) => delete map[id]);
  try { localStorage.setItem(REMOVED_KEY, JSON.stringify(map)); } catch (error) { /* just removed for now */ }
}

export function pickSuggestions(posts, me, followingIds = {}, skip = () => false, limit = 8) {
  const people = new Map();
  const removed = removedMap();
  posts.forEach((post) => {
    const uid = post.uid;
    if (!uid || uid === me || followingIds[uid] || removed[uid] || skip(uid)) return;
    const row = people.get(uid) || { uid, name: "", username: "", photoURL: "", count: 0, last: 0 };
    row.count += 1;
    if ((post.createdAt || 0) >= row.last) {
      row.last = post.createdAt || 0;
      row.name = post.name || row.name;
      row.username = post.username || row.username;
      row.photoURL = post.photoURL || row.photoURL;
    }
    people.set(uid, row);
  });
  return [...people.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, limit);
}

export const suggestHidden = (now = Date.now()) => {
  try { return now - Number(localStorage.getItem(KEY) || 0) < DAY; } catch (error) { return false; }
};

const FOLLOW_CLASS = "fz-sg-follow w-full py-1.5 rounded-full bg-primary-container text-white text-[14px] leading-5 font-semibold flex items-center justify-center gap-1 active:scale-95 transition-all";
const DONE_CLASS = "fz-sg-follow w-full py-1.5 rounded-full bg-surface-container text-on-surface-variant text-[14px] leading-5 font-semibold flex items-center justify-center gap-1";

const photoHtml = (p) => {
  const letter = escapeHtml(String(p.name || p.username || "U").trim().charAt(0).toUpperCase() || "U");
  return `<div class="relative mx-auto w-[68px] h-[68px] rounded-full bg-primary-fixed text-primary flex items-center justify-center text-2xl font-bold overflow-hidden ring-1 ring-slate-border">
      ${letter}
      ${p.photoURL ? `<img src="${escapeHtml(p.photoURL)}" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover bg-surface-container" onerror="this.remove()" />` : ""}
    </div>`;
};

// people: from pickSuggestions. onFollow(person) -> Promise<boolean>. onProfile(uid). onSeeAll(): opens the Friends page.
export function createSuggestCard({ people, onFollow, onProfile, onSeeAll }) {
  const list = people.slice();
  const el = document.createElement("section");
  el.className = "fz-suggest bg-slate-surface border-y border-slate-border pt-2.5 pb-1.5";
  el.innerHTML = `
    <div class="flex items-center justify-between px-4 mb-1.5">
      <p class="text-[16px] leading-6 text-on-surface font-bold flex items-center gap-2"><span class="material-symbols-outlined text-[22px]">group_add</span>People you may like</p>
      <div class="relative">
        <button type="button" class="fz-sg-menu w-8 h-8 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container" aria-label="More"><span class="material-symbols-outlined text-[20px]">more_horiz</span></button>
        <div class="fz-sg-pop absolute right-0 top-8 z-20 w-48 bg-slate-surface border border-slate-border rounded-xl shadow-xl py-1.5" style="display:none">
          <button type="button" class="fz-sg-x w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5"><span class="material-symbols-outlined text-[18px]">visibility_off</span> Hide for now</button>
        </div>
      </div>
    </div>
    <div class="fz-sg-row flex gap-2 overflow-x-auto px-4 pb-1" style="scrollbar-width:none;scroll-snap-type:x proximity">
      ${list.map((p) => `
        <div class="fz-sg-item relative shrink-0 w-[142px] rounded-2xl border border-slate-border bg-slate-surface pt-3 pb-2.5 px-2.5" style="scroll-snap-align:start" data-uid="${escapeHtml(p.uid)}">
          <button type="button" class="fz-sg-remove absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container active:scale-90 transition-all" aria-label="Remove"><span class="material-symbols-outlined text-[16px] pointer-events-none">close</span></button>
          <button type="button" class="fz-sg-open block w-full text-center">
            ${photoHtml(p)}
            <div class="mt-2 truncate text-[14px] leading-5 text-on-surface font-semibold">${escapeHtml(p.name || "User")}</div>
            <div class="truncate text-[12px] leading-4 text-slate-muted">${p.username ? "@" + escapeHtml(p.username) : "&nbsp;"}</div>
          </button>
          <div class="fz-sg-actions mt-2">
            <button type="button" class="${FOLLOW_CLASS}"><span class="material-symbols-outlined text-[16px]">person_add</span>Follow</button>
          </div>
        </div>`).join("")}
    </div>
    <button type="button" class="fz-sg-all w-full pt-1.5 pb-0.5 flex items-center justify-center gap-0.5 text-slate-muted text-[14px] font-semibold">See all <span class="material-symbols-outlined text-[18px]">chevron_right</span></button>`;

  const pop = el.querySelector(".fz-sg-pop");
  const closePop = () => { pop.style.display = "none"; };
  document.addEventListener("click", (event) => { if (!el.isConnected) return; if (!event.target.closest || !event.target.closest(".fz-sg-menu")) closePop(); });

  el.addEventListener("click", async (event) => {
    if (event.target.closest(".fz-sg-menu")) { pop.style.display = pop.style.display === "none" ? "block" : "none"; return; }
    if (event.target.closest(".fz-sg-x")) {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (error) { /* just hidden for now */ }
      el.remove();
      return;
    }
    if (event.target.closest(".fz-sg-all")) { onSeeAll?.(); return; }
    const item = event.target.closest(".fz-sg-item");
    if (!item) return;
    const person = list.find((p) => p.uid === item.dataset.uid);
    if (!person) return;
    if (event.target.closest(".fz-sg-open")) { onProfile?.(person.uid); return; }
    if (event.target.closest(".fz-sg-remove")) {
      rememberRemoved(person.uid);
      item.remove();
      if (!el.querySelector(".fz-sg-item")) el.remove();
      return;
    }
    const btn = event.target.closest(".fz-sg-follow");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const ok = await onFollow(person);
    const remove = item.querySelector(".fz-sg-remove");
    if (ok) {
      btn.className = DONE_CLASS;
      btn.innerHTML = '<span class="material-symbols-outlined text-[16px]">check</span>Following';
      if (remove) remove.style.display = "none";
    } else {
      btn.disabled = false;
      // a private account: a request was sent (tap again to take it back)
      const asked = isRequested(person.uid);
      btn.className = asked ? DONE_CLASS.replace("fz-sg-follow", "fz-sg-follow active:scale-95 transition-all") : FOLLOW_CLASS;
      btn.innerHTML = asked ? "Requested" : '<span class="material-symbols-outlined text-[16px]">person_add</span>Follow';
    }
  });
  return el;
}
