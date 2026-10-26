// FreeZone BD - Feed (Phase 2) - FIXED
import { auth, db } from "./config.js";
import { fzConfirm } from "./dialog.js";
import { initTheme } from "./theme.js";
initTheme();

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  ref,
  push,
  set,
  get,
  remove,
  update,
  onValue,
  increment,
  serverTimestamp,
  query,
  orderByChild,
  equalTo,
  limitToFirst
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { escapeHtml, timeAgo, avatarHtml, createPostCard, postVideoOf, showToast, pausePostVideos, canViewPost, updateFollowButtons, sharePost, postImagesHtml, postImageUrls } from "./post.js";
import { startBlocks, isBlocked, onBlocksChange, blockAccount } from "./block.js";
import { startMutes, isMuted, onMutesChange } from "./mute.js";
import { tagIndexUpdates } from "./hashtags.js";
import { createFeedPager, watchEnd } from "./feed-pager.js";
import { createNewPostsGate, createNewPostsPill } from "./feed-new.js";
import { attachPullToRefresh } from "./pull-refresh.js";
import { createFeedTabs, inFeedTab } from "./feed-tabs.js";
import { loadSeen, createViewTracker } from "./views.js";
import { createInterestStore } from "./interests.js";
import { loadLess, markNotInterested, undoNotInterested, isHiddenPost } from "./less.js";
import { rankPosts, likedAuthorsFrom, tagsOf } from "./feed-algorithm.js";
import { emptyKind, renderEmpty } from "./empty-state.js";
import { startMonetized } from "./monetize.js";
import { recordView } from "./creatorViews.js";
import { ensurePrivacy, privacyKnown, isPrivateUid, isRequested, setRequested, startRequests, onPrivacyChange } from "./privacy.js";
import { createOfflineBar } from "./offline-bar.js";
import { createScrollMemory } from "./scroll-memory.js";
import { pickSuggestions, suggestHidden, createSuggestCard } from "./suggest.js";
import { openCommentsSheet, mountComments } from "./comments.js";
import { registerFeature } from "./features.js";
import { rememberAccount } from "./accounts.js";

const $ = (selector) => document.querySelector(selector);

const postsContainer = $("#postsContainer");
const emptyState = $("#emptyState");
const postsSkeleton = $("#postsSkeleton"); // grey placeholder cards, shown until the first posts are drawn
const navAvatar = $("#navAvatar");

const postDetail = $("#postDetail");
const postDetailBody = $("#postDetailBody");
const postDetailBack = $("#postDetailBack");
const postDetailCommentForm = $("#postDetailCommentForm");
const postDetailCommentInput = $("#postDetailCommentInput");

const pageView = $("#pageView");
const pageViewBody = $("#pageViewBody");
const pageViewTitle = $("#pageViewTitle");
// A page (like the Chat inbox) can draw its own header: setHeader(false) hides the common one
const pageViewHeader = pageView.querySelector("header");
function showPageHeader(show) {
  if (pageViewHeader) pageViewHeader.style.display = show ? "" : "none";
}
const pageViewBack = $("#pageViewBack");
const pageViewActions = $("#pageViewActions");

// "You're offline" bar (the database tells us too, because the phone's own online flag can be wrong)
const offlineBar = createOfflineBar();
try { onValue(ref(db, ".info/connected"), (snap) => offlineBar.setDatabase(snap.val() === true)); } catch (error) { /* only the phone's flag is used */ }

const pageModules = {
  notifications: () => import("./notification.js"),
  friends: () => import("./friends.js"),
  create: () => import("./create.js"),
  hashtag: () => import("./hashtag.js"),
  search: () => import("./search.js"),
  chat: () => import("./chat.js"),
  profile: () => import("./profile.js"),
  settings: () => import("./settings.js")
};

let unsubscribePostDetail = null;
let detailComments = null; // the comments list of the open post page (comments.js)
let currentDetailPostId = null;

