// FreeZone BD - Post Card component
import { linkifyText } from "./linkify.js";
import { canSeeAccount, isRequested } from "./privacy.js";
import { drawQR } from "./qr.js";
import { db, auth } from "./config.js";
import { ref as dbRef, update as dbUpdate, increment as dbIncrement } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { tagLineHtml } from "./tags.js";
import { shareBase, nativeShare, nativeSaveMedia, saveVideo } from "./app-info.js";
import { linkifyHashtags } from "./hashtags.js";

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function timeAgo(timestamp) {
  if (!timestamp) return "just now";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short"
  });
}

export function avatarHtml(photoURL, size = "w-11 h-11") {
  if (photoURL) {
    return `<img class="${size} rounded-full object-cover ring-1 ring-slate-border/60" src="${escapeHtml(photoURL)}" alt="avatar" loading="lazy" />`;
  }
  return `<div class="${size} rounded-full bg-gradient-to-br from-primary-fixed to-secondary-container flex items-center justify-center ring-1 ring-slate-border/40">
    <span class="material-symbols-outlined text-primary text-[20px]">person</span>
  </div>`;
}

export function showToast(message) {
  const old = document.getElementById("fzToast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "fzToast";
  toast.textContent = message;
  toast.setAttribute("role", "status");
  toast.style.cssText =
    "position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:9999;" +
    "background:#1e293b;color:#fff;border:1px solid rgba(148,163,184,.35);padding:10px 18px;border-radius:9999px;" +
    "font-size:13px;font-weight:500;box-shadow:0 8px 24px rgba(15,23,42,.25);" +
    "max-width:85vw;text-align:center;";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

export function getPostLink(postId) {
  const url = shareBase();
  url.searchParams.set("post", postId);
  return url.toString();
}

export async function copyPostLink(postId) {
  return copyLink(getPostLink(postId));
}

// Copies any link to the clipboard (with a fallback for in-app browsers) and shows "Link copied"
export async function copyLink(link) {

  try {
    await navigator.clipboard.writeText(link);
    showToast("Link copied");
    return true;
  } catch (error) {
    // Fallback for WebView / older browsers
    try {
      const input = document.createElement("textarea");
      input.value = link;
      input.setAttribute("readonly", "");
      input.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(input);
      input.select();
      input.setSelectionRange(0, link.length);
      const ok = document.execCommand("copy");
      input.remove();
      showToast(ok ? "Link copied" : "Could not copy link");
      return ok;
    } catch (fallbackError) {
      console.error(fallbackError);
      showToast("Could not copy link");
      return false;
    }
  }
}

const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "sexual", label: "Nudity or sexual content" },
  { value: "violence", label: "Violence or dangerous content" },
  { value: "scam", label: "Scam or fraud" },
  { value: "false_info", label: "False information" },
  { value: "other", label: "Something else" }
];

// Opens a bottom sheet and resolves with { reason, details } or null if cancelled
export function openReportDialog({ title = "Report post", question = "Why are you reporting this post?" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/40";
    overlay.innerHTML = `
      <div class="w-full max-w-lg bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] flex flex-col" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="px-5 pt-5 pb-3 border-b border-slate-border">
          <div class="flex items-center justify-between">
            <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">${title}</h2>
            <button type="button" class="report-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <p class="font-body-md text-body-md text-slate-muted mt-1">${question}</p>
        </div>

        <div class="overflow-y-auto px-2 py-2">
          ${REPORT_REASONS.map(
            (r) => `
            <label class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-container-low cursor-pointer">
              <input type="radio" name="reportReason" value="${r.value}" class="w-4 h-4 accent-[#2563eb]" />
              <span class="font-body-md text-body-md text-on-surface">${r.label}</span>
            </label>`
          ).join("")}
          <div class="px-3 pt-2 pb-1">
            <textarea class="report-details w-full bg-surface-container-low border border-transparent focus:border-primary-container focus:ring-2 focus:ring-primary-container/15 rounded-xl px-3.5 py-2.5 text-body-md text-body-md outline-none resize-none" rows="3" maxlength="300" placeholder="Add more details (optional)"></textarea>
          </div>
        </div>

        <div class="flex items-center gap-2.5 px-5 py-4 border-t border-slate-border">
          <button type="button" class="report-cancel flex-1 py-2.5 rounded-xl font-label-lg text-label-lg text-on-surface bg-surface-container hover:bg-surface-container-high active:scale-95 transition-all">Cancel</button>
          <button type="button" class="report-submit flex-1 py-2.5 rounded-xl font-label-lg text-label-lg text-white bg-error disabled:opacity-40 active:scale-95 transition-all" disabled>Submit report</button>
        </div>
      </div>
    `;

    const submitBtn = overlay.querySelector(".report-submit");
    const detailsEl = overlay.querySelector(".report-details");

    const close = (result) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);

    overlay.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === overlay) close(null);
    });
    overlay.querySelector(".report-close").addEventListener("click", () => close(null));
    overlay.querySelector(".report-cancel").addEventListener("click", () => close(null));
    overlay.querySelectorAll('input[name="reportReason"]').forEach((input) => {
      input.addEventListener("change", () => (submitBtn.disabled = false));
    });
    submitBtn.addEventListener("click", () => {
      const checked = overlay.querySelector('input[name="reportReason"]:checked');
      if (!checked) return;
      close({ reason: checked.value, details: detailsEl.value.trim() });
    });

    document.body.appendChild(overlay);
  });
}

const FOLLOW_CHIP_BASE = "follow-chip ml-auto flex-shrink-0 h-8 px-3 rounded-full flex items-center gap-1 font-label-md text-label-md font-semibold active:scale-95 transition-all disabled:opacity-60 ";

function followChipClasses(following) {
  return FOLLOW_CHIP_BASE + (following ? "bg-surface-container text-slate-muted" : "bg-primary-container/10 text-primary");
}

// Keeps the Follow button (next to the name) and the Unfollow menu item of every visible post by the same author in sync
export function updateFollowButtons(authorUid, following, requested = false) {
  document.querySelectorAll(".follow-chip").forEach((chip) => {
    if (chip.dataset.authorUid !== authorUid) return;
    chip.dataset.following = following ? "1" : "0";
    if (chip.dataset.variant === "inline") {
      chip.hidden = following; // once I follow, the button is gone (Unfollow is in the ⋮ menu)
      const inlineLabel = chip.querySelector(".follow-chip-label");
      if (inlineLabel) inlineLabel.textContent = requested ? "Requested" : "Follow";
      return;
    }
    chip.className = followChipClasses(following);
    chip.querySelector(".follow-chip-label").textContent = following ? "Following" : requested ? "Requested" : "Follow";
    chip.querySelector(".follow-chip-icon").textContent = following ? "check" : "add";
  });
  document.querySelectorAll(".unfollow-btn").forEach((btn) => {
    if (btn.dataset.authorUid === authorUid) btn.hidden = !following;
  });
}

// Keeps the Save button under the post and the Save/Unsave menu item of every visible card in sync
export function updateSaveButtons(postId, saved) {
  document.querySelectorAll(".save-btn").forEach((btn) => {
    if (btn.dataset.postId !== postId) return;
    btn.dataset.saved = saved ? "1" : "0";
    btn.setAttribute("aria-pressed", String(saved));
    const label = btn.querySelector(".save-label");
    if (label) label.textContent = saved ? "Unsave post" : "Save post";
    const icon = btn.querySelector(".save-icon");
    if (icon) icon.style.fontVariationSettings = `'FILL' ${saved ? 1 : 0}`;
    const svg = btn.querySelector(".save-svg");
    if (svg) svg.style.fill = saved ? "currentColor" : "none";
  });
}

