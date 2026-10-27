// FreeZone BD - Search: people, posts, photos, polls and #tags.
// Opened from the search icon in the feed header. ctx: { db, currentUser, followingIds, postActions, savedPostIds,
//   onToggleFollow, onOpenProfile, setHeader, goBack }
//
// Empty search box : Recent searches (and people I opened), Trending #tags, People you may know.
// With text        : filter chips All / People / Posts / Photos / Polls.
//   People  - found by the beginning of the name or @username (needs users .indexOn username / name / nameLower)
//   Posts   - looks through the newest posts (text, name, @username, feeling, place, #tags)
import {
  ref, get, query, orderByChild, limitToLast, limitToFirst, startAt, endAt
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, avatarHtml, createPostCard, canViewPost, pollOptionsOf, showToast } from "./post.js";
import { isBlocked } from "./block.js";
import { ensurePrivacy, isRequested, privacyKnown } from "./privacy.js";
import { isMuted } from "./mute.js";
import { extractTags, normalizeTag } from "./hashtags.js";
import { pickSuggestions } from "./suggest.js";

const SCAN = 200;          // how many newest posts are searched
const PAGE = 15;           // post results shown at a time
const PEOPLE_LIMIT = 20;   // people found per search
const PEOPLE_MIN = 2;      // letters needed before people are searched
const RECENT_KEY = "fz_recent_searches";
const RECENT_MAX = 12;
const RECENT_SHOWN = 5;

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

/* Recent searches (kept on this phone): { t:"q", text } or { t:"u", uid, name, username, photoURL } */
function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((r) => r && (r.t === "q" ? r.text : r.t === "u" && r.uid)) : [];
  } catch (error) { return []; }
}
function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (error) { /* just not remembered */ }
}
const sameRecent = (a, b) => a.t === b.t && (a.t === "q" ? a.text.toLowerCase() === b.text.toLowerCase() : a.uid === b.uid);
function addRecent(entry) { writeRecent([entry, ...readRecent().filter((r) => !sameRecent(r, entry))]); }
function removeRecent(index) { const list = readRecent(); list.splice(index, 1); writeRecent(list); }

/* Finding people: the beginning of the @username or the name */
async function searchPeople(db, raw, me) {
  const q = raw.trim().replace(/^@/, "");
  const lower = q.toLowerCase();
  const capitalized = q.charAt(0).toUpperCase() + q.slice(1);
  const byPrefix = (field, value) =>
    get(query(ref(db, "users"), orderByChild(field), startAt(value), endAt(value + ""), limitToFirst(PEOPLE_LIMIT))).catch((error) => {
      console.warn(`Search: people by ${field} failed:`, error?.code || error);
      return null;
    });
  const jobs = [byPrefix("username", lower), byPrefix("nameLower", lower), byPrefix("name", q)];
  if (capitalized !== q) jobs.push(byPrefix("name", capitalized));
  const snaps = await Promise.all(jobs);
  if (snaps.every((snap) => snap === null)) throw new Error("People search failed");

  const found = new Map();
  snaps.forEach((snap) => {
    if (!snap) return;
    snap.forEach((child) => {
      const data = child.val();
      if (child.key === me || !data || found.has(child.key) || isBlocked(child.key) || isMuted(child.key) || data.suspended === true) return;
      found.set(child.key, { uid: child.key, name: data.name || "FreeZone User", username: data.username || "", photoURL: data.photoURL || "", bio: data.bio || "", place: data.place || data.city || "" });
    });
  });
  return [...found.values()]
    .sort((a, b) => (b.username.toLowerCase() === lower) - (a.username.toLowerCase() === lower) || a.name.localeCompare(b.name))
    .slice(0, PEOPLE_LIMIT);
}

/* Small html pieces */
const followClass = (on, requested, wide) =>
  `fz-s-follow flex-shrink-0 ${wide ? "w-full" : "min-w-[92px]"} h-9 px-4 rounded-full text-[14px] font-semibold active:scale-95 transition-all disabled:opacity-60 ${
    on || requested ? "bg-surface-container text-on-surface" : "bg-primary-container text-white"
  }`;
const followLabel = (on, requested) => (requested && !on ? "Requested" : on ? "Following" : "Follow");
const followBtn = (on, requested, wide = false) => `<button type="button" class="${followClass(on, requested, wide)}">${followLabel(on, requested)}</button>`;

