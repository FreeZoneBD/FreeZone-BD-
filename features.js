// FreeZone BD - the feature gate (video, Reels, voice messages, ...).
//
// HOW IT WORKS
//   Any element with  data-feature="reels"  (or postVideo, storyVideo, chatVideo, voiceMessage, profileVideos)
//   is controlled from here, nothing else is needed on the page. Each feature has one of three modes:
//     "on"     (the default) the real feature opens, so the admin can see every video system.
//              Until a feature has its screen built, or while Storage is not connected, the screens run in preview mode.
//     "soon"   a plain white full page with "Coming soon" opens instead (the real code never runs)
//     "hidden" the element is not shown at all
//   The admin sets the mode per feature in the admin site (Features page). It is read live: a change shows up at once.
//   Data:  config/features = { reels: "soon", postVideo: "hidden", ... }   (missing = "on")
//
// A feature element is "real" when it has a data-page (feed.js opens that page) or a handler registered with
// registerFeature(key, fn). A feature that is "on" but not built yet falls back to the Coming soon page, so a tap is never dead.
//
// TURNING UPLOADS ON (later): in config.js add
//     import { getStorage } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";
//     export const storage = getStorage(app);
//   storageReady() becomes true and the screens stop showing the "preview" notice and really upload.
//
// For code: featureMode("reels"), featureOn("reels") ("on" or not hidden/soon), storageReady(), showComingSoon("reels"),
// registerFeature("reels", fn), previewNotice() -> text to show while Storage is not connected.

import * as cfg from "./config.js"; // a namespace import: a missing `storage` export is just undefined (no error)
import * as appInfo from "./app-info.js"; // videos are uploaded through the Worker (Cloudinary) when PUSH_WORKER_URL is set
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

export const FEATURES = {
  postVideo:     { label: "Video posts",     icon: "videocam",          note: "Share videos in your posts." },
  storyVideo:    { label: "Video stories",   icon: "movie",             note: "Add a short video as your story." },
  chatVideo:     { label: "Videos in chat",  icon: "video_library",     note: "Send videos to your friends in chat." },
  voiceMessage:  { label: "Voice messages",  icon: "mic",               note: "Send voice messages in chat." },
  profileVideos: { label: "Profile videos",  icon: "video_camera_front", note: "A Videos tab on every profile." },
  reels:         { label: "Reels",           icon: "smart_display",     note: "Watch short videos, one swipe at a time." }
};

const listeners = new Set();
const MODES = ["on", "soon", "hidden"];
const state = {
  storage: !!(appInfo.PUSH_WORKER_URL || cfg.storage), // is video storage connected? (the Worker + Cloudinary, see storage.js)
  admin: {}               // config/features: only the features that are NOT "on"
};
const handlers = new Map();

export const storageReady = () => state.storage;
export const featureMode = (key) => (FEATURES[key] ? state.admin[key] || "on" : "hidden");
export const featureVisible = (key) => featureMode(key) !== "hidden";
export const featureOn = (key) => featureMode(key) === "on";
export const onFeaturesChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const registerFeature = (key, fn) => { handlers.set(key, fn); };
export const previewNotice = () => (state.storage ? "" : "Preview: videos can be uploaded when video storage is connected.");

/* ---------------------------------------------------------------
   Show / hide the elements
---------------------------------------------------------------- */
function injectStyle() {
  if (document.getElementById("fz-features-style")) return;
  const style = document.createElement("style");
  style.id = "fz-features-style";
  style.textContent = `[data-feature][data-fz-off] { display: none !important; }
    .fz-soon-sheet { animation: fzSoonUp .22s ease-out; }
    @keyframes fzSoonUp { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .fz-soon-sheet { animation: none; } }`;
  document.head.appendChild(style);
}

function apply(root = document) {
  root.querySelectorAll("[data-feature]").forEach((el) => {
    const key = el.dataset.feature;
    if (featureVisible(key)) el.removeAttribute("data-fz-off");
    else el.setAttribute("data-fz-off", "");
    el.toggleAttribute("data-fz-live", featureOn(key) && state.storage);
  });
}

