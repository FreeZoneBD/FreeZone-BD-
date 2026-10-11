// FreeZone BD - private accounts.
//  users/{uid}/isPrivate        = true  -> only approved followers see the posts; others send a follow request
//  followRequests/{target}/{requester} = time     the requests a private account has received (the owner reads and answers them)
//  myRequests/{requester}/{target}     = time     the same request, kept on the requester's side ("Requested" button)
// Like "who can see this post", this hides things inside the app. The database itself still lets a signed-in person read posts.
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const priv = new Map();        // uid -> true | false (what we know)
const requested = new Set();   // accounts I asked to follow and wait for
const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch (error) { /* a listener must not break the others */ } });

export const isPrivateUid = (uid) => priv.get(uid) === true;
export const privacyKnown = (uid) => priv.has(uid);
export const isRequested = (uid) => requested.has(uid);
export const onPrivacyChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function setPrivate(uid, value) {
  if (priv.get(uid) === !!value) return;
  priv.set(uid, !!value);
  notify();
}
export function setRequested(uid, on) {
  if (on === requested.has(uid)) return;
  if (on) requested.add(uid); else requested.delete(uid);
  notify();
}

/** Can I see the posts of this account? Public, mine, or I follow it. */
export const canSeeAccount = (uid, me, followingIds = {}) => !isPrivateUid(uid) || uid === me || !!(followingIds && followingIds[uid]);

/** Reads isPrivate of the accounts not known yet. Resolves true when something new was learned. */
export async function ensurePrivacy(db, uids) {
  const need = [...new Set(uids)].filter((uid) => uid && !priv.has(uid));
  if (!need.length || !db) return false;
  for (let i = 0; i < need.length; i += 25) {
    await Promise.all(need.slice(i, i + 25).map(async (uid) => {
      try {
        const snap = await get(ref(db, `users/${uid}/isPrivate`));
        priv.set(uid, snap.val() === true);
      } catch (error) {
        priv.set(uid, false); // unreadable: treated as public
      }
    }));
  }
  notify();
  return true;
}

/** Follow requests I sent that are still waiting. onGone(uid) is called when one was answered (approved or deleted). */
export function startRequests({ db, me, onGone } = {}) {
  if (!db || !me) return () => {};
  return onValue(ref(db, `myRequests/${me}`), (snap) => {
    const now = new Set();
    snap.forEach((child) => { now.add(child.key); });
    const gone = [...requested].filter((uid) => !now.has(uid));
    requested.clear();
    now.forEach((uid) => requested.add(uid));
    notify();
    gone.forEach((uid) => onGone && onGone(uid));
  }, () => {});
}
