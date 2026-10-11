// FreeZone BD - my interest profile (feed algorithm part 6).
// What I like / comment / share / save / follow / view / hide changes a small profile:
//   { tags: {tag: {s, t}}, authors: {uid: {s, t}}, kinds: {photo|text|poll: {s, t}} }   s = score, t = time
// It is kept on this phone (localStorage) and copied to users' own private place `userInterests/{uid}`
// (only I can read or write it), so a new phone starts with my taste. Saves are grouped (every 20 s, and when the page closes).
// The maths (how much each action is worth, fading) lives in feed-algorithm.js (learnInterest).

import { ref, get, set } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { learnInterest, emptyInterests, DEFAULT_CONFIG } from "./feed-algorithm.js";

const BAD_KEY = /[.$#\[\]\/]/;
const KINDS = ["photo", "text", "poll"];
const SAVE_EVERY = 20000;

function readLocal(uid) {
  try {
    const data = JSON.parse(localStorage.getItem(`fz_interests_${uid}`) || "null");
    if (data && typeof data === "object") return { tags: data.tags || {}, authors: data.authors || {}, kinds: data.kinds || {} };
  } catch (error) { /* broken value: start again */ }
  return emptyInterests();
}

const clean = (map, allow) => {
  const out = {};
  Object.keys(map || {}).forEach((key) => {
    const e = map[key];
    if (BAD_KEY.test(key) || !key || key.length > 60 || (allow && !allow.includes(key))) return;
    if (e && Number.isFinite(e.s) && Number.isFinite(e.t)) out[key] = { s: e.s, t: e.t };
  });
  return out;
};

/** Takes the newer entry of each key */
function merge(into, other) {
  ["tags", "authors", "kinds"].forEach((part) => {
    Object.keys(other[part] || {}).forEach((key) => {
      const a = into[part][key], b = other[part][key];
      if (!a || (b && b.t > a.t)) into[part][key] = b;
    });
  });
}

export function createInterestStore({ db, uid, config = DEFAULT_CONFIG }) {
  const profile = readLocal(uid);
  let dirty = false;
  let timer = null;

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty || !uid) return;
    dirty = false;
    try { localStorage.setItem(`fz_interests_${uid}`, JSON.stringify(profile)); } catch (error) { /* full */ }
    const body = { tags: clean(profile.tags), authors: clean(profile.authors), kinds: clean(profile.kinds, KINDS), updatedAt: Date.now() };
    set(ref(db, `userInterests/${uid}`), body).catch(() => {});
  };
  window.addEventListener("pagehide", flush);

  // My profile from another phone: merge it in (the newer entry of each key wins)
  get(ref(db, `userInterests/${uid}`)).then((snap) => {
    if (!snap.exists()) return;
    const remote = snap.val() || {};
    merge(profile, { tags: clean(remote.tags), authors: clean(remote.authors), kinds: clean(remote.kinds, KINDS) });
    try { localStorage.setItem(`fz_interests_${uid}`, JSON.stringify(profile)); } catch (error) { /* full */ }
  }).catch(() => {});

  return {
    profile,
    learn(post, action) {
      if (!post || !uid || post.uid === uid) return; // my own posts say nothing about my taste
      if (!learnInterest(profile, post, action, config)) return;
      dirty = true;
      try { localStorage.setItem(`fz_interests_${uid}`, JSON.stringify(profile)); } catch (error) { /* full */ }
      if (!timer) timer = setTimeout(flush, SAVE_EVERY);
    },
    flush
  };
}