let currentUser = null;
let followerIds = {}; // the people who follow me (the feed algorithm: "mutual")
let chattedIds = {}; // the people I chat with (the feed algorithm)
let feedApply = null; // set by listenPosts: draws the feed again (used after following / unfollowing)
let currentProfile = null;
let savedPostIds = {};
let followingIds = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Send the person to the login page and bring them back to this exact page (and post) afterwards
    const here = window.location.pathname.split("/").pop() || "feed.html";
    window.location.href = "./login.html?next=" + encodeURIComponent(here + window.location.search);
    return;
  }

  currentUser = user;

  const profileSnap = await get(ref(db, `users/${user.uid}`));
  if (profileSnap.exists()) {
    currentProfile = profileSnap.val();
  } else {
    // An account made outside the app (for example in the Firebase console) has no profile record yet:
    // make a simple one, so the profile page, posts and chats work. The username can be added in Edit profile.
    const fromEmail = (user.email || "").split("@")[0].replace(/[^\w.\- ]/g, "").slice(0, 40);
    const name = ((user.displayName || fromEmail || "").trim().slice(0, 40).padEnd(2, " ").trim()) || "FreeZone User";
    currentProfile = { name: name.length >= 2 ? name : "FreeZone User", username: "", photoURL: "" };
    try {
      await set(ref(db, `users/${user.uid}`), { name: currentProfile.name, nameLower: currentProfile.name.toLowerCase(), photoURL: "", bio: "", createdAt: serverTimestamp() });
    } catch (error) { console.warn("Could not create the profile record:", error); }
  }

  rememberAccount(user, currentProfile); // keeps the "Switch account" list up to date

  // A suspended account can read but not post, comment or message (enforced by the database rules)
  if (currentProfile.suspended === true) {
    const bar = document.createElement("div");
    bar.className = "bg-error-container text-on-error-container text-center text-[13px] font-semibold px-4 py-2";
    bar.textContent = `Your account is suspended${currentProfile.suspendReason ? ": " + currentProfile.suspendReason : ""}. You can read, but you cannot post, comment or send messages.`;
    document.body.insertBefore(bar, document.body.firstChild);
  }

  navAvatar.innerHTML = currentProfile.photoURL
    ? `<img class="w-full h-full object-cover" src="${escapeHtml(currentProfile.photoURL)}" alt="avatar" />`
    : `<svg class="fz-svg" aria-hidden="true"><use href="#i-person"/></svg>`;

  // One-time cleanup of data saved in older versions of the app (safe to run every time)
  try {
    const moves = {};
    const oldSaved = await get(ref(db, `users/${user.uid}/savedPosts`));
    if (oldSaved.exists()) {
      Object.entries(oldSaved.val()).forEach(([postId, value]) => {
        moves[`savedPosts/${user.uid}/${postId}`] = typeof value === "number" ? value : Date.now();
      });
      moves[`users/${user.uid}/savedPosts`] = null; // saved posts must stay private
    }
    if (profileSnap.exists() && profileSnap.val().email !== undefined) {
      moves[`users/${user.uid}/email`] = null; // emails must not be readable by other users
    }
    if (Object.keys(moves).length) await update(ref(db), moves);
  } catch (error) {
    console.warn("Cleanup of old data skipped:", error?.code || error);
  }

  try {
    const savedSnap = await get(ref(db, `savedPosts/${user.uid}`));
    savedPostIds = savedSnap.exists() ? savedSnap.val() : {};
  } catch (error) {
    console.error("Could not load saved posts:", error);
    savedPostIds = {};
  }

  try {
    const followingSnap = await get(ref(db, `following/${user.uid}`));
    followingIds = followingSnap.exists() ? followingSnap.val() : {};
  } catch (error) {
    console.error("Could not load following list:", error);
    followingIds = {};
  }

  // For the feed algorithm: who follows me and who I chat with (small reads; the feed works without them)
  try {
    const [followersSnap, chatsSnap] = await Promise.all([get(ref(db, `followers/${user.uid}`)), get(ref(db, `userChats/${user.uid}`))]);
    followerIds = followersSnap.exists() ? followersSnap.val() : {};
    chattedIds = {};
    chatsSnap.forEach((child) => { const other = child.val() && child.val().with; if (other) chattedIds[other] = true; });
  } catch (error) {
    followerIds = {};
    chattedIds = {};
  }

  startBlocks({ db, currentUser }); // who I blocked (block.js), before any post is drawn
  startMonetized(db); // the green tick of Creator Program members (monetize.js)
  startMutes({ db, currentUser }); // who I muted (mute.js)
  // Follow requests I sent: when one is answered, check if I follow that account now
  startRequests({
    db,
    me: user.uid,
    onGone: async (uid) => {
      try {
        const snap = await get(ref(db, `following/${user.uid}/${uid}`));
        if (snap.exists() && !followingIds[uid]) {
          followingIds[uid] = snap.val();
          updateFollowButtons(uid, true);
          feedApply?.();
        } else {
          updateFollowButtons(uid, !!followingIds[uid], false);
        }
      } catch (error) { /* the next reload will show it */ }
    }
  });
  listenPosts();
  watchUnreadMessages(user.uid);

  // Online status (the green "Active now" dots) is kept up to date by chat.js
  import("./chat.js")
    .then((module) => module.startPresence({ db, currentUser }))
    .catch((error) => console.warn("Online status is not available:", error));

  // Incoming audio / video calls (call.js; rings only while the app is open)
  import("./call.js")
    .then((module) => module.startCallListener({ db, currentUser }))
    .catch((error) => console.warn("Calls are not available:", error));

  // Announcement banner and maintenance mode (status.js, controlled from the admin panel)
  import("./status.js")
    .then((module) => module.startAppStatus({ db, auth, currentUser }))
    .catch((error) => console.warn("App status is not available:", error));

  // Notifications (the bell badge and writing notifications) live in notification.js
  import("./notification.js")
    .then((module) => module.start({ db, currentUser, currentProfile }))
    .catch((error) => console.warn("Notifications are not available:", error));

  // Stories: the bar, the viewer and adding a story all live in story.js, so that file can be
  // changed without touching this one. If story.js is missing or fails, the feed is unaffected.
  import("./story.js")
    .then((module) =>
      module.mount($("#storiesBar"), {
        db,
        auth,
        currentUser,
        currentProfile,
        followingIds,
        openProfile: (uid) => openUserProfile(uid)
      })
    )
    .catch((error) => console.warn("Stories are not available:", error));

  // Open a post directly when the page is opened from a shared link (?post=ID)
  // Open a post or a profile directly when the page is opened from a shared link
  const linkParams = new URLSearchParams(window.location.search);
  const sharedPostId = linkParams.get("post");
  const sharedProfileUid = linkParams.get("profile");
  const sharedUsername = linkParams.get("u");
  const sharedChatUid = linkParams.get("chat"); // from a push notification
  // Coming back from Terms / Privacy / Guidelines (opened from Settings): show Settings again
  const openWhat = linkParams.get("open");
  if (openWhat) { try { history.replaceState(null, "", "feed.html"); } catch (error) { /* ignore */ } }
  if (openWhat === "settings" && !sharedChatUid && !sharedPostId && !sharedProfileUid && !sharedUsername) openSettings();
  else if (sharedChatUid) openChatWith(sharedChatUid);
  else if (sharedPostId) openPostDetail(sharedPostId);
  else if (sharedProfileUid) openUserProfile(sharedProfileUid);
  else if (sharedUsername) openProfileByUsername(sharedUsername);
});

// Set by the feed (listenPosts): "Not interested" exists only in the main feed
let notInterestedHandler = null;
// Set by the feed: tells my interest profile what I did (action: like, comment, share, save, follow, hide)
let learnHook = null;
const learnById = (postId, action) => learnHook?.(postId, action);
async function shareAndLearn(post) {
  const done = await sharePost(post);
  if (done) learnHook?.(post, "share");
  return done;
}