const personRow = (p, following) => `
  <div class="fz-s-person flex items-center gap-3 px-4 py-2.5 cursor-pointer active:bg-surface-container-low transition-colors" data-uid="${escapeHtml(p.uid)}">
    ${avatarHtml(p.photoURL, "w-14 h-14")}
    <div class="min-w-0 flex-1">
      <div class="text-[16px] leading-5 font-semibold text-on-surface truncate" data-tick-uid="${escapeHtml(p.uid)}">${escapeHtml(p.name)}</div>
      <div class="text-[14px] leading-5 text-slate-muted truncate">${p.username ? "@" + escapeHtml(p.username) : ""}${p.place ? `${p.username ? " · " : ""}${escapeHtml(p.place)}` : ""}</div>
      ${p.bio ? `<div class="text-[13px] leading-4 text-slate-muted truncate mt-0.5">${escapeHtml(String(p.bio).slice(0, 80))}</div>` : ""}
    </div>
    ${followBtn(!!following[p.uid], isRequested(p.uid))}
  </div>`;

const sectionTitle = (text, action = "") =>
  `<div class="flex items-center justify-between px-4 pt-4 pb-1"><h3 class="text-[18px] leading-6 font-bold text-on-surface">${text}</h3>${action}</div>`;
const linkBtn = (cls, text) => `<button type="button" class="${cls} text-[15px] font-semibold text-primary">${text}</button>`;

// remembered while the person opens a profile and comes back
const last = { text: "", filter: "all" };