/* ---------------------------------------------------------------
   Share
---------------------------------------------------------------- */
// Our own share sheet. Used when the phone's share menu is not available (many in-app browsers / WebViews
// do not have navigator.share) or when it fails.
function openShareSheet({ link, text, title = "Share post" }) {
  const encodedLink = encodeURIComponent(link);
  const encodedText = encodeURIComponent(text);
  const encodedBoth = encodeURIComponent(`${text}\n${link}`);

  const apps = [
    { label: "WhatsApp", color: "#25D366", mark: "W", href: `https://wa.me/?text=${encodedBoth}` },
    { label: "Facebook", color: "#1877F2", mark: "f", href: `https://www.facebook.com/sharer/sharer.php?u=${encodedLink}` },
    { label: "Telegram", color: "#229ED9", mark: "T", href: `https://t.me/share/url?url=${encodedLink}&text=${encodedText}` },
    { label: "X", color: "#111827", mark: "X", href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedLink}` },
    { label: "Email", color: "#64748b", icon: "mail", href: `mailto:?subject=${encodeURIComponent("FreeZone BD")}&body=${encodedBoth}`, sameTab: true },
    { label: "SMS", color: "#16a34a", icon: "sms", href: `sms:?&body=${encodedBoth}`, sameTab: true }
  ];

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/40";
  overlay.innerHTML = `
    <div class="w-full max-w-lg bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">${escapeHtml(title)}</h2>
        <button type="button" class="share-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div class="flex items-center gap-2 bg-surface-container-low rounded-xl p-1.5 pl-3.5 mb-5">
        <input type="text" readonly value="${escapeHtml(link)}" class="share-link flex-1 min-w-0 bg-transparent text-[14px] text-on-surface-variant outline-none truncate" aria-label="Link" />
        <button type="button" class="share-copy flex-shrink-0 px-4 py-2 rounded-lg bg-primary-container text-white font-label-md text-label-md font-semibold active:scale-95 transition-all">Copy</button>
      </div>

      <div class="grid grid-cols-3 gap-y-5 gap-x-2">
        ${apps
          .map(
            (app) => `
          <a href="${app.href}" ${app.sameTab ? "" : 'target="_blank" rel="noopener noreferrer"'} class="share-app flex flex-col items-center gap-2 active:scale-95 transition-transform">
            <span class="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-[22px]" style="background:${app.color}">
              ${app.icon ? `<span class="material-symbols-outlined text-[26px]">${app.icon}</span>` : app.mark}
            </span>
            <span class="font-body-sm text-body-sm text-on-surface">${app.label}</span>
          </a>`
          )
          .join("")}
      </div>
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === overlay || event.target.closest(".share-close")) return close();
    if (event.target.closest(".share-app")) return setTimeout(close, 150);
    if (event.target.closest(".share-copy")) {
      copyLink(link).then((ok) => ok && close());
    }
  });

  document.body.appendChild(overlay);
}

// The phone's own share menu when it exists, otherwise our share sheet
async function shareLink({ link, text, title }) {
  // inside the Android app: the real system share sheet
  const native = await nativeShare({ title: "FreeZone BD", text, url: link, dialogTitle: title });
  if (native === "done") return true;
  if (native === "cancelled") return false;
  if (navigator.share) {
    try {
      await navigator.share({ title: "FreeZone BD", text, url: link });
      return true;
    } catch (error) {
      if (error && error.name === "AbortError") return false; // the person closed the share menu
      // Any other error (blocked in this browser): continue with our own sheet
    }
  }
  openShareSheet({ link, text, title });
  return true;
}

// Part 7: every post is counted once per person on this phone (sharesCount is a signal for the feed algorithm)
function countShare(postId, uid) {
  if (!postId || !uid) return;
  let done = {};
  try { done = JSON.parse(localStorage.getItem("fz_shared") || "{}") || {}; } catch (error) { done = {}; }
  if (done[postId]) return;
  done[postId] = Date.now();
  const keys = Object.keys(done);
  if (keys.length > 300) keys.sort((a, b) => done[a] - done[b]).slice(0, keys.length - 300).forEach((k) => delete done[k]);
  try { localStorage.setItem("fz_shared", JSON.stringify(done)); } catch (error) { /* full */ }
  dbUpdate(dbRef(db), { [`posts/${postId}/sharesCount`]: dbIncrement(1) }).catch(() => {});
}

/** Shares a post. */
export async function sharePost(post) {
  if (!post || !post.id) return;

  const who = post.username ? `@${post.username}` : post.name || "FreeZone User";
  const body = String(post.text || "").trim();
  const text = body ? `${who} on FreeZone BD: ${body.length > 140 ? body.slice(0, 140) + "…" : body}` : `${who} shared a post on FreeZone BD`;
  const shared = await shareLink({ link: getPostLink(post.id), text, title: "Share post" });
  if (shared) { try { countShare(post.id, auth.currentUser?.uid); } catch (error) { /* not signed in */ } }
  return shared;
}

/**
 * The unique link of a profile. It uses the @username (?u=abdul) when there is one, so it is short and easy to read,
 * and the account id (?profile=...) otherwise. feed.js opens the profile when the page is loaded with either.
 */
export function getProfileLink(user) {
  const url = shareBase();
  if (user.username) url.searchParams.set("u", user.username);
  else url.searchParams.set("profile", user.uid);
  return url.toString();
}

/* ---------------------------------------------------------------
   Who can see a post: "public" (everyone, also when the field is missing), "followers" (people who follow the author), "me" (only the author)
---------------------------------------------------------------- */
export const AUDIENCES = [
  { value: "public", label: "Public", note: "Everyone on FreeZone BD", icon: "public" },
  { value: "followers", label: "Followers", note: "Only people who follow you", icon: "group" },
  { value: "me", label: "Only me", note: "Nobody else can see it", icon: "lock" }
];

export function canViewPost(post, me, followingIds = {}) {
  if (post && post.uid && !canSeeAccount(post.uid, me, followingIds)) return false; // a private account: only its followers
  const audience = post && post.audience;
  if (!audience || audience === "public") return true;
  if (!me) return false;
  if (post.uid === me) return true;
  return audience === "followers" && !!(followingIds && followingIds[post.uid]);
}

/** Bottom sheet to choose the audience. Resolves with "public" | "followers" | "me", or null when closed. */
export function openAudienceSheet(current = "public") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/40";
    overlay.innerHTML = `
      <div class="w-full max-w-lg bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 pb-5" role="dialog" aria-modal="true" aria-label="Who can see this post">
        <div class="flex items-center justify-between px-1 mb-2">
          <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">Who can see this post?</h2>
          <button type="button" class="aud-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
        </div>
        ${AUDIENCES.map(
          (a) => `
          <button type="button" class="aud-opt w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-surface-container-low active:bg-surface-container" data-value="${a.value}">
            <span class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface flex-shrink-0"><span class="material-symbols-outlined text-[22px]">${a.icon}</span></span>
            <span class="min-w-0 flex-1"><span class="block font-label-lg text-label-lg text-on-surface">${a.label}</span><span class="block font-body-sm text-body-sm text-slate-muted">${a.note}</span></span>
            ${a.value === current ? `<span class="material-symbols-outlined text-primary text-[22px]">check_circle</span>` : ""}
          </button>`
        ).join("")}
      </div>`;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event) => { if (event.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === overlay) return close(null);
      const opt = event.target.closest(".aud-opt");
      if (opt) close(opt.dataset.value);
    });
    overlay.querySelector(".aud-close").addEventListener("click", () => close(null));
    document.body.appendChild(overlay);
  });
}

/* ---------------------------------------------------------------
   Polls: post.poll = { options: ["Yes", "No", ...] } (2 to 4), votes in pollVotes/{postId}/{uid} = option number
---------------------------------------------------------------- */
export const pollOptionsOf = (post) => {
  const raw = post && post.poll && post.poll.options;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : Object.keys(raw).sort((a, b) => a - b).map((k) => raw[k]);
  return list.filter((t) => typeof t === "string" && t.trim()).slice(0, 4);
};

