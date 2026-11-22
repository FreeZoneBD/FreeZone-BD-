// FreeZone BD - "a new version is available" message (Android app only; loaded by native.js).
// The owner sets these values in Firebase Realtime Database (path appConfig):
//   latestVersionCode  number  - newest build on Google Play (the build number, same as the CI run number)
//   minVersionCode     number  - older builds MUST update (optional)
//   message            text    - optional line shown in the box
// A build older than latestVersionCode sees a box it can close (shown once per version).
// A build older than minVersionCode sees a box it cannot close.
import { db } from "./config.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const PLAY_URL = "market://details?id=com.freezonebd.app";
const WEB_URL = "https://play.google.com/store/apps/details?id=com.freezonebd.app";

// pure decision, easy to test: "none" | "soft" | "force"
export function decide(build, cfg, dismissed) {
  const b = Number(build);
  if (!Number.isFinite(b) || b <= 0 || !cfg || typeof cfg !== "object") return "none";
  const min = Number(cfg.minVersionCode) || 0;
  const latest = Number(cfg.latestVersionCode) || 0;
  if (min && b < min) return "force";
  if (latest && b < latest && Number(dismissed) !== latest) return "soft";
  return "none";
}

function openStore() {
  try { location.href = PLAY_URL; } catch (e) { /* ignore */ }
  setTimeout(() => { try { window.open(WEB_URL, "_blank"); } catch (e) { /* ignore */ } }, 1200);
}

function show(mode, cfg) {
  const wrap = document.createElement("div");
  wrap.setAttribute("data-close-none", "");
  wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;border-radius:16px;max-width:340px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3)";
  const h = document.createElement("div");
  h.textContent = mode === "force" ? "Please update FreeZone BD" : "New version available";
  h.style.cssText = "font-weight:700;font-size:18px;margin-bottom:8px";
  const p = document.createElement("div");
  p.textContent = (cfg.message && String(cfg.message).slice(0, 200)) || (mode === "force" ? "This version is too old. Update to keep using the app." : "A newer version with improvements is on Google Play.");
  p.style.cssText = "font-size:14px;line-height:1.45;color:#444;margin-bottom:16px";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
  if (mode === "soft") {
    const later = document.createElement("button");
    later.textContent = "Later";
    later.style.cssText = "padding:10px 14px;border:0;background:#eee;border-radius:10px;font-weight:600";
    later.onclick = () => {
      try { localStorage.setItem("fzUpdateDismissed", String(Number(cfg.latestVersionCode))); } catch (e) { /* ignore */ }
      wrap.remove();
    };
    row.appendChild(later);
  }
  const go = document.createElement("button");
  go.textContent = "Update";
  go.style.cssText = "padding:10px 16px;border:0;background:#2563eb;color:#fff;border-radius:10px;font-weight:700";
  go.onclick = openStore;
  row.appendChild(go);
  box.append(h, p, row);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
}

export async function checkForUpdate() {
  try {
    const cap = window.Capacitor;
    const App = cap && cap.Plugins && cap.Plugins.App;
    if (!App || !App.getInfo) return;
    const info = await App.getInfo();
    const snap = await get(ref(db, "appConfig"));
    const cfg = snap.val();
    let dismissed = 0;
    try { dismissed = Number(localStorage.getItem("fzUpdateDismissed")) || 0; } catch (e) { /* ignore */ }
    const mode = decide(info && info.build, cfg, dismissed);
    if (mode !== "none") show(mode, cfg);
  } catch (e) { /* offline or no config: no message */ }
}

if (typeof window !== "undefined" && window.Capacitor) setTimeout(checkForUpdate, 2500);
