// FreeZone BD - Ads = boosted posts ("Sponsored")
//
// A person pays to boost one of their own posts (boost.js). When the admin approves it, the boost is copied to
// boostLive/{boostId} and this file shows that post between other posts, marked "Sponsored", with the button
// and link the person chose. Nothing else is shown here: there are no other ads.
//
//  1. Nothing changes on the page by default: no space is reserved for ads.
//  2. When the data is ready and the picture has loaded, a slot is inserted between two posts, the gap opens smoothly.
//  3. If anything fails (no boosts, no permission, no network, a deleted post, ...) nothing is inserted and the feed stays as it was.
//
// Use:  import("./ads.js").then((m) => m.insertAds(container, { placement: "feed", context }))
//       Call it after the posts have been rendered into `container`.
//       context = { interests, me (my uid), isBlocked(uid), onOpen(post), cardOptions (the options given to createPostCard) }   - all optional
//
// Data (Firebase Realtime Database), written by the admin when a boost is approved:
//   boostLive/{boostId} = { postId, uid, btnText, link (https), startAt, endAt, impressions, clicks }
// The post itself is read from posts/{postId}, so it is always the current text and picture.

import { db, auth } from "./config.js";

import { ref, get, update, increment, query, orderByChild, startAt } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { escapeHtml, showToast, avatarHtml, postImageUrls, postVideoOf, timeAgo, createPostCard, postVideoHtml, mountPostVideo } from "./post.js";
import { pickAdsForSlots } from "./feed-algorithm.js";

/* ---------------------------------------------------------------
   Settings
---------------------------------------------------------------- */
// The same everywhere (For you, Following, profiles): one ad after the 5th post, then after 6 more posts, then after 5 more,
// then 6 ... so there are always 5 or 6 posts between two ads and two ads are never next to each other.
const POSITIONS = {
  feed: { firstAfter: 5, gaps: [6, 5] },
  feedFollowing: { firstAfter: 5, gaps: [6, 5] },
  profile: { firstAfter: 5, gaps: [6, 5] }
};

const CACHE_MS = 5 * 60 * 1000; // re-read the boosts from Firebase at most every 5 minutes
const IMAGE_TIMEOUT_MS = 6000; // give up on a post whose picture does not load in time
const VISIBLE_MS = 1000; // counted as "seen" after 1 second at least half visible
const HIDDEN_KEY = "fz_hidden_ads";

/* ---------------------------------------------------------------
   Styles (injected once). The slot has no size until the ad is ready.
---------------------------------------------------------------- */
function injectStyles() {
  if (document.getElementById("fz-ads-style")) return;
  const style = document.createElement("style");
  style.id = "fz-ads-style";
  style.textContent = `
    .fz-ad-slot {
      display: grid; grid-template-rows: 0fr; opacity: 0;
      transition: grid-template-rows .5s cubic-bezier(.2,.8,.2,1), opacity .4s ease .1s;
    }
    .fz-ad-slot.fz-open { grid-template-rows: 1fr; opacity: 1; }
    .fz-ad-slot.fz-instant { transition: none; }
    .fz-ad-inner { min-height: 0; overflow: hidden; }
    @media (prefers-reduced-motion: reduce) { .fz-ad-slot { transition: none; } }
  `;
  document.head.appendChild(style);
}

/* ---------------------------------------------------------------
   Data: the live boosts and their posts
---------------------------------------------------------------- */
let dataCache = { time: 0, promise: null };

const httpsUrl = (url) => {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch (error) {
    return "";
  }
};