function mountPoll(box, post, { currentUserUid, onVote, watchVotes }) {
  const options = pollOptionsOf(post);
  if (options.length < 2) { box.remove(); return; }
  let votes = {};
  const paint = () => {
    const counts = options.map(() => 0);
    Object.values(votes).forEach((v) => { if (Number.isInteger(v) && counts[v] !== undefined) counts[v]++; });
    const total = counts.reduce((a, b) => a + b, 0);
    const mine = currentUserUid && Number.isInteger(votes[currentUserUid]) ? votes[currentUserUid] : -1;
    box.innerHTML = options
      .map((text, i) => {
        const pct = total ? Math.round((counts[i] / total) * 100) : 0;
        return `<button type="button" class="poll-opt relative w-full text-left rounded-xl border ${i === mine ? "border-primary-container" : "border-slate-border"} overflow-hidden mb-2 min-h-[44px]" data-i="${i}" aria-pressed="${i === mine}">
          <span class="absolute inset-y-0 left-0 ${i === mine ? "bg-primary-container/25" : "bg-surface-container"}" style="width:${pct}%"></span>
          <span class="relative flex items-center justify-between gap-3 px-3.5 py-2.5">
            <span class="flex items-center gap-2 min-w-0"><span class="material-symbols-outlined text-[20px] flex-shrink-0 ${i === mine ? "text-primary" : "text-slate-subtle"}">${i === mine ? "check_circle" : "radio_button_unchecked"}</span><span class="text-[15px] text-on-surface break-words">${escapeHtml(text)}</span></span>
            <span class="text-[14px] font-semibold text-on-surface flex-shrink-0 tabular-nums">${pct}%</span>
          </span>
        </button>`;
      })
      .join("") + `<p class="text-[13px] text-slate-muted">${total} vote${total === 1 ? "" : "s"}${mine >= 0 ? " · tap your choice again to remove your vote" : ""}</p>`;
  };
  paint();
  let stop = null;
  stop = watchVotes?.(post.id, (next) => {
    if (!box.isConnected) { stop?.(); return; }
    votes = next || {};
    paint();
  });
  box.addEventListener("click", (event) => {
    event.stopPropagation();
    const btn = event.target.closest(".poll-opt");
    if (!btn || !currentUserUid) return;
    const i = Number(btn.dataset.i);
    onVote?.(post.id, votes[currentUserUid] === i ? null : i);
  });
}

