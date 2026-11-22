// FreeZone BD - anonymous per-post statistics for "Post insights".
// postStats/{postId}/{hourNumber}/{field} = a counter that goes up by exactly 1 per event (the database rules check that).
//   v  = a view            vf = a view by someone who follows the author
//   u  = a new viewer      uf = a new viewer who follows the author   ("new" = first time on this phone)
//   p  = the author's profile opened from this post       fo = a follow made from this post
// hourNumber = floor(time / 1 hour). Nobody's name or id is stored here, so the owner only ever sees numbers.
// Only the owner of the post (and admins) can read them. My own posts are never counted. A failed save is dropped.
import { ref, update, increment } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const EVER_KEY = "fz_seen_ever";
const EVER_MAX = 2000;
const hour = () => String(Math.floor(Date.now() / 3600000)).padStart(6, "0");

function loadEver() {
  try { return new Set(JSON.parse(localStorage.getItem(EVER_KEY) || "[]")); } catch (e) { return new Set(); }
}
function saveEver(set) {
  try { localStorage.setItem(EVER_KEY, JSON.stringify([...set].slice(-EVER_MAX))); } catch (e) { /* storage full or blocked */ }
}

/** recordViews(db, me, [{ id, uid }], followingIds) - called by feed.js together with the views counter. */
export function recordViews(db, me, posts, followingIds = {}) {
  if (!db || !me || !posts || !posts.length) return Promise.resolve();
  const ever = loadEver();
  const h = hour();
  const updates = {};
  posts.forEach((p) => {
    if (!p || !p.id || !p.uid || p.uid === me) return;
    const fol = !!followingIds[p.uid];
    updates[`postStats/${p.id}/${h}/v`] = increment(1);
    if (fol) updates[`postStats/${p.id}/${h}/vf`] = increment(1);
    if (!ever.has(p.id)) {
      ever.add(p.id);
      updates[`postStats/${p.id}/${h}/u`] = increment(1);
      if (fol) updates[`postStats/${p.id}/${h}/uf`] = increment(1);
    }
  });
  saveEver(ever);
  if (!Object.keys(updates).length) return Promise.resolve();
  return update(ref(db), updates).catch(() => {}); // a view is not important enough to retry
}

/** start(db, me): listens for "fz:post-action" ({ kind: "visit" | "follow", postId, authorUid }) sent by post.js / feed.js */
let started = false;
export function start(db, me) {
  if (started || !db || !me) return;
  started = true;
  const visited = new Set();
  document.addEventListener("fz:post-action", (event) => {
    const d = event.detail || {};
    if (!d.postId || !d.authorUid || d.authorUid === me) return;
    const field = d.kind === "visit" ? "p" : d.kind === "follow" ? "fo" : "";
    if (!field) return;
    if (field === "p") { if (visited.has(d.postId)) return; visited.add(d.postId); }
    update(ref(db), { [`postStats/${d.postId}/${hour()}/${field}`]: increment(1) }).catch(() => {});
  });
}