// A small toast with an Undo button
function showUndoToast(message, onUndo) {
  const old = document.getElementById("fzUndoToast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "fzUndoToast";
  el.setAttribute("role", "status");
  el.style.cssText = "position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:9999;background:#1e293b;color:#fff;border:1px solid rgba(148,163,184,.35);padding:8px 8px 8px 16px;border-radius:9999px;font-size:13px;font-weight:500;box-shadow:0 8px 24px rgba(15,23,42,.25);max-width:90vw;display:flex;align-items:center;gap:10px;";
  const text = document.createElement("span");
  text.textContent = message;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "Undo";
  undo.style.cssText = "background:rgba(255,255,255,.15);color:#fff;border-radius:9999px;padding:4px 12px;font-weight:600;";
  el.append(text, undo);
  document.body.appendChild(el);
  const timer = setTimeout(() => el.remove(), 5000);
  undo.addEventListener("click", () => { clearTimeout(timer); el.remove(); onUndo(); });
}

// Boost post (paid): the steps live in boost.js and load only when needed
function boostPost(post) {
  import("./boost.js").then((m) => m.openBoost({ post })).catch(() => showToast("Could not open Boost. Try again."));
}

function postActions() {
  return {
    onOpen: openPostDetail,
    onComments: openComments,
    onLike: toggleLike,
    onShare: shareAndLearn,
    onReport: reportPost,
    onBlock: blockPost,
    onDelete: deletePost,
    onEdit: editPost,
    onBoost: boostPost,
    onAudience: setAudience,
    onHashtag: openHashtag,
    onVote: votePoll,
    watchVotes: watchPollVotes,
    onSave: toggleSavePost,
    onFollow: toggleFollow,
    isBlocked
  };
}

// Icon buttons at the right end of the page header (e.g. the settings gear of the Chat page).
// actions: [{ icon: "settings", label: "Chat settings", onClick }]  - an empty list removes them.
function setPageActions(actions = []) {
  if (!pageViewActions) return;
  pageViewActions.innerHTML = "";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "w-10 h-10 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container active:scale-95 transition-all";
    button.setAttribute("aria-label", action.label || "");
    button.innerHTML = `<span class="material-symbols-outlined text-[24px]">${action.icon}</span>`;
    button.addEventListener("click", action.onClick);
    pageViewActions.appendChild(button);
  });
}

async function openPageView(pageKey, title) {
  pageBackTarget = null;
  setPageActions();
  pageViewTitle.textContent = title;
  pageViewBody.innerHTML = "";
  pageView.hidden = false;
  showPageHeader(true);
  document.body.style.overflow = "hidden";

  try {
    const module = await pageModules[pageKey]();
    module.mount(pageViewBody, {
      currentUser,
      currentProfile,
      auth,
      db,
      savedPostIds,
      followingIds,
      postActions: postActions(),
      onToggleFollow: toggleFollow,
      onOpenProfile: (uid) =>
        openUserProfile(uid, { backTo: pageKey === "chat" ? () => openChatWith(uid) : () => openPageView(pageKey, title) }),
      onOpenChat: (uid) => openChatWith(uid, { backTo: () => openPageView(pageKey, title) }),
      setTitle: (text) => (pageViewTitle.textContent = text),
      setBack: (handler) => (pageBackTarget = handler),
      setActions: setPageActions,
      setHeader: showPageHeader,
      goBack: () => pageViewBack && pageViewBack.click(),
      closePage: closePageView,
      openPost: (postId) => openPostDetail(postId),
      onOpenSettings: () => openSettings(),
      onOpenEditProfile: () => openSettings("edit-profile"),
      onOpenCreator: () => openSettings("creator") // a Creator Program notification opens the Creator Program page
    });
  } catch (error) {
    console.error(error);
    pageViewBody.innerHTML = `<p class="text-center text-slate-muted text-sm py-10">Could not load this section.</p>`;
  }
}

// Settings (the menu icon at the top right of my own Profile). Back returns to my Profile.
async function openSettings(startPage = null) {
  if (!currentUser) return;

  const backToProfile = () => openPageView("profile", "Profile");
  pageBackTarget = backToProfile;
  setPageActions();
  pageViewTitle.textContent = "Settings";
  pageViewBody.innerHTML = "";
  pageView.hidden = false;
  showPageHeader(true);
  document.body.style.overflow = "hidden";

  try {
    const module = await pageModules.settings();
    await module.mount(pageViewBody, {
      db,
      auth,
      currentUser,
      currentProfile,
      startPage,
      setTitle: (text) => (pageViewTitle.textContent = text),
      setBack: (handler) => (pageBackTarget = handler),
      setActions: setPageActions,
      onBack: backToProfile
    });
  } catch (error) {
    console.error(error);
    pageViewBody.innerHTML = `<p class="text-center text-slate-muted text-sm py-10">Could not load settings.</p>`;
  }
}

// A profile link looks like  feed.html?u=username  : find the account with that @username and open it
async function openProfileByUsername(username) {
  const wanted = String(username).trim().replace(/^@/, "").toLowerCase();
  if (!wanted) return;

  try {
    const snap = await get(query(ref(db, "users"), orderByChild("username"), equalTo(wanted), limitToFirst(1)));
    let uid = "";
    snap.forEach((child) => {
      uid = child.key;
    });
    if (uid) openUserProfile(uid);
    else showToast("Profile not found");
  } catch (error) {
    console.error(error);
    showToast("Could not open this profile");
  }
}

async function openUserProfile(uid, { backTo = null } = {}) {
  if (!uid || !currentUser) return;

  // Own profile: use the normal Profile page
  if (uid === currentUser.uid) {
    openPageView("profile", "Profile");
    return;
  }

  pageBackTarget = backTo;
  setPageActions();
  pageViewTitle.textContent = "Profile";
  pageViewBody.innerHTML = "";
  pageView.hidden = false;
  showPageHeader(true);
  document.body.style.overflow = "hidden";

  try {
    const module = await pageModules.profile();
    await module.mount(pageViewBody, {
      db,
      auth,
      uid,
      currentUser,
      currentProfile,
      savedPostIds,
      followingIds,
      postActions: postActions(),
      isFollowing: !!followingIds[uid],
      setActions: setPageActions,
      setHeader: showPageHeader,
      goBack: () => pageViewBack && pageViewBack.click(),
      closePage: closePageView,
      onToggleFollow: toggleFollow,
      // people in this profile's Followers / Following list; Back returns to this profile
      onOpenProfile: (otherUid) => openUserProfile(otherUid, { backTo: () => openUserProfile(uid, { backTo }) }),
      onOpenChat: (chatUid) => openChatWith(chatUid, { backTo: () => openUserProfile(uid, { backTo }) })
    });
  } catch (error) {
    console.error(error);
    pageViewBody.innerHTML = `<p class="text-center text-slate-muted text-sm py-10">Could not load this profile.</p>`;
  }
}