function loadData() {
  if (dataCache.promise && Date.now() - dataCache.time < CACHE_MS) return dataCache.promise;

  dataCache.time = Date.now();
  dataCache.promise = (async () => {
    const now = Date.now();
    const live = [];
    try {
      const snap = await get(query(ref(db, "boostLive"), orderByChild("endAt"), startAt(now)));
      snap.forEach((child) => {
        const boost = child.val();
        if (boost && Number.isFinite(boost.startAt) && boost.startAt <= now) live.push({ boostId: child.key, ...boost });
      });
    } catch (error) {
      console.warn("Ads: could not read the boosts (the feed is unaffected):", error?.code || error);
      return [];
    }

    // The posts. A deleted, private or followers-only post is not shown.
    const ads = await Promise.all(
      live.slice(0, 40).map(async (boost) => {
        try {
          const postSnap = await get(ref(db, `posts/${boost.postId}`));
          if (!postSnap.exists()) return null;
          const post = { id: boost.postId, ...postSnap.val() };
          if (post.uid !== boost.uid) return null; // the boost belongs to the post's own author only
          if (post.audience === "me" || post.audience === "followers") return null;
          const link = httpsUrl(boost.link);
          if (!link) return null;
          // `id` / `text` / `impressions` / `clicks` are what the feed algorithm reads when it picks an ad
          return {
            id: boost.boostId,
            post,
            link,
            btnText: String(boost.btnText || "Learn more").slice(0, 24),
            text: post.text || "",
            impressions: Number(boost.impressions) || 0,
            clicks: Number(boost.clicks) || 0,
            startAt: boost.startAt,
            endAt: boost.endAt
          };
        } catch (error) {
          return null;
        }
      })
    );
    return ads.filter(Boolean);
  })();

  return dataCache.promise;
}

/* ---------------------------------------------------------------
   Hidden ads (the user pressed X)
---------------------------------------------------------------- */
const memoryHidden = new Set();

function getHiddenIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    return new Set([...stored, ...memoryHidden]);
  } catch (error) {
    return new Set(memoryHidden);
  }
}

function rememberHidden(adId) {
  memoryHidden.add(adId);
  try {
    const list = [...getHiddenIds()].slice(-100);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
  } catch (error) {
    // Storage unavailable: the ad stays hidden until the page is reloaded
  }
}

/* ---------------------------------------------------------------
   Frequency cap: how often I saw each ad today. Kept on this phone, one day at a time.
---------------------------------------------------------------- */
const FREQ_KEY = "fz_ad_freq";
const dayKey = () => new Date().toISOString().slice(0, 10);

function readFreq() {
  try {
    const data = JSON.parse(localStorage.getItem(FREQ_KEY) || "null");
    if (data && data.day === dayKey()) return { day: data.day, ads: data.ads || {}, total: data.total || 0 };
  } catch (error) { /* start the day again */ }
  return { day: dayKey(), ads: {}, total: 0 };
}

function recordShown(adId) {
  const freq = readFreq();
  freq.ads[adId] = (freq.ads[adId] || 0) + 1;
  freq.total += 1;
  try { localStorage.setItem(FREQ_KEY, JSON.stringify(freq)); } catch (error) { /* storage unavailable */ }
}

/* ---------------------------------------------------------------
   Image preloading: a post is only shown once its picture is ready
---------------------------------------------------------------- */
const readyImages = new Map(); // url -> { width, height }

function preloadImage(url) {
  if (!url) return Promise.resolve({ width: 0, height: 0 });
  if (readyImages.has(url)) return Promise.resolve(readyImages.get(url));

  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = "";
      resolve(null);
    }, IMAGE_TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timer);
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      readyImages.set(url, size);
      resolve(size);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

// The picture of a boosted post: its first photo, or the cover of its video
function mediaOf(post) {
  const photos = postImageUrls(post);
  if (photos && photos.length) return { url: photos[0], more: photos.length - 1, video: false };
  const video = postVideoOf(post);
  if (video) return { url: video.thumb || "", more: 0, video: true }; // a video without a cover picture still shows (its first frame)
  return null;
}

/* ---------------------------------------------------------------
   Tracking (the owner's own views and clicks are not counted)
---------------------------------------------------------------- */
const countedImpressions = new Set();
const shownBefore = new Set(); // ads already opened once: re-renders show them without animation

function track(adId, field) {
  update(ref(db, `boostLive/${adId}`), { [field]: increment(1) }).catch(() => {});
}

