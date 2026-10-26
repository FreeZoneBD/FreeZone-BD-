// FreeZone BD - Notifications (likes, comments, replies, comment likes, new followers)
//
// Everything about notifications lives in this file, so it can be changed without touching feed.js:
//   start(ctx)  - called once by feed.js after login. It
//                   1. listens for the "fz:notify" events that feed.js sends when someone likes, comments or follows,
//                      and writes the notification for the right person,
//                   2. keeps the red number on the bell icon up to date.
//   mount(container, ctx) - draws the Notifications page (opened by the bell icon).
//
// Data (Firebase Realtime Database):
//   notifications/{recipientUid}/{notificationId} = { type, from, fromName, fromUsername, fromPhotoURL,
//                                                      postId?, text?, createdAt, read }
//   type is "like", "comment", "reply", "commentLike" or "follow". Ids are fixed (like_{postId}_{from}, follow_{from}, comment_{commentId}),
//   so liking the same post twice never creates two notifications, and unliking removes it.

import {
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  query,
  limitToLast,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { escapeHtml, avatarHtml, timeAgo, showToast } from "./post.js";
import { fzConfirm } from "./dialog.js";

const LIST_LIMIT = 50; // newest notifications shown
const SNIPPET_MAX = 100; // characters of a post or comment shown in a notification

const TYPES = {
  like: { icon: "thumb_up", color: "bg-primary-container", label: "liked your post" },
  comment: { icon: "chat_bubble", color: "bg-online-emerald", label: "commented on your post" },
  follow: { icon: "person_add", color: "bg-violet-500", label: "started following you" },
  reply: { icon: "reply", color: "bg-sky-500", label: "replied to your comment" },
  commentLike: { icon: "favorite", color: "bg-notification-rose", label: "liked your comment" },
  boost: { icon: "campaign", color: "bg-amber-500", label: "" }, // sent by the FreeZone team about a boost (approved, ended, refund ...)
  creator: { icon: "workspace_premium", color: "bg-online-emerald", label: "" } // sent by the FreeZone team about the Creator Program (approved, turned off ...)
};

const snippet = (text) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX ? clean.slice(0, SNIPPET_MAX) + "…" : clean;
};

/* ===============================================================
   BACKGROUND: sending notifications + the bell badge
=============================================================== */
let started = false;

/**
 * @param {object} ctx  { db, currentUser, currentProfile }
 */
