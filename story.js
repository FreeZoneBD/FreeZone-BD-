// FreeZone BD - Stories (photo stories that disappear after 24 hours)
//
// Everything about stories lives in this file: the bar at the top of the Feed, the full-screen
// viewer and adding a story. feed.js only calls  mount(container, context)  once, so changing
// this file never requires changing feed.js.
//
// Data (Firebase Realtime Database):
//   stories/{uid}/{storyId}                   = { imageURL, caption?, createdAt, videoURL?, videoDuration?, music?: {title, artist?, url} }
//     A video story keeps its cover picture in imageURL, so every older part of the app still works.
//     Music (chosen from the admin's list at music/) is only for photo stories.
//   storyViews/{uid}/{storyId}/{viewerUid}    = time      (only the owner can read it -> "N views")
//   storyReactions/{uid}/{storyId}/{viewerUid} = emoji   (the owner sees who reacted; a viewer sees their own)
//   storySeen/{myUid}/{authorUid}             = createdAt of the newest story of that person I have seen
// Replies and reactions are also sent as chat messages to the owner (see chat.js), with the story attached.
// Who sees whose stories: you see your own and the stories of people YOU FOLLOW.

import {
  ref,
  get,
  push,
  set,
  update,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { uploadToImgbb, prepareImage } from "./imgbb.js";
import { openCropper } from "./crop.js";
import { sendChatMessage } from "./chat.js";
import { escapeHtml, avatarHtml, timeAgo, showToast } from "./post.js";
import { storageReady, previewNotice } from "./features.js";
import { LIMITS, checkVideoFile, captureFrame, formatDuration, formatSize } from "./video-tools.js";

const TTL_MS = 24 * 60 * 60 * 1000; // a story lives 24 hours
const SLIDE_MS = 5000; // each story is shown for 5 seconds
const MAX_FOLLOWED = 40; // stories of at most this many followed people are loaded
const MAX_FILE_MB = 10;
const CAPTION_MAX = 200;
const REFRESH_AFTER_MS = 2 * 60 * 1000; // reload the bar when the app comes back after 2 minutes
const REACTIONS = ["❤️", "😂", "😮", "😢", "👏", "🔥"];
const REPLY_MAX = 300;

function injectStyles() {
  if (document.getElementById("fz-story-style")) return;
  const style = document.createElement("style");
  style.id = "fz-story-style";
  style.textContent = `
    .fz-pop { animation: fz-pop .9s ease-out forwards; }
    @keyframes fz-pop {
      0% { transform: translateY(0) scale(.4); opacity: 0; }
      30% { transform: translateY(-20px) scale(1.25); opacity: 1; }
      100% { transform: translateY(-120px) scale(1); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

const userCache = new Map();

async function readUser(db, uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  try {
    const snap = await get(ref(db, `users/${uid}`));
    const data = snap.exists() ? snap.val() : null;
    const user = data ? { uid, name: data.name || "FreeZone User", username: data.username || "", photoURL: data.photoURL || "" } : null;
    userCache.set(uid, user);
    return user;
  } catch (error) {
    return null;
  }
}

/* ---------------------------------------------------------------
   Mount
---------------------------------------------------------------- */
/**
 * @param {HTMLElement} container  where the stories bar is drawn
 * @param {object} ctx  { db, currentUser, currentProfile, followingIds, openProfile? }
 */
export async function mount(container, ctx = {}) {
  const { db, currentUser } = ctx;
  if (!container || !db || !currentUser) return;

  const me = currentUser.uid;
  let groups = []; // people (other than me) who have stories, plus me when I have some
  let seen = {}; // authorUid -> createdAt of the newest story already seen
  let loadedAt = 0;
  const viewedThisSession = new Set();

  const myProfile = () => ctx.currentProfile || { name: "You", username: "", photoURL: "" };

  /* =============================================================
     Loading
  ============================================================= */
  const readStories = async (uid, cutoff) => {
    try {
      const snap = await get(ref(db, `stories/${uid}`));
      const stories = [];
      const expired = {};
      const expiredFiles = []; // video + cover of my own expired video stories
      snap.forEach((child) => {
        const value = child.val() || {};
        if (!value.imageURL) return;
        const createdAt = Number(value.createdAt) || 0;
        if (createdAt >= cutoff) {
          const music = value.music && value.music.url ? { title: String(value.music.title || ""), artist: String(value.music.artist || ""), url: value.music.url } : null;
          stories.push({ id: child.key, imageURL: value.imageURL, caption: value.caption || "", createdAt, ...(value.videoURL ? { videoURL: value.videoURL, videoDuration: Number(value.videoDuration) || 0 } : {}), ...(music ? { music } : {}) });
        } else if (uid === me) {
          expired[`stories/${uid}/${child.key}`] = null; // my own expired stories are cleaned up
          expired[`storyViews/${uid}/${child.key}`] = null;
          expired[`storyReactions/${uid}/${child.key}`] = null;
          if (value.videoURL) expiredFiles.push(value.videoURL, value.imageURL);
        }
      });
      stories.sort((a, b) => a.createdAt - b.createdAt);
      return { uid, stories, expired, expiredFiles };
    } catch (error) {
      return { uid, stories: [], expired: {} }; // no permission or no network: just no stories
    }
  };

  const loadGroups = async () => {
    const cutoff = Date.now() - TTL_MS;
    const followed = Object.keys(ctx.followingIds || {}).filter((id) => id !== me).slice(0, MAX_FOLLOWED);

    const [seenSnap, results] = await Promise.all([
      get(ref(db, `storySeen/${me}`)).catch(() => null),
      Promise.all([me, ...followed].map((uid) => readStories(uid, cutoff)))
    ]);
    seen = seenSnap && seenSnap.exists() ? seenSnap.val() : {};

    const expired = Object.assign({}, ...results.map((result) => result.expired));
    if (Object.keys(expired).length) {
      update(ref(db), expired).catch(() => {});
      // the expired video stories are removed from Cloudinary too (4 files per call)
      const files = results.flatMap((result) => result.expiredFiles || []).filter((u) => typeof u === "string");
      if (files.length) import("./storage.js").then(async (m) => { for (let i = 0; i < files.length; i += 4) await m.deleteMedia(files.slice(i, i + 4)); }).catch(() => {});
    }

    const found = await Promise.all(
      results
        .filter((result) => result.stories.length)
        .map(async (result) => ({
          uid: result.uid,
          isMine: result.uid === me,
          user: result.uid === me ? myProfile() : await readUser(db, result.uid),
          stories: result.stories
        }))
    );

    const others = found.filter((group) => !group.isMine && group.user);
    const newest = (group) => group.stories[group.stories.length - 1].createdAt;
    others.sort((a, b) => Number(hasUnseen(b)) - Number(hasUnseen(a)) || newest(b) - newest(a));

    const mine = found.find((group) => group.isMine);
    return mine ? [mine, ...others] : others;
  };

  const hasUnseen = (group) => !group.isMine && group.stories[group.stories.length - 1].createdAt > (Number(seen[group.uid]) || 0);

  const reload = async () => {
    try {
      groups = await loadGroups();
    } catch (error) {
      console.warn("Stories: could not load:", error?.code || error);
    }
    loadedAt = Date.now();
    renderBar();
  };

  /* =============================================================
     The bar
  ============================================================= */
  // Instagram look: a big round photo inside a ring. Unseen stories have a colourful ring, seen ones a thin grey ring.
  const GRADIENT = "background:linear-gradient(45deg,#feda75 0%,#fa7e1e 25%,#d62976 55%,#962fbf 78%,#4f5bd5 100%);";
  const ringed = (kind, inner) => {
    if (kind === "unseen") {
      return `<div class="rounded-full" style="padding:2px;${GRADIENT}"><div class="p-[2px] rounded-full bg-slate-surface">${inner}</div></div>`;
    }
    return `<div class="rounded-full border border-slate-border" style="padding:2px;">${inner}</div>`;
  };
  // the photo has no ring of its own (the ring above is the only border)
  const photo = (url, size) => url
    ? `<img class="${size} rounded-full object-cover block bg-surface-container" src="${escapeHtml(url)}" alt="" loading="lazy" />`
    : `<div class="${size} rounded-full bg-gradient-to-br from-primary-fixed to-secondary-container flex items-center justify-center"><span class="material-symbols-outlined text-primary text-[20px]">person</span></div>`;
  const SIZE = "w-[58px] h-[58px]";
  const ITEM = "fz-story-item flex-shrink-0 w-[70px] flex flex-col items-center gap-0.5 cursor-pointer";

  const renderBar = () => {
    const mine = groups.find((group) => group.isMine);
    const me_ = myProfile();

    // One "Your story" card with my profile photo and a black + (like Instagram).
    // Tapping the photo shows my story (or adds one when I have none); tapping the + always adds a new one.
    const yourItem = `
      <div class="${ITEM}" role="button" tabindex="0" data-action="open" data-uid="${escapeHtml(me)}" aria-label="${mine ? "View your story" : "Add a story"}">
        <div class="relative">
          ${ringed(mine ? "unseen" : "none", photo(me_.photoURL || "logo.png", SIZE))}
          <span data-action="add" role="button" aria-label="Add a story" class="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-black text-white dark:bg-white dark:text-black border-2 border-slate-surface flex items-center justify-center">
            <span class="material-symbols-outlined text-[14px] pointer-events-none">add</span>
          </span>
        </div>
        <span class="w-full text-center text-[11px] leading-4 text-on-surface truncate">Your story</span>
      </div>`;

    const others = groups
      .filter((group) => !group.isMine)
      .map((group) => {
        const label = group.user.username ? group.user.username : group.user.name.split(" ")[0];
        const unseen = hasUnseen(group);
        return `
        <div class="${ITEM}" role="button" tabindex="0" data-action="open" data-uid="${escapeHtml(group.uid)}" aria-label="View ${escapeHtml(group.user.name)}'s story">
          ${ringed(unseen ? "unseen" : "seen", photo(group.user.photoURL, SIZE))}
          <span class="w-full text-center text-[11px] leading-4 ${unseen ? "text-on-surface" : "text-slate-muted"} truncate">${escapeHtml(label)}</span>
        </div>`;
      })
      .join("");

    container.innerHTML = `
      <div class="fz-stories flex gap-1 overflow-x-auto -mx-3 sm:-mx-4 px-3 sm:px-4 pt-1.5 pb-1 bg-slate-surface border-b border-slate-border [&::-webkit-scrollbar]:hidden" style="scrollbar-width:none;">
        ${yourItem}${others}
      </div>`;
  };

  const showSkeleton = () => {
    container.innerHTML = `
      <div class="flex gap-1 overflow-hidden -mx-3 sm:-mx-4 px-3 sm:px-4 pt-1.5 pb-1 bg-slate-surface border-b border-slate-border">
        ${Array.from({ length: 5 })
          .map(
            () => `<div class="flex-shrink-0 w-[70px] flex flex-col items-center gap-1.5"><div class="skeleton w-[62px] h-[62px] rounded-full"></div><div class="skeleton h-2.5 w-12 rounded"></div></div>`
          )
          .join("")}
      </div>`;
  };

  container.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="add"]')) return chooseKind();

    const item = event.target.closest('[data-action="open"]');
    if (!item) return;
    const index = groups.findIndex((group) => group.uid === item.dataset.uid);
    if (index === -1) return chooseKind(); // no story of mine yet: tapping "Your story" adds one
    openViewer(index);
  });

  container.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const item = event.target.closest('[data-action="open"]');
      if (item) {
        event.preventDefault();
        item.click();
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - loadedAt > REFRESH_AFTER_MS) reload();
  });

  /* =============================================================
     Adding a story
  ============================================================= */
  function chooseKind() {
    const sheet = document.createElement("div");
    sheet.className = "fixed inset-0 z-[9996] bg-black/50 flex items-end";
    sheet.innerHTML = `
      <div class="w-full bg-surface rounded-t-3xl p-4 space-y-2" style="padding-bottom:max(1rem, env(safe-area-inset-bottom));">
        <div class="w-10 h-1 rounded-full bg-slate-border mx-auto mb-2"></div>
        <button type="button" data-kind="photo" class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-surface-container text-on-surface font-label-lg text-label-lg"><span class="material-symbols-outlined text-primary">image</span>Photo story</button>
        <button type="button" data-kind="video" data-feature="storyVideo" data-feature-ready class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-surface-container text-on-surface font-label-lg text-label-lg"><span class="material-symbols-outlined text-primary">movie</span>Video story <span class="ml-auto text-slate-muted font-body-sm text-body-sm">up to ${LIMITS.story.sec}s</span></button>
      </div>`;
    const close = () => sheet.remove();
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) return close();
      const kind = event.target.closest("[data-kind]")?.dataset.kind;
      if (!kind) return;
      close();
      if (kind === "photo") pickImage(); else pickVideo();
    });
    document.body.appendChild(sheet);
  }

  function pickVideo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const check = await checkVideoFile(file, LIMITS.story);
      if (!check.ok) return showToast(check.message);
      try {
        const cover = await captureFrame(file, 0);
        openComposer({ video: { file, cover, duration: check.info.duration } });
      } catch (error) {
        console.error(error);
        showToast("Could not open this video");
      }
    });
    input.click();
  }

  let songsCache = null;
  async function loadSongs() {
    if (songsCache) return songsCache;
    const snap = await get(ref(db, "music"));
    const list = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v && v.url && v.active !== false) list.push({ id: child.key, title: String(v.title || "Untitled"), artist: String(v.artist || ""), url: v.url, createdAt: v.createdAt || 0 });
    });
    songsCache = list.sort((a, b) => b.createdAt - a.createdAt);
    return songsCache;
  }

  // Lets the person pick one of the admin's songs. Resolves to a song, null (remove) or undefined (closed without choosing).
  function openMusicSheet(current) {
    return new Promise((resolve) => {
      const sheet = document.createElement("div");
      sheet.className = "fixed inset-0 z-[9998] bg-black/60 flex items-end";
      sheet.innerHTML = `
        <div class="w-full max-h-[75vh] flex flex-col bg-surface rounded-t-3xl" style="padding-bottom:max(1rem, env(safe-area-inset-bottom));">
          <div class="flex items-center justify-between px-4 pt-4 pb-2">
            <span class="font-label-lg text-label-lg text-on-surface">Add music</span>
            <button type="button" class="fz-m-close w-9 h-9 rounded-full flex items-center justify-center text-on-surface active:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
          </div>
          <div class="fz-m-list flex-1 overflow-y-auto px-2"><p class="text-center text-slate-muted text-sm py-10">Loading...</p></div>
          ${current ? `<button type="button" class="fz-m-none mx-4 mt-2 py-2.5 rounded-xl bg-surface-container text-error font-label-md text-label-md font-semibold">Remove music</button>` : ""}
        </div>`;
      const audio = new Audio();
      audio.preload = "none";
      const finish = (value) => { audio.pause(); audio.removeAttribute("src"); sheet.remove(); resolve(value); };
      sheet.addEventListener("click", (event) => { if (event.target === sheet) finish(undefined); });
      sheet.querySelector(".fz-m-close").addEventListener("click", () => finish(undefined));
      sheet.querySelector(".fz-m-none")?.addEventListener("click", () => finish(null));
      document.body.appendChild(sheet);

      const listEl = sheet.querySelector(".fz-m-list");
      loadSongs().then((songs) => {
        if (!songs.length) { listEl.innerHTML = `<p class="text-center text-slate-muted text-sm py-10 px-6">No songs yet. Music will appear here soon.</p>`; return; }
        listEl.innerHTML = songs.map((song, i) => `
          <div class="flex items-center gap-2 px-2 py-2 rounded-2xl ${current && current.url === song.url ? "bg-primary-fixed/40" : ""}">
            <button type="button" class="fz-m-play w-10 h-10 rounded-full bg-surface-container text-primary flex items-center justify-center flex-shrink-0" data-i="${i}" aria-label="Listen"><span class="material-symbols-outlined">play_arrow</span></button>
            <button type="button" class="fz-m-pick flex-1 min-w-0 text-left py-1" data-i="${i}"><div class="font-label-lg text-label-lg text-on-surface truncate">${escapeHtml(song.title)}</div><div class="font-body-sm text-body-sm text-slate-muted truncate">${escapeHtml(song.artist || "FreeZone")}</div></button>
          </div>`).join("");
        listEl.addEventListener("click", (event) => {
          const play = event.target.closest(".fz-m-play");
          const pick = event.target.closest(".fz-m-pick");
          if (pick) return finish(songs[Number(pick.dataset.i)]);
          if (!play) return;
          const song = songs[Number(play.dataset.i)];
          const icon = (el, name) => (el.querySelector("span").textContent = name);
          listEl.querySelectorAll(".fz-m-play").forEach((b) => b !== play && icon(b, "play_arrow"));
          if (!audio.paused && audio.src === song.url) { audio.pause(); icon(play, "play_arrow"); return; }
          audio.src = song.url;
          audio.play().then(() => icon(play, "pause")).catch(() => showToast("Could not play this song"));
          audio.onended = () => icon(play, "play_arrow");
        });
      }).catch(() => { listEl.innerHTML = `<p class="text-center text-slate-muted text-sm py-10">Could not load songs.</p>`; });
    });
  }

  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return showToast("Please choose an image");
      if (file.size > MAX_FILE_MB * 1024 * 1024) return showToast(`Image is too large (max ${MAX_FILE_MB} MB)`);

      try {
        // The person sizes and places the photo (zoom, move, turn) before the story is made.
        // "Full screen" matches the shape of this phone; the photo may also be made smaller (black bars).
        const screen = Math.min(0.8, Math.max(0.4, window.innerWidth / Math.max(1, window.innerHeight)));
        const blob = await openCropper(file, {
          aspects: [{ id: "full", label: "Full screen", ratio: screen }, { id: "916", label: "9:16", ratio: 9 / 16 }],
          fit: true,
          fillColor: "#000",
          maxSide: 1280,
          title: "Adjust story",
          doneLabel: "Next"
        });
        if (!blob) return; // cancelled
        openComposer({ blob });
      } catch (error) {
        console.error(error);
        showToast("Could not open this image");
      }
    });
    input.click();
  }

  function openComposer(media) {
    const isVideo = !!media.video;
    const blob = isVideo ? media.video.cover : media.blob;
    const previewUrl = URL.createObjectURL(blob);
    const videoUrl = isVideo ? URL.createObjectURL(media.video.file) : "";
    let song = null; // the chosen music (photo stories only)
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[9997] bg-black flex flex-col";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "New story");
    overlay.innerHTML = `
      ${isVideo
        ? `<video src="${videoUrl}" poster="${previewUrl}" class="absolute inset-0 w-full h-full object-cover" autoplay muted loop playsinline></video>`
        : `<img src="${previewUrl}" alt="Story preview" class="absolute inset-0 w-full h-full object-cover" />`}
      <div class="relative z-10 flex items-center justify-between px-3 pb-8 bg-gradient-to-b from-black/60 to-transparent" style="padding-top:max(0.75rem, env(safe-area-inset-top));">
        <button type="button" class="fz-c-close w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10" aria-label="Cancel">
          <span class="material-symbols-outlined">close</span>
        </button>
        <span class="text-white font-label-lg text-label-lg">${isVideo ? `Video story · ${formatDuration(media.video.duration)}` : "New story"}</span>
        ${isVideo ? `<span class="w-10"></span>` : `<button type="button" class="fz-c-music h-10 px-3 max-w-[46vw] rounded-full flex items-center gap-1 text-white bg-black/40 active:scale-95 transition-transform" aria-label="Add music"><span class="material-symbols-outlined text-[20px]">music_note</span><span class="fz-c-music-text font-label-md text-label-md truncate">Music</span></button>`}
      </div>
      <div class="flex-1"></div>
      <div class="relative z-10 px-4 pt-12 space-y-3 bg-gradient-to-t from-black/80 to-transparent" style="padding-bottom:max(1rem, env(safe-area-inset-bottom));">
        <textarea class="fz-c-caption w-full resize-none rounded-2xl bg-white/10 text-white placeholder:text-white/50 px-4 py-3 text-[16px] outline-none focus:bg-white/15" rows="2" maxlength="${CAPTION_MAX}" placeholder="Add a caption (optional)"></textarea>
        <button type="button" class="fz-c-share w-full py-3 rounded-xl bg-primary-container text-white font-label-lg text-label-lg font-semibold active:scale-[.98] transition-all disabled:opacity-60">Share story</button>
      </div>`;

    const close = () => {
      URL.revokeObjectURL(previewUrl);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      overlay.remove();
    };
    const musicBtn = overlay.querySelector(".fz-c-music");
    if (musicBtn) {
      musicBtn.addEventListener("click", async () => {
        const choice = await openMusicSheet(song);
        if (choice === undefined) return;
        song = choice;
        overlay.querySelector(".fz-c-music-text").textContent = song ? song.title : "Music";
        musicBtn.classList.toggle("bg-primary-container", !!song);
      });
    }
    overlay.querySelector(".fz-c-close").addEventListener("click", close);

    const shareBtn = overlay.querySelector(".fz-c-share");
    shareBtn.addEventListener("click", async () => {
      // Firebase Storage is not connected yet: the page shows how it will look, but nothing is shared
      if (isVideo && !storageReady()) return showToast("Preview only. " + (previewNotice() || "Video stories need Firebase Storage."));
      shareBtn.disabled = true;
      shareBtn.textContent = "Sharing...";
      try {
        let videoURL = "";
        let imageURL;
        if (isVideo) {
          const { uploadVideo, uploadThumb } = await import("./storage.js");
          videoURL = await uploadVideo(media.video.file, {
            uid: me, kind: "stories",
            onPrepare: (fraction) => { shareBtn.textContent = `Preparing ${Math.round(fraction * 100)}%`; },
            onProgress: (fraction) => { shareBtn.textContent = `Sharing ${Math.round(fraction * 95)}%`; }
          });
          imageURL = await uploadThumb(media.video.cover, { uid: me, kind: "stories" });
        } else {
          imageURL = await uploadToImgbb(blob, "story.jpg", {
            onProgress: (fraction) => {
              shareBtn.textContent = fraction < 1 ? `Sharing ${Math.round(fraction * 100)}%` : "Finishing...";
            }
          });
        }
        const caption = overlay.querySelector(".fz-c-caption").value.trim();
        const storyRef = push(ref(db, `stories/${me}`));
        await set(storyRef, {
          imageURL,
          ...(caption ? { caption } : {}),
          ...(videoURL ? { videoURL, videoDuration: Math.round(media.video.duration) } : {}),
          ...(song ? { music: { title: song.title.slice(0, 60), ...(song.artist ? { artist: song.artist.slice(0, 40) } : {}), url: song.url } } : {}),
          createdAt: serverTimestamp()
        });
        close();
        showToast("Story shared");
        await reload();
      } catch (error) {
        console.error(error);
        showToast(error.code === "PERMISSION_DENIED" ? "Could not share: database rules block it" : ["storage-full", "sign-failed", "upload-failed", "network", "no-login", "no-storage"].includes(error.code) ? "Could not share. " + error.message : "Could not share your story. Try again.");
        shareBtn.disabled = false;
        shareBtn.textContent = "Share story";
      }
    });

    document.body.appendChild(overlay);
  }

  /* =============================================================
     The viewer
  ============================================================= */
  function openViewer(startGroup) {
    let gi = startGroup; // which person
    let si = 0; // which of their stories
    let raf = null;
    let last = 0;
    let elapsed = 0;
    let paused = false;
    let ready = false;
    let closed = false;
    let inputPause = false; // typing a reply or reading the viewers list also pauses the story
    let slideMs = SLIDE_MS; // how long the shown story lasts (a video story lasts as long as the video)
    let soundOff = false; // the sound button: mutes video sound and music
    let mediaPlaying = false;
    const audio = new Audio(); // music of a photo story
    audio.loop = true;
    audio.preload = "auto";
    const myReactions = new Map(); // storyId -> emoji I reacted with ("" = none)
    const previousOverflow = document.body.style.overflow;

    // Start with the first story the person has not seen yet
    const startGroupData = groups[gi];
    if (startGroupData && !startGroupData.isMine) {
      const seenUpTo = Number(seen[startGroupData.uid]) || 0;
      const firstUnseen = startGroupData.stories.findIndex((story) => story.createdAt > seenUpTo);
      si = firstUnseen === -1 ? 0 : firstUnseen;
    }

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[9997] bg-black flex flex-col select-none touch-none";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Story viewer");
    overlay.innerHTML = `
      <div class="absolute top-0 inset-x-0 z-20 px-3 pb-8 bg-gradient-to-b from-black/70 to-transparent" style="padding-top:max(0.75rem, env(safe-area-inset-top));">
        <div class="fz-bars flex gap-1"></div>
        <div class="flex items-center justify-between mt-3">
          <div class="fz-author flex items-center gap-2.5 min-w-0"></div>
          <div class="flex items-center flex-shrink-0">
            <button type="button" class="fz-mute hidden w-10 h-10 rounded-full items-center justify-center text-white hover:bg-white/10" aria-label="Sound"><span class="material-symbols-outlined">volume_up</span></button>
            <button type="button" class="fz-edit hidden w-10 h-10 rounded-full items-center justify-center text-white hover:bg-white/10" aria-label="Edit caption"><span class="material-symbols-outlined">edit</span></button>
            <button type="button" class="fz-delete hidden w-10 h-10 rounded-full items-center justify-center text-white hover:bg-white/10" aria-label="Delete story"><span class="material-symbols-outlined">delete</span></button>
            <button type="button" class="fz-close w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
          </div>
        </div>
        <div class="fz-music hidden mt-2 max-w-[70%] items-center gap-1.5 px-3 py-1 rounded-full bg-black/40 text-white text-[13px]"><span class="material-symbols-outlined text-[16px]">music_note</span><span class="fz-music-text truncate"></span></div>
      </div>

      <div class="absolute inset-0 flex items-center justify-center overflow-hidden bg-black">
        <img class="fz-img w-full h-full object-cover" alt="" />
        <video class="fz-vid absolute inset-0 w-full h-full object-cover" playsinline preload="auto" style="opacity:0"></video>
        <div class="fz-spinner absolute w-9 h-9 rounded-full border-[3px] border-white/25 border-t-white animate-spin"></div>
      </div>

      <div class="absolute bottom-0 inset-x-0 z-20 px-4 pt-12 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" style="padding-bottom:max(1rem, env(safe-area-inset-bottom));">
        <p class="fz-caption hidden text-white text-[16px] leading-snug text-center whitespace-pre-wrap break-words px-1"></p>
        <div class="fz-views hidden mt-3 items-center justify-center gap-1.5 text-white/90 text-[13px] pointer-events-auto cursor-pointer" role="button" tabindex="0" aria-label="See who viewed this story"></div>

        <div class="fz-reply hidden pointer-events-auto mt-3 space-y-3">
          <div class="fz-reactions flex items-center justify-center gap-2"></div>
          <div class="flex items-center gap-2">
            <input type="text" class="fz-reply-input flex-1 min-w-0 bg-white/10 border border-white/30 focus:border-white rounded-full px-4 py-2.5 text-white placeholder:text-white/60 text-[16px] outline-none" maxlength="${REPLY_MAX}" autocomplete="off" />
            <button type="button" class="fz-reply-send flex-shrink-0 w-11 h-11 rounded-full bg-primary-container text-white flex items-center justify-center active:scale-90 transition-all disabled:opacity-40" aria-label="Send reply" disabled>
              <span class="material-symbols-outlined text-[22px]" style="font-variation-settings:'FILL' 1;">send</span>
            </button>
          </div>
        </div>
      </div>

      <div class="fz-tap absolute inset-0 z-10"></div>`;

    const barsEl = overlay.querySelector(".fz-bars");
    const authorEl = overlay.querySelector(".fz-author");
    const imgEl = overlay.querySelector(".fz-img");
    const vidEl = overlay.querySelector(".fz-vid");
    const muteBtn = overlay.querySelector(".fz-mute");
    const musicEl = overlay.querySelector(".fz-music");
    const spinnerEl = overlay.querySelector(".fz-spinner");
    const captionEl = overlay.querySelector(".fz-caption");
    const viewsEl = overlay.querySelector(".fz-views");
    const deleteBtn = overlay.querySelector(".fz-delete");
    const editBtn = overlay.querySelector(".fz-edit");
    let editing = false; // the caption editor is open
    const tapEl = overlay.querySelector(".fz-tap");
    const replyEl = overlay.querySelector(".fz-reply");
    const reactionsEl = overlay.querySelector(".fz-reactions");
    const replyInput = overlay.querySelector(".fz-reply-input");
    const replySend = overlay.querySelector(".fz-reply-send");

    const group = () => groups[gi];
    const story = () => group().stories[si];

    /* ---- progress ---- */
    const setProgress = (fraction) => {
      const bar = barsEl.children[si]?.firstElementChild;
      if (bar) bar.style.width = `${Math.min(100, fraction * 100)}%`;
    };

    const buildBars = () => {
      barsEl.innerHTML = group()
        .stories.map(() => `<div class="flex-1 h-[3px] rounded-full bg-white/30 overflow-hidden"><div class="h-full bg-white" style="width:0%"></div></div>`)
        .join("");
    };

    const paintBars = () => {
      Array.from(barsEl.children).forEach((segment, index) => {
        segment.firstElementChild.style.width = index < si ? "100%" : "0%";
      });
    };

    const tick = (timestamp) => {
      if (closed) return;
      if (!last) last = timestamp;
      const delta = timestamp - last;
      last = timestamp;

      if (!paused && !inputPause && ready) {
        elapsed += delta;
        setProgress(elapsed / slideMs);
        if (elapsed >= slideMs) return next();
      }
      syncMedia();
      raf = requestAnimationFrame(tick);
    };

    // Video and music play only while the story runs; a finger on the screen or a keyboard pauses them too
    const syncMedia = () => {
      const want = !closed && !paused && !inputPause && (ready || currentHasVideo()) && document.visibilityState === "visible";
      if (want === mediaPlaying) return;
      mediaPlaying = want;
      const pending = [];
      if (currentHasVideo()) pending.push(want ? vidEl.play() : vidEl.pause());
      if (audio.src) pending.push(want ? audio.play() : audio.pause());
      pending.forEach((result) => result && result.catch && result.catch(() => {}));
    };
    const currentHasVideo = () => !!vidEl.getAttribute("src");

    const applySound = () => {
      vidEl.muted = soundOff;
      audio.muted = soundOff;
      muteBtn.firstElementChild.textContent = soundOff ? "volume_off" : "volume_up";
    };

    const stopMedia = () => {
      mediaPlaying = false;
      vidEl.pause();
      vidEl.removeAttribute("src");
      vidEl.load();
      vidEl.style.opacity = "0";
      audio.pause();
      audio.removeAttribute("src");
    };

    const restartTimer = () => {
      cancelAnimationFrame(raf);
      elapsed = 0;
      last = 0;
      raf = requestAnimationFrame(tick);
    };

    /* ---- showing one story ---- */
    const markSeen = (currentGroup, currentStory) => {
      if (currentGroup.isMine) return;
      if ((Number(seen[currentGroup.uid]) || 0) < currentStory.createdAt) {
        seen[currentGroup.uid] = currentStory.createdAt;
        update(ref(db), { [`storySeen/${me}/${currentGroup.uid}`]: currentStory.createdAt }).catch(() => {});
      }
      const key = `${currentGroup.uid}/${currentStory.id}`;
      if (!viewedThisSession.has(key)) {
        viewedThisSession.add(key);
        update(ref(db), { [`storyViews/${currentGroup.uid}/${currentStory.id}/${me}`]: serverTimestamp() }).catch(() => {});
      }
    };

    const showViews = async (currentStory) => {
      viewsEl.classList.remove("hidden");
      viewsEl.classList.add("flex");
      viewsEl.innerHTML = `<span class="material-symbols-outlined text-[18px]">visibility</span><span class="fz-views-text">...</span>`;
      try {
        const [viewsSnap, reactSnap] = await Promise.all([
          get(ref(db, `storyViews/${me}/${currentStory.id}`)),
          get(ref(db, `storyReactions/${me}/${currentStory.id}`)).catch(() => null)
        ]);
        if (closed || story().id !== currentStory.id) return;

        const views = viewsSnap.exists() ? viewsSnap.size : 0;
        const reactions = reactSnap && reactSnap.exists() ? Object.values(reactSnap.val()) : [];
        let text = views === 1 ? "1 view" : `${views} views`;
        if (reactions.length) text += ` · ${[...new Set(reactions)].slice(0, 3).join("")} ${reactions.length}`;
        viewsEl.querySelector(".fz-views-text").textContent = text;
      } catch (error) {
        viewsEl.classList.add("hidden");
        viewsEl.classList.remove("flex");
      }
    };

    // Who viewed my story, and with which reaction
    const openViewersSheet = async (targetStory) => {
      inputPause = true;
      const sheet = document.createElement("div");
      sheet.className = "fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/50";
      sheet.innerHTML = `
        <div class="w-full max-w-lg bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[75vh] flex flex-col" role="dialog" aria-modal="true" aria-label="Viewers">
          <div class="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">Viewers</h2>
            <button type="button" class="fz-v-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
          </div>
          <div class="fz-v-list overflow-y-auto px-2 pb-5"><p class="text-center text-slate-muted font-body-md text-body-md py-8">Loading...</p></div>
        </div>`;

      const closeSheet = () => {
        sheet.remove();
        inputPause = false;
      };
      sheet.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.target === sheet || event.target.closest(".fz-v-close")) closeSheet();
      });
      document.body.appendChild(sheet);

      const listEl = sheet.querySelector(".fz-v-list");
      try {
        const [viewsSnap, reactSnap] = await Promise.all([
          get(ref(db, `storyViews/${me}/${targetStory.id}`)),
          get(ref(db, `storyReactions/${me}/${targetStory.id}`)).catch(() => null)
        ]);
        const views = viewsSnap.exists() ? viewsSnap.val() : {};
        const reactions = reactSnap && reactSnap.exists() ? reactSnap.val() : {};
        const ids = [...new Set([...Object.keys(views), ...Object.keys(reactions)])]
          .sort((a, b) => (Number(views[b]) || 0) - (Number(views[a]) || 0))
          .slice(0, 100);
        const users = await Promise.all(ids.map((id) => readUser(db, id)));

        const rows = ids
          .map((id, index) => ({ id, user: users[index] }))
          .filter((row) => row.user)
          .map(
            ({ id, user }) => `
          <div class="flex items-center gap-3 px-3 py-2.5">
            ${avatarHtml(user.photoURL, "w-10 h-10")}
            <div class="min-w-0 flex-1">
              <div class="font-label-lg text-label-lg text-on-surface truncate">${escapeHtml(user.name)}</div>
              <div class="font-body-sm text-body-sm text-slate-muted truncate">${user.username ? "@" + escapeHtml(user.username) + " · " : ""}${views[id] ? timeAgo(Number(views[id])) : ""}</div>
            </div>
            ${reactions[id] ? `<span class="text-[24px] flex-shrink-0">${escapeHtml(reactions[id])}</span>` : ""}
          </div>`
          )
          .join("");
        listEl.innerHTML = rows || `<p class="text-center text-slate-muted font-body-md text-body-md py-8">No views yet.</p>`;
      } catch (error) {
        listEl.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-8">Could not load the viewers.</p>`;
      }
    };

    // ---- reactions and replies to other people's stories ----
    const renderReactions = () => {
      const current = myReactions.get(story().id) || "";
      reactionsEl.innerHTML = REACTIONS.map(
        (emoji) =>
          `<button type="button" data-emoji="${emoji}" class="w-11 h-11 rounded-full flex items-center justify-center text-[24px] ${
            emoji === current ? "bg-white/25 ring-2 ring-white" : "bg-white/10"
          } active:scale-90 transition-transform" aria-label="React ${emoji}">${emoji}</button>`
      ).join("");
    };

    const loadMyReaction = async (currentGroup, currentStory) => {
      if (!myReactions.has(currentStory.id)) {
        try {
          const snap = await get(ref(db, `storyReactions/${currentGroup.uid}/${currentStory.id}/${me}`));
          myReactions.set(currentStory.id, snap.exists() ? snap.val() : "");
        } catch (error) {
          myReactions.set(currentStory.id, "");
        }
      }
      if (!closed && story().id === currentStory.id) renderReactions();
    };

    const storyRef = (currentGroup, currentStory) => ({ id: currentStory.id, imageURL: currentStory.imageURL, ownerUid: currentGroup.uid });

    const popEmoji = (emoji) => {
      const el = document.createElement("div");
      el.className = "fz-pop pointer-events-none absolute left-1/2 top-1/2 z-30 text-[72px] leading-none";
      el.style.marginLeft = "-36px";
      el.textContent = emoji;
      overlay.appendChild(el);
      setTimeout(() => el.remove(), 950);
    };

    const react = async (emoji) => {
      const currentGroup = group();
      const currentStory = story();
      popEmoji(emoji);
      if (myReactions.get(currentStory.id) === emoji) return; // the same reaction is not sent twice

      const before = myReactions.get(currentStory.id) || "";
      myReactions.set(currentStory.id, emoji);
      renderReactions();

      try {
        await Promise.all([
          update(ref(db), { [`storyReactions/${currentGroup.uid}/${currentStory.id}/${me}`]: emoji }),
          sendChatMessage(db, me, currentGroup.uid, emoji, { story: storyRef(currentGroup, currentStory), reaction: true }, `Reacted ${emoji} to a story`)
        ]);
      } catch (error) {
        console.error("Story reaction:", error);
        myReactions.set(currentStory.id, before);
        if (!closed && story().id === currentStory.id) renderReactions();
        showToast(error.code === "PERMISSION_DENIED" ? "Could not react: database rules block it" : "Could not send your reaction");
      }
    };

    const sendReply = async () => {
      const text = replyInput.value.trim();
      if (!text) return;
      const currentGroup = group();
      const currentStory = story();

      replySend.disabled = true;
      try {
        await sendChatMessage(db, me, currentGroup.uid, text, { story: storyRef(currentGroup, currentStory) }, `Story reply: ${text}`);
        replyInput.value = "";
        replyInput.blur();
        inputPause = false;
        showToast("Reply sent");
      } catch (error) {
        console.error("Story reply:", error);
        showToast(error.code === "PERMISSION_DENIED" ? "Could not reply: database rules block it" : "Could not send your reply");
      }
      replySend.disabled = !replyInput.value.trim();
    };

    reactionsEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-emoji]");
      if (button) react(button.dataset.emoji);
    });
    const updateInputPause = () => {
      inputPause = document.activeElement === replyInput || replyInput.value.trim() !== "";
      replySend.disabled = !replyInput.value.trim();
    };
    replyInput.addEventListener("focus", updateInputPause);
    replyInput.addEventListener("blur", updateInputPause);
    replyInput.addEventListener("input", updateInputPause);
    replyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendReply();
      }
    });
    replySend.addEventListener("click", sendReply);
    viewsEl.addEventListener("click", () => openViewersSheet(story()));

    const showStory = () => {
      const currentGroup = group();
      const currentStory = story();

      paintBars();
      ready = false;
      stopMedia();
      slideMs = SLIDE_MS;
      spinnerEl.classList.remove("hidden");
      imgEl.style.opacity = "0";
      const isVideo = !!currentStory.videoURL;
      const music = !isVideo && currentStory.music ? currentStory.music : null;
      imgEl.onload = () => {
        if (closed) return;
        imgEl.style.opacity = "1";
        if (isVideo) return; // the video decides when the story is ready
        spinnerEl.classList.add("hidden");
        ready = true;
      };
      if (isVideo) {
        const maxMs = 60000;
        slideMs = Math.min(maxMs, Math.max(1000, (currentStory.videoDuration || 0) * 1000 || SLIDE_MS));
        vidEl.onloadedmetadata = () => {
          if (closed || !Number.isFinite(vidEl.duration) || vidEl.duration <= 0) return;
          slideMs = Math.min(maxMs, Math.max(1000, vidEl.duration * 1000));
        };
        vidEl.onplaying = () => {
          if (closed) return;
          spinnerEl.classList.add("hidden");
          vidEl.style.opacity = "1";
          ready = true;
        };
        vidEl.onwaiting = () => { if (!closed) { ready = false; spinnerEl.classList.remove("hidden"); } };
        vidEl.onended = () => { if (!closed) next(); };
        vidEl.onerror = () => { if (closed) return; showToast("Could not play this video"); next(); };
        vidEl.src = currentStory.videoURL;
        vidEl.load();
        // becomes "ready" when it really plays; start it now so the first frame shows quickly
        mediaPlaying = true;
        const start = vidEl.play();
        if (start && start.catch) start.catch(() => { mediaPlaying = false; vidEl.muted = true; vidEl.play().then(() => { mediaPlaying = true; }).catch(() => {}); });
      }
      if (music) {
        audio.src = music.url;
        audio.onerror = () => { musicEl.classList.add("hidden"); musicEl.classList.remove("inline-flex"); };
      }
      musicEl.classList.toggle("hidden", !music);
      musicEl.classList.toggle("inline-flex", !!music);
      if (music) musicEl.querySelector(".fz-music-text").textContent = music.artist ? `${music.title} · ${music.artist}` : music.title;
      const hasSound = isVideo || !!music;
      muteBtn.classList.toggle("hidden", !hasSound);
      muteBtn.classList.toggle("flex", hasSound);
      applySound();
      imgEl.onerror = () => {
        if (closed) return;
        showToast("Could not load this story");
        next();
      };
      imgEl.src = currentStory.imageURL;
      if (isVideo) vidEl.style.opacity = "0";

      authorEl.innerHTML = `
        ${avatarHtml(currentGroup.user.photoURL, "w-9 h-9")}
        <div class="min-w-0">
          <div class="text-white font-label-lg text-label-lg truncate">${escapeHtml(currentGroup.isMine ? "Your story" : currentGroup.user.username ? "@" + currentGroup.user.username : currentGroup.user.name)}</div>
          <div class="text-white/70 text-[12px]">${timeAgo(currentStory.createdAt)}</div>
        </div>`;

      captionEl.textContent = currentStory.caption;
      captionEl.classList.toggle("hidden", !currentStory.caption);

      deleteBtn.classList.toggle("hidden", !currentGroup.isMine);
      deleteBtn.classList.toggle("flex", currentGroup.isMine);
      editBtn.classList.toggle("hidden", !currentGroup.isMine);
      editBtn.classList.toggle("flex", currentGroup.isMine);

      viewsEl.classList.add("hidden");
      viewsEl.classList.remove("flex");

      // Other people's stories can be replied to and reacted to; my own show who viewed them
      const canReply = !currentGroup.isMine;
      replyEl.classList.toggle("hidden", !canReply);
      replyInput.value = "";
      inputPause = false;
      replySend.disabled = true;
      if (canReply) {
        replyInput.placeholder = `Reply to ${currentGroup.user.username ? "@" + currentGroup.user.username : currentGroup.user.name}...`;
        renderReactions();
        loadMyReaction(currentGroup, currentStory);
      }

      if (currentGroup.isMine) showViews(currentStory);
      else markSeen(currentGroup, currentStory);

      restartTimer();
    };

    /* ---- moving around ---- */
    const close = () => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      stopMedia();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", fitToViewport);
        window.visualViewport.removeEventListener("scroll", fitToViewport);
      }
      document.body.style.overflow = previousOverflow;
      overlay.remove();
      renderBar(); // rings turn grey for the stories that were seen
    };

    function next() {
      if (si < group().stories.length - 1) {
        si++;
        setProgress(1);
        return showStory();
      }
      if (gi < groups.length - 1) {
        gi++;
        si = 0;
        buildBars();
        return showStory();
      }
      close();
    }

    const previous = () => {
      if (si > 0) {
        si--;
        return showStory();
      }
      if (gi > 0) {
        gi--;
        si = 0;
        buildBars();
      }
      showStory();
    };

    /* ---- input ---- */
    let pressStart = 0;
    let pressX = 0;
    let pressY = 0;

    tapEl.addEventListener("pointerdown", (event) => {
      pressStart = Date.now();
      pressX = event.clientX;
      pressY = event.clientY;
      paused = true; // holding a finger on the screen pauses the story
    });

    const release = (event) => {
      paused = false;
      const held = Date.now() - pressStart;
      const dx = Math.abs(event.clientX - pressX);
      const dy = event.clientY - pressY;

      if (dy > 90 && dy > dx) return close(); // swipe down closes
      if (held < 250 && dx < 12 && Math.abs(dy) < 12) {
        const width = overlay.clientWidth || window.innerWidth;
        if (event.clientX < width * 0.33) previous();
        else next();
      }
    };
    tapEl.addEventListener("pointerup", release);
    tapEl.addEventListener("pointercancel", () => (paused = false));

    overlay.querySelector(".fz-close").addEventListener("click", close);
    muteBtn.addEventListener("click", () => {
      soundOff = !soundOff;
      applySound();
    });

    authorEl.addEventListener("click", () => {
      if (group().isMine || !ctx.openProfile) return;
      const uid = group().uid;
      close();
      ctx.openProfile(uid);
    });

    // ---- edit the caption of my own story ----
    editBtn.addEventListener("click", () => {
      if (editing) return;
      const target = story();
      const targetGroup = group();
      if (!targetGroup.isMine) return;
      editing = true;
      inputPause = true; // the story stops while the caption is edited
      const sheet = document.createElement("div");
      sheet.className = "fixed inset-0 z-[9998] bg-black/60 flex items-center justify-center px-4";
      sheet.innerHTML = `
        <div class="w-full max-w-md bg-surface rounded-3xl p-4 space-y-3" role="dialog" aria-label="Edit caption">
          <div class="flex items-center justify-between">
            <span class="font-label-lg text-label-lg text-on-surface font-semibold">Edit caption</span>
            <button type="button" class="fz-e-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
          </div>
          <textarea class="fz-e-text w-full resize-none rounded-2xl bg-surface-container text-on-surface placeholder:text-slate-muted px-4 py-3 text-[16px] outline-none" rows="3" maxlength="${CAPTION_MAX}" placeholder="Add a caption"></textarea>
          <div class="flex items-center justify-between gap-3">
            <span class="fz-e-count text-slate-muted text-[12px]"></span>
            <div class="flex gap-2">
              <button type="button" class="fz-e-cancel px-4 py-2 rounded-full text-on-surface font-label-md text-label-md active:bg-surface-container">Cancel</button>
              <button type="button" class="fz-e-save px-5 py-2 rounded-full bg-primary-container text-white font-label-md text-label-md font-semibold active:scale-95 transition-all disabled:opacity-60">Save</button>
            </div>
          </div>
        </div>`;
      const box = sheet.querySelector(".fz-e-text");
      const count = sheet.querySelector(".fz-e-count");
      const saveBtn = sheet.querySelector(".fz-e-save");
      box.value = target.caption || "";
      const updateCount = () => { count.textContent = `${box.value.length}/${CAPTION_MAX}`; };
      updateCount();
      box.addEventListener("input", updateCount);

      const closeEditor = () => {
        editing = false;
        inputPause = false;
        sheet.remove();
      };
      sheet.addEventListener("click", (event) => { if (event.target === sheet) closeEditor(); });
      sheet.querySelector(".fz-e-close").addEventListener("click", closeEditor);
      sheet.querySelector(".fz-e-cancel").addEventListener("click", closeEditor);
      saveBtn.addEventListener("click", async () => {
        const caption = box.value.trim();
        if (caption === (target.caption || "")) return closeEditor(); // nothing changed
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
        try {
          // an empty caption removes the field
          await update(ref(db, `stories/${me}/${target.id}`), { caption: caption || null });
        } catch (error) {
          console.error(error);
          showToast(error.code === "PERMISSION_DENIED" ? "Could not save: database rules block it" : "Could not save the caption. Try again.");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          return;
        }
        if (caption) target.caption = caption; else delete target.caption;
        if (!closed && story() === target) {
          captionEl.textContent = target.caption || "";
          captionEl.classList.toggle("hidden", !target.caption);
        }
        closeEditor();
        showToast("Caption updated");
      });
      document.body.appendChild(sheet);
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });

    deleteBtn.addEventListener("click", async () => {
      paused = true;
      if (!confirm("Delete this story?")) {
        paused = false;
        return;
      }

      const target = story();
      try {
        await update(ref(db), {
          [`stories/${me}/${target.id}`]: null,
          [`storyViews/${me}/${target.id}`]: null,
          [`storyReactions/${me}/${target.id}`]: null
        });
        // a video story: its video and cover are removed from Cloudinary too
        const files = [target.videoURL, target.imageURL].filter((u) => typeof u === "string");
        if (files.length) import("./storage.js").then((m) => m.deleteMedia(files)).catch(() => {});
      } catch (error) {
        console.error(error);
        showToast("Could not delete the story. Try again.");
        paused = false;
        return;
      }

      const current = group();
      current.stories.splice(si, 1);
      showToast("Story deleted");

      if (!current.stories.length) {
        groups = groups.filter((item) => item !== current);
        close();
        return;
      }
      si = Math.min(si, current.stories.length - 1);
      buildBars();
      paused = false;
      showStory();
    });

    const onKey = (event) => {
      if (editing) return;
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") previous();
    };
    const onVisibility = () => {
      paused = document.visibilityState !== "visible";
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);

    // On phones the keyboard covers the bottom of the screen: follow the visible area
    const viewport = window.visualViewport;
    const fitToViewport = () => {
      if (!viewport) return;
      overlay.style.bottom = "auto";
      overlay.style.top = `${viewport.offsetTop}px`;
      overlay.style.height = `${viewport.height}px`;
    };
    if (viewport) {
      viewport.addEventListener("resize", fitToViewport);
      viewport.addEventListener("scroll", fitToViewport);
    }

    injectStyles();
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
    buildBars();
    showStory();
  }

  /* =============================================================
     Start
  ============================================================= */
  showSkeleton();
  await reload();
}
