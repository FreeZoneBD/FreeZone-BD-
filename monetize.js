// FreeZone BD - Creator Program: the green tick next to the name of an approved creator.
//
// Data:  monetized/{uid} = true     written ONLY by an admin (database.rules.json). The tick is on while it exists.
//        An admin turns it off (policy break: sexual / obscene content, abusive behaviour, fake views...) -> the tick disappears everywhere at once.
//
// startMonetized(db) listens to that small list and puts a tick after the name in:
//   post cards, comments  (found by their own markup)
//   anything with  data-tick-uid="UID"  (profile name, Reels name): the tick is added inside that element
// Chat, search and the friends list do not show it yet.
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const on = new Set();
let started = false;
let queued = false;

export const isMonetized = (uid) => !!uid && on.has(uid);

const TICK =
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#16a34a"/><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The tick as HTML (for places that draw their own markup) */
export const tickHtml = (uid) =>
  isMonetized(uid)
    ? `<span class="fz-tick inline-flex items-center flex-shrink-0 align-middle" data-notr data-tick-for="${uid}" role="img" aria-label="Creator Program member" title="Creator Program member">${TICK}</span>`
    : "";

function makeTick(uid, inside) {
  const span = document.createElement("span");
  span.className = "fz-tick inline-flex items-center flex-shrink-0 align-middle";
  span.setAttribute("data-notr", "");
  span.dataset.tickFor = uid;
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", "Creator Program member");
  span.title = "Creator Program member";
  span.style.cssText = inside ? "margin-left:5px;vertical-align:-2px;" : "margin-left:2px;";
  span.innerHTML = TICK;
  return span;
}

function scan() {
  queued = false;
  // a tick whose person is no longer a creator goes away
  document.querySelectorAll(".fz-tick").forEach((el) => {
    if (!on.has(el.dataset.tickFor)) el.remove();
  });
  if (!on.size) return;

  // after the name (post cards, comments)
  const after = (el, uid) => {
    if (!uid || !on.has(uid)) return;
    const next = el.nextElementSibling;
    if (next && next.classList.contains("fz-tick")) return;
    el.after(makeTick(uid, false));
  };
  document.querySelectorAll("article[data-author-uid] .profile-link .truncate").forEach((el) => {
    const article = el.closest("article[data-author-uid]");
    after(el, article && article.dataset.authorUid);
  });
  document.querySelectorAll(".cm-author[data-profile-uid]").forEach((el) => after(el, el.dataset.profileUid));

  // inside the element (profile name, Reels name)
  document.querySelectorAll("[data-tick-uid]").forEach((el) => {
    const uid = el.dataset.tickUid;
    if (!uid || !on.has(uid)) return;
    if (el.querySelector(":scope > .fz-tick")) return;
    el.appendChild(makeTick(uid, true));
  });
}

const schedule = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(scan);
};

export function startMonetized(db) {
  if (started || !db) return;
  started = true;
  onValue(
    ref(db, "monetized"),
    (snap) => {
      on.clear();
      snap.forEach((child) => {
        if (child.val() === true) on.add(child.key);
      });
      schedule();
    },
    () => {} // no permission or no network: simply no ticks
  );
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
}