// "People reached": each signed-in person is counted once per boost (boostSeen/{boost}/{uid} stops a second count)
const REACH_KEY = "fz_boost_reach";
function trackReach(adId) {
  const me = auth.currentUser && auth.currentUser.uid;
  if (!me) return;
  let done = {};
  try { done = JSON.parse(localStorage.getItem(REACH_KEY) || "{}") || {}; } catch (e) { done = {}; }
  if (done[adId]) return;
  done[adId] = Date.now();
  try { localStorage.setItem(REACH_KEY, JSON.stringify(done)); } catch (e) { /* storage blocked: the rules still count a person only once */ }
  update(ref(db), { [`boostSeen/${adId}/${me}`]: true, [`boostLive/${adId}/reach`]: increment(1) }).catch(() => {});
}

function watchImpression(slot, adId, placement) {
  const key = `${adId}:${placement}`;
  if (countedImpressions.has(key) || !("IntersectionObserver" in window)) return;

  let timer = null;
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!slot.isConnected) {
        clearTimeout(timer);
        observer.disconnect();
        return;
      }
      if (entry.isIntersecting) {
        if (timer) return;
        timer = setTimeout(() => {
          if (countedImpressions.has(key)) return;
          countedImpressions.add(key);
          if (!slot.dataset.own) {
            track(adId, "impressions");
            trackReach(adId);
            recordShown(adId); // my own views of my own ad do not use up the daily limit
          }
          observer.disconnect();
        }, VISIBLE_MS);
      } else {
        clearTimeout(timer);
        timer = null;
      }
    },
    { threshold: 0.5 }
  );
  observer.observe(slot);
}

/* ---------------------------------------------------------------
   Reels: boosted VIDEOS can come up between the reels (reels.js asks for them here)
---------------------------------------------------------------- */
export async function reelAds({ me, isBlocked } = {}) {
  try {
    const all = await loadData();
    const hidden = getHiddenIds();
    const now = Date.now();
    const list = all.filter((ad) =>
      !hidden.has(ad.id) && now >= ad.startAt && now <= ad.endAt &&
      postVideoOf(ad.post) && ad.post.uid !== me && !(isBlocked && isBlocked(ad.post.uid)));
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } // a different order each time
    return list;
  } catch (error) {
    return []; // the reels are never held back by ads
  }
}
export function countReelAdSeen(adId) {
  track(adId, "impressions");
  trackReach(adId);
  recordShown(adId);
}
export function countReelAdClick(adId) { track(adId, "clicks"); }

/* ---------------------------------------------------------------
   The Sponsored card
---------------------------------------------------------------- */
function buildAdCard(ad, media, imageSize, onOpen) {
  const post = ad.post;
  const who = post.name || "FreeZone User";
  const text = (post.text || "").trim();
  const ratio = imageSize && imageSize.width && imageSize.height ? `${imageSize.width} / ${imageSize.height}` : "16 / 9";
  const host = new URL(ad.link).hostname.replace(/^www\./, "");

  const card = document.createElement("article");
  card.className = "bg-slate-surface border-y border-slate-border overflow-hidden";
  card.dataset.adId = ad.id;
  card.innerHTML = `
    <div class="flex items-center justify-between gap-3 px-4 pt-4">
      <div class="flex items-center gap-3 min-w-0">
        ${avatarHtml(post.photoURL, "w-10 h-10")}
        <div class="min-w-0">
          <div class="font-label-lg text-label-lg text-on-surface truncate">${escapeHtml(who)}</div>
          <div class="font-body-sm text-body-sm text-slate-muted flex items-center gap-1"><span>Ad</span><span aria-hidden="true">·</span><span class="material-symbols-outlined text-[14px]" aria-label="Public">public</span></div>
        </div>
      </div>
      <button type="button" class="fz-ad-hide w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container active:scale-95 transition-all flex-shrink-0" aria-label="Hide this ad">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
    <div class="fz-ad-open ${ad.canOpen ? "cursor-pointer" : ""}">
      ${text ? `<p class="fz-ad-text font-body-md text-body-md text-on-surface leading-relaxed whitespace-pre-wrap break-words px-4 pt-3 ${media ? "" : "pb-3"}" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;">${escapeHtml(text)}</p>
        ${text.length > 120 || text.split("\n").length > 3 ? `<button type="button" class="fz-ad-more block px-4 pt-0.5 font-body-sm text-body-sm text-slate-muted font-semibold">See more</button>` : ""}` : ""}
      ${
        media && imageSize
          ? media.video
            ? `<div class="mt-3">${postVideoHtml(postVideoOf(post))}</div>` // the same video box as a normal post: plays on the screen, tap = Reels
            : `<div class="relative mt-3 bg-surface-container"><img src="${escapeHtml(media.url)}" alt="" class="w-full object-cover block" style="aspect-ratio:${ratio};max-height:24rem;" />
               ${media.more > 0 ? `<span class="absolute right-2 top-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[12px] font-semibold">+${media.more}</span>` : ""}
             </div>`
          : ""
      }
    </div>
    <a class="fz-ad-link flex items-center justify-between gap-3 px-4 py-3 ${media || text ? "" : "mt-1"} bg-surface-container-low" href="${escapeHtml(ad.link)}" target="_blank" rel="noopener noreferrer sponsored">
      <span class="font-body-md text-body-md text-on-surface font-semibold truncate">${escapeHtml(host)}</span>
      <span class="flex-shrink-0 px-4 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md font-semibold">${escapeHtml(ad.btnText)}</span>
    </a>
  `;
  const videoBox = card.querySelector(".post-video");
  if (videoBox) mountPostVideo(videoBox, { onOpen: () => { if (onOpen) onOpen(post); } });
  const more = card.querySelector(".fz-ad-more");
  if (more) {
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const p = card.querySelector(".fz-ad-text");
      p.style.webkitLineClamp = "unset";
      p.style.display = "block";
      more.remove();
    });
  }
  return card;
}

