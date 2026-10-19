// FreeZone BD - Create Post page (opened by the + button in the bottom bar)
// A post can have up to 4 photos. The photos are uploaded to imgbb and only their links are saved in the database.
// While posting, the page shows a progress bar with the real upload percentage, one percentage per photo, and a Cancel button.

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
import { escapeHtml, avatarHtml, showToast, AUDIENCES, openAudienceSheet } from "./post.js";
import { openEmojiPicker } from "./emoji.js";
import { openFeelingSheet, openPlaceSheet } from "./tags.js";
import { tagIndexUpdates } from "./hashtags.js";
import { adultCheck } from "./feed-algorithm.js";
import { storageReady, previewNotice } from "./features.js";
import { LIMITS, checkVideoFile, captureFrame, formatDuration, formatSize } from "./video-tools.js";

const TEXT_MAX = 500;
const MAX_IMAGES = 4;
const MAX_FILE_MB = 10;
const POLL_OPTION_MAX = 40;
const DRAFT_DAYS = 30; // an unfinished post is kept this long

/* ---------------------------------------------------------------
   Draft: the unfinished post (text + photos) is kept on this phone, one per account.
   Photos are big, so they go to IndexedDB; if that is not available only the text is kept (localStorage).
---------------------------------------------------------------- */
const draftKey = (uid) => `fz_draft_${uid}`;

function openDraftDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("no indexedDB"));
    const request = indexedDB.open("fz_drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const idbRun = async (mode, fn) => {
  const db = await openDraftDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = fn(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

async function saveDraft(uid, text, blobs, audience = "public", tags = {}, poll = null) {
  const pollUsed = !!(poll && poll.some((o) => o.trim()));
  if (!text.trim() && !blobs.length && !pollUsed) return clearDraft(uid);
  const draft = { text, images: blobs, audience, feeling: tags.feeling || "", place: tags.place || "", poll: poll || null, savedAt: Date.now() };
  try {
    await idbRun("readwrite", (store) => store.put(draft, draftKey(uid)));
    try { localStorage.removeItem(draftKey(uid)); } catch (e) { /* ignore */ }
  } catch (error) {
    try { localStorage.setItem(draftKey(uid), JSON.stringify({ text, audience, feeling: draft.feeling, place: draft.place, poll: draft.poll, savedAt: draft.savedAt })); } catch (e) { /* storage unavailable: no draft */ }
  }
}

async function loadDraft(uid) {
  let draft = null;
  try { draft = await idbRun("readonly", (store) => store.get(draftKey(uid))); } catch (error) { /* try localStorage */ }
  if (!draft) {
    try { draft = JSON.parse(localStorage.getItem(draftKey(uid)) || "null"); } catch (error) { draft = null; }
  }
  const hasPoll = Array.isArray(draft && draft.poll) && draft.poll.some((o) => String(o).trim());
  if (!draft || (!(draft.text || "").trim() && !(draft.images || []).length && !hasPoll)) return null;
  if (Date.now() - (draft.savedAt || 0) > DRAFT_DAYS * 86400000) {
    clearDraft(uid);
    return null;
  }
  return { poll: hasPoll ? draft.poll.slice(0, 4).map((o) => String(o).slice(0, POLL_OPTION_MAX)) : null, feeling: String(draft.feeling || "").slice(0, 40), place: String(draft.place || "").slice(0, 60), audience: ["followers", "me"].includes(draft.audience) ? draft.audience : "public", text: String(draft.text || "").slice(0, TEXT_MAX), images: (draft.images || []).filter((b) => b instanceof Blob).slice(0, MAX_IMAGES), savedAt: draft.savedAt };
}

async function clearDraft(uid) {
  try { await idbRun("readwrite", (store) => store.delete(draftKey(uid))); } catch (error) { /* nothing to clear */ }
  try { localStorage.removeItem(draftKey(uid)); } catch (error) { /* ignore */ }
}

/**
 * @param {HTMLElement} container
 * @param {object} ctx  { db, currentUser, currentProfile, closePage? }
 */
export function mount(container, ctx = {}) {
  const { db, currentUser } = ctx;
  const profile = ctx.currentProfile || { name: "You", username: "", photoURL: "" };

  if (!db || !currentUser) {
    container.innerHTML = `<p class="text-center text-slate-muted text-sm py-16 px-6">Please log in to create a post.</p>`;
    return;
  }

  let images = []; // [{ blob, url }]  url is only for the preview on this page
  let video = null; // { file, url, duration, cover, coverUrl }  one video per post, never together with photos
  let posting = false;
  let controller = null; // lets the Cancel button stop the uploads

  container.innerHTML = `
    <div class="fz-create fixed inset-0 z-[60] flex flex-col bg-background text-on-surface">
      <div class="flex items-center justify-between gap-3 px-3 h-14 flex-shrink-0">
        <button type="button" class="fz-close w-10 h-10 -ml-1 rounded-full flex items-center justify-center active:bg-surface-container transition-colors" aria-label="Close"><span class="material-symbols-outlined text-[26px]">close</span></button>
        <span class="fz-saved opacity-0 transition-opacity flex items-center gap-0.5 text-slate-subtle font-body-sm text-body-sm ml-auto"><span class="material-symbols-outlined text-[14px]">cloud_done</span>Draft saved</span>
        <button type="button" class="fz-post px-5 h-9 rounded-full bg-primary-container text-white font-label-lg text-label-lg font-bold active:scale-95 transition-all disabled:opacity-50" disabled>Post</button>
      </div>

      <div class="fz-scroll flex-1 overflow-y-auto px-4 pb-4">
        <div class="fz-draft-note hidden items-center justify-between gap-2 px-3 py-2 mb-3 rounded-xl bg-primary-fixed/40 text-primary font-body-sm text-body-sm">
          <span class="flex items-center gap-1.5 min-w-0"><span class="material-symbols-outlined text-[18px] flex-shrink-0">edit_note</span><span class="fz-draft-text truncate">Draft restored</span></span>
          <button type="button" class="fz-draft-discard flex-shrink-0 font-label-md text-label-md font-semibold text-error">Discard</button>
        </div>

        <div class="flex items-start gap-3">
          <div class="flex-shrink-0">${avatarHtml(profile.photoURL, "w-10 h-10")}</div>
          <div class="flex-1 min-w-0 space-y-3">
            <textarea class="fz-text w-full resize-none bg-transparent text-[20px] leading-snug text-on-surface placeholder:text-slate-subtle outline-none min-h-[120px] pt-1.5 disabled:opacity-60" maxlength="${TEXT_MAX}" placeholder="What's happening?"></textarea>
            <div class="fz-chips flex flex-wrap gap-2 hidden"></div>
            <div class="fz-poll hidden rounded-2xl border border-slate-border p-3 space-y-2"></div>
            <div class="fz-previews grid grid-cols-2 gap-2 hidden"></div>
            <div class="fz-video-box hidden"></div>
          </div>
        </div>

        <!-- Shown while posting -->
        <div class="fz-progress hidden mt-4 bg-slate-surface border border-slate-border rounded-2xl p-4 space-y-3" role="status" aria-live="polite">
          <div class="flex items-center justify-between gap-3">
            <span class="fz-p-title font-label-lg text-label-lg text-on-surface">Uploading photos</span>
            <span class="fz-p-percent font-label-lg text-label-lg text-primary">0%</span>
          </div>
          <div class="h-2.5 rounded-full bg-surface-container overflow-hidden">
            <div class="fz-p-bar h-full rounded-full bg-primary-container transition-all duration-200 ease-out" style="width:0%"></div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="fz-p-sub font-body-sm text-body-sm text-slate-muted"></span>
            <button type="button" class="fz-p-cancel font-label-md text-label-md font-semibold text-error">Cancel</button>
          </div>
        </div>
      </div>

      <div class="flex-shrink-0 border-t border-slate-border/70">
        <button type="button" class="fz-audience w-full flex items-center gap-2 px-4 py-3 text-primary font-label-md text-label-md font-semibold disabled:opacity-50" aria-label="Who can see this post">
          <span class="fz-aud-icon material-symbols-outlined text-[18px]">public</span><span class="fz-aud-label">Public</span><span class="material-symbols-outlined text-[18px]">arrow_drop_down</span>
        </button>
        <div class="flex items-center gap-1 px-3 py-1.5 border-t border-slate-border/70" style="padding-bottom:max(.375rem, var(--fz-bottom,env(safe-area-inset-bottom,0px)))">
          <button type="button" class="fz-add-photo flex items-center justify-center w-10 h-10 rounded-full text-primary active:bg-primary-fixed/40 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none" aria-label="Photo"><span class="material-symbols-outlined text-[24px]">image</span><span class="fz-photo-label hidden"></span></button>
          <button type="button" data-feature="postVideo" data-feature-ready class="fz-add-video flex items-center justify-center w-10 h-10 rounded-full text-primary active:bg-primary-fixed/40 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none" aria-label="Video"><span class="material-symbols-outlined text-[24px]">videocam</span></button>
          <button type="button" class="fz-emoji flex items-center justify-center w-10 h-10 rounded-full text-primary active:bg-primary-fixed/40 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none" aria-label="Emoji"><span class="material-symbols-outlined text-[24px]">mood</span></button>
          <button type="button" class="fz-feeling flex items-center justify-center w-10 h-10 rounded-full text-primary active:bg-primary-fixed/40 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none" aria-label="Feeling or activity"><span class="material-symbols-outlined text-[24px]">sentiment_satisfied</span><span class="fz-feeling-text hidden"></span></button>
          <button type="button" class="fz-poll-btn flex items-center justify-center w-10 h-10 rounded-full text-primary active:bg-primary-fixed/40 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none" aria-label="Poll"><span class="material-symbols-outlined text-[24px]">poll</span><span class="fz-poll-label hidden"></span></button>
          <button type="button" class="fz-place flex items-center justify-center w-10 h-10 rounded-full text-primary active:bg-primary-fixed/40 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none" aria-label="Place"><span class="material-symbols-outlined text-[24px]">location_on</span><span class="fz-place-text hidden"></span></button>
          <span class="fz-ring ml-auto mr-1 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style="background:conic-gradient(rgb(var(--c-primary-container,29 155 240)) 0deg,rgba(128,128,128,.25) 0deg)"><span class="fz-count w-[22px] h-[22px] rounded-full bg-background flex items-center justify-center text-[10px] text-slate-muted"></span></span>
        </div>
      </div>

      <input type="file" accept="image/*" multiple class="fz-file" hidden />
      <input type="file" accept="video/*" class="fz-vfile" hidden />
    </div>
  `;

  const textEl = container.querySelector(".fz-text");
  const countEl = container.querySelector(".fz-count");
  const ringEl = container.querySelector(".fz-ring");
  const chipsEl = container.querySelector(".fz-chips");
  const fileEl = container.querySelector(".fz-file");
  const previewsEl = container.querySelector(".fz-previews");
  const addBtn = container.querySelector(".fz-add-photo");
  const vidBtn = container.querySelector(".fz-add-video");
  const vidBox = container.querySelector(".fz-video-box");
  const vFileEl = container.querySelector(".fz-vfile");
  const photoLabel = container.querySelector(".fz-photo-label");
  const postBtn = container.querySelector(".fz-post");
  const progressEl = container.querySelector(".fz-progress");
  const titleEl = container.querySelector(".fz-p-title");
  const percentEl = container.querySelector(".fz-p-percent");
  const barEl = container.querySelector(".fz-p-bar");
  const subEl = container.querySelector(".fz-p-sub");

  const emojiBtn = container.querySelector(".fz-emoji");
  emojiBtn.addEventListener("click", () => {
    if (posting) return;
    openEmojiPicker(textEl); // typing into the box also saves the draft and updates the counter
  });

  // Poll: 2 to 4 options, one vote per person
  let pollOn = false;
  let pollOptions = ["", ""];
  const pollEl = container.querySelector(".fz-poll");
  const pollBtn = container.querySelector(".fz-poll-btn");
  const cleanPoll = () => pollOptions.map((o) => o.trim().replace(/\s+/g, " ")).filter(Boolean);
  const renderPoll = () => {
    pollEl.classList.toggle("hidden", !pollOn);
    pollBtn.classList.toggle("text-primary", pollOn);
    container.querySelector(".fz-poll-label").textContent = pollOn ? "Poll on" : "Poll";
    if (!pollOn) { pollEl.innerHTML = ""; refresh(); return; }
    pollEl.innerHTML = `
      <div class="flex items-center justify-between"><span class="font-label-lg text-label-lg text-on-surface">Poll options</span><button type="button" class="fz-poll-remove font-label-md text-label-md font-semibold text-error">Remove poll</button></div>
      ${pollOptions.map((o, i) => `<div class="flex items-center gap-2"><input type="text" class="fz-poll-in flex-1 min-w-0 bg-surface-container-low border border-transparent focus:border-primary-container rounded-xl px-3.5 py-2.5 text-[16px] outline-none" data-i="${i}" maxlength="${POLL_OPTION_MAX}" placeholder="Option ${i + 1}" value="${escapeHtml(o)}" />${pollOptions.length > 2 ? `<button type="button" class="fz-poll-del w-8 h-8 rounded-full text-slate-muted hover:bg-surface-container flex items-center justify-center" data-i="${i}" aria-label="Remove option ${i + 1}"><span class="material-symbols-outlined text-[18px]">close</span></button>` : ""}</div>`).join("")}
      ${pollOptions.length < 4 ? `<button type="button" class="fz-poll-add flex items-center gap-1 text-primary font-label-md text-label-md font-semibold"><span class="material-symbols-outlined text-[18px]">add</span>Add option</button>` : ""}
      <p class="font-body-sm text-body-sm text-slate-muted">Everyone can vote once. They can change their vote later.</p>`;
    refresh();
  };
  pollBtn.addEventListener("click", () => {
    if (posting) return;
    pollOn = !pollOn;
    if (pollOn && pollOptions.length < 2) pollOptions = ["", ""];
    renderPoll();
    scheduleSave();
    if (pollOn) pollEl.querySelector(".fz-poll-in")?.focus();
  });
  pollEl.addEventListener("input", (event) => {
    const input = event.target.closest(".fz-poll-in");
    if (!input) return;
    pollOptions[Number(input.dataset.i)] = input.value;
    refresh();
    scheduleSave();
  });
  pollEl.addEventListener("click", (event) => {
    if (posting) return;
    if (event.target.closest(".fz-poll-remove")) { pollOn = false; renderPoll(); scheduleSave(); return; }
    if (event.target.closest(".fz-poll-add") && pollOptions.length < 4) { pollOptions.push(""); renderPoll(); pollEl.querySelectorAll(".fz-poll-in")[pollOptions.length - 1]?.focus(); return; }
    const del = event.target.closest(".fz-poll-del");
    if (del && pollOptions.length > 2) { pollOptions.splice(Number(del.dataset.i), 1); renderPoll(); scheduleSave(); }
  });

  // Feeling / activity and place tags
  let feeling = "";
  let place = "";
  const feelBtn = container.querySelector(".fz-feeling");
  const placeBtn = container.querySelector(".fz-place");
  const paintTags = () => {
    container.querySelector(".fz-feeling-text").textContent = feeling || "";
    container.querySelector(".fz-place-text").textContent = place ? `📍 ${place}` : "";
    chipsEl.classList.toggle("hidden", !feeling && !place);
    chipsEl.innerHTML = [feeling ? `<button type="button" class="fz-chip px-3 py-1 rounded-full bg-surface-container text-primary font-label-md text-label-md font-semibold" data-k="feeling">${escapeHtml(feeling)}</button>` : "", place ? `<button type="button" class="fz-chip px-3 py-1 rounded-full bg-surface-container text-primary font-label-md text-label-md font-semibold" data-k="place">📍 ${escapeHtml(place)}</button>` : ""].join("");
    feelBtn.classList.toggle("text-primary", !!feeling);
    placeBtn.classList.toggle("text-primary", !!place);
  };
  chipsEl.addEventListener("click", (event) => {
    const chip = event.target.closest(".fz-chip");
    if (chip) (chip.dataset.k === "place" ? placeBtn : feelBtn).click();
  });
  container.querySelector(".fz-close").addEventListener("click", () => {
    if (posting) { showToast("Please wait or press Cancel"); return; }
    if (ctx.closePage) ctx.closePage();
    else container.innerHTML = "";
  });
  feelBtn.addEventListener("click", async () => {
    if (posting) return;
    const choice = await openFeelingSheet(feeling);
    if (choice !== null) { feeling = choice; paintTags(); scheduleSave(); }
  });
  placeBtn.addEventListener("click", async () => {
    if (posting) return;
    const choice = await openPlaceSheet(place);
    if (choice !== null) { place = choice; paintTags(); scheduleSave(); }
  });

  // Who can see this post
  let audience = "public";
  const audBtn = container.querySelector(".fz-audience");
  const paintAudience = () => {
    const info = AUDIENCES.find((a) => a.value === audience) || AUDIENCES[0];
    container.querySelector(".fz-aud-icon").textContent = info.icon;
    container.querySelector(".fz-aud-label").textContent = info.label;
  };
  audBtn.addEventListener("click", async () => {
    if (posting) return;
    const choice = await openAudienceSheet(audience);
    if (choice) {
      audience = choice;
      paintAudience();
      scheduleSave();
    }
  });

  const draftNote = container.querySelector(".fz-draft-note");
  const draftText = container.querySelector(".fz-draft-text");
  const savedEl = container.querySelector(".fz-saved");

  /* ---- draft ---- */
  const uid = currentUser.uid;
  let draftTimer = null;
  let draftOff = false; // set once the post is published, so a late save cannot bring the draft back
  let savedFade = null;

  const saveNow = async () => {
    if (draftOff) return;
    await saveDraft(uid, textEl.value, images.map((image) => image.blob), audience, { feeling, place }, pollOn ? pollOptions : null);
    if (draftOff) return clearDraft(uid);
    if (textEl.value.trim() || images.length) {
      savedEl.style.opacity = "1";
      clearTimeout(savedFade);
      savedFade = setTimeout(() => (savedEl.style.opacity = "0"), 1500);
    }
  };
  const scheduleSave = () => {
    if (draftOff) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveNow, 600);
  };
  const showDraftNote = (show, message) => {
    draftNote.classList.toggle("hidden", !show);
    draftNote.classList.toggle("flex", show);
    if (message) draftText.textContent = message;
  };

  /* ---- form state ---- */
  const refresh = () => {
    const used = textEl.value.length;
    const left = TEXT_MAX - used;
    countEl.textContent = left <= 50 ? String(left) : "";
    countEl.style.color = left <= 20 ? "rgb(220,38,38)" : "";
    ringEl.style.background = `conic-gradient(${left <= 20 ? "rgb(220,38,38)" : "rgb(var(--c-primary-container,29 155 240))"} ${Math.round((used / TEXT_MAX) * 360)}deg, rgba(128,128,128,.25) 0deg)`;
    const pollOk = pollOn && cleanPoll().length >= 2;
    postBtn.disabled = posting || (pollOn && !pollOk) || (!textEl.value.trim() && !images.length && !video && !pollOk);
    addBtn.disabled = posting || !!video || images.length >= MAX_IMAGES;
    vidBtn.disabled = posting || images.length > 0 || !!video;
    textEl.disabled = posting;
    audBtn.disabled = posting;
    emojiBtn.disabled = posting;
    feelBtn.disabled = posting;
    pollBtn.disabled = posting;
    pollEl.querySelectorAll("input,button").forEach((el) => (el.disabled = posting));
    placeBtn.disabled = posting;
    photoLabel.textContent = images.length ? `${images.length}/${MAX_IMAGES}` : "";
    addBtn.title = images.length ? `Photo ${images.length}/${MAX_IMAGES}` : "Photo";
  };

  const renderPreviews = () => {
    previewsEl.className = `fz-previews grid ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-2 ${images.length ? "" : "hidden"}`;
    previewsEl.innerHTML = images
      .map(
        (image, index) => `
        <div class="relative ${images.length === 1 ? "" : "aspect-square"} rounded-xl overflow-hidden border border-slate-border bg-surface-container">
          <img src="${image.url}" alt="Photo ${index + 1}" class="${images.length === 1 ? "w-full max-h-80 object-cover block" : "absolute inset-0 w-full h-full object-cover"}" />
          <button type="button" class="fz-remove absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform" data-index="${index}" aria-label="Remove photo ${index + 1}">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
          ${images.length > 1 && index === 0 ? `<span class="fz-cover absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white font-label-sm text-label-sm">Cover</span>` : ""}
          <div class="fz-tools absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <span class="flex gap-1.5">
              ${images.length > 1 ? `<button type="button" class="fz-move w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30" data-index="${index}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="Move photo ${index + 1} earlier"><span class="material-symbols-outlined text-[18px]">arrow_back</span></button>
              <button type="button" class="fz-move w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30" data-index="${index}" data-dir="1" ${index === images.length - 1 ? "disabled" : ""} aria-label="Move photo ${index + 1} later"><span class="material-symbols-outlined text-[18px]">arrow_forward</span></button>` : ""}
            </span>
            <span class="flex gap-1.5">
            <button type="button" class="fz-crop w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform" data-index="${index}" aria-label="Crop photo ${index + 1}"><span class="material-symbols-outlined text-[18px]">crop</span></button>
            <button type="button" class="fz-rotate w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform" data-index="${index}" aria-label="Rotate photo ${index + 1}"><span class="material-symbols-outlined text-[18px]">rotate_right</span></button>
            </span>
          </div>
          <div class="fz-tile-ov hidden absolute inset-0 bg-black/55 flex-col items-center justify-center text-white font-label-lg text-label-lg" data-ov="${index}"></div>
        </div>`
      )
      .join("");
    refresh();
  };

  /* ---- progress display ---- */
  // state of each photo while uploading: "waiting" | "uploading" | "processing" | "done" | "failed"
  const showTile = (index, state, fraction = 0) => {
    const el = previewsEl.querySelector(`[data-ov="${index}"]`);
    if (!el) return;
    el.classList.remove("hidden");
    el.classList.add("flex");
    el.innerHTML =
      state === "done"
        ? `<span class="material-symbols-outlined text-[34px] text-emerald-300" style="font-variation-settings:'FILL' 1;">check_circle</span>`
        : state === "failed"
          ? `<span class="material-symbols-outlined text-[34px] text-red-300" style="font-variation-settings:'FILL' 1;">error</span><span class="text-[12px] mt-1">Failed</span>`
          : state === "processing"
            ? `<span class="text-[14px]">Processing...</span>`
            : `<span class="text-[22px] font-bold">${Math.round(fraction * 100)}%</span>`;
  };

  const hideTileOverlays = () => {
    previewsEl.querySelectorAll(".fz-tile-ov").forEach((el) => {
      el.classList.add("hidden");
      el.classList.remove("flex");
    });
  };

  /* ---- video (one per post) ---- */
  const dropVideo = () => {
    if (video) { URL.revokeObjectURL(video.url); if (video.coverUrl) URL.revokeObjectURL(video.coverUrl); }
    video = null;
    renderVideo();
    refresh();
  };

  function renderVideo() {
    vidBox.classList.toggle("hidden", !video);
    if (!video) { vidBox.innerHTML = ""; return; }
    const notice = previewNotice();
    vidBox.innerHTML = `
      <div class="rounded-2xl border border-slate-border overflow-hidden bg-black relative">
        <video src="${video.url}" poster="${video.coverUrl || ""}" controls playsinline preload="metadata" class="w-full max-h-96 block"></video>
        <button type="button" class="fz-vremove absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-90 transition-transform" aria-label="Remove video"><span class="material-symbols-outlined text-[18px]">close</span></button>
        <span class="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white font-label-sm text-label-sm">${formatDuration(video.duration)} · ${formatSize(video.file.size)}</span>
      </div>
      <div class="pt-2 space-y-1">
        <div class="flex items-center gap-2 text-slate-muted font-body-sm text-body-sm">
          <span class="material-symbols-outlined text-[18px]">image</span><span>Choose the cover picture</span>
          ${video.coverUrl ? `<img src="${video.coverUrl}" alt="Cover" class="ml-auto w-10 h-10 rounded-lg object-cover border border-slate-border" />` : ""}
        </div>
        <input type="range" class="fz-vcover w-full" min="0" max="${Math.max(0, Math.floor(video.duration * 10))}" value="${Math.round((video.coverAt || 0) * 10)}" ${posting ? "disabled" : ""} />
        ${notice ? `<p class="text-slate-subtle font-body-sm text-body-sm">${escapeHtml(notice)}</p>` : ""}
      </div>`;
    const range = vidBox.querySelector(".fz-vcover");
    let timer = null;
    range.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const at = Number(range.value) / 10;
        try {
          const blob = await captureFrame(video.file, at);
          if (!video) return;
          if (video.coverUrl) URL.revokeObjectURL(video.coverUrl);
          video.cover = blob; video.coverAt = at; video.coverUrl = URL.createObjectURL(blob);
          const poster = vidBox.querySelector("video"); if (poster) poster.poster = video.coverUrl;
          const thumb = vidBox.querySelector("img"); if (thumb) thumb.src = video.coverUrl;
        } catch (error) { /* keep the old cover */ }
      }, 250);
    });
    vidBox.querySelector(".fz-vremove").addEventListener("click", () => { if (!posting) dropVideo(); });
  }

  vidBtn.addEventListener("click", () => vFileEl.click());
  vFileEl.addEventListener("change", async () => {
    const file = vFileEl.files[0];
    vFileEl.value = "";
    if (!file || posting) return;
    const check = await checkVideoFile(file, LIMITS.post);
    if (!check.ok) { showToast(check.message); return; }
    let cover = null;
    try { cover = await captureFrame(file, 0); } catch (error) { /* a post without a cover is still fine */ }
    video = { file, url: URL.createObjectURL(file), duration: check.info.duration, cover, coverAt: 0, coverUrl: cover ? URL.createObjectURL(cover) : "" };
    renderVideo();
    refresh();
  });

  const setProgress = (fraction, title, sub) => {
    const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
    barEl.style.width = `${percent}%`;
    percentEl.textContent = `${percent}%`;
    if (title) titleEl.textContent = title;
    if (sub !== undefined) subEl.textContent = sub;
  };

  const setPosting = (value) => {
    posting = value;
    progressEl.classList.toggle("hidden", !value);
    previewsEl.querySelectorAll(".fz-remove, .fz-tools").forEach((el) => el.classList.toggle("hidden", value));
    if (!value) hideTileOverlays();
    refresh();
  };

  /* ---- events ---- */
  textEl.addEventListener("input", () => {
    refresh();
    scheduleSave();
  });

  container.querySelector(".fz-draft-discard").addEventListener("click", () => {
    if (posting) return;
    if (!confirm("Discard this draft?")) return;
    clearTimeout(draftTimer);
    textEl.value = "";
    images.forEach((image) => URL.revokeObjectURL(image.url));
    images = [];
    dropVideo();
    renderPreviews();
    clearDraft(uid);
    showDraftNote(false);
    showToast("Draft discarded");
  });

  // Leaving the app or the tab right away must not lose the last few letters
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && draftTimer) {
      clearTimeout(draftTimer);
      saveNow();
    }
  });

  // Bring back an unfinished post from last time
  loadDraft(uid).then((draft) => {
    if (!draft || draftOff || textEl.value.trim() || images.length) return;
    textEl.value = draft.text;
    audience = draft.audience;
    paintAudience();
    feeling = draft.feeling;
    place = draft.place;
    paintTags();
    if (draft.poll) { pollOn = true; pollOptions = draft.poll.length >= 2 ? draft.poll : [...draft.poll, ""]; renderPoll(); }
    draft.images.forEach((blob) => images.push({ blob, url: URL.createObjectURL(blob) }));
    renderPreviews();
    const photos = images.length ? ` with ${images.length} photo${images.length === 1 ? "" : "s"}` : "";
    showDraftNote(true, `Draft restored${photos}`);
  });
  addBtn.addEventListener("click", () => fileEl.click());

  // Turn a photo a quarter turn to the right (the picture itself is re-saved, so it is posted turned)
  const rotateBlob = async (blob) => {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;
    const g = canvas.getContext("2d");
    g.translate(canvas.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("rotate failed"))), "image/jpeg", 0.92));
  };

  previewsEl.addEventListener("click", async (event) => {
    if (posting) return;
    const move = event.target.closest(".fz-move");
    if (move) {
      const from = Number(move.dataset.index);
      const to = from + Number(move.dataset.dir);
      if (to < 0 || to >= images.length) return;
      [images[from], images[to]] = [images[to], images[from]];
      renderPreviews();
      scheduleSave();
      return;
    }
    const cropBtn = event.target.closest(".fz-crop");
    if (cropBtn) {
      const item = images[Number(cropBtn.dataset.index)];
      if (!item || posting) return;
      cropBtn.disabled = true;
      try {
        const blob = await openCropper(item.blob, {
          title: "Crop photo",
          maxSide: 1280,
          aspects: [
            { id: "orig", label: "Original", ratio: "auto" },
            { id: "sq", label: "1:1", ratio: 1 },
            { id: "45", label: "4:5", ratio: 4 / 5 },
            { id: "169", label: "16:9", ratio: 16 / 9 }
          ]
        });
        if (blob) {
          URL.revokeObjectURL(item.url);
          item.blob = blob;
          item.url = URL.createObjectURL(blob);
          renderPreviews();
          scheduleSave();
        } else cropBtn.disabled = false;
      } catch (error) {
        console.error(error);
        cropBtn.disabled = false;
        showToast("Could not crop the photo");
      }
      return;
    }
    const rotate = event.target.closest(".fz-rotate");
    if (rotate) {
      const index = Number(rotate.dataset.index);
      const item = images[index];
      if (!item) return;
      rotate.disabled = true;
      try {
        const blob = await rotateBlob(item.blob);
        URL.revokeObjectURL(item.url);
        item.blob = blob;
        item.url = URL.createObjectURL(blob);
        renderPreviews();
        scheduleSave();
      } catch (error) {
        console.error(error);
        rotate.disabled = false;
        showToast("Could not turn the photo");
      }
      return;
    }
    const button = event.target.closest(".fz-remove");
    if (!button || posting) return;
    const [removed] = images.splice(Number(button.dataset.index), 1);
    if (removed) URL.revokeObjectURL(removed.url);
    renderPreviews();
    scheduleSave();
  });

  container.querySelector(".fz-p-cancel").addEventListener("click", () => controller && controller.abort());

  fileEl.addEventListener("change", async () => {
    const files = Array.from(fileEl.files);
    fileEl.value = "";
    if (!files.length) return;

    const room = MAX_IMAGES - images.length;
    if (files.length > room) showToast(`You can add up to ${MAX_IMAGES} photos`);

    for (const file of files.slice(0, Math.max(room, 0))) {
      if (!file.type.startsWith("image/")) {
        showToast("Only photos can be added");
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        showToast(`A photo is too large (max ${MAX_FILE_MB} MB)`);
        continue;
      }
      try {
        const blob = await prepareImage(file);
        images.push({ blob, url: URL.createObjectURL(blob) });
      } catch (error) {
        console.error(error);
        showToast("Could not open one of the photos");
      }
    }
    renderPreviews();
    scheduleSave();
  });

  postBtn.addEventListener("click", async () => {
    const text = textEl.value.trim();
    const pollList = pollOn ? cleanPoll() : [];
    if (posting || (!text && !images.length && !video && pollList.length < 2) || (pollOn && pollList.length < 2)) return;

    // Adult content (sex posts and sex videos described in the text, caption or poll) can not be posted.
    // Nothing is uploaded or saved: the person can change the text and try again. (Pictures and videos themselves are caught by reports and flags in the feed.)
    if (adultCheck({ text, poll: pollList.length >= 2 ? { options: pollList } : undefined }).level === "blocked") {
      showToast("This post can't be shared: adult content is not allowed on FreeZone BD");
      return;
    }

    // Firebase Storage is not connected yet: show how it will look, but do not post
    if (video && !storageReady()) { showToast("Preview only. Videos can be posted when Firebase Storage is connected."); return; }

    setPosting(true);
    controller = new AbortController();

    try {
      /* 0. Upload the video and its cover picture */
      let videoURL = "", thumbURL = "";
      if (video) {
        const { uploadVideo, uploadThumb } = await import("./storage.js");
        setProgress(0, "Uploading video", "Please keep this page open");
        videoURL = await uploadVideo(video.file, { uid: currentUser.uid, kind: "posts", signal: controller.signal, onPrepare: (f) => setProgress(f * 0.3, "Making the video smaller", `${Math.round(f * 100)}%  (faster upload, less data)`), onProgress: (f) => setProgress(0.3 + f * 0.65, "Uploading video", `${Math.round(f * 100)}%`) });
        if (video.cover) { try { thumbURL = await uploadThumb(video.cover, { uid: currentUser.uid, kind: "posts", signal: controller.signal }); } catch (error) { if (error && error.name === "AbortError") throw error; } }
      }

      /* 1. Upload every photo at the same time, keeping their order */
      let urls = [];
      if (images.length) {
        const progress = images.map(() => 0);
        const total = images.length;
        const overall = () => progress.reduce((sum, value) => sum + value, 0) / total;
        const finished = () => progress.filter((value) => value >= 1).length;

        setProgress(0, "Uploading photos", `0 of ${total} photos done`);
        images.forEach((image, index) => showTile(index, "uploading", 0));

        const results = await Promise.allSettled(
          images.map((image, index) =>
            uploadToImgbb(image.blob, `photo-${index + 1}.jpg`, {
              signal: controller.signal,
              onProgress: (fraction) => {
                progress[index] = fraction;
                // The bytes are sent, now imgbb is saving the photo
                showTile(index, fraction >= 1 ? "processing" : "uploading", fraction);
                setProgress(overall() * 0.97, "Uploading photos", `${finished()} of ${total} photos done`);
              }
            }).then(
              (url) => {
                showTile(index, "done");
                return url;
              },
              (error) => {
                showTile(index, error && error.name === "AbortError" ? "uploading" : "failed", progress[index]);
                throw error;
              }
            )
          )
        );

        const cancelled = results.some((result) => result.status === "rejected" && result.reason && result.reason.name === "AbortError");
        if (cancelled) {
          showToast("Upload cancelled");
          setPosting(false);
          return;
        }

        urls = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
        const failed = total - urls.length;

        if (failed > 0) {
          console.error("Photo upload failed:", results.filter((result) => result.status === "rejected"));
          const message = urls.length
            ? `${failed}টি ছবি আপলোড হয়নি। বাকি ${urls.length}টি ছবি নিয়ে পোস্ট করবেন?\n\n${failed} photo(s) failed to upload. Post with the other ${urls.length}?`
            : "ছবি আপলোড হয়নি। ছবি ছাড়া শুধু লেখা পোস্ট করবেন?\n\nImage upload failed. Post the text without the photos?";
          if ((!text && !urls.length) || !confirm(message)) {
            setPosting(false);
            return;
          }
        }
      }

      /* 2. Save the post */
      controller = null;
      container.querySelector(".fz-p-cancel").classList.add("hidden"); // too late to cancel now
      setProgress(1, "Publishing your post", "Almost done...");

      // Who is posting: if the profile was not loaded when this page opened, read it now (so a post is never saved as "You")
      let author = profile;
      if (!ctx.currentProfile || !ctx.currentProfile.name) {
        try {
          const mine = await get(ref(db, `users/${currentUser.uid}`));
          if (mine.exists()) author = { ...profile, ...mine.val() };
        } catch (error) { /* keep what we have */ }
      }
      const postRef = push(ref(db, "posts"));
      await set(postRef, {
        uid: currentUser.uid,
        name: author.name || currentUser.displayName || "FreeZone User",
        username: author.username || "",
        photoURL: author.photoURL || "",
        text,
        imageURL: urls[0] || "", // the first photo, for older parts of the app
        ...(urls.length ? { imageURLs: urls } : {}),
        ...(videoURL ? { videoURL, videoDuration: Math.round(video.duration), ...(thumbURL ? { videoThumb: thumbURL } : {}) } : {}),
        ...(audience !== "public" ? { audience } : {}),
        ...(feeling ? { feeling } : {}),
        ...(place ? { place } : {}),
        ...(pollList.length >= 2 ? { poll: { options: pollList } } : {}),
        createdAt: serverTimestamp(),
        likesCount: 0,
        commentsCount: 0
      });
      // #tag index: best effort, so a missing rule can never stop the post itself
      try {
        const index = tagIndexUpdates(postRef.key, "", text);
        if (Object.keys(index).length) await update(ref(db), index);
      } catch (error) {
        console.warn("Could not save the #tag index:", error);
      }

      draftOff = true; // published: the draft is no longer needed
      clearTimeout(draftTimer);
      await clearDraft(uid);
      images.forEach((image) => URL.revokeObjectURL(image.url));
      dropVideo();
      showToast("Posted");
      if (ctx.closePage) ctx.closePage();
      else container.innerHTML = "";
    } catch (error) {
      if (error && error.name === "AbortError") { showToast("Upload cancelled"); setPosting(false); return; }
      console.error(error);
      showToast(error.code === "PERMISSION_DENIED" ? "Could not post: database rules block it" : ["storage-full", "sign-failed", "upload-failed", "network", "no-login", "no-storage"].includes(error.code) ? "Could not post. " + error.message : "Could not post right now. Try again.");
      container.querySelector(".fz-p-cancel")?.classList.remove("hidden");
      setPosting(false);
    }
  });
}
