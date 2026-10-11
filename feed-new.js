// FreeZone BD - "New posts" for the feed.
// While you read further down the feed, posts that other people publish are NOT pushed into the list (the page would jump).
// They wait, and a small button "↑ 3 new posts" shows. Tap it, or scroll back to the top, and they appear.
// Your own new post always appears at once.

/**
 * createNewPostsGate({ me, isAtTop, passes })
 *   me()        -> uid of the signed-in person
 *   isAtTop()   -> true when the feed is scrolled to the top (new posts may appear at once)
 *   passes(post)-> false for posts that would be hidden anyway (blocked, muted, not allowed): they are never counted
 * gate.update(posts) -> the posts to show now (newest first); gate.count -> posts waiting; gate.release() lets them in.
 */
export function createNewPostsGate({ me, isAtTop, passes = () => true }) {
  let newest = null; // createdAt of the newest post seen so far (null until the first list)
  const held = new Set();
  return {
    update(posts) {
      const present = new Set(posts.map((p) => p.id));
      held.forEach((id) => { if (!present.has(id)) held.delete(id); });
      if (newest !== null && !isAtTop()) {
        posts.forEach((post) => {
          // only posts NEWER than everything seen (older posts that appear because the feed loaded another page are not "new")
          if ((post.createdAt || 0) > newest && post.uid !== me() && !held.has(post.id) && passes(post)) held.add(post.id);
        });
      }
      newest = posts.reduce((max, p) => Math.max(max, p.createdAt || 0), newest || 0);
      return posts.filter((p) => !held.has(p.id));
    },
    release() { held.clear(); },
    get count() { return held.size; }
  };
}

/** The floating button. pill.show(3) -> "↑ 3 new posts", pill.hide(). */
export function createNewPostsPill({ onClick, parent = document.body }) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "fz-new-posts fixed left-1/2 z-40 flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary-container text-white font-label-md text-label-md font-semibold shadow-lg shadow-primary-container/30 active:scale-95 transition-all";
  el.style.cssText = "top:76px;transform:translateX(-50%);display:none";
  el.innerHTML = `<span class="material-symbols-outlined text-[18px]">arrow_upward</span><span class="fz-new-text"></span>`;
  el.addEventListener("click", onClick);
  parent.appendChild(el);
  return {
    show(count) {
      el.querySelector(".fz-new-text").textContent = count === 1 ? "1 new post" : `${count > 99 ? "99+" : count} new posts`;
      el.style.display = "flex";
    },
    hide() { el.style.display = "none"; },
    el
  };
}
