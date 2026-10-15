// FreeZone BD - push notifications (Firebase Cloud Messaging).
// Two jobs:
//  1. In the Android app: ask for permission, get this phone's FCM token and give it to the push Worker.
//  2. Everywhere (app and website): after a message, a call, a like... is saved, tell the Worker, which pushes it to the other person.
// Nothing happens until PUSH_WORKER_URL in app-info.js is filled in.
import { auth } from "./config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { PUSH_WORKER_URL } from "./app-info.js";

const cap = window.Capacitor;
const native = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
const Push = native && cap.Plugins ? cap.Plugins.PushNotifications : null;
const TOKEN_KEY = "fz_push_token";
const base = String(PUSH_WORKER_URL || "").replace(/\/+$/, "");

const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } };
const saveToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* ignore */ } };

async function callWorker(path, body) {
  if (!base || !auth.currentUser) return false;
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + idToken },
    body: JSON.stringify(body || {}),
    keepalive: true
  });
  return res.ok;
}

// Fire and forget: a push that fails must never get in the way of sending a message
function notify(payload) {
  if (!base) return;
  callWorker("/notify", payload).catch(() => {});
}

async function unregister(all) {
  if (!base) return;
  try {
    await callWorker("/unregister", all ? { all: true } : { token: readToken() });
  } catch (e) { /* ignore */ }
}

let started = false;
async function setupNative() {
  if (!Push || !base || started) return;
  // the app tells us whether Firebase is really running; if not, never ask for push (it would crash the app)
  try { if (window.FzNative && typeof window.FzNative.push === "function" && !window.FzNative.push()) return; } catch (e) { /* older app: carry on */ }
  started = true;
  try {
    await Push.createChannel({ id: "messages", name: "Messages", description: "New chat messages", importance: 4, visibility: 0, vibration: true });
    await Push.createChannel({ id: "calls", name: "Calls", description: "Incoming calls", importance: 5, visibility: 0, vibration: true });
    await Push.createChannel({ id: "activity", name: "Likes, comments and follows", description: "Activity on your posts and profile", importance: 3, visibility: 0 });
  } catch (e) { /* older Android: channels do not exist */ }

  Push.addListener("registration", async (t) => {
    if (!t || !t.value) return;
    saveToken(t.value);
    try { await callWorker("/register", { token: t.value }); } catch (e) { /* tried again at the next start */ }
  });
  Push.addListener("registrationError", (e) => console.warn("Push registration failed:", e));

  // tapping a notification opens the chat / post / profile it is about
  Push.addListener("pushNotificationActionPerformed", (action) => {
    const data = action && action.notification && action.notification.data;
    const url = data && data.url;
    if (!url || !/^feed\.html(\?[\w=&%.\-]*)?$/.test(url)) return;
    try {
      const last = Number(sessionStorage.getItem("fz_push_nav") || 0);
      if (Date.now() - last < 8000) return; // never loop
      sessionStorage.setItem("fz_push_nav", String(Date.now()));
    } catch (e) { /* ignore */ }
    window.location.href = url;
  });

  try {
    let status = (await Push.checkPermissions()).receive;
    if (status === "prompt" || status === "prompt-with-rationale") status = (await Push.requestPermissions()).receive;
    if (status === "granted") await Push.register();
  } catch (e) { console.warn("Push permission:", e); }
}

if (native) {
  onAuthStateChanged(auth, (user) => {
    if (user) setTimeout(setupNative, 3500); // let the feed open first
  });
}

window.fzPush = { notify, unregister, enabled: !!base };