export async function mount(container, ctx = {}) {
  const { db, currentUser, followingIds = {}, postActions = {} } = ctx;
  if (!db || !currentUser) {
    container.innerHTML = `<p class="text-center text-slate-muted text-sm py-16 px-6">Search is not available.</p>`;
    return;
  }
  ctx.setHeader?.(false); // the search page draws its own top bar
  const me = currentUser.uid;

  container.innerHTML = `
    <div class="fz-s-top sticky top-0 z-10 bg-slate-surface border-b border-slate-border/60">
      <div class="flex items-center gap-1 px-2 py-2">
        <button type="button" class="fz-s-back w-11 h-11 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container active:bg-surface-container flex-shrink-0" aria-label="Back"><span class="material-symbols-outlined text-[26px]">arrow_back</span></button>
        <div class="flex-1 min-w-0 flex items-center gap-2 bg-surface-container rounded-full pl-3.5 pr-1.5 h-11">
          <span class="material-symbols-outlined text-[22px] text-slate-muted flex-shrink-0">search</span>
          <input class="fz-s-input flex-1 min-w-0 h-full text-[16px] text-on-surface placeholder:text-slate-muted" style="border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;-webkit-appearance:none;appearance:none;" type="text" inputmode="search" enterkeyhint="search" maxlength="60" placeholder="Search" autocomplete="off" autocapitalize="off" spellcheck="false" />
          <button type="button" class="fz-s-clear w-8 h-8 rounded-full items-center justify-center bg-slate-subtle/40 text-on-surface flex-shrink-0" aria-label="Clear" style="display:none"><span class="material-symbols-outlined text-[18px]">close</span></button>
        </div>
      </div>
      <div class="fz-s-chips flex gap-2 px-4 pb-2.5 overflow-x-auto" style="display:none;scrollbar-width:none;">
        ${[["all", "All"], ["people", "People"], ["post", "Posts"], ["photo", "Photos"], ["poll", "Polls"]]
          .map(([id, label]) => `<button type="button" class="fz-s-chip flex-shrink-0 px-4 h-9 rounded-full text-[15px] font-semibold transition-colors" data-f="${id}">${label}</button>`).join("")}
      </div>
    </div>
    <div class="fz-s-body pb-12 bg-slate-surface min-h-[60vh]"></div>`;

  const input = container.querySelector(".fz-s-input");
  const clearBtn = container.querySelector(".fz-s-clear");
  const chipsEl = container.querySelector(".fz-s-chips");
  const body = container.querySelector(".fz-s-body");
  const alive = () => container.isConnected;

  let filter = last.filter;
  let posts = null;          // the newest posts, loaded once
  let loadError = false;
  let shown = PAGE;
  let showAllRecent = false;
  let timer = null;
  let peopleFor = "";
  let people = [];
  let peopleState = "idle";  // idle | loading | done | error
  let runToken = 0;
  const peopleById = new Map();

  const paintChips = () => container.querySelectorAll(".fz-s-chip").forEach((chip) => {
    const on = chip.dataset.f === filter;
    chip.className = "fz-s-chip flex-shrink-0 px-4 h-9 rounded-full text-[15px] font-semibold transition-colors " + (on ? "bg-primary-fixed text-primary" : "bg-surface-container text-on-surface");
  });
  const note = (html, icon = "") => {
    body.innerHTML = `<div class="text-center text-slate-muted text-[15px] py-16 px-8">${icon ? `<span class="material-symbols-outlined text-[44px] opacity-60 block mb-2">${icon}</span>` : ""}${html}</div>`;
  };
  const visiblePosts = () => (posts || []).filter((post) => privacyKnown(post.uid) && !isBlocked(post.uid) && !isMuted(post.uid) && canViewPost(post, me, followingIds)); // an author whose privacy is not checked yet stays hidden

  const renderHome = () => {
    const recent = readRecent();
    let html = "";
    if (recent.length) {
      const list = showAllRecent ? recent : recent.slice(0, RECENT_SHOWN);
      html += sectionTitle("Recent", recent.length > RECENT_SHOWN ? linkBtn("fz-s-allrecent", showAllRecent ? "Show less" : "See all") : linkBtn("fz-s-clearrecent", "Clear all"));
      const x = `<button type="button" class="fz-s-rx w-9 h-9 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Remove"><span class="material-symbols-outlined text-[20px]">close</span></button>`;
      html += list.map((r, i) => r.t === "u"
        ? `<div class="fz-s-recent flex items-center gap-3 px-4 py-2 cursor-pointer active:bg-surface-container-low" data-i="${i}">${avatarHtml(r.photoURL, "w-11 h-11")}<div class="min-w-0 flex-1"><div class="text-[16px] leading-5 text-on-surface truncate">${escapeHtml(r.name || r.username)}</div>${r.username ? `<div class="text-[13px] text-slate-muted truncate">@${escapeHtml(r.username)}</div>` : ""}</div>${x}</div>`
        : `<div class="fz-s-recent flex items-center gap-3 px-4 py-2 cursor-pointer active:bg-surface-container-low" data-i="${i}"><span class="w-11 h-11 rounded-full bg-surface-container flex items-center justify-center text-on-surface flex-shrink-0"><span class="material-symbols-outlined text-[22px]">history</span></span><div class="min-w-0 flex-1 text-[16px] leading-5 text-on-surface truncate">${escapeHtml(r.text)}</div>${x}</div>`).join("");
      if (recent.length > RECENT_SHOWN && showAllRecent) html += `<div class="px-4 pt-1">${linkBtn("fz-s-clearrecent", "Clear all")}</div>`;
    }

    const seen = visiblePosts();
    const trends = trendingTags(seen, 5);
    if (trends.length) {
      html += sectionTitle(`<span class="inline-flex items-center gap-1.5"><span class="material-symbols-outlined text-[22px] text-primary">trending_up</span>Trending</span>`);
      html += trends.map((row, i) => `<button type="button" class="fz-trend w-full text-left px-4 py-2.5 active:bg-surface-container-low transition-colors" data-tag="${escapeHtml(row.tag)}"><span class="block text-[13px] text-slate-muted">${i + 1} · Trending</span><span class="block text-[16px] leading-5 text-on-surface font-semibold break-words">#${escapeHtml(row.tag)}</span><span class="block text-[13px] text-slate-muted">${row.count} post${row.count === 1 ? "" : "s"}</span></button>`).join("");
    }

    let suggestions = [];
    try { suggestions = posts ? pickSuggestions(seen, me, followingIds, (uid) => isBlocked(uid) || isMuted(uid), 10) : []; } catch (error) { suggestions = []; }
    suggestions.forEach((p) => peopleById.set(p.uid, p));
    if (suggestions.length) {
      html += sectionTitle("People you may know");
      html += `<div class="fz-s-pymk flex gap-3 overflow-x-auto px-4 pb-2 pt-1" style="scrollbar-width:none;">${suggestions.map((p) => `
        <div class="fz-s-card flex-shrink-0 w-[148px] rounded-2xl border border-slate-border bg-slate-surface p-3 text-center cursor-pointer active:bg-surface-container-low" data-uid="${escapeHtml(p.uid)}">
          <div class="flex justify-center">${avatarHtml(p.photoURL, "w-[72px] h-[72px]")}</div>
          <div class="mt-2 text-[15px] leading-5 font-semibold text-on-surface truncate" data-tick-uid="${escapeHtml(p.uid)}">${escapeHtml(p.name || p.username || "FreeZone User")}</div>
          <div class="text-[13px] leading-4 text-slate-muted truncate h-4">${p.username ? "@" + escapeHtml(p.username) : ""}</div>
          <div class="mt-2.5">${followBtn(!!followingIds[p.uid], isRequested(p.uid), true)}</div>
        </div>`).join("")}</div>`;
    }

    if (!html) { note(posts || loadError ? "Search for people, posts and #tags." : "Loading…", "search"); return; }
    body.innerHTML = html;
  };

  const postResults = (text) => visiblePosts().filter((post) =>
    (filter === "all" || filter === "post" || (filter === "photo" ? hasPhoto(post) : hasPoll(post))) && matchPost(post, text));

  const renderResults = (text) => {
    const wantPeople = filter === "all" || filter === "people";
    const wantPosts = filter !== "people";
    const found = wantPeople && peopleFor === text ? people : [];
    const results = wantPosts && posts ? postResults(text) : [];
    const plain = text.replace(/^@/, "");

    let html = "";
    if (wantPeople && !text.startsWith("#")) {
      if (plain.length < PEOPLE_MIN) {
        if (filter === "people") html += `<p class="text-center text-slate-muted text-[15px] py-14 px-8">Type at least ${PEOPLE_MIN} letters of a name or @username.</p>`;
      } else if (peopleState === "loading") {
        if (filter === "people") html += `<p class="text-center text-slate-muted text-[15px] py-14">Searching…</p>`;
      } else if (peopleState === "error") {
        if (filter === "people") html += `<p class="text-center text-slate-muted text-[15px] py-14 px-8">Could not search people. Try again.</p>`;
      } else if (found.length) {
        const list = filter === "all" ? found.slice(0, 3) : found;
        if (filter === "all") html += sectionTitle("People");
        html += list.map((p) => { peopleById.set(p.uid, p); return personRow(p, followingIds); }).join("");
        if (filter === "all" && found.length > 3) html += `<div class="px-4 pt-1 pb-1"><button type="button" class="fz-s-seepeople w-full h-10 rounded-lg bg-surface-container text-on-surface text-[15px] font-semibold">See all people</button></div>`;
      } else if (filter === "people") {
        html += `<p class="text-center text-slate-muted text-[15px] py-14 px-8">No people found for “${escapeHtml(text)}”.<br><span class="text-[13px]">The search matches the beginning of a name or @username.</span></p>`;
      }
    }
    if (wantPosts) {
      if (loadError && !posts) html += `<p class="text-center text-slate-muted text-[15px] py-14 px-8">Could not load posts. Try again.</p>`;
      else if (!posts) html += `<p class="text-center text-slate-muted text-[15px] py-10">Searching…</p>`;
      else if (results.length) {
        html += (filter === "all" ? sectionTitle("Posts") : "") + `<p class="px-4 pt-2 pb-2 text-[13px] text-slate-muted">${results.length} result${results.length === 1 ? "" : "s"}</p><div class="fz-s-list flex flex-col gap-2 bg-background"></div>`;
      } else if (filter !== "all" || !found.length) {
        html += `<p class="text-center text-slate-muted text-[15px] py-14 px-8">No posts found for “${escapeHtml(text)}”.<br><span class="text-[13px]">Searched the newest ${posts.length} posts.</span></p>`;
      }
    }
    body.innerHTML = html;

    const list = body.querySelector(".fz-s-list");
    if (list) {
      results.slice(0, shown).forEach((post) =>
        list.appendChild(createPostCard(post, { ...postActions, currentUserUid: me, savedPostIds: ctx.savedPostIds, followingIds, isBlocked })));
      if (results.length > shown) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "mx-auto my-3 px-5 py-2 rounded-full bg-surface-container text-on-surface text-[15px] font-semibold active:scale-95 transition-all block";
        more.textContent = "Show more";
        more.addEventListener("click", () => { shown += PAGE; render(); });
        list.after(more);
      }
    }
  };

  const loadPeople = async (text) => {
    if (peopleFor === text && (peopleState === "loading" || peopleState === "done")) return;
    peopleFor = text; peopleState = "loading"; people = [];
    const token = ++runToken;
    try {
      const found = await searchPeople(db, text, me);
      if (token !== runToken || !alive()) return;
      people = found; peopleState = "done";
    } catch (error) {
      if (token !== runToken || !alive()) return;
      peopleState = "error";
    }
    render();
  };

  function render() {
    if (!alive()) return;
    const text = input.value.trim();
    last.text = input.value; last.filter = filter;
    clearBtn.style.display = text ? "flex" : "none";
    chipsEl.style.display = text ? "flex" : "none";
    if (!text) { runToken++; peopleFor = ""; peopleState = "idle"; renderHome(); return; }
    paintChips();
    const wantPeople = (filter === "all" || filter === "people") && !text.startsWith("#") && text.replace(/^@/, "").length >= PEOPLE_MIN;
    if (wantPeople) loadPeople(text);
    renderResults(text);
  }

  const openPerson = (p) => {
    if (!p) return;
    addRecent({ t: "u", uid: p.uid, name: p.name || "", username: p.username || "", photoURL: p.photoURL || "" });
    ctx.onOpenProfile?.(p.uid);
  };

  input.addEventListener("input", () => {
    shown = PAGE;
    clearTimeout(timer);
    if (!input.value.trim()) render(); else timer = setTimeout(render, 250);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    clearTimeout(timer);
    const text = input.value.trim();
    if (text) addRecent({ t: "q", text });
    input.blur();
    render();
  });
  clearBtn.addEventListener("click", () => { input.value = ""; shown = PAGE; render(); input.focus(); });
  container.querySelector(".fz-s-back").addEventListener("click", () => ctx.goBack?.());
  chipsEl.addEventListener("click", (event) => {
    const chip = event.target.closest(".fz-s-chip");
    if (!chip) return;
    filter = chip.dataset.f; shown = PAGE; render();
  });

  body.addEventListener("click", async (event) => {
    const fbtn = event.target.closest(".fz-s-follow");
    const holder = event.target.closest("[data-uid]");
    if (fbtn && holder) {
      event.stopPropagation();
      const p = peopleById.get(holder.dataset.uid);
      if (!p || !ctx.onToggleFollow) return;
      const was = !!followingIds[p.uid];
      const wide = fbtn.className.includes("w-full");
      fbtn.disabled = true;
      let ok = true;
      try { ok = (await ctx.onToggleFollow(p, was)) !== false; } catch (error) { ok = false; }
      if (!alive()) return;
      fbtn.disabled = false;
      if (!ok) { showToast("Could not update. Try again."); return; }
      const now = !!followingIds[p.uid];
      fbtn.className = followClass(now, isRequested(p.uid), wide);
      fbtn.textContent = followLabel(now, isRequested(p.uid));
      return;
    }
    if (event.target.closest(".fz-s-seepeople")) { filter = "people"; shown = PAGE; render(); return; }
    const person = event.target.closest(".fz-s-person, .fz-s-card");
    if (person) { openPerson(peopleById.get(person.dataset.uid)); return; }

    if (event.target.closest(".fz-s-clearrecent")) { writeRecent([]); showAllRecent = false; render(); return; }
    if (event.target.closest(".fz-s-allrecent")) { showAllRecent = !showAllRecent; render(); return; }
    const rec = event.target.closest(".fz-s-recent");
    if (rec) {
      const i = Number(rec.dataset.i);
      if (event.target.closest(".fz-s-rx")) { removeRecent(i); render(); return; }
      const item = readRecent()[i];
      if (!item) return;
      if (item.t === "u") { openPerson(item); return; }
      input.value = item.text; shown = PAGE; addRecent(item); render();
      return;
    }
    const trend = event.target.closest(".fz-trend");
    if (trend) {
      addRecent({ t: "q", text: "#" + trend.dataset.tag });
      input.value = "#" + trend.dataset.tag; shown = PAGE; render();
    }
  });

  input.value = last.text;
  paintChips();
  render();
  if (!last.text) input.focus();

  try {
    const snap = await get(query(ref(db, "posts"), orderByChild("createdAt"), limitToLast(SCAN)));
    const list = [];
    snap.forEach((child) => { list.push({ id: child.key, ...child.val() }); });
    posts = list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    // Show the results now; the private-account check (one small read per author) finishes in the background
    ensurePrivacy(db, posts.map((post) => post.uid)).then((learned) => { if (learned) render(); }).catch(() => {});
  } catch (error) {
    console.error(error);
    loadError = true;
  }
  render();
}
