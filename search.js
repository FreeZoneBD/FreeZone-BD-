// FreeZone BD - search posts. Looks through the newest posts (text, name, @username, feeling, place, #tags).
// Opened from the search icon in the feed header. ctx: { db, currentUser, followingIds, postActions, savedPostIds, setTitle }
import { ref, get, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, createPostCard, canViewPost, pollOptionsOf } from "./post.js";
import { isBlocked } from "./block.js";
import { ensurePrivacy } from "./privacy.js";
import { isMuted } from "./mute.js";
import { extractTags, normalizeTag } from "./hashtags.js";

const SCAN = 400;   // how many newest posts are searched
const PAGE = 15;    // results shown at a time

const hasPhoto = (post) => !!(post.imageURL || (post.imageURLs && Object.keys(post.imageURLs).length));
const hasPoll = (post) => { try { return pollOptionsOf(post).length > 0; } catch (error) { return !!post.poll; } };

// All words must be found (any order). A word starting with # must be a real hashtag of the post.
export function matchPost(post, queryText) {
  const words = String(queryText || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const tags = extractTags(post.text);
  const hay = [post.text, post.name, post.username, post.feeling, post.place].filter(Boolean).join(" \n ").toLowerCase();
  return words.every((word) => {
    if (word.startsWith("#")) {
      const tag = normalizeTag(word);
      return !!tag && tags.includes(tag);
    }
    return hay.includes(word);
  });
}

// Hashtags used most in the last 7 days (all scanned posts if the week is empty). Each post counts a tag once.
export function trendingTags(posts, limit = 10, now = Date.now()) {
  const week = posts.filter((post) => (post.createdAt || 0) >= now - 7 * 86400000);
  const pool = week.length ? week : posts;
  const stats = new Map();
  pool.forEach((post) => extractTags(post.text).forEach((tag) => {
    const row = stats.get(tag) || { tag, count: 0, last: 0 };
    row.count += 1;
    row.last = Math.max(row.last, post.createdAt || 0);
    stats.set(tag, row);
  }));
  return [...stats.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, limit);
}

export async function mount(container, ctx = {}) {
  const { db, currentUser, followingIds = {}, postActions = {} } = ctx;
  ctx.setTitle?.("Search");
  if (!db || !currentUser) {
    container.innerHTML = `<p class="text-center text-slate-muted text-sm py-16 px-6">Search is not available.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="sticky top-0 z-10 bg-background px-4 pt-3 pb-2 border-b border-slate-border/50">
      <div class="flex items-center gap-2 bg-surface-container-low rounded-full px-4 border border-transparent focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/15 transition-all">
        <span class="material-symbols-outlined text-[20px] text-slate-subtle">search</span>
        <input class="fz-s-input flex-1 min-w-0 bg-transparent py-2.5 text-body-md text-body-md outline-none" type="search" maxlength="60" placeholder="Search posts, people, #tags" autocomplete="off" />
        <button type="button" class="fz-s-clear w-7 h-7 rounded-full items-center justify-center text-slate-subtle hover:bg-surface-container" aria-label="Clear" style="display:none"><span class="material-symbols-outlined text-[18px]">close</span></button>
      </div>
      <div class="fz-s-chips flex gap-2 mt-2">
        ${[["all", "All"], ["photo", "Photos"], ["poll", "Polls"]].map(([id, label]) => `<button type="button" class="fz-s-chip px-3.5 py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all" data-f="${id}">${label}</button>`).join("")}
      </div>
    </div>
    <div class="fz-s-body pb-10"></div>`;
  const input = container.querySelector(".fz-s-input");
  const clearBtn = container.querySelector(".fz-s-clear");
  const body = container.querySelector(".fz-s-body");
  let filter = "all";
  let posts = null;      // the newest posts, loaded once
  let loadError = false;
  let shown = PAGE;
  let timer = null;

  const paintChips = () => container.querySelectorAll(".fz-s-chip").forEach((chip) => {
    const on = chip.dataset.f === filter;
    chip.className = "fz-s-chip px-3.5 py-1.5 rounded-full font-label-md text-label-md font-semibold transition-all " + (on ? "bg-primary-container text-white" : "bg-surface-container text-on-surface-variant");
  });

  const note = (html) => { body.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-14 px-6">${html}</p>`; };

  const run = () => {
    const text = input.value.trim();
    clearBtn.style.display = text ? "flex" : "none";
    if (!text) {
      const seen = posts ? posts.filter((post) => !isBlocked(post.uid) && !isMuted(post.uid) && canViewPost(post, currentUser.uid, followingIds)) : [];
      const trends = trendingTags(seen);
      if (!trends.length) { note("Type a word, a name or a #tag to find posts."); return; }
      body.innerHTML = `<p class="px-4 pt-4 pb-2 font-label-lg text-label-lg text-on-surface font-semibold flex items-center gap-1.5"><span class="material-symbols-outlined text-[20px] text-primary">trending_up</span>Trending</p>
        <div class="fz-trends flex flex-col">${trends.map((row, i) => `<button type="button" class="fz-trend text-left px-4 py-3 hover:bg-surface-container active:bg-surface-container transition-colors" data-tag="${escapeHtml(row.tag)}"><span class="block font-label-md text-label-md text-slate-muted">${i + 1} · Trending</span><span class="block font-body-lg text-body-lg text-on-surface font-semibold break-words">#${escapeHtml(row.tag)}</span><span class="block font-label-md text-label-md text-slate-muted">${row.count} post${row.count === 1 ? "" : "s"}</span></button>`).join("")}</div>`;
      return;
    }
    if (loadError) { note("Could not load posts. Try again."); return; }
    if (!posts) { note("Searching..."); return; }
    const results = posts.filter((post) =>
      !isBlocked(post.uid) && !isMuted(post.uid) && canViewPost(post, currentUser.uid, followingIds) &&
      (filter === "all" || (filter === "photo" ? hasPhoto(post) : hasPoll(post))) &&
      matchPost(post, text));
    if (!results.length) { note(`No posts found for "${escapeHtml(text)}".<br><span class="text-[13px]">Searched the newest ${posts.length} posts.</span>`); return; }
    body.innerHTML = `<p class="px-4 pt-3 pb-2 font-label-md text-label-md text-slate-muted">${results.length} result${results.length === 1 ? "" : "s"}</p><div class="fz-s-list flex flex-col gap-2"></div>`;
    const list = body.querySelector(".fz-s-list");
    results.slice(0, shown).forEach((post) =>
      list.appendChild(createPostCard(post, { ...postActions, currentUserUid: currentUser.uid, savedPostIds: ctx.savedPostIds, followingIds, isBlocked })));
    if (results.length > shown) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "mx-auto my-3 px-5 py-2 rounded-full bg-surface-container text-on-surface font-label-lg text-label-lg font-semibold active:scale-95 transition-all";
      more.textContent = "Show more";
      more.addEventListener("click", () => { shown += PAGE; run(); });
      list.after(more);
    }
  };

  input.addEventListener("input", () => { shown = PAGE; clearTimeout(timer); timer = setTimeout(run, 250); });
  clearBtn.addEventListener("click", () => { input.value = ""; shown = PAGE; run(); input.focus(); });
  container.querySelector(".fz-s-chips").addEventListener("click", (event) => {
    const chip = event.target.closest(".fz-s-chip");
    if (!chip) return;
    filter = chip.dataset.f; shown = PAGE; paintChips(); run();
  });
  body.addEventListener("click", (event) => {
    const item = event.target.closest(".fz-trend");
    if (!item) return;
    if (postActions.onHashtag) postActions.onHashtag(item.dataset.tag);
    else { input.value = "#" + item.dataset.tag; shown = PAGE; run(); }
  });
  paintChips();
  run();
  input.focus();

  try {
    const snap = await get(query(ref(db, "posts"), orderByChild("createdAt"), limitToLast(SCAN)));
    const list = [];
    snap.forEach((child) => { list.push({ id: child.key, ...child.val() }); });
    posts = list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    await ensurePrivacy(db, posts.map((post) => post.uid)); // posts of private accounts are not searchable by strangers
  } catch (error) {
    console.error(error);
    loadError = true;
  }
  run();
}