/* ---------------------------------------------------------------
   Slots
---------------------------------------------------------------- */
function closeSlot(slot) {
  restoreReplaced(slot); // a boosted post that was shown as an ad on its owner's profile comes back as a normal post
  slot.classList.remove("fz-open");
  setTimeout(() => slot.remove(), 600);
}

function openSlot(slot, instant) {
  if (instant) {
    slot.classList.add("fz-instant", "fz-open");
    return;
  }
  slot.getBoundingClientRect(); // make sure the closed state is painted first
  requestAnimationFrame(() => requestAnimationFrame(() => slot.classList.add("fz-open")));
}

function createSlot(ad, media, imageSize, placement, context) {
  const slot = document.createElement("div");
  slot.className = "fz-ad-slot";
  slot.dataset.adId = ad.id;
  if (context.me && ad.post.uid === context.me) slot.dataset.own = "1";

  const inner = document.createElement("div");
  inner.className = "fz-ad-inner";
  const card = buildAdCard(ad, media, imageSize, ad.canOpen ? context.onOpen : null);
  inner.appendChild(card);
  slot.appendChild(inner);

  // The same like / comment / share / save row as every other post (the real buttons, moved onto this card)
  if (context.cardOptions) {
    try {
      const real = createPostCard(ad.post, { ...context.cardOptions, showFollowChip: false });
      const bar = real.querySelector(".like-btn")?.parentElement;
      if (bar) card.querySelector(".fz-ad-link").after(bar); // like Facebook: the link button first, then like / comment / share
    } catch (error) {
      console.warn("Sponsored post: action row not added:", error);
    }
  }

  card.querySelector(".fz-ad-hide").addEventListener("click", () => {
    rememberHidden(ad.id);
    document.querySelectorAll(`.fz-ad-slot[data-ad-id="${CSS.escape(ad.id)}"]`).forEach(closeSlot);
    showToast("Ad hidden");
  });

  card.querySelector(".fz-ad-link").addEventListener("click", () => {
    if (!slot.dataset.own) track(ad.id, "clicks");
  });

  // Tapping the post itself opens it, like any other post
  if (ad.canOpen) card.querySelector(".fz-ad-open").addEventListener("click", () => context.onOpen(ad.post));

  watchImpression(slot, ad.id, placement);
  return slot;
}

/* ---------------------------------------------------------------
   Public API
---------------------------------------------------------------- */
function restoreReplaced(slot) {
  if (slot.__replaces) {
    slot.__replaces.style.display = "";
    slot.__replaces = null;
  }
}

