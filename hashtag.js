// FreeZone BD - the page of one hashtag: every post that uses it, newest first.
// Opened from feed.js (tap a #tag). ctx: { db, currentUser, followingIds, postActions, tag, setTitle }
import { postSkeleton } from "./skeleton.js";
import { ref, get, query, limitToLast } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, createPostCard, canViewPost, postImageUrls, postVideoOf, avatarHtml } from "./post.js";
import { isBlocked } from "./block.js";
import { ensurePrivacy } from "./privacy.js";
import { isMuted } from "./mute.js";
import { extractTags, normalizeTag } from "./hashtags.js";

const LIMIT = 60;

export async function mount(container, ctx = {}) {
  const { db, currentUser, followingIds = {}, postActions = {} } = ctx;
  const tag = normalizeTag(ctx.tag);
  ctx.setTitle?.(`#${tag}`);
  ctx.setHeader?.(false); // this page has its own top bar

  if (!db || !currentUser || !tag) {
    container.innerHTML = `<p class="text-center text-slate-muted text-sm py-16 px-6">This tag is not available.</p>`;
    return;
  }

  container.innerHTML = postSkeleton(3);
  let posts = [];
  try {
    const idsSnap = await get(query(ref(db, `hashtags/${tag}`), limitToLast(LIMIT)));
    const ids = [];
    idsSnap.forEach((child) => { ids.push(child.key); });
    const loaded = await Promise.all(ids.map(async (id) => {
      try {
        const snap = await get(ref(db, `posts/${id}`));
        return snap.exists() ? { id, ...snap.val() } : null;
      } catch (error) {
        return null;
      }
    }));
    await ensurePrivacy(db, loaded.filter(Boolean).map((post) => post.uid));
    posts = loaded
      .filter((post) => post && extractTags(post.text).includes(tag)) // the post really uses this tag
      .filter((post) => !isBlocked(post.uid) && !isMuted(post.uid) && canViewPost(post, currentUser.uid, followingIds))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (error) {
    console.error(error);
    container.innerHTML = `<p class="text-center text-slate-muted text-sm py-16 px-6">Could not load this tag. Try again.</p>`;
    return;
  }

  // Tabs like Twitter / Facebook search: Top, Latest, People, Media
  const TABS = [["top", "Top"], ["latest", "Latest"], ["people", "People"], ["media", "Media"]];
  container.innerHTML = `
    <div class="ht-top sticky top-0 z-10" style="background:rgba(255,255,255,.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);">
      <div class="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <button type="button" class="ht-back flex-shrink-0 flex items-center justify-center rounded-full bg-white active:scale-95" aria-label="Back" style="width:42px;height:42px;box-shadow:0 1px 4px rgba(0,0,0,.12);">
          <span class="material-symbols-outlined text-[22px] text-on-surface">arrow_back</span>
        </button>
        <div class="flex-1 min-w-0 flex items-center gap-2 rounded-full bg-white pl-3.5 pr-1.5" style="height:44px;box-shadow:0 1px 4px rgba(0,0,0,.12);">
          <span class="material-symbols-outlined text-[20px] text-slate-muted">search</span>
          <span class="flex-1 min-w-0 truncate font-semibold text-[16px]" style="color:#0560e6;">#${escapeHtml(tag)}</span>
          <button type="button" class="ht-clear flex items-center justify-center rounded-full bg-surface-container text-slate-muted active:scale-95" aria-label="Close" style="width:32px;height:32px;"><span class="material-symbols-outlined text-[18px]">close</span></button>
        </div>
      </div>
      <p class="px-5 pb-2 text-[13px] text-slate-muted">${posts.length} post${posts.length === 1 ? "" : "s"}</p>
      <div class="ht-tabs flex gap-2 px-3 pb-2.5 overflow-x-auto" role="tablist" style="scrollbar-width:none;">
        ${TABS.map(([key, label]) => `<button type="button" role="tab" data-tab="${key}" class="ht-tab px-[18px] py-2 rounded-full bg-white text-[14px] font-semibold text-slate-muted whitespace-nowrap" style="box-shadow:0 1px 3px rgba(0,0,0,.08);">${label}</button>`).join("")}
      </div>
    </div>
    <div class="ht-list flex flex-col gap-2 pb-10"></div>`;
  const list = container.querySelector(".ht-list");
  const goBack = () => ctx.goBack?.();
  container.querySelector(".ht-back").addEventListener("click", goBack);
  container.querySelector(".ht-clear").addEventListener("click", goBack);
  if (!posts.length) {
    list.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-10 px-6">No posts with #${escapeHtml(tag)} yet. Be the first: write a post with this tag.</p>`;
    container.querySelector(".ht-tabs").hidden = true; // nothing to switch between
    return;
  }
  const cardOptions = { ...postActions, currentUserUid: currentUser.uid, savedPostIds: ctx.savedPostIds, followingIds, isBlocked };
  const score = (p) => (Number(p.likesCount) || 0) + 2 * (Number(p.commentsCount) || 0) + 2 * (Number(p.sharesCount) || 0);
  const empty = (text) => `<p class="text-center text-slate-muted font-body-md text-body-md py-10 px-6">${text}</p>`;

  const draw = {
    top() {
      [...posts].sort((a, b) => score(b) - score(a) || (b.createdAt || 0) - (a.createdAt || 0)).forEach((p) => list.appendChild(createPostCard(p, cardOptions)));
    },
    latest() {
      posts.forEach((p) => list.appendChild(createPostCard(p, cardOptions))); // already newest first
    },
    people() {
      const byUid = new Map();
      posts.forEach((p) => {
        if (!p.uid) return;
        const row = byUid.get(p.uid) || { uid: p.uid, name: p.name, username: p.username, photoURL: p.photoURL, n: 0 };
        row.n += 1;
        byUid.set(p.uid, row);
      });
      const rows = [...byUid.values()].sort((a, b) => b.n - a.n);
      list.innerHTML = rows.map((r) => `
        <button type="button" data-uid="${escapeHtml(r.uid)}" class="ht-person flex items-center gap-3 px-4 py-3 text-left active:bg-surface-container-low">
          ${avatarHtml(r.photoURL, "w-11 h-11")}
          <span class="min-w-0 flex-1"><span class="block font-semibold text-on-surface truncate">${escapeHtml(r.name || "FreeZone User")}</span><span class="block text-[13px] text-slate-muted truncate">${r.username ? "@" + escapeHtml(r.username) + " · " : ""}${r.n} post${r.n === 1 ? "" : "s"} with #${escapeHtml(tag)}</span></span>
        </button>`).join("");
      list.querySelectorAll(".ht-person").forEach((b) => b.addEventListener("click", () => ctx.onOpenProfile?.(b.dataset.uid)));
    },
    media() {
      const items = posts.map((p) => ({ p, photos: postImageUrls(p) || [], video: postVideoOf(p) })).filter((x) => x.photos.length || x.video);
      if (!items.length) { list.innerHTML = empty(`No photos or videos with #${escapeHtml(tag)} yet.`); return; }
      const videoPosts = items.filter((x) => x.video).map((x) => x.p);
      const grid = document.createElement("div");
      grid.className = "grid gap-0.5";
      grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      items.forEach(({ p, photos, video }) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "relative block overflow-hidden bg-black active:opacity-80";
        tile.style.aspectRatio = "1 / 1";
        const cover = photos[0] || (video && video.thumb) || "";
        tile.innerHTML = (cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover" onerror="this.remove()" />` : video ? `<video src="${escapeHtml(video.url)}#t=0.1" muted playsinline preload="metadata" class="absolute inset-0 w-full h-full object-cover pointer-events-none"></video>` : "")
          + (video ? `<span class="absolute top-1.5 right-1.5 text-white drop-shadow"><span class="material-symbols-outlined text-[20px]" style="font-variation-settings:'FILL' 1;">play_arrow</span></span>` : "")
          + (!video && photos.length > 1 ? `<span class="absolute top-1.5 right-1.5 px-1.5 rounded-full bg-black/60 text-white text-[11px]">+${photos.length - 1}</span>` : "");
        tile.addEventListener("click", () => {
          if (video && postActions.onOpenReels) postActions.onOpenReels(p.id, videoPosts);
          else postActions.onOpen?.(p);
        });
        grid.appendChild(tile);
      });
      list.appendChild(grid);
    }
  };

  let current = "";
  const show = (key) => {
    if (key === current) return;
    current = key;
    container.querySelectorAll(".ht-tab").forEach((b) => {
      const on = b.dataset.tab === key;
      b.classList.toggle("text-white", on);
      b.classList.toggle("bg-white", !on);
      b.classList.toggle("text-slate-muted", !on);
      b.style.background = on ? "#0560e6" : "";
      b.style.boxShadow = on ? "0 4px 12px rgba(5,96,230,.35)" : "0 1px 3px rgba(0,0,0,.08)";
      b.setAttribute("aria-selected", String(on));
    });
    list.innerHTML = "";
    draw[key]();
  };
  container.querySelectorAll(".ht-tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show("top");
      }
    