/** Opens a sheet with the QR code of a profile: { uid, name, username }. Scanning it opens the profile link. */
export function openProfileQr(user) {
  if (!user || !user.uid) return;
  const link = getProfileLink(user);
  const handle = user.username ? `@${user.username}` : "";
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/40";
  overlay.innerHTML = `
    <div class="w-full max-w-sm bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 text-center" role="dialog" aria-modal="true" aria-label="Profile QR code">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">QR code</h2>
        <button type="button" class="qr-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
      </div>
      <div class="inline-block bg-white rounded-2xl p-2 shadow-sm ring-1 ring-slate-border/60"><canvas class="qr-canvas block" style="width:240px;height:240px;image-rendering:pixelated" aria-label="QR code of the profile"></canvas></div>
      <p class="font-body-lg text-body-lg text-on-surface font-semibold mt-3 break-words">${escapeHtml(user.name || "FreeZone User")}</p>
      ${handle ? `<p class="font-body-md text-body-md text-primary/80">${escapeHtml(handle)}</p>` : ""}
      <p class="font-body-sm text-body-sm text-slate-muted mt-1">Scan with a phone camera to open this profile.</p>
      <div class="flex gap-2.5 mt-4">
        <button type="button" class="qr-save flex-1 py-2.5 rounded-xl font-label-lg text-label-lg text-on-surface bg-surface-container hover:bg-surface-container-high active:scale-95 transition-all flex items-center justify-center gap-2"><span class="material-symbols-outlined text-[18px]">download</span>Save image</button>
        <button type="button" class="qr-share flex-1 py-2.5 rounded-xl font-label-lg text-label-lg text-white bg-primary-container hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"><span class="material-symbols-outlined text-[18px]">share</span>Share link</button>
      </div>
    </div>`;
  const canvas = overlay.querySelector(".qr-canvas");
  try {
    drawQR(canvas, link, 480);
  } catch (error) {
    console.error(error);
    showToast("Could not make the QR code");
    return;
  }
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (event) => { event.stopPropagation(); if (event.target === overlay) close(); });
  overlay.querySelector(".qr-close").addEventListener("click", close);
  overlay.querySelector(".qr-share").addEventListener("click", () => shareProfile(user));
  overlay.querySelector(".qr-save").addEventListener("click", () => {
    canvas.toBlob((blob) => {
      if (!blob) return showToast("Could not save the image");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `freezone-${user.username || "profile"}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast("QR code saved");
    }, "image/png");
  });
  document.body.appendChild(overlay);
}

/** Shares a profile: { uid, name, username }. */
export async function shareProfile(user) {
  if (!user || !user.uid) return;
  const name = user.name || "FreeZone User";
  const text = user.username ? `${name} (@${user.username}) on FreeZone BD` : `${name} on FreeZone BD`;
  return shareLink({ link: getProfileLink(user), text, title: "Share profile" });
}

/* ---------------------------------------------------------------
   Post photos: one to four per post
---------------------------------------------------------------- */
// New posts keep every photo in `imageURLs` (and the first one also in `imageURL`); old posts only have `imageURL`.
export function postImageUrls(post) {
  if (!post) return [];
  const list = post.imageURLs ? (Array.isArray(post.imageURLs) ? post.imageURLs : Object.values(post.imageURLs)) : [];
  const urls = list.filter((url) => typeof url === "string" && url);
  if (!urls.length && post.imageURL) urls.push(post.imageURL);
  return urls.slice(0, 4);
}

// The photo lists are kept here, so the page does not carry huge (or repeated) links in its markup
const imageSets = new Map();

function hashString(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  return (hash >>> 0).toString(36) + text.length.toString(36);
}

/**
 * Markup of the photo grid: 1 photo = full width, 2 = side by side, 3 = one big and two small, 4 = a 2x2 grid.
 * options.flat       full-width, no rounded corners or border (the feed card)
 * options.doubleTap  the card handles taps itself (double tap = like) and adds the heart that pops up
 */
export function postImagesHtml(urls, { flat = false, doubleTap = false } = {}) {
  if (!urls || !urls.length) return "";
  const list = urls.slice(0, 4);
  const count = list.length;

  const key = hashString(list.join("\n"));
  imageSets.set(key, list);

  const singleStyle = flat ? "max-height:min(600px,125vw);" : "";
  const tile = (url, index, extra = "") => `
    <button type="button" class="post-img-tile relative block overflow-hidden bg-surface-container ${extra}" data-img-index="${index}" aria-label="Open photo ${index + 1} of ${count}">
      <img src="${escapeHtml(url)}" alt="" loading="lazy" class="${count === 1 ? `w-full ${flat ? "" : "max-h-[420px] "}object-cover block` : "absolute inset-0 w-full h-full object-cover"}" ${count === 1 && singleStyle ? `style="${singleStyle}"` : ""}
           onerror="${count === 1 ? "this.closest('.post-images')?.remove();" : "this.closest('.post-img-tile')?.remove();"}" />
    </button>`;

  let inner;
  if (count === 1) {
    inner = tile(list[0], 0, "w-full");
  } else if (count === 2) {
    inner = `<div class="grid grid-cols-2 grid-rows-1 gap-0.5 ${flat ? "aspect-[2/1.15]" : "aspect-[16/9]"}">${list.map((url, i) => tile(url, i)).join("")}</div>`;
  } else if (count === 3) {
    inner = `<div class="grid ${flat ? "grid-cols-[1.5fr_1fr]" : "grid-cols-2"} grid-rows-2 gap-0.5 aspect-[4/3]">${tile(list[0], 0, "row-span-2")}${tile(list[1], 1)}${tile(list[2], 2)}</div>`;
  } else {
    inner = `<div class="grid grid-cols-2 grid-rows-2 gap-0.5 ${flat ? "aspect-[4/3.2]" : "aspect-square"}">${list.map((url, i) => tile(url, i)).join("")}</div>`;
  }

  const frame = flat ? "relative overflow-hidden bg-slate-surface" : "rounded-xl overflow-hidden border border-slate-border bg-surface-container mt-1";
  const burst = doubleTap
    ? `<div class="fz-burst" aria-hidden="true"><svg viewBox="0 0 24 24" fill="#fff"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.2 3.4 5 6.6 5c2 0 3.6 1.2 5.4 3.3C13.8 6.2 15.4 5 17.4 5c3.2 0 5 3.2 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></div>`
    : "";
  return `<div class="post-images relative ${frame}" data-set="${key}" ${doubleTap ? 'data-double-tap="1"' : ""}>${inner}${burst}</div>`;
}

/* ---------------------------------------------------------------
   Post video: plays by itself (muted) while it is on screen; tap for sound, double tap to like
---------------------------------------------------------------- */
// A video post keeps { videoURL, videoThumb?, videoDuration? }
export function postVideoOf(post) {
  if (!post || typeof post.videoURL !== "string" || !post.videoURL.startsWith("https://")) return null;
  const thumb = typeof post.videoThumb === "string" && post.videoThumb.startsWith("https://") ? post.videoThumb : "";
  return { url: post.videoURL, thumb, duration: Number(post.videoDuration) || 0 };
}

// "Auto-play videos" (Settings > Appearance): kept on this phone. When it is off, a video starts only when tapped.
export function getVideoAutoplay() {
  try { return localStorage.getItem("fz-autoplay") !== "off"; } catch (e) { return true; }
}
export function setVideoAutoplay(on) {
  try { if (on) localStorage.removeItem("fz-autoplay"); else localStorage.setItem("fz-autoplay", "off"); } catch (e) { /* ignore */ }
  if (!on && videoState.current) pauseVideoBox(videoState.current);
}

const videoState = { muted: true, current: null }; // sound choice is shared by all videos; only one plays at a time
let videoObserver = null;

const paintVideo = (box) => {
  const video = box.querySelector("video");
  const sound = box.querySelector(".pv-sound span");
  const play = box.querySelector(".pv-play");
  if (sound) sound.textContent = video.muted ? "volume_off" : "volume_up";
  if (play) play.style.display = video.paused ? "flex" : "none";
};

function playVideoBox(box) {
  const video = box.querySelector("video");
  if (!video) return;
  if (videoState.current && videoState.current !== box) pauseVideoBox(videoState.current);
  videoState.current = box;
  video.muted = videoState.muted;
  const started = video.play();
  if (started && started.catch) started.catch(() => { video.muted = true; videoState.muted = true; video.play().catch(() => {}).finally(() => paintVideo(box)); });
  paintVideo(box);
}

function pauseVideoBox(box) {
  const video = box.querySelector("video");
  if (video) video.pause();
  if (videoState.current === box) videoState.current = null;
  paintVideo(box);
}

/** Pauses the video that is playing in a post card (used when a full-screen page opens above the feed). */
export function pausePostVideos() {
  if (videoState.current) pauseVideoBox(videoState.current);
}

function watchVideoBox(box) {
  if (!("IntersectionObserver" in window)) return;
  if (!videoObserver) {
    videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const box = entry.target;
        if (!box.isConnected) return videoObserver.unobserve(box);
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6 && document.visibilityState === "visible" && !box.dataset.userPaused && getVideoAutoplay()) playVideoBox(box);
        else if (!entry.isIntersecting || entry.intersectionRatio < 0.35) pauseVideoBox(box);
      });
    }, { threshold: [0, 0.35, 0.6, 1] });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible" && videoState.current) pauseVideoBox(videoState.current); });
  }
  videoObserver.observe(box);
}

/** Markup of the video of a post. Call mountPostVideo(element) once the markup is in a card. */
export function postVideoHtml(video, { doubleTap = false } = {}) {
  if (!video) return "";
  const burst = doubleTap
    ? `<div class="fz-burst" aria-hidden="true"><svg viewBox="0 0 24 24" fill="#fff"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.2 3.4 5 6.6 5c2 0 3.6 1.2 5.4 3.3C13.8 6.2 15.4 5 17.4 5c3.2 0 5 3.2 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg></div>`
    : "";
  return `<div class="post-video relative overflow-hidden bg-black cursor-pointer" style="aspect-ratio:4/5;max-height:min(600px,125vw);" ${doubleTap ? 'data-double-tap="1"' : ""}>
    <video src="${escapeHtml(video.url)}" ${video.thumb ? `poster="${escapeHtml(video.thumb)}"` : ""} class="absolute inset-0 w-full h-full" style="object-fit:contain;" muted loop playsinline preload="none"></video>
    <span class="pv-play absolute inset-0 items-center justify-center pointer-events-none" style="display:flex;"><span class="w-14 h-14 rounded-full bg-black/55 text-white flex items-center justify-center"><span class="material-symbols-outlined text-[34px]" style="font-variation-settings:'FILL' 1;">play_arrow</span></span></span>
    ${video.duration ? `<span class="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/60 text-white text-[12px]">${Math.floor(video.duration / 60)}:${String(Math.round(video.duration % 60)).padStart(2, "0")}</span>` : ""}
    <span class="pv-sound absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"><span class="material-symbols-outlined text-[18px]">volume_off</span></span>
    ${burst}
  </div>`;
}

/** Makes a video box of a post card work: autoplay on screen, tap = sound, double tap = like (onDoubleTap). */
export function mountPostVideo(box, { onDoubleTap, onOpen } = {}) {
  if (!box) return;
  const video = box.querySelector("video");
  const burst = box.querySelector(".fz-burst");
  video.addEventListener("loadedmetadata", () => {
    if (video.videoWidth && video.videoHeight) box.style.aspectRatio = String(Math.min(1.4, Math.max(0.75, video.videoWidth / video.videoHeight)).toFixed(3));
  });
  video.addEventListener("error", () => { if (video.getAttribute("src")) { box.querySelector(".pv-sound")?.remove(); box.querySelector(".pv-play").style.display = "none"; } });
  let lastTap = 0;
  let timer = null;
  box.addEventListener("click", (event) => {
    event.stopPropagation();
    if (onOpen && event.target.closest(".pv-sound")) { // the speaker button: sound on / off, without opening Reels
      videoState.muted = !videoState.muted;
      video.muted = videoState.muted;
      paintVideo(box);
      return;
    }
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(timer);
      lastTap = 0;
      if (burst) { burst.classList.remove("go"); void burst.offsetWidth; burst.classList.add("go"); }
      onDoubleTap?.();
      return;
    }
    lastTap = now;
    timer = setTimeout(() => {
      lastTap = 0;
      if (onOpen) { onOpen(); return; } // the feed: one tap opens this video in Reels
      if (video.paused) { delete box.dataset.userPaused; playVideoBox(box); return; } // a paused video starts again
      videoState.muted = !videoState.muted; // a playing video: tap = sound on / off
      video.muted = videoState.muted;
      paintVideo(box);
    }, 300);
  });
  box.addEventListener("dblclick", (event) => event.preventDefault());
  watchVideoBox(box);
}

/** Saves a picture to the phone. Fetches the picture and downloads it as a file; if the browser blocks that, a hint is shown. */
export async function downloadImage(url, filename = "") {
  // inside the Android app: straight into the gallery (the web way below does nothing in the app's WebView)
  const native = await nativeSaveMedia({ url, kind: "image" });
  if (native.status === "done") { showToast("Photo saved to your gallery"); return true; }
  if (native.status === "failed") { showToast("Could not save the photo: " + native.error); return false; }
  if (native.status === "unsupported") { showToast("Saving needs Android 10 or newer on this phone"); return false; }
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || `freezone-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    showToast("Photo saved");
    return true;
  } catch (error) {
    console.warn("Save photo:", error);
    showToast("Could not save it here. Press and hold the photo to save it.");
    return false;
  }
}

/** Saves the video of a post or a chat message (gallery in the app, a download in a browser). */
export function downloadVideo(url) {
  return saveVideo(url, showToast);
}

/** Full-screen photo viewer: swipe or use the arrows to move between the photos, swipe down or tap X to close. */
const viewerContexts = new Map();

// Facebook-style full-screen photo viewer. `ctx` (optional) = { post, isLiked(), likeCount(), commentCount(),
// toggleLike(), onComments(), onShare(), onReport() }; without it only the photo is shown.
export function openImageViewer(urls, startIndex = 0, ctx = null) {
  if (!urls || !urls.length) return;
  let index = Math.min(Math.max(startIndex, 0), urls.length - 1);
  const post = ctx && ctx.post;

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[9996] bg-black flex flex-col select-none";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Photo viewer");
  const pill =
    "flex-1 h-11 rounded-full bg-white/15 text-white flex items-center justify-center gap-2 font-semibold text-[14px] tabular-nums active:bg-white/25";
  const footer = post
    ? `<div class="iv-footer px-4 pt-3 text-white" style="padding-bottom:max(0.75rem, var(--fz-bottom,env(safe-area-inset-bottom,0px)));">
        <div class="flex items-center gap-3">
          <span class="iv-avatar shrink-0"></span>
          <div class="min-w-0">
            <div class="font-semibold text-[15px] truncate">${escapeHtml(post.name || "")}</div>
            <div class="text-white/60 text-[12px]">${escapeHtml(timeAgo(post.createdAt))}</div>
          </div>
        </div>
        ${
          post.text
            ? `<div class="mt-2 text-[14px] leading-snug text-white/95"><span class="iv-text iv-clamp break-words whitespace-pre-wrap">${escapeHtml(post.text)}</span> <button type="button" class="iv-more text-white/70 font-semibold" hidden>${TEXT_SEE_MORE}</button></div>`
            : ""
        }
        <div class="mt-3 flex items-center justify-between text-white/80 text-[13px]">
          <span class="iv-summary-likes flex items-center gap-1"></span>
          <span class="iv-summary-comments"></span>
        </div>
        <div class="mt-3 flex gap-2">
          <button type="button" class="iv-like ${pill}"><span class="iv-like-icon material-symbols-outlined">favorite</span><span class="iv-like-n"></span></button>
          <button type="button" class="iv-comment ${pill}"><span class="material-symbols-outlined">chat_bubble</span><span class="iv-comment-n"></span></button>
          <button type="button" class="iv-share ${pill}"><span class="material-symbols-outlined">share</span></button>
        </div>
      </div>`
    : `<div style="height:max(0.75rem, var(--fz-bottom,env(safe-area-inset-bottom,0px)));"></div>`;

  overlay.innerHTML = `
    <style>.iv-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.iv-heart-on{font-variation-settings:'FILL' 1;color:#ff3b5c}</style>
    <div class="flex items-center justify-between px-2 relative" style="padding-top:max(0.5rem, var(--fz-top,env(safe-area-inset-top,0px)));">
      <button type="button" class="iv-close w-11 h-11 rounded-full flex items-center justify-center text-white active:bg-white/10" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      <span class="iv-count text-white/90 text-[13px]"></span>
      <button type="button" class="iv-menu-btn w-11 h-11 rounded-full flex items-center justify-center text-white active:bg-white/10" aria-label="More"><span class="material-symbols-outlined">more_vert</span></button>
      <div class="iv-menu absolute right-2 top-full z-10 min-w-[190px] rounded-xl bg-[#242526] text-white shadow-xl py-1" hidden></div>
    </div>
    <div class="iv-stage flex-1 min-h-0 relative flex items-center justify-center overflow-hidden" style="touch-action:pan-y;">
      <img class="iv-img w-full max-h-full object-contain" alt="" draggable="false" />
      ${
        urls.length > 1
          ? `<button type="button" class="iv-prev absolute left-2 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center" aria-label="Previous photo"><span class="material-symbols-outlined">chevron_left</span></button>
             <button type="button" class="iv-next absolute right-2 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center" aria-label="Next photo"><span class="material-symbols-outlined">chevron_right</span></button>`
          : ""
      }
    </div>
    ${footer}`;

  const $ = (sel) => overlay.querySelector(sel);
  const imgEl = $(".iv-img");
  const countEl = $(".iv-count");
  const stage = $(".iv-stage");
  const menu = $(".iv-menu");

  const show = () => {
    imgEl.src = urls[index];
    countEl.textContent = urls.length > 1 ? `${index + 1} / ${urls.length}` : "";
  };
  const move = (step) => {
    if (urls.length < 2) return;
    index = (index + step + urls.length) % urls.length;
    show();
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") move(1);
    else if (event.key === "ArrowLeft") move(-1);
  };
  document.addEventListener("keydown", onKey);

  $(".iv-close").addEventListener("click", close);
  $(".iv-prev")?.addEventListener("click", () => move(-1));
  $(".iv-next")?.addEventListener("click", () => move(1));

  // ⋮ menu
  const items = [
    ["download", "Save photo", () => downloadImage(urls[index])],
  ];
  if (post) {
    items.unshift(["link", "Copy link", () => copyPostLink(post.id)]);
    if (ctx.onShare) items.push(["share", "Share", () => ctx.onShare()]);
    if (ctx.onReport) items.push(["flag", "Report", () => { close(); ctx.onReport(); }]);
  }
  menu.innerHTML = items
    .map(([icon, label], i) => `<button type="button" data-i="${i}" class="w-full flex items-center gap-3 px-4 h-11 text-left text-[14px] active:bg-white/10"><span class="material-symbols-outlined text-[20px]">${icon}</span>${label}</button>`)
    .join("");
  $(".iv-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-i]");
    if (!btn) return;
    menu.hidden = true;
    items[Number(btn.dataset.i)][2]();
  });
  overlay.addEventListener("click", (e) => {
    if (!e.target.closest(".iv-menu") && !e.target.closest(".iv-menu-btn")) menu.hidden = true;
  });

  // Footer (author, caption, counts, actions)
  if (post) {
    const avatarSlot = $(".iv-avatar");
    avatarSlot.innerHTML = avatarHtml(post.photoURL, "w-10 h-10");
    const more = $(".iv-more");
    const textEl = $(".iv-text");
    if (more && textEl) {
      requestAnimationFrame(() => {
        if (textEl.scrollHeight > textEl.clientHeight + 1) more.hidden = false;
      });
      more.addEventListener("click", () => {
        textEl.classList.remove("iv-clamp");
        more.hidden = true;
      });
    }
    const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n));
    const refresh = () => {
      const liked = ctx.isLiked();
      const likes = ctx.likeCount();
      const comments = ctx.commentCount();
      $(".iv-like-icon").classList.toggle("iv-heart-on", liked);
      $(".iv-like-n").textContent = fmt(likes);
      $(".iv-comment-n").textContent = fmt(comments);
      $(".iv-summary-likes").innerHTML = likes
        ? `<span class="material-symbols-outlined iv-heart-on text-[18px]">favorite</span>${fmt(likes)}`
        : "";
      $(".iv-summary-comments").textContent = comments ? `${fmt(comments)} comments` : "";
    };
    refresh();
    $(".iv-like").addEventListener("click", () => {
      ctx.toggleLike();
      refresh();
    });
    $(".iv-comment").addEventListener("click", () => {
      close();
      ctx.onComments?.();
    });
    $(".iv-share").addEventListener("click", () => ctx.onShare?.());
  }

  // Swipe: sideways = next/previous photo, down = close
  let startX = 0;
  let startY = 0;
  stage.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startY = event.clientY;
  });
  stage.addEventListener("pointerup", (event) => {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dy > 90 && dy > Math.abs(dx)) return close();
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
  });

  document.body.appendChild(overlay);
  show();
}

