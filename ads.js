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

import { db } from "./config.js";

import { ref, get, update, increment, query, orderByChild, startAt } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { escapeHtml, showToast, avatarHtml, postImageUrls, postVideoOf, timeAgo, createPostCard } from "./post.js";
import { pickAdsForSlots } from "./feed-algorithm.js";

/* ---------------------------------------------------------------
   Settings
---------------------------------------------------------------- */
const POSITIONS = {
  feed: { firstAfter: 3, every: 5 },
  profile: { firstAfter: 2, every: 6 }
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
  if (video && video.thumb) return { url: video.thumb, more: 0, video: true };
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
          if (!slot.dataset.own) track(adId, "impressions");
          recordShown(adId);
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
   The Sponsored card
---------------------------------------------------------------- */
function buildAdCard(ad, media, imageSize) {
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
          <div class="font-body-sm text-body-sm text-slate-muted">Sponsored${post.createdAt ? ` · ${escapeHtml(timeAgo(post.createdAt))}` : ""}</div>
        </div>
      </div>
      <button type="button" class="fz-ad-hide w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container active:scale-95 transition-all flex-shrink-0" aria-label="Hide this ad">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
    <div class="fz-ad-open ${ad.canOpen ? "cursor-pointer" : ""}">
      ${text ? `<p class="fz-ad-text font-body-md text-body-md text-on-surface leading-relaxed whitespace-pre-wrap break-words px-4 pt-3" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden;">${escapeHtml(text)}</p>` : ""}
      ${
        media && imageSize
          ? `<div class="relative mt-3 bg-surface-container"><img src="${escapeHtml(media.url)}" alt="" class="w-full object-cover block" style="aspect-ratio:${ratio};max-height:24rem;" />
               ${media.video ? `<span class="absolute inset-0 flex items-center justify-center"><span class="w-14 h-14 rounded-full bg-black/55 text-white flex items-center justify-center"><span class="material-symbols-outlined text-[34px]">play_arrow</span></span></span>` : ""}
               ${media.more > 0 ? `<span class="absolute right-2 top-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[12px] font-semibold">+${media.more}</span>` : ""}
             </div>`
          : ""
      }
    </div>
    <a class="fz-ad-link flex items-center justify-between gap-3 px-4 py-3 ${media || text ? "" : "mt-1"} bg-surface-container-low" href="${escapeHtml(ad.link)}" target="_blank" rel="noopener noreferrer sponsored">
      <span class="font-body-sm text-body-sm text-slate-muted truncate">${escapeHtml(host)}</span>
      <span class="flex-shrink-0 px-4 py-1.5 rounded-full bg-primary-container text-white font-label-md text-label-md font-semibold">${escapeHtml(ad.btnText)}</span>
    </a>
  `;
  return card;
}

/* ---------------------------------------------------------------
   Slots
---------------------------------------------------------------- */
function closeSlot(slot) {
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
  const card = buildAdCard(ad, media, imageSize);
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
export function clearAds(container) {
  container.querySelectorAll(":scope > .fz-ad-slot").forEach((slot) => slot.remove());
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
    const eligible = all
      .filter((ad) => !hidden.has(ad.id) && now >= ad.startAt && now <= ad.endAt)
      .filter((ad) => !(context.isBlocked && context.isBlocked(ad.post.uid)))
      .filter((ad) => !container.querySelector(`article[data-post-id="${CSS.escape(ad.post.id)}"]`)) // already in this list
      .filter((ad) => !(placement === "profile" && context.profileUid && ad.post.uid === context.profileUid))
      .map((ad) => ({ ...ad, canOpen: typeof context.onOpen === "function" }));
    if (!eligible.length) return;

    // Which posts get an ad after them
    const posts = Array.from(container.children).filter((el) => el.tagName === "ARTICLE");
    const { firstAfter, every } = POSITIONS[placement] || POSITIONS.feed;
    const anchors = [];
    posts.forEach((post, index) => {
      const position = index + 1;
      const isSpot = position === firstAfter || (position > firstAfter && (position - firstAfter) % every === 0);
      if (isSpot && position < posts.length) anchors.push(post);
    });
    if (!anchors.length) return;

    // Which ad goes to which spot (my interests, click rate, daily caps, no repeat in a row)
    const freq = readFreq();
    const picks = pickAdsForSlots(eligible, anchors.length, {
      interests: context.interests,
      now,
      adFreq: freq.ads,
      adTotal: freq.total,
      hidden
    });
    if (!picks.length) return;

    await Promise.all(
      anchors.map(async (anchor, slotIndex) => {
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
          const instant = shownBefore.has(`${ad.id}:${placement}`);
          shownBefore.add(`${ad.id}:${placement}`);
          openSlot(slot, instant);
          return;
        }
      })
    );
  } catch (error) {
    // Ads must never break the page
    console.warn("Ads: skipped because of an error:", error);
  }
}
