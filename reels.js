// FreeZone BD - Reels: full-screen videos, one swipe at a time (opened by the Video button in the bottom bar)
//
// feed.js calls  openReels({ ... })  and this file does the rest. Nothing is saved except:
//   posts/{id}/likes/{uid} + likesCount   (through the same like function the feed uses)
//   posts/{id}/playsCount, watchTimeMs    (how many times a video was played and for how long: feed algorithm part 23)
// The videos come from the newest posts that have a videoURL. They are ordered by the feed algorithm (rankPosts),
// which also hides blocked, muted, adult, spam and heavily reported posts.

import { ref, get, query, orderByChild, limitToLast, onValue, update, increment } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, avatarHtml, showToast, canViewPost, postVideoOf, getPostLink, copyPostLink, downloadVideo } from "./post.js";
import { rankPosts, watchAction } from "./feed-algorithm.js";
import { storageReady, previewNotice } from "./features.js";

const LOAD = 300; // the newest posts looked at
const MAX_REELS = 60;
const MIN_WATCH_MS = 1500; // a shorter look is not counted as a play
const MAX_WATCH_MS = 10 * 60 * 1000; // never more than 10 minutes in one save (the rules allow this much)

const compact = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
};

// Icons: solid white (the heart turns red when liked, the bookmark yellow when saved)
const SOLID = (path, size = 34, extra = "") => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" fill-rule="evenodd" aria-hidden="true" ${extra}>${path}</svg>`;
const HEART = SOLID(`<path d="M12 21s-7.8-4.9-9.6-10C1.3 7.6 3.3 4.5 6.6 4.5c2 0 3.5 1 5.4 3 1.9-2 3.4-3 5.4-3 3.3 0 5.3 3.1 4.2 6.5C19.8 16.1 12 21 12 21z"/>`);
const BUBBLE = SOLID(`<path d="M12 3C6.8 3 2.7 6.6 2.7 11c0 2.2 1 4.2 2.7 5.7L4.6 21l4.5-2.2c.9.2 1.9.3 2.9.3 5.2 0 9.3-3.6 9.3-8S17.2 3 12 3zM7.2 11a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0zm3.65 0a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0zm3.65 0a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0z"/>`);
const BOOKMARK = SOLID(`<path d="M6 3h12a1 1 0 0 1 1 1v17.2a.5.5 0 0 1-.8.4L12 17l-6.2 4.6a.5.5 0 0 1-.8-.4V4a1 1 0 0 1 1-1z"/>`);
const SHARE = SOLID(`<path d="M13 4.5v4.1c-5.6.4-9.6 3.9-10.5 10.4a.4.4 0 0 0 .7.3c2.4-3.2 5.4-4.4 9.8-4.6v4.2a.8.8 0 0 0 1.3.6l7.6-7a.8.8 0 0 0 0-1.2l-7.6-7A.8.8 0 0 0 13 4.5z"/>`);
const DOTS = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>`;

let openNow = null; // only one Reels page at a time

// In the Android app: black status / navigation bars while Reels is open (otherwise white strips show above and below the video).
// A no-op in a browser and in an old app build without the FzBars plugin.
function blackBars(on) {
  try {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return;
    const plugin = (cap.Plugins && cap.Plugins.FzBars) || (cap.registerPlugin && cap.registerPlugin("FzBars"));
    if (plugin) plugin[on ? "black" : "reset"]().catch(() => { /* not available: keep the normal bars */ });
  } catch (error) { /* ignore */ }
}

/**
 * @param {object} o
 *   db, currentUser, followingIds (live object), followerIds, chattedIds
 *   isBlocked(uid), isMuted(uid)
 *   onLike(postId) -> Promise    toggles my like (the feed's own function)
 *   onComments(postId)           opens the comments sheet
 *   onShare(post)                opens the share sheet
 *   onProfile(uid)               opens a profile (it appears above Reels)
 *   onFollow(post, wasFollowing) -> Promise<boolean>   the feed's follow function (returns the new state)
 *   savedPostIds (live object), onSave(post, wasSaved) -> Promise<boolean>   the Save (bookmark) button
 *   learn(post, action)          tells my interest profile what I did
 *   isCovered()                  true while a page / post is open above Reels (the video pauses)
 *   startPostId                  optional: start with this post
 */
export async function openReels(o) {
  if (openNow) return;
  const { db, currentUser } = o;
  if (!db || !currentUser) return;
  const me = currentUser.uid;

  const root = document.createElement("div");
  root.className = "fz-reels fixed inset-0 z-[65] bg-black text-white";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Reels");
  root.innerHTML = `
    <style>
      .fz-reels .fz-rl-list { position:absolute; inset:0; overflow-y:scroll; scroll-snap-type:y mandatory; overscroll-behavior:contain; scrollbar-width:none; }
      .fz-reels .fz-rl-list::-webkit-scrollbar { display:none; }
      .fz-reels .fz-rl-item { position:relative; height:100%; scroll-snap-align:start; scroll-snap-stop:always; overflow:hidden; background:#000; }
      .fz-reels video { position:absolute; inset:0; width:100%; height:100%; }
      .fz-reels .fz-rl-btn { display:flex; flex-direction:column; align-items:center; gap:2px; color:#fff; font-size:12px; font-weight:600; text-shadow:0 1px 3px rgba(0,0,0,.6); -webkit-tap-highlight-color:transparent; }
      .fz-reels .fz-rl-btn > :first-child { filter:drop-shadow(0 1px 3px rgba(0,0,0,.5)); transition:transform .15s; }
      .fz-reels .fz-rl-btn:active > :first-child { transform:scale(.88); }
      .fz-reels .fz-rl-like.liked > :first-child { color:#ff3040; }
      .fz-reels .fz-rl-like.liked .fz-rl-heart-p { fill:#ff3040; }
      .fz-reels .fz-rl-save.saved > :first-child { color:#ffc107; }
      .fz-reels .fz-rl-plus { position:absolute; left:50%; bottom:-10px; margin-left:-10px; width:20px; height:20px; border-radius:9999px; background:#ff3040; color:#fff; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; transition:transform .2s, opacity .2s; }
      .fz-reels .fz-rl-plus:active { transform:scale(.85); }
      .fz-reels .fz-rl-plus.gone { transform:scale(0); opacity:0; }
      .fz-reels .fz-rl-disc { width:42px; height:42px; border-radius:9999px; overflow:hidden; border:2px solid rgba(255,255,255,.9); box-sizing:border-box; animation:fzRlSpin 7s linear infinite; background:rgba(128,128,128,.5); }
      @keyframes fzRlSpin { to { transform:rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .fz-reels .fz-rl-disc { animation:none; } }
      .fz-reels .fz-rl-more, .fz-reels .fz-rl-less { color:rgba(255,255,255,.75); font-weight:600; background:none; border:0; padding:0; font:inherit; font-weight:600; }
      .fz-reels .fz-rl-sheet { position:absolute; inset:0; z-index:30; background:rgba(0,0,0,.5); display:flex; align-items:flex-end; }
      .fz-reels .fz-rl-sheet > div { width:100%; background:#1c1c1e; border-radius:18px 18px 0 0; padding:8px 0 calc(var(--fz-bottom, env(safe-area-inset-bottom, 0px)) + 10px); }
      .fz-reels .fz-rl-sheet button { display:flex; align-items:center; gap:14px; width:100%; padding:15px 20px; color:#fff; font-size:16px; text-align:left; }
      .fz-reels .fz-rl-sheet button:active { background:rgba(255,255,255,.1); }
      .fz-reels .fz-rl-burst { position:absolute; left:50%; top:50%; margin:-48px 0 0 -48px; width:96px; height:96px; opacity:0; pointer-events:none; color:#fff; }
      .fz-reels .fz-rl-burst.go { animation:fzRlBurst .75s ease-out; }
      @keyframes fzRlBurst { 0%{opacity:0;transform:scale(.4)} 25%{opacity:1;transform:scale(1.15)} 60%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.05)} }
      @media (prefers-reduced-motion: reduce) { .fz-reels .fz-rl-burst.go { animation:none; opacity:1; } }
    </style>
    <div class="fz-rl-list"></div>
    <div class="fz-rl-top absolute top-0 inset-x-0 z-20 flex items-center gap-1 px-2 pointer-events-none" style="padding-top:max(.5rem, var(--fz-top, env(safe-area-inset-top, 0px))); height:calc(56px + var(--fz-top, env(safe-area-inset-top, 0px)));">
      <button type="button" class="fz-rl-close pointer-events-auto w-10 h-10 rounded-full flex items-center justify-center active:bg-white/15" aria-label="Back"><span class="material-symbols-outlined text-[26px]">arrow_back</span></button>
      <span class="font-semibold text-[18px]" style="text-shadow:0 1px 3px rgba(0,0,0,.6)">Reels</span>
      <button type="button" class="fz-rl-mute pointer-events-auto ml-auto w-10 h-10 rounded-full flex items-center justify-center active:bg-white/15" aria-label="Sound"><span class="material-symbols-outlined text-[24px]">volume_up</span></button>
    </div>
    <div class="fz-rl-state absolute inset-0 z-10 flex flex-col items-center justify-center text-center px-8 pointer-events-none"></div>
    <div class="fz-rl-hint hidden absolute left-1/2 z-20 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-[13px] pointer-events-none" style="bottom:calc(var(--fz-bottom, env(safe-area-inset-bottom, 0px)) + 96px);">Tap the speaker for sound</div>`;
  const listEl = root.querySelector(".fz-rl-list");
  const stateEl = root.querySelector(".fz-rl-state");
  const muteBtn = root.querySelector(".fz-rl-mute");
  const hintEl = root.querySelector(".fz-rl-hint");
  document.body.appendChild(root);
  blackBars(true);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  openNow = root;

  const showState = (html) => { stateEl.innerHTML = html; stateEl.style.display = html ? "flex" : "none"; };
  showState(`<div class="w-9 h-9 rounded-full border-[3px] border-white/25 border-t-white animate-spin"></div>`);

  /* ---------- state ---------- */
  let reels = []; // [{ post, video, el, vid, ... }]
  let active = -1;
  let muted = false;
  let closed = false;
  let coverTimer = null;
  let unsubActive = null;
  let watch = null; // { reel, ms, last }  the time watched in the active reel

  const iLiked = (post) => !!(post.likes && post.likes[me]);

  /* ---------- watch time ---------- */
  const flushWatch = () => {
    if (!watch) return;
    const { reel, ms } = watch;
    watch = null;
    if (ms < MIN_WATCH_MS) return;
    const post = reel.post;
    const action = watchAction({ ...post }, ms);
    if (action) o.learn?.(post, action);
    if (post.uid === me) return; // my own videos are not counted
    update(ref(db), {
      [`posts/${post.id}/playsCount`]: increment(1),
      [`posts/${post.id}/watchTimeMs`]: increment(Math.min(Math.round(ms), MAX_WATCH_MS))
    }).catch(() => { /* a play is not important enough to retry (or the rules are not updated yet) */ });
  };
  const tickWatch = () => {
    if (!watch) return;
    const now = performance.now();
    if (!watch.reel.vid.paused && !watch.reel.vid.ended) watch.ms += now - watch.last;
    watch.last = now;
  };

  /* ---------- drawing one reel ---------- */
  const likeIcon = (reel) => reel.el.querySelector(".fz-rl-like");
  const paintCounts = (reel) => {
    const p = reel.post;
    const btn = likeIcon(reel);
    btn.classList.toggle("liked", iLiked(p));
    btn.querySelector(".fz-rl-n").textContent = compact(p.likesCount);
    reel.el.querySelector(".fz-rl-comment .fz-rl-n").textContent = compact(p.commentsCount);
    reel.el.querySelector(".fz-rl-share .fz-rl-sn").textContent = compact(p.sharesCount);
  };

  const paintSave = (reel) => {
    const btn = reel.el.querySelector(".fz-rl-save");
    if (!btn) return;
    const saved = !!(o.savedPostIds && o.savedPostIds[reel.post.id]);
    btn.classList.toggle("saved", saved);
    btn.setAttribute("aria-pressed", String(saved));
    btn.querySelector(".fz-rl-savetext").textContent = saved ? "Saved" : "Save";
  };

  const buildReel = (post, video) => {
    const el = document.createElement("section");
    el.className = "fz-rl-item";
    el.dataset.id = post.id;
    const handle = post.username ? `@${post.username}` : post.name || "FreeZone User";
    const own = post.uid === me;
    el.innerHTML = `
      <video ${video.thumb ? `poster="${escapeHtml(video.thumb)}"` : ""} loop playsinline preload="none" style="object-fit:contain;background:#000"></video>
      <div class="fz-rl-tap absolute inset-0"></div>
      <svg class="fz-rl-burst" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.2 3.4 5 6.6 5c2 0 3.6 1.2 5.4 3.3C13.8 6.2 15.4 5 17.4 5c3.2 0 5 3.2 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>
      <span class="fz-rl-pause absolute inset-0 items-center justify-center pointer-events-none" style="display:none"><span class="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center"><span class="material-symbols-outlined text-[40px]" style="font-variation-settings:'FILL' 1">play_arrow</span></span></span>
      <div class="fz-rl-spin hidden absolute inset-0 items-center justify-center pointer-events-none"><div class="w-9 h-9 rounded-full border-[3px] border-white/25 border-t-white animate-spin"></div></div>

      <div class="absolute right-2 z-20 flex flex-col items-center gap-[15px]" style="bottom:calc(var(--fz-bottom, env(safe-area-inset-bottom, 0px)) + 20px)">
        <div class="relative" style="width:48px;height:48px;margin-bottom:12px">
          <button type="button" class="fz-rl-author" aria-label="Open profile of ${escapeHtml(handle)}" style="display:block;width:48px;height:48px;border-radius:9999px;overflow:hidden;border:2px solid #fff;box-sizing:border-box">${avatarHtml(post.photoURL, "w-full h-full")}</button>
          ${own ? "" : `<button type="button" class="fz-rl-plus fz-rl-follow" aria-label="Follow"><span class="material-symbols-outlined" style="font-size:17px;font-weight:700">add</span></button>`}
        </div>
        <button type="button" class="fz-rl-btn fz-rl-like" aria-label="Like">${HEART}<span class="fz-rl-n">0</span></button>
        <button type="button" class="fz-rl-btn fz-rl-comment" aria-label="Comments">${BUBBLE}<span class="fz-rl-n">0</span></button>
        <button type="button" class="fz-rl-btn fz-rl-save" aria-label="Save post">${BOOKMARK}<span class="fz-rl-savetext">Save</span></button>
        <button type="button" class="fz-rl-btn fz-rl-share" aria-label="Share">${SHARE}<span class="fz-rl-sn">0</span></button>
        <button type="button" class="fz-rl-btn fz-rl-menu" aria-label="More options">${DOTS}</button>
        <div class="fz-rl-disc" aria-hidden="true" style="margin-top:2px">${avatarHtml(post.musicCover || post.photoURL, "w-full h-full")}</div>
      </div>

      <div class="absolute left-0 z-10 px-3" style="right:80px;bottom:calc(var(--fz-bottom, env(safe-area-inset-bottom, 0px)) + 20px);pointer-events:none;">
        <button type="button" class="fz-rl-name block max-w-full font-bold text-[18px] truncate text-left" style="pointer-events:auto;text-shadow:0 1px 4px rgba(0,0,0,.75)">${escapeHtml(post.name || handle)}</button>
        ${post.text ? `<p class="fz-rl-text text-[15px] leading-snug mt-1 whitespace-pre-wrap break-words" style="text-shadow:0 1px 4px rgba(0,0,0,.75);pointer-events:auto;"></p>` : ""}
      </div>
      <div class="fz-rl-bar absolute inset-x-0 bottom-0 z-10 h-[3px]"><div class="h-full bg-white" style="width:0%"></div></div>`;
    const reel = { post, video, el, vid: el.querySelector("video"), userPaused: false, errored: false };
    wireReel(reel);
    paintCounts(reel);
    paintSave(reel);
    return reel;
  };

  const setSrc = (reel, on) => {
    const vid = reel.vid;
    if (on) {
      if (!vid.getAttribute("src") && !reel.errored) { vid.preload = "auto"; vid.src = reel.video.url; }
    } else if (vid.getAttribute("src")) {
      vid.pause();
      vid.removeAttribute("src");
      vid.preload = "none";
      vid.load();
    }
  };

  const paintPause = (reel) => {
    const el = reel.el.querySelector(".fz-rl-pause");
    el.style.display = reel.userPaused ? "flex" : "none";
  };

  const play = (reel) => {
    const vid = reel.vid;
    if (!vid.getAttribute("src")) setSrc(reel, true);
    vid.muted = muted;
    const started = vid.play();
    if (started && started.catch) {
      started.catch((error) => {
        if (error && error.name === "NotAllowedError" && !vid.muted) {
          // the browser wants a tap before sound: play without sound and tell the person
          muted = true; applyMute(); hintEl.classList.remove("hidden"); setTimeout(() => hintEl.classList.add("hidden"), 3500);
          vid.muted = true; vid.play().catch(() => {});
        }
      });
    }
  };

  const wireReel = (reel) => {
    const { vid, el, post } = reel;
    const spin = el.querySelector(".fz-rl-spin");
    const barFill = el.querySelector(".fz-rl-bar > div");
    vid.addEventListener("loadedmetadata", () => {
      // a tall video fills the screen; a wide one keeps its shape
      if (vid.videoWidth && vid.videoHeight) vid.style.objectFit = vid.videoWidth / vid.videoHeight < 0.8 ? "cover" : "contain";
    });
    vid.addEventListener("waiting", () => { spin.classList.remove("hidden"); spin.classList.add("flex"); });
    const calm = () => { spin.classList.add("hidden"); spin.classList.remove("flex"); };
    vid.addEventListener("playing", calm);
    vid.addEventListener("canplay", calm);
    vid.addEventListener("timeupdate", () => { if (vid.duration) barFill.style.width = `${Math.min(100, (vid.currentTime / vid.duration) * 100)}%`; });
    vid.addEventListener("error", () => {
      if (!vid.getAttribute("src")) return;
      reel.errored = true;
      calm();
      el.querySelector(".fz-rl-tap").insertAdjacentHTML("afterend", `<div class="fz-rl-err absolute inset-0 flex items-center justify-center text-white/80 text-[14px] pointer-events-none">Could not play this video</div>`);
    });

    // tap = pause / play, double tap = like
    let lastTap = 0;
    let timer = null;
    el.querySelector(".fz-rl-tap").addEventListener("click", () => {
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(timer);
        lastTap = 0;
        const burst = el.querySelector(".fz-rl-burst");
        burst.classList.remove("go"); void burst.getBoundingClientRect(); burst.classList.add("go");
        if (!iLiked(post)) like(reel);
        return;
      }
      lastTap = now;
      timer = setTimeout(() => {
        lastTap = 0;
        if (vid.paused) { reel.userPaused = false; play(reel); } else { reel.userPaused = true; vid.pause(); }
        paintPause(reel);
      }, 280);
    });

    el.querySelector(".fz-rl-like").addEventListener("click", () => like(reel));
    el.querySelector(".fz-rl-comment").addEventListener("click", () => { o.onComments?.(post.id); });
    el.querySelector(".fz-rl-share").addEventListener("click", () => { o.onShare?.(post); });
    const openProfile = () => { if (post.uid !== me) o.onProfile?.(post.uid); };
    el.querySelector(".fz-rl-author").addEventListener("click", openProfile);
    el.querySelector(".fz-rl-name").addEventListener("click", openProfile);
    // the red "+" under my photo: follow; once followed the "+" goes away. (A private account only gets a request: the "+" stays.)
    const followBtn = el.querySelector(".fz-rl-follow");
    if (followBtn) {
      if (o.followingIds && o.followingIds[post.uid]) followBtn.remove();
      else followBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        followBtn.disabled = true;
        try {
          const now = await o.onFollow?.(post, false, { redraw: false });
          if (now) { followBtn.classList.add("gone"); setTimeout(() => followBtn.remove(), 220); } else followBtn.disabled = false;
        } catch (error) { followBtn.disabled = false; }
      });
    }
    // Save (bookmark): the same "saved posts" list as everywhere in the app
    const saveBtn = el.querySelector(".fz-rl-save");
    saveBtn.addEventListener("click", async () => {
      const was = !!(o.savedPostIds && o.savedPostIds[post.id]);
      saveBtn.disabled = true;
      try { await o.onSave?.(post, was); } catch (error) { /* the feed shows the error */ }
      saveBtn.disabled = false;
      paintSave(reel);
    });
    // caption: one line with "... more", a tap opens all of it
    const textEl = el.querySelector(".fz-rl-text");
    if (textEl) {
      const tr = (word) => (window.FZI18N && window.FZI18N.t ? window.FZI18N.t(word) : word);
      const full = String(post.text);
      const firstLine = full.split("\n")[0];
      const needsMore = full.length > 48 || full.includes("\n");
      const collapsed = () => {
        textEl.textContent = "";
        textEl.style.maxHeight = "";
        textEl.style.overflowY = "";
        if (!needsMore) { textEl.textContent = full; return; }
        textEl.append(document.createTextNode(firstLine.slice(0, 48).trimEnd() + "… "));
        const more = document.createElement("button");
        more.type = "button"; more.className = "fz-rl-more"; more.textContent = tr("more");
        more.addEventListener("click", (event) => { event.stopPropagation(); expanded(); });
        textEl.append(more);
      };
      const expanded = () => {
        textEl.textContent = full + " ";
        textEl.style.maxHeight = "38vh";
        textEl.style.overflowY = "auto";
        const less = document.createElement("button");
        less.type = "button"; less.className = "fz-rl-less"; less.textContent = tr("less");
        less.addEventListener("click", (event) => { event.stopPropagation(); collapsed(); });
        textEl.append(less);
      };
      collapsed();
    }
    el.querySelector(".fz-rl-menu").addEventListener("click", () => openMenu(reel));
  };

  // the three dots: Save video, Copy link
  const openMenu = (reel) => {
    if (root.querySelector(".fz-rl-sheet")) return;
    const sheet = document.createElement("div");
    sheet.className = "fz-rl-sheet";
    sheet.innerHTML = `<div role="menu">
      <button type="button" data-do="save"><span class="material-symbols-outlined">download</span><span>Save video</span></button>
      <button type="button" data-do="copy"><span class="material-symbols-outlined">link</span><span>Copy link</span></button>
      <button type="button" data-do="cancel"><span class="material-symbols-outlined">close</span><span>Cancel</span></button>
    </div>`;
    sheet.addEventListener("click", (event) => {
      const what = event.target.closest("[data-do]")?.dataset.do;
      if (event.target === sheet || what) sheet.remove();
      if (what === "save") downloadVideo(reel.video.url);
      else if (what === "copy") copyPostLink(reel.post.id);
    });
    root.appendChild(sheet);
  };

  const like = async (reel) => {
    const p = reel.post;
    const was = iLiked(p);
    // show it at once; the database call follows (undone when it fails)
    p.likes = { ...(p.likes || {}) };
    if (was) delete p.likes[me]; else p.likes[me] = true;
    p.likesCount = Math.max(0, (Number(p.likesCount) || 0) + (was ? -1 : 1));
    paintCounts(reel);
    try {
      await o.onLike?.(p.id);
    } catch (error) {
      console.error("Reels like:", error);
      p.likes = { ...(p.likes || {}) };
      if (was) p.likes[me] = true; else delete p.likes[me];
      p.likesCount = Math.max(0, (Number(p.likesCount) || 0) + (was ? 1 : -1));
      paintCounts(reel);
      showToast("Could not save your like");
    }
  };

  /* ---------- the active reel ---------- */
  const applyMute = () => {
    muteBtn.querySelector("span").textContent = muted ? "volume_off" : "volume_up";
    if (reels[active]) reels[active].vid.muted = muted;
  };

  const activate = (index) => {
    if (index === active || index < 0 || index >= reels.length) return;
    tickWatch();
    flushWatch();
    unsubActive?.(); unsubActive = null;
    reels[active]?.vid.pause();
    active = index;
    const reel = reels[active];
    // the video of this reel and of its neighbours is loaded; the others give their memory back
    reels.forEach((r, i) => setSrc(r, Math.abs(i - active) <= 1));
    reel.userPaused = false;
    paintPause(reel);
    if (!o.isCovered?.()) play(reel);
    watch = { reel, ms: 0, last: performance.now() };
    o.learn?.(reel.post, "view");
    // live numbers (likes, comments) of the reel on the screen; a deleted post leaves the list
    unsubActive = onValue(ref(db, `posts/${reel.post.id}`), (snap) => {
      if (!snap.exists()) { showToast("This video was removed"); removeReel(reel); return; }
      const v = snap.val();
      reel.post.likes = v.likes || null;
      reel.post.likesCount = v.likesCount || 0;
      reel.post.commentsCount = v.commentsCount || 0;
      reel.post.sharesCount = v.sharesCount || 0;
      paintCounts(reel);
    }, () => {});
  };

  const removeReel = (reel) => {
    const i = reels.indexOf(reel);
    if (i < 0) return;
    const wasActive = i === active;
    reel.vid.pause();
    reel.el.remove();
    reels.splice(i, 1);
    if (!reels.length) { active = -1; showEmpty(); return; }
    if (wasActive) { active = -1; watch = null; unsubActive?.(); unsubActive = null; activate(Math.min(i, reels.length - 1)); reels[active].el.scrollIntoView(); }
    else if (i < active) active -= 1;
  };

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            const index = reels.findIndex((r) => r.el === entry.target);
            if (index >= 0) activate(index);
          }
        });
      }, { root: listEl, threshold: [0.7] })
    : null;

  // pauses while a page or the comments are open above Reels or the tab is hidden; carries on when they close
  const guard = () => {
    const reel = reels[active];
    if (!reel || closed) return;
    tickWatch();
    const covered = !!o.isCovered?.() || document.visibilityState !== "visible";
    if (covered && !reel.vid.paused) reel.vid.pause();
    else if (!covered && reel.vid.paused && !reel.userPaused && reel.vid.getAttribute("src") && !reel.errored) play(reel);
  };
  const guardTimer = setInterval(guard, 400);
  const onVis = () => { guard(); if (document.visibilityState !== "visible") { tickWatch(); } };
  document.addEventListener("visibilitychange", onVis);

  /* ---------- close ---------- */
  const close = () => {
    if (closed) return;
    closed = true;
    tickWatch();
    flushWatch();
    clearInterval(guardTimer);
    clearTimeout(coverTimer);
    unsubActive?.();
    observer?.disconnect();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", close);
    reels.forEach((r) => { r.vid.pause(); r.vid.removeAttribute("src"); r.vid.load(); });
    document.body.style.overflow = prevOverflow;
    blackBars(false);
    root.remove();
    openNow = null;
  };
  const onKey = (event) => {
    if (o.isCovered?.()) return;
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = reels[active + (event.key === "ArrowDown" ? 1 : -1)];
      next?.el.scrollIntoView({ behavior: "smooth" });
    }
  };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("pagehide", close);
  root.querySelector(".fz-rl-close").addEventListener("click", close);
  muteBtn.addEventListener("click", () => { muted = !muted; applyMute(); hintEl.classList.add("hidden"); });

  /* ---------- loading ---------- */
  const showEmpty = () => {
    const note = !storageReady() ? previewNotice() : "";
    showState(`
      <span class="material-symbols-outlined" style="font-size:56px;color:#9aa4ae">smart_display</span>
      <p class="mt-3 text-[18px] font-bold">No videos yet</p>
      <p class="mt-1 text-[14px] text-white/70 max-w-[280px]">Videos that people post will appear here. ${note ? escapeHtml(note) : "Be the first to post one!"}</p>`);
  };

  try {
    const snap = await get(query(ref(db, "posts"), orderByChild("createdAt"), limitToLast(LOAD)));
    if (closed) return;
    const posts = [];
    snap.forEach((child) => {
      const post = { ...child.val(), id: child.key };
      if (!postVideoOf(post)) return;
      if (o.isBlocked?.(post.uid) || o.isMuted?.(post.uid)) return;
      if (!canViewPost(post, me, o.followingIds || {})) return;
      posts.push(post);
    });
    // the feed algorithm orders them (and drops adult, spam and heavily reported ones)
    let ordered = posts;
    try {
      ordered = rankPosts(posts, { me, followingIds: o.followingIds || {}, followerIds: o.followerIds || {}, chattedIds: o.chattedIds || {} });
    } catch (error) { ordered = posts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
    if (o.startPostId) {
      const i = ordered.findIndex((p) => p.id === o.startPostId);
      if (i > 0) ordered.unshift(ordered.splice(i, 1)[0]);
      else if (i < 0) {
        let one = posts.find((p) => p.id === o.startPostId);
        if (!one) { // an older video than the newest ones loaded above
          try {
            const s1 = await get(ref(db, `posts/${o.startPostId}`));
            const p1 = s1.exists() ? { ...s1.val(), id: o.startPostId } : null;
            if (p1 && postVideoOf(p1) && !o.isBlocked?.(p1.uid) && !o.isMuted?.(p1.uid) && canViewPost(p1, me, o.followingIds || {})) one = p1;
          } catch (error) { /* just start from the first video */ }
        }
        if (one) ordered.unshift(one);
      }
    }
    ordered = ordered.slice(0, MAX_REELS);
    if (!ordered.length) return showEmpty();

    showState("");
    reels = ordered.map((post) => buildReel(post, postVideoOf(post)));
    reels.forEach((r) => { listEl.appendChild(r.el); observer?.observe(r.el); });
    if (!observer) activate(0);
    applyMute();
  } catch (error) {
    console.error("Reels:", error);
    showState(`<span class="material-symbols-outlined" style="font-size:48px;color:#9aa4ae">error</span><p class="mt-3 text-[15px]">Could not load videos. Check your connection and try again.</p>`);
  }
}