// One handler for every photo grid on the page (feed, post page, profile): it runs before the card's own
// "open post" click, so tapping a photo opens the viewer instead.
document.addEventListener(
  "click",
  (event) => {
    const tile = event.target.closest(".post-images [data-img-index]");
    if (!tile) return;
    if (tile.closest(".post-images").dataset.doubleTap) return; // the feed card handles taps itself (double tap = like)
    const urls = imageSets.get(tile.closest(".post-images").dataset.set);
    if (!urls || !urls.length) return;
    event.stopPropagation();
    event.preventDefault();
    openImageViewer(urls, Number(tile.dataset.imgIndex) || 0, viewerContexts.get(tile.closest(".post-images").dataset.set));
  },
  true
);

let globalMenuCloserAttached = false;
function ensureGlobalMenuCloser() {
  if (globalMenuCloserAttached) return;
  globalMenuCloserAttached = true;
  document.addEventListener("click", () => {
    document.querySelectorAll(".menu-dropdown").forEach((el) => {
      el.hidden = true;
    });
  });
}

/* ---------------------------------------------------------------
   The post card (Feed, profile). Flat and full width: header, text, photos, actions, last comment.
---------------------------------------------------------------- */
const TEXT_SEE_MORE = "আরও দেখুন";
const textViewAllComments = (count) => `সব ${count}টি কমেন্ট দেখুন`;