// Polls: one vote per person (tap another option to change it, tap yours again to remove it)
function watchPollVotes(postId, callback) {
  return onValue(ref(db, `pollVotes/${postId}`), (snap) => callback(snap.exists() ? snap.val() : {}), () => callback({}));
}

async function votePoll(postId, index) {
  if (!currentUser) return;
  try {
    await set(ref(db, `pollVotes/${postId}/${currentUser.uid}`), index === null ? null : index);
  } catch (error) {
    console.error(error);
    showToast(error.code === "PERMISSION_DENIED" ? "Could not vote: database rules block it" : "Could not save your vote. Try again.");
  }
}

// The page of one #tag. Back closes it.
async function openHashtag(tag) {
  if (!tag || !currentUser) return;
  pageBackTarget = null;
  setPageActions();
  pageViewTitle.textContent = `#${tag}`;
  pageViewBody.innerHTML = "";
  pageView.hidden = false;
  showPageHeader(true);
  document.body.style.overflow = "hidden";
  try {
    const module = await pageModules.hashtag();
    await module.mount(pageViewBody, {
      db,
      currentUser,
      savedPostIds,
      followingIds,
      postActions: postActions(),
      tag,
      setTitle: (text) => (pageViewTitle.textContent = text)
    });
  } catch (error) {
    console.error(error);
    pageViewBody.innerHTML = `<p class="text-center text-slate-muted text-sm py-10">Could not load this tag.</p>`;
  }
}

// Opens the conversation with one person (used by the Message buttons)
async function openChatWith(uid, { backTo = null } = {}) {
  if (!uid || !currentUser || uid === currentUser.uid) return;

  pageBackTarget = backTo;
  setPageActions();
  pageViewTitle.textContent = "Chat";
  pageViewBody.innerHTML = "";
  pageView.hidden = false;
  showPageHeader(true);
  document.body.style.overflow = "hidden";

  try {
    const module = await pageModules.chat();
    await module.mount(pageViewBody, {
      db,
      currentUser,
      openWithUid: uid,
      followingIds,
      onOpenProfile: (profileUid) => openUserProfile(profileUid, { backTo: () => openChatWith(uid) }),
      setTitle: (text) => (pageViewTitle.textContent = text),
      setBack: (handler) => (pageBackTarget = handler),
      setActions: setPageActions,
      setHeader: showPageHeader,
      goBack: () => pageViewBack && pageViewBack.click(),
      closePage: closePageView
    });
  } catch (error) {
    console.error(error);
    pageViewBody.innerHTML = `<p class="text-center text-slate-muted text-sm py-10">Could not open the chat.</p>`;
  }
}

// Red badge on the Chat tab with the number of unread messages
function watchUnreadMessages(uid) {
  const chatTab = document.querySelector('.nav-link[data-page="chat"]');
  if (!chatTab) return;

  chatTab.classList.add("relative");
  let badge = chatTab.querySelector(".fz-chat-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "fz-chat-badge absolute -top-0.5 left-1/2 ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-white text-[10px] font-bold items-center justify-center";
    badge.style.display = "none";
    chatTab.appendChild(badge);
  }

  onValue(
    ref(db, `userChats/${uid}`),
    (snap) => {
      let total = 0;
      snap.forEach((child) => {
        total += Number(child.val()?.unread) || 0;
      });
      badge.textContent = total > 99 ? "99+" : String(total);
      badge.style.display = total > 0 ? "flex" : "none";
    },
    () => {} // no permission or no network: simply no badge
  );
}

// Post detail: tapping the author or a commenter's photo/name opens their profile
if (postDetailBody) {
  postDetailBody.addEventListener("click", (event) => {
    const target = event.target.closest("[data-profile-uid]");
    if (target) openUserProfile(target.dataset.profileUid);
  });
}

function closePageView() {
  pageBackTarget = null;
  showPageHeader(true);
  setPageActions();
  pageView.hidden = true;
  document.body.style.overflow = "";
  pageViewBody.innerHTML = "";
}

// When a profile was opened from the Friends list, Back returns to that list
let pageBackTarget = null;

if (pageViewBack) {
  pageViewBack.addEventListener("click", () => {
    if (pageBackTarget) {
      const goBack = pageBackTarget;
      pageBackTarget = null;
      goBack();
    } else {
      closePageView();
    }
  });
}

document.querySelectorAll(".nav-link[data-page]").forEach((button) => {
  button.addEventListener("click", () => {
    openPageView(button.dataset.page, button.dataset.title);
  });
});

// Ads (= boosted posts, see ads.js) are optional: if ads.js is missing or fails, the feed simply stays as it is
let adsModule = null;
function showAds(container, placement, context = {}) {
  if (!adsModule) adsModule = import("./ads.js").catch(() => null);
  adsModule.then((module) => module && module.insertAds(container, { placement, context })).catch(() => {});
}

