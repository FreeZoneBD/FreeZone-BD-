// FreeZone BD - the page of one hashtag: every post that uses it, newest first.
// Opened from feed.js (tap a #tag). ctx: { db, currentUser, followingIds, postActions, tag, setTitle }
import { postSkeleton } from "./skeleton.js";
import { ref, get, query, limitToLast } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, createPostCard, canViewPost } from "./post.js";
import { isBlocked } from "./block.js";
import { ensurePrivacy } from "./privacy.js";
import { isMuted } from "./mute.js";
import { extractTags, normalizeTag } from "./hashtags.js";

const LIMIT = 60;

export async function mount(container, ctx = {}) {
  const { db, currentUser, followingIds = {}, postActions = {} } = ctx;
  const tag = normalizeTag(ctx.tag);
  ctx.setTitle?.(`#${tag}`);

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

  container.innerHTML = `
    <div class="px-4 pt-4 pb-3">
      <h2 class="font-headline-md text-headline-md text-on-surface font-semibold break-words">#${escapeHtml(tag)}</h2>
      <p class="font-body-md text-body-md text-slate-muted">${posts.length} post${posts.length === 1 ? "" : "s"}</p>
    </div>
    <div class="ht-list flex flex-col gap-2 pb-10"></div>`;
  const list = container.querySelector(".ht-list");
  if (!posts.length) {
    list.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-10 px-6">No posts with #${escapeHtml(tag)} yet. Be the first: write a post with this tag.</p>`;
    return;
  }
  posts.forEach((post) =>
    list.appendChild(createPostCard(post, { ...postActions, currentUserUid: currentUser.uid, savedPostIds: ctx.savedPostIds, followingIds, isBlocked }))
  );
}