export function clearAds(container) {
  container.querySelectorAll(":scope > .fz-ad-slot").forEach((slot) => {
    restoreReplaced(slot);
    slot.remove();
  });
  container.querySelectorAll(".fz-ad-decor").forEach((el) => el.remove());
}

// The person who boosted the post sees their own post: the real card (with its three-dot menu: edit, delete, ...)
// stays, with a small round tick next to the name (instead of the "Sponsored" label) and the link button under it. The X (hide ad) is only for other people.
const isOwnAd = (ad, context) => !!(context.me && ad.post.uid === context.me);

function decorateOwn(original, ad) {
  const host = new URL(ad.link).hostname.replace(/^www\./, "");
  // Instead of the "Sponsored" label: a small round tick next to the name. Only the person who boosted sees it (others see "Sponsored")
  const nameEl = original.querySelector(".profile-link .truncate");
  if (nameEl && !original.querySelector(".fz-ad-badge")) {
    const badge = document.createElement("span");
    badge.className = "fz-ad-badge flex-shrink-0 inline-flex items-center justify-center";
    badge.title = "Boosted post (only you can see this mark)";
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", "Boosted post");
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="rgb(var(--c-primary-container))"/><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    nameEl.after(badge);
  }
  original.querySelectorAll(".fz-ad-decor").forEach((el) => el.remove()); // never two bars on one post
  const link = document.createElement("a");
  link.className = "fz-ad-decor fz-ad-link flex items-center justify-between gap-3 px-4 py-3 bg-surface-container-low";
  link.href = ad.link;
  link.target = "_blank";
  link.rel = "noopener noreferrer sponsored";
  link.innerHTML = `<span class="font-body-md text-body-md text-on-surface font-semibold truncate">${escapeHtml(host)}</span>
    <span class="flex-shrink-0 px-4 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md font-semibold">${escapeHtml(ad.btnText)}</span>`;
  // like Facebook: the link bar sits ABOVE the like / comment / share row (under the picture)
  const actionRow = original.querySelector(".like-btn")?.parentElement;
  if (actionRow && actionRow.parentElement) actionRow.before(link);
  else original.after(link);
}

/**
 * Inserts the boosted posts between the posts that are already in `container`.
 * Safe to call after every render: it never throws and never leaves an empty gap.
 */