function listenPosts() {
  let latestPosts = null;
  let hasMore = false;
  let capped = false;

  // The line under the last post: "Loading more..." while older posts can still be loaded, "all caught up" at the end
  const moreEl = document.createElement("div");
  moreEl.className = "feed-more py-8 text-center text-slate-muted font-body-md text-body-md";
  moreEl.style.display = "none";
  postsContainer.after(moreEl);
  let pager = null;

  // Top order (feed-algorithm.js). The order is kept while I scroll, so posts never jump under my finger:
  // it is made again only when I change tab / sort, pull down, tap "New posts" or come back to the top.
  let rankedIds = null;
  const resetRank = () => { rankedIds = null; };
  // Part 8: posts that stayed on the screen long enough (kept 7 days on this phone) and views counted on the post
  const seenIds = loadSeen();
  // Part 9: "Not interested" (post hidden now; its author and hashtags go down in Top)
  const less = loadLess();
  const tracker = createViewTracker({
    seen: seenIds,
    getMe: () => currentUser?.uid,
    onSeen: (id) => learnHook?.(id, "view"),
    save: (ids) => {
      const updates = {};
      ids.forEach((id) => { updates[`posts/${id}/viewsCount`] = increment(1); });
      // Creator Program: a view of an approved creator is counted (creatorViews.js)
      ids.forEach((id) => {
        const post = (latestPosts || []).find((p) => p.id === id);
        if (post && post.uid) recordView(db, currentUser.uid, post.uid, postVideoOf(post) ? "v" : "p", id);
      });
      return update(ref(db), updates);
    }
  });
  const interests = createInterestStore({ db, uid: currentUser.uid });
  learnHook = (what, action) => {
    const post = typeof what === "string" ? (latestPosts || []).find((p) => p.id === what) : what;
    if (post) interests.learn(post, action);
  };
  notInterestedHandler = (post) => {
    interests.learn(post, "hide");
    const tags = tagsOf(post).slice(0, 2);
    const before = markNotInterested(less, post, tags);
    const card = postsContainer.querySelector(`article[data-post-id="${CSS.escape(post.id)}"]`);
    if (card) card.remove();
    showUndoToast("Got it. You will see fewer posts like this.", () => {
      undoNotInterested(less, post, tags, before);
      applyList();
    });
  };

  // Tabs: For you (everyone) / Following (people I follow)
  const feedTabs = createFeedTabs({
    before: postsSkeleton || emptyState || postsContainer, // right under the stories: above the grey cards and the "not following anyone" message
    onSortChange: () => {
      gate.release();
      resetRank();
      applyList();
      window.scrollTo({ top: 0 });
      if (hasMore) end.check();
    },
    onChange: () => {
      gate.release();
      resetRank();
      const back = memory.restoreFor(feedTabs.tab);   // this tab has a remembered place: go back to it
      applyList();
      if (!back) window.scrollTo({ top: 0 });
      // few posts from followed people in the loaded window: keep loading older ones until the screen is filled
      if (hasMore) end.check();
    }
  });
  const inTab = (post) => inFeedTab(feedTabs.tab, post, currentUser?.uid, followingIds);

  // Where I was: remembered per tab, and across a reload
  try { history.scrollRestoration = "manual"; } catch (error) { /* ignore */ }
  const memory = createScrollMemory({ container: postsContainer });
  memory.restoreFor(feedTabs.tab);
  let memoryTick = false;
  window.addEventListener("scroll", () => {
    if (memoryTick) return;
    memoryTick = true;
    requestAnimationFrame(() => { memoryTick = false; if (!pageView?.hidden || !postDetail?.hidden) return; memory.note(feedTabs.tab); });
  }, { passive: true });

  // The messages of an empty feed (empty-state.js)
  const emptyHandlers = {
    create: () => openPageView("create", "Create Post"),
    refresh: () => (pager ? pager.refresh() : undefined),
    find: () => openPageView("friends", "Friends"),
    foryou: () => feedTabs.el.querySelector('[data-tab="foryou"]')?.click(),
    retry: () => location.reload()
  };

  // "New posts": while reading further down, other people's new posts wait behind a button instead of moving the page
  let shown = null; // the posts the feed shows (the latest list minus the ones waiting)
  const isAtTop = () => window.scrollY < 120;
  const gate = createNewPostsGate({
    me: () => currentUser?.uid,
    isAtTop,
    passes: (post) => !isBlocked(post.uid) && !isMuted(post.uid) && canViewPost(post, currentUser?.uid, followingIds) && inTab(post)
  });
  const pill = createNewPostsPill({
    onClick: () => {
      gate.release();
      resetRank();
      applyList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  const applyList = () => {
    if (!latestPosts) return;
    shown = gate.update(latestPosts);
    renderPosts();
    if (gate.count) pill.show(gate.count);
    else pill.hide();
  };
  window.addEventListener(
    "scroll",
    () => {
      if (gate.count && isAtTop()) {
        gate.release(); // back at the top: let them in
        resetRank();
        applyList();
      }
    },
    { passive: true }
  );

  // Pull down at the very top: bring in the waiting new posts and start the feed again from the newest page
  attachPullToRefresh({
    enabled: () => (!pageView || pageView.hidden) && (!postDetail || postDetail.hidden),
    onRefresh: () => {
      gate.release();
      resetRank();
      return pager ? pager.refresh() : undefined;
    }
  });

  feedApply = () => {
    gate.release();
    applyList();
  };
  const end = watchEnd(moreEl, () => pager && pager.hasMore && pager.loadMore());

  // Posts of people I blocked are not shown
  // "Top": the posts in the order of the feed algorithm; "Latest": as they were loaded (newest first)
  // Debug mode (part 17): open the feed once with  ?debug=algo  (turn off with ?debug=off). Every post then shows why it is where it is.
  const debugInfo = new Map();
  try {
    const flag = new URLSearchParams(location.search).get("debug");
    if (flag === "algo") localStorage.setItem("fz_algo_debug", "1");
    if (flag === "off") localStorage.removeItem("fz_algo_debug");
  } catch (error) { /* storage blocked */ }
  const debugOn = () => { try { return localStorage.getItem("fz_algo_debug") === "1"; } catch (error) { return false; } };
  const addDebugLine = (card, id) => {
    const info = debugInfo.get(id);
    if (!info) return;
    const line = document.createElement("div");
    line.className = "fz-algo-debug";
    line.style.cssText = "font:11px/1.4 monospace;padding:4px 16px;background:#fef9c3;color:#713f12;border-top:1px dashed #ca8a04;";
    line.textContent = `score ${info.score.toFixed(2)} = quality ${info.quality.toFixed(2)} × fresh ${info.freshness.toFixed(2)} × (1 + ${info.affinity.toFixed(2)})` +
      (info.penalty !== 1 ? ` × penalty ${info.penalty.toFixed(2)}` : "") + (info.cold ? ` · new person ${info.cold.toFixed(2)}` : "");
    card.appendChild(line);
  };
  const orderPosts = (list) => {
    if (feedTabs.sort !== "top" || list.length < 2) return list;
    const context = {
      me: currentUser?.uid,
      followingIds,
      followerIds,
      chattedIds,
      likedAuthors: likedAuthorsFrom(latestPosts || [], currentUser?.uid),
      seen: seenIds,
      less,
      interests: interests.profile
    };
    const byId = new Map(list.map((post) => [post.id, post]));
    // Part 17: ranking with the numbers behind it (shown on the cards only in debug mode)
    const rank = (items) => rankPosts(items, context, undefined, { explain: true }).map((item) => { debugInfo.set(item.post.id, item); return item.post; });
    if (rankedIds) {
      const known = new Set(rankedIds);
      const extra = list.filter((post) => !known.has(post.id));
      if (extra.length && isAtTop()) rankedIds = null; // at the top, nobody is reading: make the whole order again
      else if (extra.length) {
        // older pages go to the end (ranked among themselves); my own new post goes first
        const mine = extra.filter((post) => post.uid === currentUser?.uid && Date.now() - (post.createdAt || 0) < 120000);
        const rest = extra.filter((post) => !mine.includes(post));
        rankedIds = mine.map((post) => post.id).concat(rankedIds, rank(rest).map((post) => post.id));
      }
    }
    if (!rankedIds) rankedIds = rank(list).map((post) => post.id);
    return rankedIds.map((id) => byId.get(id)).filter(Boolean);
  };

  const renderPosts = () => {
    if (!shown) return;
    postsSkeleton?.remove();
    // Drawing the list again (a new page of older posts, a like, a follow) must not throw the person back to the top:
    // the old height is held while the cards are rebuilt, and the place on the screen is put back afterwards.
    const keepY = window.scrollY;
    const keepH = postsContainer.offsetHeight;
    if (keepY > 0 && keepH > 0) postsContainer.style.minHeight = keepH + "px";
    postsContainer.innerHTML = "";

    const visible = orderPosts(shown.filter((post) => !isHiddenPost(less, post.id) && !isBlocked(post.uid) && !isMuted(post.uid) && canViewPost(post, currentUser?.uid, followingIds) && inTab(post)));
    if (emptyState) {
      renderEmpty(emptyState, emptyKind({
        visibleCount: visible.length, loadedCount: shown.length, hasMore,
        tab: feedTabs.tab, followingCount: Object.keys(followingIds || {}).length
      }), emptyHandlers);
    }

    // "People you may like": one card after the 5th post (needs 6+ posts) (For you tab only). A follow redraws the feed, so it is built once per draw.
    const suggestions = feedTabs.tab === "foryou" && visible.length >= 6 && !suggestHidden()
      ? pickSuggestions(latestPosts || [], currentUser?.uid, followingIds, (uid) => isBlocked(uid) || isMuted(uid), 8)
      : [];
    visible.forEach((post, index) => {
      if (index === 5 && suggestions.length >= 2) {
        postsContainer.appendChild(createSuggestCard({
          people: suggestions,
          onFollow: (person) => toggleFollow({ uid: person.uid, name: person.name, username: person.username }, false, { redraw: false }),
          onProfile: openUserProfile,
          onSeeAll: () => openPageView("friends", "Friends")
        }));
      }
      postsContainer.appendChild(
        createPostCard(post, {
          currentUserUid: currentUser?.uid,
          savedPostIds,
          followingIds,
          onSave: toggleSavePost,
          onFollow: toggleFollow,
          onProfile: openUserProfile,
          onOpen: openPostDetail,
          onOpenVideo: (p) => openReelsAt(p.id),
          onComments: openComments,
          onLike: toggleLike,
          onShare: shareAndLearn,
          onReport: reportPost,
          onNotInterested: notInterestedHandler,
          onBlock: blockPost,
          onDelete: deletePost,
          onEdit: editPost,
          onBoost: boostPost,
          onAudience: setAudience,
          onHashtag: openHashtag,
          onVote: votePoll,
          watchVotes: watchPollVotes,
          isBlocked
        })
      );
    });

    if (debugOn()) postsContainer.querySelectorAll("article[data-post-id]").forEach((card) => addDebugLine(card, card.dataset.postId));
    showAds(postsContainer, "feed", {
      interests: interests.profile,
      tab: feedTabs.tab,
      me: currentUser?.uid,
      isBlocked,
      onOpen: openPostDetail,
      cardOptions: { ...postActions(), currentUserUid: currentUser?.uid, savedPostIds, followingIds, onProfile: openUserProfile }
    });
    tracker.watch(postsContainer);

    postsContainer.style.minHeight = "";
    if (keepY > 0 && Math.abs(window.scrollY - keepY) > 2) window.scrollTo({ top: keepY });

    // Back to the remembered place: load older pages until its post is there
    if (memory.step() === "wait" && !(pager && pager.loadMore()) && !(pager && pager.loading)) memory.giveUp(feedTabs.tab);

    // End-of-feed line, and ask for the next page when the end is still near the screen (e.g. many posts were hidden)
    if (!visible.length && !hasMore) moreEl.style.display = "none";
    else {
      moreEl.style.display = "";
      moreEl.textContent = hasMore ? "Loading more posts..." : capped ? "Showing the latest posts. Use search or tags to find older ones." : "You are all caught up";
    }
    if (hasMore) end.check();
  };
  onBlocksChange(applyList);
  onMutesChange(applyList);
  onPrivacyChange(applyList); // a request was sent or answered

  pager = createFeedPager({
    db,
    onData: (posts, state) => {
      const show = () => {
        latestPosts = posts;
        hasMore = state.hasMore;
        capped = state.capped;
        applyList();
      };
      // Is an author a private account? Known after one small read per author; until then the posts wait
      ensurePrivacy(db, posts.map((post) => post.uid)).then((learned) => {
        if (learned) show();
      });
      if (posts.every((post) => !post.uid || privacyKnown(post.uid))) show();
    },
    onError: (error) => {
      console.error("Could not read posts:", error.code, error.message);
      postsSkeleton?.remove();
      postsContainer.innerHTML = "";
      if (emptyState) {
        renderEmpty(
          emptyState,
          "error",
          emptyHandlers,
          error.code === "PERMISSION_DENIED"
            ? 'Database rules are blocking read access to "posts". Update your Realtime Database rules and reload.'
            : error.message
        );
      }
    }
  });
}

// "Block @username" in the menu of a post
function blockPost(post) {
  if (!currentUser || !post || !post.uid) return;
  blockAccount({
    db,
    me: currentUser.uid,
    user: { uid: post.uid, name: post.name, username: post.username },
    followingIds
  });
}

async function toggleFollow(post, wasFollowing, { redraw = true } = {}) {
  if (!currentUser || !post.uid || post.uid === currentUser.uid) return false;

  const me = currentUser.uid;
  const target = post.uid;
  const handle = post.username ? `@${post.username}` : post.name || "this user";

  await ensurePrivacy(db, [target]);

  // A private account: Follow sends a request (tap "Requested" to take it back)
  if (!wasFollowing && isPrivateUid(target)) {
    const cancel = isRequested(target);
    try {
      await update(ref(db), {
        [`followRequests/${target}/${me}`]: cancel ? null : serverTimestamp(),
        [`myRequests/${me}/${target}`]: cancel ? null : serverTimestamp()
      });
      setRequested(target, !cancel);
      updateFollowButtons(target, false, !cancel);
      showToast(cancel ? "Follow request cancelled" : `Follow request sent to ${handle}`);
    } catch (error) {
      console.error(error);
      showToast(error.code === "PERMISSION_DENIED" ? "Could not send the request: database rules block it" : "Something went wrong. Try again.");
    }
    return false; // not following (yet)
  }

  try {
    // Both sides are written together so the two lists never disagree
    await update(ref(db), {
      [`following/${me}/${target}`]: wasFollowing ? null : serverTimestamp(),
      [`followers/${target}/${me}`]: wasFollowing ? null : serverTimestamp()
    });

    if (wasFollowing) delete followingIds[target];
    else followingIds[target] = Date.now();

    updateFollowButtons(target, !wasFollowing);
    if (redraw) feedApply?.(); // the Following tab changes at once (the suggestion card keeps its place instead)
    emitNotify({ type: "follow", toUid: target, undo: wasFollowing });
    if (!wasFollowing) learnHook?.(post, "follow");
    showToast(wasFollowing ? `Unfollowed ${handle}` : `Following ${handle}`);
    return true;
  } catch (error) {
    console.error(error);
    showToast(
      error.code === "PERMISSION_DENIED"
        ? "Could not follow: database rules block it"
        : "Something went wrong. Try again."
    );
    return false;
  }
}

async function toggleSavePost(post, wasSaved) {
  if (!currentUser) return false;

  const saveRef = ref(db, `savedPosts/${currentUser.uid}/${post.id}`);
  try {
    if (wasSaved) {
      await remove(saveRef);
      delete savedPostIds[post.id];
      showToast("Removed from saved");
    } else {
      await set(saveRef, serverTimestamp());
      savedPostIds[post.id] = Date.now();
      learnHook?.(post, "save");
      showToast("Post saved");
    }
    return true;
  } catch (error) {
    console.error(error);
    showToast(
      error.code === "PERMISSION_DENIED"
        ? "Could not save: database rules block it"
        : "Could not save post. Try again."
    );
    return false;
  }
}

async function reportPost(post, { reason, details }) {
  if (!currentUser) return;

  // One report per user per post
  const reportRef = ref(db, `reports/${post.id}/${currentUser.uid}`);
  try {
    const existing = await get(reportRef);
    if (existing.exists()) {
      showToast("You already reported this post");
      return;
    }

    await set(reportRef, {
      postId: post.id,
      postOwnerUid: post.uid || "",
      reporterUid: currentUser.uid,
      reason,
      details: details || "",
      postText: (post.text || "").slice(0, 200),
      status: "pending",
      createdAt: serverTimestamp()
    });
    showToast("Report submitted. Thank you.");
  } catch (error) {
    console.error(error);
    showToast(
      error.code === "PERMISSION_DENIED"
        ? "Could not report: database rules block it"
        : "Could not submit report. Try again."
    );
  }
}

async function setAudience(postId, audience) {
  try {
    await update(ref(db, `posts/${postId}`), { audience: audience === "public" ? null : audience });
    showToast(audience === "public" ? "Post is now public" : audience === "followers" ? "Only your followers can see this post" : "Only you can see this post");
  } catch (error) {
    console.error(error);
    showToast("Could not change who can see this post");
  }
}

async function editPost(postId, newText) {
  // keep the #tag index in step with the new text
  let oldText = "";
  try { oldText = (await get(ref(db, `posts/${postId}/text`))).val() || ""; } catch (error) { /* index is best effort */ }
  await update(ref(db, `posts/${postId}`), {
    text: newText,
    editedAt: serverTimestamp()
  });
  try {
    const index = tagIndexUpdates(postId, oldText, newText);
    if (Object.keys(index).length) await update(ref(db), index);
  } catch (error) {
    console.warn("Could not update the #tag index:", error);
  }
}

async function deletePost(postId) {
  if (!(await fzConfirm("Delete this post? This cannot be undone.", { confirmLabel: "Delete", danger: true }))) return;
  try {
    let oldText = "";
    let files = []; // the video and its cover are removed from Cloudinary too
    try {
      const old = (await get(ref(db, `posts/${postId}`))).val() || {};
      oldText = old.text || "";
      files = [old.videoURL, old.videoThumb].filter((u) => typeof u === "string");
    } catch (error) { /* index and file clean-up are best effort */ }
    try { await remove(ref(db, `pollVotes/${postId}`)); } catch (error) { /* only posts with a poll have votes */ }
    await remove(ref(db, `posts/${postId}`));
    if (files.length) import("./storage.js").then((m) => m.deleteMedia(files)).catch(() => {});
    try { await update(ref(db), tagIndexUpdates(postId, oldText, "")); } catch (error) { /* a stale index entry is skipped by the tag page */ }
    if (currentDetailPostId === postId) closePostDetail();
  } catch (error) {
    console.error(error);
    showToast("Could not delete the post. Please try again.");
  }
}

// feed.js only announces what happened; notification.js decides who gets a notification and writes it
function emitNotify(detail) {
  document.dispatchEvent(new CustomEvent("fz:notify", { detail }));
}

async function toggleLike(postId) {
  if (!currentUser) return;

  const likeRef = ref(db, `posts/${postId}/likes/${currentUser.uid}`);
  const snap = await get(likeRef);

  if (snap.exists()) {
    await remove(likeRef);
    await update(ref(db, `posts/${postId}`), { likesCount: increment(-1) });
    emitNotify({ type: "like", postId, undo: true });
  } else {
    await set(likeRef, true);
    await update(ref(db, `posts/${postId}`), { likesCount: increment(1) });
    learnById(postId, "like");
    emitNotify({ type: "like", postId });
  }
}

function openPostDetail(postId) {
  currentDetailPostId = postId;
  postDetail.hidden = false;
  document.body.style.overflow = "hidden";

  const postRef = ref(db, `posts/${postId}`);
  unsubscribePostDetail = onValue(postRef, (snapshot) => {
    if (!snapshot.exists()) {
      closePostDetail();
      return;
    }
    if (!canViewPost(snapshot.val(), currentUser?.uid, followingIds)) {
      closePostDetail();
      showToast("This post is not available");
      return;
    }
    renderPostDetail(postId, snapshot.val());
  });
}

function closePostDetail() {
  postDetail.hidden = true;
  document.body.style.overflow = pageView && !pageView.hidden ? "hidden" : "";
  if (unsubscribePostDetail) unsubscribePostDetail();
  if (detailComments) detailComments.destroy();
  unsubscribePostDetail = null;
  detailComments = null;
  currentDetailPostId = null;
}

if (postDetailBack) postDetailBack.addEventListener("click", closePostDetail);

function renderPostDetail(postId, post) {
  // The same card as in the feed (new design); the full comment list is mounted below it
  const keepScroll = postDetailBody.scrollTop;
  // A like or a comment redraws the card: the video of the post keeps its place instead of starting again
  const oldVideo = postDetailBody.querySelector(".post-video video");
  const keepVideo = oldVideo && oldVideo.getAttribute("src") === post.videoURL ? { time: oldVideo.currentTime, playing: !oldVideo.paused } : null;
  postDetailBody.innerHTML = `<div id="postDetailCard" class="-mx-3 sm:-mx-4 -mt-4"></div><div id="postDetailComments" class="space-y-4 px-1 pb-4"></div>`;
  $("#postDetailCard").appendChild(
    createPostCard(
      { ...post, id: postId },
      {
        ...postActions(),
        currentUserUid: currentUser?.uid,
        savedPostIds,
        followingIds,
        onSave: toggleSavePost,
        onFollow: toggleFollow,
        onProfile: openUserProfile,
        onOpen: undefined,
        onComments: () => postDetailCommentInput?.focus()
      }
    )
  );
  postDetailBody.scrollTop = keepScroll;
  // A boosted post is "Sponsored" on its own page too
  if (!adsModule) adsModule = import("./ads.js").catch(() => null);
  adsModule.then((module) => module && module.markSponsored($("#postDetailCard"), postId, { me: currentUser?.uid })).catch(() => {});
  const newVideo = keepVideo && postDetailBody.querySelector(".post-video video");
  if (newVideo) {
    newVideo.preload = "auto";
    const restore = () => { try { newVideo.currentTime = keepVideo.time; } catch (error) { /* not seekable yet */ } };
    if (newVideo.readyState >= 1) restore(); else newVideo.addEventListener("loadedmetadata", restore, { once: true });
  }

  // Comments (like, reply, delete) are handled by comments.js; keep the same list when only the post changed
  if (detailComments && detailComments.postId === postId) {
    detailComments.rebind($("#postDetailComments"));
  } else {
    if (detailComments) detailComments.destroy();
    detailComments = mountComments({
      db,
      postId,
      getMe,
      listEl: $("#postDetailComments"),
      formEl: postDetailCommentForm,
      inputEl: postDetailCommentInput,
      isBlocked // profile taps are handled by the page (data-profile-uid)
    });
  }
}

// Who is writing (read when a comment is sent, so a changed name or photo is used)
function getMe() {
  if (!currentUser) return {};
  const profile = currentProfile || {};
  return {
    uid: currentUser.uid,
    name: profile.name || "FreeZone User",
    username: profile.username || "",
    photoURL: profile.photoURL || ""
  };
}

// The Comment button of a post: the comments open in a sheet that slides up (comments.js)
function openComments(postId) {
  if (!currentUser) return;
  openCommentsSheet({
    db,
    postId,
    getMe,
    isBlocked,
    onPosted: () => learnById(postId, "comment"),
    onProfile: (uid) => openUserProfile(uid)
  });
}

// Reels: the Video button in the bottom bar (features.js lets this run when the admin has Reels "On")
registerFeature("reels", () => openReelsAt(""));

// startPostId = the video the person tapped in the feed: Reels opens on it
function openReelsAt(startPostId) {
  if (!currentUser) return;
  pausePostVideos(); // a video of the feed behind Reels must not keep playing
  import("./reels.js").then((module) => module.openReels({
    startPostId,
    db,
    currentUser,
    followingIds,
    followerIds,
    chattedIds,
    isBlocked,
    isMuted,
    onLike: toggleLike,
    onComments: openComments,
    onShare: shareAndLearn,
    onProfile: (uid) => openUserProfile(uid),
    onFollow: toggleFollow,
    savedPostIds,
    onSave: toggleSavePost,
    learn: (post, action) => learnHook?.(post, action),
    isCovered: () => !pageView.hidden || !postDetail.hidden
  })).catch((error) => { console.error(error); showToast("Could not open Reels"); });
}