const CARD_ICONS = {
  heart: `<svg class="like-svg" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.2 3.4 5 6.6 5c2 0 3.6 1.2 5.4 3.3C13.8 6.2 15.4 5 17.4 5c3.2 0 5 3.2 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>`,
  comment: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 20.5l1.6-5A8.5 8.5 0 1 1 21 11.5z"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M21.5 3.5 10.8 14.2M21.5 3.5l-6.6 17-4.1-6.3-6.3-4.1 17-6.6z"/></svg>`,
  bookmark: (saved) => `<svg class="save-svg" viewBox="0 0 24 24" width="26" height="26" fill="${saved ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h12v17l-6-4.6-6 4.6v-17z"/></svg>`,
  dots: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`
};

// 1234 -> 1.2K
function compactCount(n) {
  n = Number(n) || 0;
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n);
}

// The newest comment that I may see (comments of accounts I blocked are skipped)
function latestComment(post, isBlockedUid) {
  if (!post.comments || typeof post.comments !== "object") return null;
  let latest = null;
  Object.values(post.comments).forEach((comment) => {
    if (!comment || !comment.text) return;
    if (isBlockedUid && comment.uid && isBlockedUid(comment.uid)) return;
    if (!latest || (comment.createdAt || 0) > (latest.createdAt || 0)) latest = comment;
  });
  return latest;
}

const ACT_BTN =
  "flex items-center gap-1.5 h-11 px-2 rounded-full text-on-surface font-semibold text-[14px] tabular-nums active:bg-surface-container transition-colors";

