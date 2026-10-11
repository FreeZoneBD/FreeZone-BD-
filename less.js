// FreeZone BD - "Not interested" (feed algorithm part 9).
// Tapping "Not interested" on a post: the post disappears now, and that author and the post's hashtags are
// pushed down in "Top" for a while (the effect fades over `interest.decayDays`). It is kept on this phone.
//   fz_less = { posts: {id: time}, authors: {uid: time}, tags: {tag: time} }

const KEY = "fz_less";

export function loadLess() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (error) { data = {}; }
  return { posts: data.posts || {}, authors: data.authors || {}, tags: data.tags || {} };
}

function persist(less) {
  ["posts", "authors", "tags"].forEach((part) => {
    const ids = Object.keys(less[part]);
    if (ids.length > 400) ids.sort((a, b) => less[part][a] - less[part][b]).slice(0, ids.length - 400).forEach((id) => delete less[part][id]);
  });
  try { localStorage.setItem(KEY, JSON.stringify(less)); } catch (error) { /* storage full or blocked */ }
}

/** tags: the hashtags of the post (feed-algorithm.js tagsOf) */
export function markNotInterested(less, post, tags = []) {
  const now = Date.now();
  const before = { post: less.posts[post.id], author: less.authors[post.uid], tags: tags.map((t) => less.tags[t]) };
  less.posts[post.id] = now;
  if (post.uid) less.authors[post.uid] = now;
  tags.forEach((t) => { less.tags[t] = now; });
  persist(less);
  return before;
}

/** Undo (the toast button): puts back what was there before */
export function undoNotInterested(less, post, tags, before) {
  const put = (map, key, value) => { if (value) map[key] = value; else delete map[key]; };
  put(less.posts, post.id, before.post);
  if (post.uid) put(less.authors, post.uid, before.author);
  tags.forEach((t, i) => put(less.tags, t, before.tags[i]));
  persist(less);
}

export const isHiddenPost = (less, id) => !!(less && less.posts[id]);