export async function insertAds(container, { placement = "feed", context = {} } = {}) {
  try {
    if (!container) return;
    injectStyles();

    // Only the latest call for this container may insert anything
    const run = (container.__fzAdsRun = (container.__fzAdsRun || 0) + 1);
    clearAds(container);

    const all = await loadData();
    if (container.__fzAdsRun !== run) return;

    const hidden = getHiddenIds();
    const now = Date.now();
    const live = all
      .filter((ad) => !hidden.has(ad.id) && now >= ad.startAt && now <= ad.endAt)
      .filter((ad) => !(context.isBlocked && context.isBlocked(ad.post.uid)))
      .map((ad) => ({ ...ad, canOpen: typeof context.onOpen === "function" }));

    // On a profile, the boosts of the person whose profile it is are pinned at the top as "Sponsored"
    // (their normal card is hidden meanwhile, so the post is not shown twice)
    const pinned =
      placement === "profile" && context.profileUid
        ? live.filter((ad) => ad.post.uid === context.profileUid).sort((a, b) => b.startAt - a.startAt).slice(0, 3)
        : [];

    // A boosted post that is already in this list as a normal card (e.g. the "For you" tab) becomes the Sponsored card
    // in its own place, so the same post never shows in two different looks
    const inPlace = live.filter(
      (ad) => !pinned.includes(ad) && container.querySelector(`:scope > article[data-post-id="${CSS.escape(ad.post.id)}"]`)
    );

    // Everyone else's boosts go between the posts
    const eligible = live
      .filter((ad) => !container.querySelector(`article[data-post-id="${CSS.escape(ad.post.id)}"]`)) // already in this list
      .filter((ad) => !(placement === "profile" && context.profileUid && ad.post.uid === context.profileUid));
    if (!eligible.length && !pinned.length && !inPlace.length) return;

    if (pinned.length) {
      const firstChild = container.firstElementChild;
      if (firstChild && !firstChild.isConnected) return;
      for (const ad of pinned) {
        const own = container.querySelector(`:scope > article[data-post-id="${CSS.escape(ad.post.id)}"]`);
        if (own && isOwnAd(ad, context)) {
          if (firstChild && own !== firstChild) container.insertBefore(own, firstChild); // pinned to the top
          decorateOwn(own, ad);
          continue;
        }
        const media = mediaOf(ad.post);
        const imageSize = await preloadImage(media ? media.url : "");
        if (imageSize === null) continue; // picture failed: the normal card stays
        if (container.__fzAdsRun !== run) return;
        const slot = createSlot(ad, media, imageSize, placement, context);
        const original = container.querySelector(`:scope > article[data-post-id="${CSS.escape(ad.post.id)}"]`);
        if (original) {
          original.style.display = "none";
          slot.__replaces = original;
        }
        container.insertBefore(slot, firstChild);
        const instant = shownBefore.has(`${ad.id}:${placement}`);
        shownBefore.add(`${ad.id}:${placement}`);
        openSlot(slot, instant);
      }
    }
    const originalOf = (ad) => container.querySelector(`:scope > article[data-post-id="${CSS.escape(ad.post.id)}"]`);

    // The advertiser's own boosts: the real card stays (label above, link under it). Everybody else's are handled below.
    const others = [];
    for (const ad of inPlace) {
      const original = originalOf(ad);
      if (!original) continue;
      if (isOwnAd(ad, context)) decorateOwn(original, ad);
      else others.push(ad);
    }

    // Ad spots between the posts: after the 5th post, then after 6 more, then 5 more ... (all lists). The boosted posts that are already in the
    // list do not count as posts: on the feed they move to an ad spot instead of staying wherever they were ranked.
    const relocate = placement === "feed" && !context.inPlaceOnly;
    const moving = new Set(others.map(originalOf));
    const spotKey = placement === "feed" && context.tab && context.tab !== "foryou" ? "feedFollowing" : placement;
    const { firstAfter, gaps } = POSITIONS[spotKey] || POSITIONS.feed;
    const posts = Array.from(container.children).filter((el) => el.tagName === "ARTICLE" && el.style.display !== "none" && !moving.has(el));
    const anchors = [];
    let nextSpot = firstAfter, gapIndex = 0;
    posts.forEach((post, index) => {
      const position = index + 1;
      if (position !== nextSpot) return;
      if (position < posts.length) anchors.push(post); // never after the very last post (the next page brings the next spot)
      nextSpot += gaps[gapIndex++ % gaps.length];
    });
    // A short feed (e.g. "Following" with only a few posts) has no spot yet: the ad goes after the last post instead of nowhere
    if (!anchors.length && placement === "feed" && posts.length >= 1) anchors.push(posts[posts.length - 1]);

    const reveal = (slot, ad) => {
      const instant = shownBefore.has(`${ad.id}:${placement}`);
      shownBefore.add(`${ad.id}:${placement}`);
      openSlot(slot, instant);
    };

    // Boosted posts of other people that are already in this list become the Sponsored card:
    // on the feed at the next free ad spot (not at the top), in other lists right where they are
    await Promise.all(
      others.map(async (ad, index) => {
        const original = originalOf(ad);
        if (!original) return;
        const media = mediaOf(ad.post);
        const imageSize = await preloadImage(media ? media.url : "");
        if (imageSize === null) return; // picture failed: the normal card stays
        if (container.__fzAdsRun !== run || !original.isConnected) return;
        const slot = createSlot(ad, media, imageSize, placement, context);
        original.style.display = "none";
        slot.__replaces = original;
        const anchor = relocate ? anchors[index] : null;
        if (anchor && anchor.isConnected) anchor.after(slot);
        else container.insertBefore(slot, original); // no spot (few posts): it stays where it is
        reveal(slot, ad);
      })
    );

    if (!eligible.length || context.inPlaceOnly) return; // inPlaceOnly: lists like "Saved" only re-dress the posts they already have
    const freeAnchors = relocate ? anchors.slice(others.length) : anchors;
    if (!freeAnchors.length) return;

    // Which ad goes to which spot (my interests, click rate, daily caps, no repeat in a row)
    const freq = readFreq();
    // The ads seen the least today come first (ties in a random order), so with several ads they take turns
    eligible.sort((a, b) => (freq.ads[a.id] || 0) - (freq.ads[b.id] || 0) || Math.random() - 0.5);
    const picks = pickAdsForSlots(eligible, freeAnchors.length, {
      interests: context.interests,
      now,
      adFreq: freq.ads,
      adTotal: freq.total,
      hidden
    });
    if (!picks.length) return;

    await Promise.all(
      freeAnchors.map(async (anchor, slotIndex) => {
        const candidates = picks[slotIndex];
        if (!candidates) return; // the daily limit is reached: this spot stays empty
        // The first choice, then up to 2 spare ads (when a picture does not load); if all fail, the spot stays empty
        for (let attempt = 0; attempt < candidates.length; attempt++) {
          const ad = candidates[attempt];
          const media = mediaOf(ad.post);
          const imageSize = await preloadImage(media ? media.url : "");
          if (imageSize === null) continue; // picture failed: try the next ad

          if (container.__fzAdsRun !== run || !anchor.isConnected) return;

          const slot = createSlot(ad, media, imageSize, placement, context);
          anchor.after(slot);
          reveal(slot, ad);
          return;
        }
      })
    );
  } catch (error) {
    // Ads must never break the page
    console.warn("Ads: skipped because of an error:", error);
  } finally {
    try { removeAdjacentAds(container); } catch (error) { /* never breaks the page */ }
  }
}