export function createPostCard(post, options = {}) {
  const { onNotInterested, currentUserUid, savedPostIds, followingIds, onOpen, onComments, onLike, onShare, onDelete, onEdit, onBoost, onAudience, onHashtag, onVote, watchVotes, onReport, onSave, onFollow, onProfile, onBlock, isBlocked: isBlockedUid, showFollowChip = true, onOpenVideo } = options;

  const likedByMe = !!(post.likes && currentUserUid && post.likes[currentUserUid]);
  const likesCount = post.likesCount || 0;
  const commentsCount = post.commentsCount || 0;
  const isOwner = !!(currentUserUid && post.uid === currentUserUid);
  const isSaved = !!(savedPostIds && savedPostIds[post.id]);
  const canFollow = !!(onFollow && currentUserUid && post.uid && post.uid !== currentUserUid);
  const canBlock = !!(onBlock && currentUserUid && post.uid && post.uid !== currentUserUid);
  const isFollowing = !!(followingIds && followingIds[post.uid]);
  const followHandle = post.username ? `@${post.username}` : post.name || "this user";
  const showFollow = canFollow && showFollowChip;

  const article = document.createElement("article");
  article.className = "bg-slate-surface border-y border-slate-border";
  article.dataset.postId = post.id;
  if (post.uid) article.dataset.authorUid = post.uid;

  const imageUrls = postImageUrls(post);
  const imageBlock = postImagesHtml(imageUrls, { flat: true, doubleTap: true });
  const postVideo = postVideoOf(post);
  const videoBlock = postVideo ? postVideoHtml(postVideo, { doubleTap: true }) : "";

  // Short text without photos is shown larger, like a status
  const text = post.text || "";
  const bigText = !imageUrls.length && !postVideo && text.length > 0 && text.length <= 110 && text.split("\n").length <= 2;
  const textBlock = text
    ? `<p class="post-text ${bigText ? "text-[20px] leading-7 font-medium" : "text-[15px] leading-[22px]"} text-on-surface whitespace-pre-wrap break-words mx-4 mb-2.5" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${linkifyText(text, escapeHtml, { tags: true })}</p>
       <button type="button" class="more-btn block px-4 -mt-1 mb-2.5 text-slate-muted font-semibold text-[14px] text-left" hidden>${TEXT_SEE_MORE}</button>`
    : "";

  const last = latestComment(post, isBlockedUid);
  const lastName = last ? (last.username ? `@${last.username}` : last.name || "FreeZone User") : "";
  const commentsBlock =
    commentsCount > 1 || last
      ? `<div class="px-4 pb-2.5 space-y-0.5">
           ${commentsCount > 1 ? `<button type="button" class="view-comments block text-slate-muted text-[14px] text-left">${textViewAllComments(commentsCount)}</button>` : ""}
           ${last ? `<p class="last-comment cursor-pointer text-[14px] leading-5 text-on-surface truncate"><span class="font-semibold">${escapeHtml(lastName)}</span> ${escapeHtml(last.text)}</p>` : ""}
         </div>`
      : `<div class="h-1.5"></div>`;

  article.innerHTML = `
    <div class="flex items-center gap-2 pl-4 pr-2 pt-3 pb-2.5">
      <div class="profile-link flex items-center gap-2.5 min-w-0 flex-1 ${onProfile && post.uid ? "cursor-pointer" : ""}">
        ${avatarHtml(post.photoURL, "w-10 h-10")}
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-semibold text-[15px] leading-5 text-on-surface truncate min-w-0">${escapeHtml(post.name || "FreeZone User")}</span>
            ${
              showFollow
                ? `<button type="button" class="follow-chip flex-shrink-0 flex items-center text-primary font-bold text-[14px] px-1 -ml-0.5 active:opacity-60" data-variant="inline" data-author-uid="${escapeHtml(post.uid)}" data-handle="${escapeHtml(followHandle)}" data-following="${isFollowing ? "1" : "0"}" aria-label="Follow ${escapeHtml(followHandle)}" ${isFollowing ? "hidden" : ""}>
                     <span class="text-slate-subtle font-normal mr-1.5" aria-hidden="true">·</span><span class="follow-chip-label">${isRequested(post.uid) ? "Requested" : "Follow"}</span>
                   </button>`
                : ""
            }
          </div>
          <div class="text-slate-muted text-[13px] leading-[18px] truncate">${post.username ? `@${escapeHtml(post.username)} · ` : ""}${timeAgo(post.createdAt)}${post.editedAt ? " · edited" : ""}${post.audience === "followers" ? ` · <span class="material-symbols-outlined text-[13px] align-[-2px]" title="Followers only">group</span>` : post.audience === "me" ? ` · <span class="material-symbols-outlined text-[13px] align-[-2px]" title="Only me">lock</span>` : ""}</div>${tagLineHtml(post, escapeHtml)}
        </div>
      </div>

      <div class="relative menu-wrap flex-shrink-0">
        <button class="menu-btn w-10 h-10 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container active:bg-surface-container transition-colors" aria-label="More options">${CARD_ICONS.dots}</button>
        <div class="menu-dropdown absolute right-0 top-10 z-20 w-52 bg-slate-surface border border-slate-border rounded-xl shadow-xl py-1.5 overflow-hidden" hidden>
          <button class="copy-link-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[18px]">link</span> Copy link
          </button>
          ${
            postVideoOf(post)
              ? `<button class="save-video-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5">
                   <span class="material-symbols-outlined text-[18px]">download</span> Save video
                 </button>`
              : ""
          }
          ${
            onSave
              ? `<button class="save-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5" data-post-id="${escapeHtml(post.id)}" data-saved="${isSaved ? "1" : "0"}">
                   <span class="save-icon material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' ${isSaved ? 1 : 0};">bookmark</span>
                   <span class="save-label">${isSaved ? "Unsave post" : "Save post"}</span>
                 </button>`
              : ""
          }
          ${
            showFollow
              ? `<button class="unfollow-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5" data-author-uid="${escapeHtml(post.uid)}" ${isFollowing ? "" : "hidden"}>
                   <span class="material-symbols-outlined text-[18px]">person_remove</span> <span class="truncate">Unfollow ${escapeHtml(followHandle)}</span>
                 </button>`
              : ""
          }
          ${
            isOwner
              ? `<button class="edit-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5">
                   <span class="material-symbols-outlined text-[18px]">edit</span> Edit post
                 </button>
                 ${onBoost ? `<button class="boost-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5">
                   <span class="material-symbols-outlined text-[18px]">campaign</span> Boost post
                 </button>` : ""}
                 ${onAudience ? `<button class="audience-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5">
                   <span class="material-symbols-outlined text-[18px]">${post.audience === "me" ? "lock" : post.audience === "followers" ? "group" : "public"}</span> Who can see this
                 </button>` : ""}
                 <button class="delete-btn w-full text-left px-3.5 py-2.5 text-sm text-error hover:bg-error-container/40 flex items-center gap-2.5">
                   <span class="material-symbols-outlined text-[18px]">delete</span> Delete post
                 </button>`
              : `${
                  onNotInterested
                    ? `<button class="notint-btn w-full text-left px-3.5 py-2.5 text-sm text-on-surface hover:bg-surface-container-low flex items-center gap-2.5">
                         <span class="material-symbols-outlined text-[18px]">visibility_off</span> Not interested
                       </button>`
                    : ""
                }${
                  onReport
                    ? `<button class="report-btn w-full text-left px-3.5 py-2.5 text-sm text-error hover:bg-error-container/40 flex items-center gap-2.5">
                         <span class="material-symbols-outlined text-[18px]">flag</span> Report post
                       </button>`
                    : ""
                }${
                  canBlock
                    ? `<button class="block-btn w-full text-left px-3.5 py-2.5 text-sm text-error hover:bg-error-container/40 flex items-center gap-2.5">
                         <span class="material-symbols-outlined text-[18px]">block</span> <span class="truncate">Block ${escapeHtml(followHandle)}</span>
                       </button>`
                    : ""
                }`
          }
        </div>
      </div>
    </div>

    ${textBlock}
    ${pollOptionsOf(post).length >= 2 ? `<div class="poll-box mx-4 mb-3"></div>` : ""}

    <div class="edit-wrap space-y-2.5 mx-4 mb-3" hidden>
      <textarea class="edit-textarea w-full bg-surface-container-low border border-transparent focus:border-primary-container focus:ring-2 focus:ring-primary-container/20 rounded-xl px-3.5 py-2.5 text-body-md text-body-md outline-none resize-none transition-all" rows="3" maxlength="500">${escapeHtml(post.text)}</textarea>
      <div class="flex items-center justify-between">
        <span class="edit-char-count text-slate-subtle font-label-sm text-label-sm">0/500</span>
        <div class="flex items-center gap-2">
          <button type="button" class="edit-cancel px-3.5 py-1.5 rounded-lg text-slate-muted font-label-md text-label-md font-semibold hover:bg-surface-container transition-colors">Cancel</button>
          <button type="button" class="edit-save px-4 py-1.5 rounded-lg bg-primary-container text-white font-label-md text-label-md font-semibold disabled:opacity-50 active:scale-95 transition-all">Save</button>
        </div>
      </div>
    </div>

    ${imageBlock}
    ${videoBlock}

    <div class="flex items-center px-2 pt-1">
      <button type="button" class="like-btn ${ACT_BTN} ${likedByMe ? "text-notification-rose liked" : ""}" aria-label="Like" aria-pressed="${likedByMe}">
        ${CARD_ICONS.heart}<span class="like-count">${compactCount(likesCount)}</span>
      </button>
      <button type="button" class="comment-btn ${ACT_BTN}" aria-label="Comments">
        ${CARD_ICONS.comment}<span>${compactCount(commentsCount)}</span>
      </button>
      <button type="button" class="share-btn ${ACT_BTN}" aria-label="Share">${CARD_ICONS.share}</button>
      <span class="flex-1"></span>
      ${
        onSave
          ? `<button type="button" class="save-btn ${ACT_BTN}" data-post-id="${escapeHtml(post.id)}" data-saved="${isSaved ? "1" : "0"}" aria-label="Save post" aria-pressed="${isSaved}">${CARD_ICONS.bookmark(isSaved)}</button>`
          : ""
      }
    </div>

    ${commentsBlock}
  `;

  // The heart of a liked post is filled
  const likeBtn = article.querySelector(".like-btn");
  const likeSvg = likeBtn.querySelector(".like-svg");
  const likeCountEl = likeBtn.querySelector(".like-count");
  if (likedByMe) likeSvg.style.fill = "currentColor";

  // Likes show at once; the database confirms a moment later (the feed redraws with the saved value)
  let liked = likedByMe;
  let likeTotal = likesCount;
  const toggleLikeNow = () => {
    liked = !liked;
    likeTotal = Math.max(0, likeTotal + (liked ? 1 : -1));
    likeBtn.classList.toggle("liked", liked);
    likeBtn.classList.toggle("text-notification-rose", liked);
    likeBtn.setAttribute("aria-pressed", String(liked));
    likeSvg.style.fill = liked ? "currentColor" : "none";
    likeCountEl.textContent = compactCount(likeTotal);
    likeBtn.classList.remove("pop");
    void likeBtn.offsetWidth;
    likeBtn.classList.add("pop");
    onLike?.(post.id);
  };

  likeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLikeNow();
  });

  // What the full-screen photo viewer needs to show and act on this post
  const photoSet = article.querySelector(".post-images");
  if (photoSet) {
    viewerContexts.set(photoSet.dataset.set, {
      post,
      isLiked: () => liked,
      likeCount: () => likeTotal,
      commentCount: () => commentsCount,
      toggleLike: toggleLikeNow,
      onComments: () => (onComments || onOpen)?.(post.id),
      onShare: () => onShare?.(post),
      onReport: onReport ? async () => { const result = await openReportDialog(); if (result) onReport(post, result); } : null,
    });
  }

  const pollBox = article.querySelector(".poll-box");
  if (pollBox) mountPoll(pollBox, post, { currentUserUid, onVote, watchVotes });

  // Tap a #tag: open its page (before the card's own tap handler opens the post)
  article.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest(".hashtag");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      onHashtag?.(link.dataset.tag);
    },
    true
  );

  // Comment button and "View all comments": the comments sheet (falls back to the post page)
  const openCommentsNow = (event) => {
    event.stopPropagation();
    (onComments || onOpen)?.(post.id);
  };
  article.querySelector(".comment-btn").addEventListener("click", openCommentsNow);
  const viewComments = article.querySelector(".view-comments");
  if (viewComments) viewComments.addEventListener("click", openCommentsNow);
  // the one-line preview of the newest comment: tap it to read all comments
  const lastComment = article.querySelector(".last-comment");
  if (lastComment) lastComment.addEventListener("click", (event) => { event.stopPropagation(); openCommentsNow(event); });

  article.querySelector(".share-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    onShare?.(post);
  });

  // Video: plays by itself on screen, tap for sound, a double tap likes the post (never un-likes it)
  mountPostVideo(article.querySelector(".post-video"), { onDoubleTap: () => { if (!liked) toggleLikeNow(); }, onOpen: onOpenVideo ? () => onOpenVideo(post) : null });

  // Photos: one tap opens the viewer, a double tap likes the post (never un-likes it)
  const imagesEl = article.querySelector(".post-images");
  if (imagesEl) {
    const burst = imagesEl.querySelector(".fz-burst");
    let lastTap = 0;
    let tapTimer = null;
    imagesEl.addEventListener("click", (event) => {
      event.stopPropagation();
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        tapTimer = null;
        lastTap = 0;
        if (burst) {
          burst.classList.remove("go");
          void burst.offsetWidth;
          burst.classList.add("go");
        }
        if (!liked) toggleLikeNow();
        return;
      }
      lastTap = now;
      const tile = event.target.closest("[data-img-index]");
      const index = tile ? Number(tile.dataset.imgIndex) || 0 : 0;
      tapTimer = setTimeout(() => {
        tapTimer = null;
        lastTap = 0;
        const urls = imageSets.get(imagesEl.dataset.set);
        if (urls && urls.length) openImageViewer(urls, index, viewerContexts.get(imagesEl.dataset.set));
      }, 300);
    });
  }

  const menuBtn = article.querySelector(".menu-btn");
  const menuDropdown = article.querySelector(".menu-dropdown");

  menuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".menu-dropdown").forEach((el) => {
      if (el !== menuDropdown) el.hidden = true;
    });
    menuDropdown.hidden = !menuDropdown.hidden;
  });

  ensureGlobalMenuCloser();

  article.querySelector(".copy-link-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    menuDropdown.hidden = true;
    copyPostLink(post.id);
  });

  article.querySelector(".save-video-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    menuDropdown.hidden = true;
    const v = postVideoOf(post);
    if (v) downloadVideo(v.url);
  });

  const profileLink = article.querySelector(".profile-link");
  if (profileLink && onProfile && post.uid) {
    profileLink.addEventListener("click", (event) => {
      event.stopPropagation();
      onProfile(post.uid);
    });
  }

  // Follow (next to the name; it disappears once I follow) and Unfollow (in the ⋮ menu)
  const followChip = article.querySelector(".follow-chip");
  if (followChip) {
    followChip.addEventListener("click", async (event) => {
      event.stopPropagation();
      followChip.disabled = true;
      await onFollow(post, false); // on success updateFollowButtons() refreshes every card of this author
      followChip.disabled = false;
    });
  }
  const unfollowBtn = article.querySelector(".unfollow-btn");
  if (unfollowBtn) {
    unfollowBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      if (!confirm(`Unfollow ${followHandle}?`)) return;
      await onFollow(post, true);
    });
  }

  // Save: the bookmark under the post and the item in the ⋮ menu do the same thing
  article.querySelectorAll(".save-btn").forEach((saveBtn) => {
    saveBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      const wasSaved = saveBtn.dataset.saved === "1";
      const ok = await onSave(post, wasSaved);
      if (ok) updateSaveButtons(post.id, !wasSaved);
    });
  });

  const notIntBtn = article.querySelector(".notint-btn");
  if (notIntBtn) {
    notIntBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      onNotInterested(post);
    });
  }

  const blockBtn = article.querySelector(".block-btn");
  if (blockBtn) {
    blockBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      onBlock(post);
    });
  }

  const reportBtn = article.querySelector(".report-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      const result = await openReportDialog();
      if (result) onReport?.(post, result);
    });
  }

  const boostBtn = article.querySelector(".boost-btn");
  if (boostBtn) {
    boostBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      onBoost?.(post);
    });
  }

  const audienceBtn = article.querySelector(".audience-btn");
  if (audienceBtn) {
    audienceBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      const choice = await openAudienceSheet(post.audience || "public");
      if (choice && choice !== (post.audience || "public")) onAudience?.(post.id, choice);
    });
  }

  const deleteBtn = article.querySelector(".delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      onDelete?.(post.id);
    });
  }

  // Long text: three lines, then "See more". Tap the opened text to fold it again.
  const postTextEl = article.querySelector(".post-text");
  const moreBtn = article.querySelector(".more-btn");
  const clampStyle = postTextEl ? postTextEl.getAttribute("style") || "" : "";
  let expanded = false;
  const checkClamp = () => {
    if (!postTextEl || !moreBtn || expanded || postTextEl.hidden) return;
    moreBtn.hidden = !(postTextEl.scrollHeight > postTextEl.clientHeight + 2);
  };
  if (postTextEl && moreBtn) {
    if ("ResizeObserver" in window) new ResizeObserver(checkClamp).observe(postTextEl);
    else requestAnimationFrame(checkClamp);

    const expand = () => {
      expanded = true;
      postTextEl.style.cssText = "";
      moreBtn.hidden = true;
    };
    const collapse = () => {
      expanded = false;
      postTextEl.setAttribute("style", clampStyle);
      checkClamp();
      // bring the post back into view if folding moved its top above the screen
      const top = article.getBoundingClientRect().top;
      if (top < 96) { article.style.scrollMarginTop = "100px"; article.scrollIntoView({ block: "start" }); }
    };

    moreBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      expand();
    });
    // tapping the opened text folds it (links and hashtags keep working)
    postTextEl.addEventListener("click", (event) => {
      if (!expanded) return;
      if (event.target.closest("a, button, [data-hashtag], [data-tag], .hashtag")) return;
      event.stopPropagation();
      collapse();
    });
  }

  const editWrap = article.querySelector(".edit-wrap");
  const editBtn = article.querySelector(".edit-btn");

  if (editBtn) {
    const editTextarea = article.querySelector(".edit-textarea");
    const editCancelBtn = article.querySelector(".edit-cancel");
    const editSaveBtn = article.querySelector(".edit-save");
    const editCharCount = article.querySelector(".edit-char-count");

    const updateCharCount = () => {
      editCharCount.textContent = `${editTextarea.value.length}/500`;
    };

    const enterEditMode = () => {
      if (postTextEl) postTextEl.hidden = true;
      if (moreBtn) moreBtn.hidden = true;
      editWrap.hidden = false;
      editTextarea.value = post.text || "";
      updateCharCount();
      editTextarea.focus();
    };

    const exitEditMode = () => {
      if (postTextEl) postTextEl.hidden = false;
      editWrap.hidden = true;
      checkClamp();
    };

    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      menuDropdown.hidden = true;
      enterEditMode();
    });

    editWrap.addEventListener("click", (event) => event.stopPropagation());
    editTextarea.addEventListener("input", updateCharCount);

    editCancelBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      exitEditMode();
    });

    editSaveBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const newText = editTextarea.value.trim();
      if (!newText) return;

      editSaveBtn.disabled = true;
      try {
        await onEdit?.(post.id, newText);
        exitEditMode();
      } catch (error) {
        console.error(error);
        alert("Could not save the edit. Please try again.");
      } finally {
        editSaveBtn.disabled = false;
      }
    });
  }

  return article;
}
