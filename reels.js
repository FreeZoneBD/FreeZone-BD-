// FreeZone BD - Reels: full-screen videos, one swipe at a time (opened by the Video button in the bottom bar)
//
// feed.js calls  openReels({ ... })  and this file does the rest. Nothing is saved except:
//   posts/{id}/likes/{uid} + likesCount   (through the same like function the feed uses)
//   posts/{id}/playsCount, watchTimeMs    (how many times a video was played and for how long: feed algorithm part 23)
// The videos come from the newest posts that have a videoURL. They are ordered by the feed algorithm (rankPosts),
// which also hides blocked, muted, adult, spam and heavily reported posts.

import { ref, get, query, orderByChild, limitToLast, onValue, update, increment } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, avatarHtml, showToast, canViewPost, postVideoOf } from "./post.js";
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

const HEART = `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.2 3.4 5 6.6 5c2 0 3.6 1.2 5.4 3.3C13.8 6.2 15.4 5 17.4 5c3.2 0 5 3.2 3.9 6.3-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>`;

let openNow = null; // only one Reels page at a time

/**
 * @param {object} o
 *   db, currentUser, followingIds (live object), followerIds, chattedIds
 *   isBlocked(uid), isMuted(uid)
 *   onLike(postId) -> Promise    toggles my like (the feed's own function)
 *   onComments(postId)           opens the comments sheet
 *   onShare(post)                opens the share sheet
 *   onProfile(uid)               opens a profile (it appears above Reels)
 *   onFollow(post, wasFollowing) -> Promise<boolean>   the feed's follow function (returns the new state)
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
      .fz-reels .fz-rl-like.liked > :first-child { color:#f91880; }
      .fz-reels .fz-rl-burst { position:absolute; left:50%; top:50%; margin:-48px 0 0 -48px; width:96px; height:96px; opacity:0; pointer-events:none; color:#fff; }
      .fz-reels .fz-rl-burst.go { animation:fzRlBurst .75s ease-out; }
      @keyframes fzRlBurst { 0%{opacity:0;transform:scale(.4)} 25%{opacity:1;transform:scale(1.15)} 60%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.05)} }
      @media (prefers-reduced-motion: reduce) { .fz-reels .fz-rl-burst.go { animation:none; opacity:1; } }
    </style>
    <div class="fz-rl-list"></div>
    <div class="fz-rl-top absolute top-0 inset-x-0 z-20 flex items-center gap-1 px-2 pointer-events-none" style="padding-top:max(.5rem, env(safe-area-inset-top)); background:linear-gradient(to bottom,rgba(0,0,0,.5),transparent); height:calc(56px + env(safe-area-inset-top));">
      <button type="button" class="fz-rl-close pointer-events-auto w-10 h-10 rounded-full flex items-center justify-center active:bg-white/15" aria-label="Back"><span class="material-symbols-outlined text-[26px]">arrow_back</span></button>
      <span class="font-semibold text-[18px]" style="text-shadow:0 1px 3px rgba(0,0,0,.6)">Reels</span>
      <button type="button" class="fz-rl-mute pointer-events-auto ml-auto w-10 h-10 rounded-full flex items-center justify-center active:bg-white/15" aria-label="Sound"><span class="material-symbols-outlined text-[24px]">volume_up</span></button>
    </div>
    <div class="fz-rl-state absolute inset-0 z-10 flex flex-col items-center justify-center text-center px-8 pointer-events-none"></div>
    <div class="fz-rl-hint hidden absolute left-1/2 z-20 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/60 text-[13px] pointer-events-none" style="bottom:calc(env(safe-area-inset-bottom) + 96px);">Tap the speaker for sound</div>`;
  const listEl = root.querySelector(".fz-rl-list");
  const stateEl = root.querySelector(".fz-rl-state");
  const muteBtn = root.querySelector(".fz-rl-mute");
  const hintEl = root.querySelector(".fz-rl-hint");
  document.body.appendChild(root);
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

      <div class="absolute right-2 z-10 flex flex-col items-center gap-5" style="bottom:calc(env(safe-area-inset-bottom) + 28px)">
        <div class="relative">
          <button type="button" class="fz-rl-author rounded-full" aria-label="Open profile of ${escapeHtml(handle)}" style="display:block;border:2px solid #fff;border-radius:9999px;overflow:hidden">${avatarHtml(post.photoURL, "w-11 h-11")}</button>
          ${own ? "" : `<button type="button" class="fz-rl-follow absolute left-1/2 -bottom-2 -translate-x-1/2 w-5 h-5 rounded-full bg-[#fe2c55] flex items-center justify-center" aria-label="Follow"><span class="material-symbols-outlined text-[16px]" style="color:#fff">add</span></button>`}
        </div>
        <button type="button" class="fz-rl-btn fz-rl-like" aria-label="Like">${HEART}<span class="fz-rl-n">0</span></button>
        <button type="button" class="fz-rl-btn fz-rl-comment" aria-label="Comments"><span class="material-symbols-outlined text-[32px]" style="font-variation-settings:'FILL' 1">chat_bubble</span><span class="fz-rl-n">0</span></button>
        <button type="button" class="fz-rl-btn fz-rl-share" aria-label="Share"><span class="material-symbols-outlined text-[32px]" style="font-variation-settings:'FILL' 1">share</span><span>Share</span></button>
      </div>

      <div class="absolute left-0 z-10 px-3 pr-20" style="right:0;bottom:calc(env(safe-area-inset-bottom) + 24px);background:linear-gradient(to top,rgba(0,0,0,.55),transparent);padding-top:48px;">
        <button type="button" class="fz-rl-name font-bold text-[16px] block max-w-full truncate" style="text-shadow:0 1px 3px rgba(0,0,0,.6)">${escapeHtml(handle)}</button>
        ${post.text ? `<p class="fz-rl-text text-[14px] leading-snug mt-1 whitespace-pre-wrap break-words" style="text-shadow:0 1px 3px rgba(0,0,0,.6);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(post.text)}</p>` : ""}
      </div>
      <div class="fz-rl-bar absolute inset-x-0 bottom-0 z-10 h-[3px] bg-white/25"><div class="h-full bg-white" style="width:0%"></div></div>`;
    const reel = { post, video, el, vid: el.querySelector("video"), userPaused: false, errored: false };
    wireReel(reel);
    paintCounts(reel);
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
    const followBtn = el.querySelector(".fz-rl-follow");
    if (followBtn) {
      if (o.followingIds && o.followingIds[post.uid]) followBtn.remove();
      else followBtn.addEventListener("click", async () => {
        followBtn.disabled = true;
        try {
          const now = await o.onFollow?.(post, false, { redraw: false });
          if (now) followBtn.remove(); else followBtn.disabled = false;
        } catch (error) { followBtn.disabled = false; }
      });
    }
    el.querySelector(".fz-rl-text")?.addEventListener("click", (event) => {
      const t = event.currentTarget;
      t.style.webkitLineClamp = t.style.webkitLineClamp === "unset" ? "2" : "unset";
    });
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
      else if (i < 0) { const one = posts.find((p) => p.id === o.startPostId); if (one) ordered.unshift(one); }
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