// Two ads are never shown next to each other: if two Sponsored cards end up side by side, the second goes
// (its post comes back as a normal post)
function removeAdjacentAds(container) {
  if (!container) return;
  let previousWasAd = false;
  for (const el of Array.from(container.children)) {
    if (el.style && el.style.display === "none") continue; // posts hidden because an ad replaced them
    const isAd = el.classList.contains("fz-ad-slot");
    if (isAd && previousWasAd) { restoreReplaced(el); el.remove(); continue; }
    previousWasAd = isAd;
  }
}

/**
 * For a single post shown on its own (the post page): if it is a live boost, add the "Sponsored" label above the card
 * and the link button under it, like the Sponsored card in the feed. Never throws, never blocks the post.
 */
export async function markSponsored(wrap, postId, { me } = {}) {
  try {
    if (!wrap || !postId) return;
    injectStyles();
    const now = Date.now();
    const all = await loadData();
    const ad = all.find((item) => item.post.id === postId && now >= item.startAt && now <= item.endAt);
    if (!ad || !wrap.isConnected || wrap.querySelector(".fz-sponsored-label")) return;

    const host = new URL(ad.link).hostname.replace(/^www\./, "");
    const label = document.createElement("div");
    label.className = "fz-sponsored-label px-4 pt-3 pb-1 font-label-md text-label-md font-semibold text-slate-muted bg-slate-surface";
    label.textContent = "Sponsored";

    const link = document.createElement("a");
    link.className = "fz-ad-link flex items-center justify-between gap-3 px-4 py-3 bg-surface-container-low";
    link.href = ad.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer sponsored";
    link.innerHTML = `<span class="font-body-md text-body-md text-on-surface font-semibold truncate">${escapeHtml(host)}</span>
      <span class="flex-shrink-0 px-4 py-2 rounded-lg bg-surface-container text-on-surface font-label-md text-label-md font-semibold">${escapeHtml(ad.btnText)}</span>`;
    link.addEventListener("click", () => {
      if (!(me && ad.post.uid === me)) track(ad.id, "clicks");
    });

    wrap.prepend(label);
    const actionRow = wrap.querySelector(".like-btn")?.parentElement;
    if (actionRow && actionRow.parentElement) actionRow.before(link); // above like / comment / share
    else wrap.append(link);
  } catch (error) {
    console.warn("Sponsored label skipped:", error);
  }
}