export function start(ctx = {}) {
  const { db, currentUser } = ctx;
  if (started || !db || !currentUser) return;
  started = true;

  const me = currentUser.uid;

  /* ---- sending ---- */
  const readValue = async (path) => {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
  };

  const send = (toUid, id, data) => {
    const profile = ctx.currentProfile || {};
    const notification = {
      ...data,
      from: me,
      fromName: String(profile.name || "FreeZone User").slice(0, 60),
      createdAt: serverTimestamp(),
      read: false
    };
    if (profile.username) notification.fromUsername = String(profile.username).slice(0, 20);
    if (profile.photoURL) notification.fromPhotoURL = String(profile.photoURL).slice(0, 600);
    Object.keys(notification).forEach((key) => notification[key] === undefined && delete notification[key]);
    return set(ref(db, `notifications/${toUid}/${id}`), notification).then((result) => {
      try { window.fzPush && window.fzPush.notify({ kind: "notification", toUid, id }); } catch (e) { /* ignore */ }
      return result;
    });
  };

  const handle = async (detail) => {
    const { type, postId, commentId, toUid, undo } = detail || {};

    if (type === "like" || type === "comment") {
      if (!postId) return;
      const owner = await readValue(`posts/${postId}/uid`);
      if (!owner || owner === me) return; // never notify yourself

      if (type === "like") {
        const id = `like_${postId}_${me}`;
        if (undo) return remove(ref(db, `notifications/${owner}/${id}`));
        const postText = await readValue(`posts/${postId}/text`);
        return send(owner, id, { type, postId, ...(snippet(postText) ? { text: snippet(postText) } : {}) });
      }

      const commentText = snippet(detail.text);
      return send(owner, `comment_${commentId || Date.now()}`, { type, postId, ...(commentText ? { text: commentText } : {}) });
    }

    // Someone answered a comment: tell the owner of the comment (and the person who was answered)
    if (type === "reply") {
      if (!postId) return;
      const replyText = snippet(detail.text);
      const targets = new Set([toUid, detail.replyToUid].filter((uid) => uid && uid !== me));
      return Promise.all(
        [...targets].map((uid) => send(uid, `reply_${detail.replyId || Date.now()}`, { type, postId, ...(replyText ? { text: replyText } : {}) }))
      );
    }

    // Someone liked a comment or a reply
    if (type === "commentLike") {
      if (!postId || !toUid || toUid === me) return;
      const id = `clike_${commentId}_${detail.replyId || "c"}_${me}`;
      if (undo) return remove(ref(db, `notifications/${toUid}/${id}`));
      const likeText = snippet(detail.text);
      return send(toUid, id, { type, postId, ...(likeText ? { text: likeText } : {}) });
    }

    if (type === "follow") {
      if (!toUid || toUid === me) return;
      const id = `follow_${me}`;
      if (undo) return remove(ref(db, `notifications/${toUid}/${id}`));
      return send(toUid, id, { type });
    }
  };

  document.addEventListener("fz:notify", (event) => {
    handle(event.detail).catch((error) => console.warn("Notification not sent:", error?.code || error));
  });

  /* ---- the bell badge ---- */
  const bell = document.querySelector('.nav-link[data-page="notifications"]');
  if (!bell) return;

  bell.classList.add("relative");
  let badge = bell.querySelector(".fz-notif-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className =
      "fz-notif-badge absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-notification-rose text-white text-[10px] font-bold items-center justify-center ring-2 ring-white pointer-events-none";
    badge.style.display = "none";
    bell.appendChild(badge);
  }

  onValue(
    query(ref(db, `notifications/${me}`), limitToLast(LIST_LIMIT)),
    (snap) => {
      let unread = 0;
      snap.forEach((child) => {
        if (child.val() && child.val().read === false) unread++;
      });
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.style.display = unread > 0 ? "flex" : "none";
    },
    () => {} // no permission or no network: simply no badge
  );
}

