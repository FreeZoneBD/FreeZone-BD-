// FreeZone BD - hashtags: #ঢাকা  #eid2026  #my_trip
// A tag is # followed by letters, marks (Bengali vowel signs) or digits or _ (2 to 30 characters).
// Index in the database: hashtags/{tag}/{postId} = number (when the post was written). The tag page re-checks the post text, so a wrong index entry never shows a wrong post.

const TAG_RE = /#([\p{L}\p{M}\p{N}_]{2,30})/gu;
export const MAX_TAGS = 5;

// "abc#tag" inside a word (or a link like page#section) is not a tag
const insideWord = (source, index) => {
  const before = source[index - 1];
  return !!before && /[\p{L}\p{M}\p{N}_/&=]/u.test(before);
};

export const normalizeTag = (tag) => String(tag || "").replace(/^#/, "").toLowerCase();

/** Unique tags of a text, lowercase, without #, at most MAX_TAGS. */
export function extractTags(text) {
  const source = String(text || "");
  const found = [];
  for (const match of source.matchAll(TAG_RE)) {
    if (insideWord(source, match.index)) continue;
    const tag = normalizeTag(match[1]);
    if (!found.includes(tag)) found.push(tag);
    if (found.length >= MAX_TAGS) break;
  }
  return found;
}

/** Same text as escaped HTML, with every tag turned into a tappable <a class="hashtag">. `escapeHtml` is passed in to avoid a circular import. */
export function linkifyHashtags(text, escapeHtml) {
  const source = String(text || "");
  let html = "";
  let last = 0;
  let count = 0;
  for (const match of source.matchAll(TAG_RE)) {
    // "abc#tag" inside a word (like an address or a link) is not a tag
    if (insideWord(source, match.index)) continue;
    const tag = normalizeTag(match[1]);
    html += escapeHtml(source.slice(last, match.index));
    html += `<a href="#" class="hashtag text-primary font-semibold" data-tag="${escapeHtml(tag)}">${escapeHtml(match[0])}</a>`;
    last = match.index + match[0].length;
    if (++count >= 50) break;
  }
  return html + escapeHtml(source.slice(last));
}

/** Database paths to write when a post is created / edited / deleted: { "hashtags/tag/postId": value | null } */
export function tagIndexUpdates(postId, oldText, newText) {
  const before = extractTags(oldText);
  const after = extractTags(newText);
  const updates = {};
  before.filter((t) => !after.includes(t)).forEach((t) => (updates[`hashtags/${t}/${postId}`] = null));
  after.filter((t) => !before.includes(t)).forEach((t) => (updates[`hashtags/${t}/${postId}`] = Date.now()));
  return updates;
}