function changed() {
  apply();
  listeners.forEach((fn) => { try { fn(); } catch (error) { /* a listener must never break the gate */ } });
}

/* ---------------------------------------------------------------
   The "Coming soon" page: a plain white full page
---------------------------------------------------------------- */
export function showComingSoon(key) {
  const info = FEATURES[key] || { label: "This feature", icon: "schedule", note: "" };
  const old = document.getElementById("fzSoon");
  if (old) old.remove();

  const page = document.createElement("div");
  page.id = "fzSoon";
  // inline styles: the page must look right even when Tailwind has not loaded
  page.style.cssText = "position:fixed;inset:0;z-index:9999;background:#fff;color:#0f1419;display:flex;flex-direction:column;font-family:Inter,system-ui,sans-serif;";
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-modal", "true");
  page.setAttribute("aria-label", `${info.label} - coming soon`);
  page.innerHTML = `
    <div style="height:52px;display:flex;align-items:center;padding:0 8px;">
      <button type="button" class="fz-soon-back" aria-label="Back" style="width:40px;height:40px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:none;border:0;color:inherit;cursor:pointer;">
        <span class="material-symbols-outlined" style="font-size:24px;">arrow_back</span>
      </button>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 32px 72px;">
      <span class="material-symbols-outlined fz-soon-icon" style="font-size:64px;color:#9aa4ae;"></span>
      <h1 class="fz-soon-title" style="margin:16px 0 4px;font-size:26px;line-height:34px;font-weight:800;letter-spacing:-0.02em;">Coming soon</h1>
      <p class="fz-soon-label" style="margin:0;font-size:16px;line-height:24px;font-weight:600;"></p>
      <p class="fz-soon-note" style="margin:6px 0 0;font-size:14px;line-height:20px;color:#6b7580;max-width:280px;"></p>
    </div>`;
  // text goes in as text (never as HTML)
  page.querySelector(".fz-soon-icon").textContent = info.icon;
  page.querySelector(".fz-soon-label").textContent = info.label;
  page.querySelector(".fz-soon-note").textContent = "We are working on it. It will be here soon.";

  const close = () => { page.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  page.addEventListener("click", (event) => { if (event.target.closest(".fz-soon-back")) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(page);
  page.querySelector(".fz-soon-back").focus();
}

/* ---------------------------------------------------------------
   Start
---------------------------------------------------------------- */
let started = false;
function start() {
  if (started) return;
  started = true;
  injectStyle();
  apply();

  // Taps: "soon" (or a feature that is not built yet) -> the Coming soon page; the real handler is stopped (capture phase = first)
  const gate = (event) => {
    const el = event.target.closest && event.target.closest("[data-feature]");
    if (!el) return;
    const key = el.dataset.feature;
    const mode = featureMode(key);
    if (mode === "on" && handlers.has(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handlers.get(key)(el, event);
      return;
    }
    if (mode === "on" && (el.dataset.page || el.hasAttribute("data-feature-ready"))) return; // a real page or code exists: let it run
    event.preventDefault();
    event.stopImmediatePropagation();
    if (mode !== "hidden") showComingSoon(key);
  };
  document.addEventListener("click", gate, true);
  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest && event.target.closest("[data-feature]")) gate(event);
  }, true);

  // Elements that appear later (a profile tab, a chat bar...) are handled too
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches("[data-feature]")) apply(node.parentNode || document);
        else if (node.querySelector && node.querySelector("[data-feature]")) apply(node);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // The admin's switches (live). Until they arrive, every feature is "on".
  if (cfg.auth && cfg.db) {
    let watching = false;
    onAuthStateChanged(cfg.auth, (user) => {
      if (!user || watching) return;
      watching = true;
      onValue(
        ref(cfg.db, "config/features"),
        (snap) => {
          const value = snap.exists() && snap.val() && typeof snap.val() === "object" ? snap.val() : {};
          const next = {};
          Object.keys(FEATURES).forEach((key) => { if (MODES.includes(value[key]) && value[key] !== "on") next[key] = value[key]; });
          state.admin = next;
          changed();
        },
        () => { /* no permission or no network: everything stays visible */ }
      );
    });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
