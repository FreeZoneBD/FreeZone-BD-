// FreeZone BD - Creator Program: counting the views of approved creators.
//
// A view is written ONLY for an approved creator (monetized/{uid}) and never for my own posts:
//   creatorViews/{YYYY-MM}/{creatorUid}/{viewerUid} = { v: video views, p: photo / text post views, f: profile visits }
// One small record per viewer per month: one person can never count more than the cap, a new account (under 24 hours) is refused by the
// database rules, and the admin counts unique viewers. The admin turns these into money in the panel (Creator earnings).
// Kinds:  "v" a video was watched   "p" a post was seen   "f" a profile was opened
import { ref, update, increment } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { isMonetized } from "./monetize.js";

const KINDS = ["v", "p", "f"];
const DAY_KEY = "fz_cv";
const FLUSH_MS = 8000;

// The month in Bangladesh time (UTC+6), the same in the app and in the admin panel
export const monthKey = (now = Date.now()) => new Date(now + 6 * 3600 * 1000).toISOString().slice(0, 7);

const pending = new Map(); // "creator|kind" -> count
let ctx = null;
let timer = null;

// Never count the same thing twice on the same day on this phone (the database also caps each person)
function firstToday(key) {
  const today = monthKey() + "|" + new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
  let state = { day: "", keys: [] };
  try { state = JSON.parse(localStorage.getItem(DAY_KEY) || "{}") || state; } catch (error) { /* ignore */ }
  if (state.day !== today || !Array.isArray(state.keys)) state = { day: today, keys: [] };
  if (state.keys.includes(key)) return false;
  state.keys.push(key);
  if (state.keys.length > 800) state.keys = state.keys.slice(-800);
  try { localStorage.setItem(DAY_KEY, JSON.stringify(state)); } catch (error) { /* storage full or blocked */ }
  return true;
}

async function flush() {
  timer = null;
  if (!ctx || !pending.size) return;
  const batch = [...pending.entries()];
  pending.clear();
  const month = monthKey();
  const byCreator = new Map();
  batch.forEach(([k, n]) => {
    const [creator, kind] = k.split("|");
    if (!byCreator.has(creator)) byCreator.set(creator, {});
    byCreator.get(creator)[kind] = increment(n);
  });
  // one write per creator: a refused one (cap reached, rules not published yet) never stops the others
  await Promise.allSettled([...byCreator.entries()].map(([creator, fields]) => update(ref(ctx.db, `creatorViews/${month}/${creator}/${ctx.me}`), fields)));
}

const flushNow = () => { if (timer) { clearTimeout(timer); timer = null; } flush(); };

/** recordView(db, myUid, creatorUid, "v" | "p" | "f", uniqueKey) */
export function recordView(db, me, creatorUid, kind, key) {
  if (!db || !me || !creatorUid || creatorUid === me || !KINDS.includes(kind)) return;
  if (!isMonetized(creatorUid)) return;
  if (!firstToday(`${kind}:${key || creatorUid}`)) return;
  if (!ctx) {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });
    window.addEventListener("pagehide", flushNow);
  }
  ctx = { db, me };
  const k = `${creatorUid}|${kind}`;
  pending.set(k, (pending.get(k) || 0) + 1);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}