/* ===============================================================
   PAGE: the list
=============================================================== */
const STYLE_ID = "fz-notif-style";
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .fz-n-badge { box-shadow: 0 0 0 2.5px rgb(var(--c-slate-surface)); }
    .fz-n-row.fz-n-new { background: rgb(var(--c-primary-fixed) / .28); }
    .fz-n-row { -webkit-tap-highlight-color: transparent; }
    .fz-n-menu { box-shadow: 0 8px 28px rgba(0,0,0,.18); }
    .fz-n-text { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
    .fz-n-quote { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
    @keyframes fz-n-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
    .fz-n-row { animation: fz-n-in .22s ease both; }
    @media (prefers-reduced-motion: reduce) { .fz-n-row { animation: none; } }
  `;
  document.head.appendChild(style);
}

function emptyState(unreadOnly) {
  return `
    <div class="text-center py-20 px-8">
      <div class="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center" style="background:linear-gradient(135deg,rgb(var(--c-primary-fixed)),rgb(var(--c-surface-container)));">
        <span class="material-symbols-outlined text-[38px] text-primary-container" style="font-variation-settings:'FILL' 1;">${unreadOnly ? "done_all" : "notifications"}</span>
      </div>
      <p class="text-[18px] leading-6 font-bold text-on-surface mb-1">${unreadOnly ? "You're all caught up" : "No notifications yet"}</p>
      <p class="font-body-md text-body-md text-slate-muted max-w-xs mx-auto">${
        unreadOnly ? "You have no unread notifications." : "When someone likes or comments on your posts, or follows you, it will show up here."
      }</p>
    </div>`;
}

function skeleton() {
  return Array.from({ length: 6 })
    .map(
      () => `
    <div class="flex items-start gap-3 px-4 py-3">
      <div class="skeleton w-14 h-14 rounded-full flex-shrink-0"></div>
      <div class="flex-1 space-y-2.5 pt-1.5">
        <div class="skeleton h-3.5 w-11/12 rounded"></div>
        <div class="skeleton h-3.5 w-2/3 rounded"></div>
        <div class="skeleton h-3 w-14 rounded"></div>
      </div>
    </div>`
    )
    .join("");
}

// Which heading a notification goes under (newest first, so the groups come out in order)
function groupOf(createdAt, now = new Date()) {
  const t = Number(createdAt) || 0;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  if (t >= startToday) return "Today";
  if (t >= startToday - DAY) return "Yesterday";
  if (t >= startToday - 6 * DAY) return "This week";
  return "Earlier";
}

/**
 * @param {HTMLElement} container
 * @param {object} ctx  { db, currentUser, openPost?, onOpenProfile? }
 */
export function mount(container, ctx = {}) {
  const { db, currentUser } = ctx;
  if (!db || !currentUser) {
    container.innerHTML = `<p class="text-center text-slate-muted text-sm py-16 px-6">Please log in to see your notifications.</p>`;
    return;
  }
  injectStyles();

  const me = currentUser.uid;
  let items = [];
  let fresh = null; // ids that were unread when the page opened (they stay highlighted while you read)
  let filter = "all"; // "all" | "unread"

  container.innerHTML = `
    <div class="fz-notifs bg-slate-surface min-h-full">
      <div class="fz-n-bar flex items-center gap-2 px-4 pt-3 pb-2">
        <button type="button" class="fz-n-filter px-4 h-9 rounded-full text-[14px] font-semibold transition-colors" data-f="all">All</button>
        <button type="button" class="fz-n-filter px-4 h-9 rounded-full text-[14px] font-semibold transition-colors" data-f="unread">Unread</button>
        <div class="flex-1"></div>
        <div class="relative">
          <button type="button" class="fz-n-top w-10 h-10 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container active:bg-surface-container" aria-label="More options"><span class="material-symbols-outlined text-[24px]">more_horiz</span></button>
          <div class="fz-n-topmenu fz-n-menu absolute right-0 top-11 z-20 w-56 rounded-xl bg-slate-surface border border-slate-border py-1.5" hidden>
            <button type="button" class="fz-n-readall w-full text-left px-4 py-2.5 text-[14px] text-on-surface hover:bg-surface-container-low flex items-center gap-3"><span class="material-symbols-outlined text-[20px]">done_all</span>Mark all as read</button>
            <button type="button" class="fz-n-clear w-full text-left px-4 py-2.5 text-[14px] text-error hover:bg-error-container/40 flex items-center gap-3"><span class="material-symbols-outlined text-[20px]">delete_sweep</span>Clear all</button>
          </div>
        </div>
      </div>
      <div class="fz-n-requests" style="display:none"></div>
      <div class="fz-n-list pb-6">${skeleton()}</div>
    </div>`;

  const root = container.querySelector(".fz-notifs");
  const listEl = container.querySelector(".fz-n-list");
  const alive = () => root.isConnected;

  const paintFilters = () => {
    root.querySelectorAll(".fz-n-filter").forEach((b) => {
      const on = b.dataset.f === filter;
      b.className = `fz-n-filter px-4 h-9 rounded-full text-[14px] font-semibold transition-colors ${on ? "bg-primary-fixed text-primary" : "bg-surface-container text-on-surface"}`;
      b.setAttribute("aria-pressed", String(on));
    });
  };
  paintFilters();

  const closeMenus = () => {
    root.querySelectorAll(".fz-n-menu").forEach((m) => { m.hidden = true; });
  };
  const onDocClick = (event) => {
    if (!alive()) return document.removeEventListener("click", onDocClick);
    if (!event.target.closest(".fz-n-menu") && !event.target.closest(".fz-n-more") && !event.target.closest(".fz-n-top")) closeMenus();
  };
  document.addEventListener("click", onDocClick);

  /* ---- follow requests (private account): Confirm or Delete ---- */
  const reqEl = container.querySelector(".fz-n-requests");
  const readPerson = async (uid) => {
    try {
      const snap = await get(ref(db, `users/${uid}`));
      const u = snap.exists() ? snap.val() : null;
      return u ? { uid, name: u.name || "FreeZone User", username: u.username || "", photoURL: u.photoURL || "" } : null;
    } catch (error) {
      return null;
    }
  };
  const answerRequest = async (uid, accept) => {
    const paths = { [`followRequests/${me}/${uid}`]: null, [`myRequests/${uid}/${me}`]: null };
    if (accept) {
      paths[`following/${uid}/${me}`] = serverTimestamp();
      paths[`followers/${me}/${uid}`] = serverTimestamp();
    }
    try {
      await update(ref(db), paths);
      showToast(accept ? "Request confirmed" : "Request deleted");
    } catch (error) {
      console.error(error);
      showToast(error.code === "PERMISSION_DENIED" ? "Could not answer: database rules block it" : "Something went wrong. Try again.");
    }
  };
  const unsubscribeRequests = onValue(
    ref(db, `followRequests/${me}`),
    async (snap) => {
      if (!alive()) return unsubscribeRequests();
      const uids = [];
      snap.forEach((child) => { uids.push(child.key); });
      const people = (await Promise.all(uids.map(readPerson))).filter(Boolean);
      if (!alive()) return;
      if (!people.length) {
        reqEl.style.display = "none";
        reqEl.innerHTML = "";
        return;
      }
      reqEl.style.display = "";
      reqEl.innerHTML = `
        <div class="flex items-center justify-between px-4 pt-3 pb-1">
          <h3 class="text-[17px] font-bold text-on-surface">Follow requests <span class="text-primary">${people.length}</span></h3>
        </div>
        ${people.map((p) => `
          <div class="fz-req px-4 py-2.5" data-uid="${escapeHtml(p.uid)}">
            <button type="button" class="fz-req-open flex items-center gap-3 w-full text-left">
              ${avatarHtml(p.photoURL, "w-14 h-14")}
              <span class="min-w-0 flex-1"><span class="block text-[15px] leading-5 font-semibold text-on-surface truncate">${escapeHtml(p.name)}</span>${p.username ? `<span class="block text-[13px] text-slate-muted truncate">@${escapeHtml(p.username)}</span>` : ""}</span>
            </button>
            <div class="flex gap-2 mt-2.5 pl-[68px]">
              <button type="button" class="fz-req-yes flex-1 h-9 rounded-lg bg-primary-container text-white text-[14px] font-semibold active:scale-[0.98] transition-all disabled:opacity-60">Confirm</button>
              <button type="button" class="fz-req-no flex-1 h-9 rounded-lg bg-surface-container text-on-surface text-[14px] font-semibold active:scale-[0.98] transition-all disabled:opacity-60">Delete</button>
            </div>
          </div>`).join("")}
        <div class="h-2 border-b border-slate-border/60"></div>`;
    },
    () => { reqEl.style.display = "none"; }
  );
  reqEl.addEventListener("click", async (event) => {
    const row = event.target.closest(".fz-req");
    if (!row) return;
    const uid = row.dataset.uid;
    if (event.target.closest(".fz-req-open")) { ctx.onOpenProfile?.(uid); return; }
    const yes = event.target.closest(".fz-req-yes");
    const no = event.target.closest(".fz-req-no");
    if (!yes && !no) return;
    row.querySelectorAll("button").forEach((b) => (b.disabled = true));
    await answerRequest(uid, !!yes);
  });

  /* ---- rendering ---- */
  const isFresh = (n) => !!(fresh && fresh.has(n.id));

  const rowHtml = (n, index) => {
    const type = TYPES[n.type];
    if (!type) return "";

    const isCreator = n.type === "creator";
    const isBoost = n.type === "boost" || isCreator; // messages from the FreeZone team look alike
    const who = isBoost ? "FreeZone Team" : n.fromUsername ? `@${n.fromUsername}` : n.fromName || "Someone";
    const isNew = isFresh(n);
    const sentence = isBoost
      ? isCreator
        ? `<span class="font-semibold">Creator Program</span> · ${escapeHtml(n.text || "Update about the Creator Program")}`
        : `<span class="font-semibold">Boost</span> · ${escapeHtml(n.text || "Update about your boost")}`
      : `<span class="font-semibold">${escapeHtml(who)}</span> ${type.label}`;
    const quote = !isBoost && n.text ? `<p class="fz-n-quote text-[14px] leading-5 text-slate-muted mt-0.5">“${escapeHtml(n.text)}”</p>` : "";
    const picture = isBoost
      ? `<div class="w-14 h-14 rounded-full flex items-center justify-center text-white" style="background:${isCreator ? "linear-gradient(135deg,#16a34a,#0d9488)" : "linear-gradient(135deg,#f59e0b,#ef4444)"};"><span class="material-symbols-outlined text-[28px]" style="font-variation-settings:'FILL' 1;">${isCreator ? "workspace_premium" : "campaign"}</span></div>`
      : avatarHtml(n.fromPhotoURL || "", "w-14 h-14");
    const badge = isBoost
      ? ""
      : `<span class="fz-n-badge absolute -bottom-0.5 -right-0.5 w-[26px] h-[26px] rounded-full ${type.color} text-white flex items-center justify-center"><span class="material-symbols-outlined text-[15px]" style="font-variation-settings:'FILL' 1;">${type.icon}</span></span>`;

    return `
      <div class="fz-n-row relative flex items-start gap-3 pl-4 pr-2 py-3 cursor-pointer active:bg-surface-container-low transition-colors ${isNew ? "fz-n-new" : ""}" data-id="${escapeHtml(n.id)}" style="animation-delay:${Math.min(index, 8) * 25}ms">
        <div class="relative flex-shrink-0">${picture}${badge}</div>
        <div class="min-w-0 flex-1 pt-0.5">
          <p class="fz-n-text text-[15px] leading-5 text-on-surface">${sentence}</p>
          ${quote}
          <p class="text-[13px] leading-4 mt-1 ${isNew ? "text-primary font-semibold" : "text-slate-muted"}">${timeAgo(Number(n.createdAt))}</p>
        </div>
        <div class="flex flex-col items-center flex-shrink-0 w-9">
          <button type="button" class="fz-n-more w-9 h-9 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container active:bg-surface-container" aria-label="More options"><span class="material-symbols-outlined text-[22px]">more_horiz</span></button>
          ${isNew ? `<span class="mt-2 w-2.5 h-2.5 rounded-full bg-primary-container" aria-label="Unread"></span>` : ""}
        </div>
        <div class="fz-n-menu absolute right-3 top-11 z-10 w-60 rounded-xl bg-slate-surface border border-slate-border py-1.5" hidden>
          <button type="button" class="fz-n-remove w-full text-left px-4 py-2.5 text-[14px] text-on-surface hover:bg-surface-container-low flex items-center gap-3"><span class="material-symbols-outlined text-[20px]">delete</span>Remove this notification</button>
        </div>
      </div>`;
  };

  const render = () => {
    if (!alive()) return;
    const shown = items.filter((n) => TYPES[n.type]).filter((n) => filter === "all" || isFresh(n));

    if (!shown.length) {
      listEl.innerHTML = emptyState(filter === "unread");
      return;
    }

    // "New" first (what was unread when the page opened), then by day
    const groups = [];
    const add = (name, list) => { if (list.length) groups.push([name, list]); };
    add("New", shown.filter(isFresh));
    const rest = shown.filter((n) => !isFresh(n));
    ["Today", "Yesterday", "This week", "Earlier"].forEach((g) => add(g, rest.filter((n) => groupOf(n.createdAt) === g)));

    let index = 0;
    listEl.innerHTML = groups
      .map(([name, list]) => `<h3 class="px-4 pt-3 pb-1 text-[17px] leading-6 font-bold text-on-surface">${name}</h3>${list.map((n) => rowHtml(n, index++)).join("")}`)
      .join("");
  };

  /* ---- realtime list ---- */
  let readTimer = null;
  const writeRead = () => {
    const unread = items.filter((n) => n.read === false);
    if (!unread.length) return;
    const updates = {};
    unread.forEach((n) => {
      updates[`notifications/${me}/${n.id}/read`] = true;
    });
    update(ref(db), updates).catch(() => {});
  };
  const markRead = () => {
    clearTimeout(readTimer);
    // A short delay, so the person sees what is new before the highlight and the bell badge go away
    readTimer = setTimeout(writeRead, 1200);
  };

  const unsubscribe = onValue(
    query(ref(db, `notifications/${me}`), limitToLast(LIST_LIMIT)),
    (snap) => {
      if (!alive()) {
        clearTimeout(readTimer);
        return unsubscribe();
      }

      const list = [];
      snap.forEach((child) => {
        list.push({ id: child.key, ...child.val() });
      });
      list.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      items = list;

      if (fresh === null) fresh = new Set();
      list.forEach((n) => {
        if (n.read === false) fresh.add(n.id);
      });

      render();
      markRead();
    },
    (error) => {
      console.error("Notifications:", error);
      if (alive()) listEl.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-16 px-6">Could not load your notifications.</p>`;
    }
  );

  /* ---- top bar: filter, mark all as read, clear all ---- */
  root.querySelector(".fz-n-bar").addEventListener("click", async (event) => {
    const f = event.target.closest(".fz-n-filter");
    if (f) {
      filter = f.dataset.f;
      paintFilters();
      render();
      return;
    }
    if (event.target.closest(".fz-n-top")) {
      const menu = root.querySelector(".fz-n-topmenu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      return;
    }
    if (event.target.closest(".fz-n-readall")) {
      closeMenus();
      fresh = new Set(); // the highlight goes away now
      clearTimeout(readTimer);
      writeRead();
      render();
      return;
    }
    if (event.target.closest(".fz-n-clear")) {
      closeMenus();
      if (!items.length || !(await fzConfirm("Remove all notifications?", { confirmLabel: "Remove all", danger: true }))) return;
      const updates = {};
      items.forEach((n) => {
        updates[`notifications/${me}/${n.id}`] = null;
      });
      try {
        await update(ref(db), updates);
        showToast("Notifications cleared");
      } catch (error) {
        console.error(error);
        showToast("Could not clear notifications");
      }
    }
  });

  /* ---- taps on a notification ---- */
  listEl.addEventListener("click", (event) => {
    const row = event.target.closest(".fz-n-row");
    if (!row) return;
    const n = items.find((item) => item.id === row.dataset.id);
    if (!n) return;

    if (event.target.closest(".fz-n-more")) {
      const menu = row.querySelector(".fz-n-menu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      return;
    }
    if (event.target.closest(".fz-n-remove")) {
      remove(ref(db, `notifications/${me}/${n.id}`)).catch(() => showToast("Could not remove this notification"));
      return;
    }
    if (event.target.closest(".fz-n-menu")) return;

    if (["like", "comment", "reply", "commentLike"].includes(n.type) && n.postId) ctx.openPost?.(n.postId);
    else if (n.type === "follow") ctx.onOpenProfile?.(n.from);
    else if (n.type === "creator") ctx.onOpenCreator?.();
    else if (n.type === "boost") import("./boost.js").then((m) => m.openMyBoosts()).catch(() => showToast("Could not open My boosts"));
  });
}
