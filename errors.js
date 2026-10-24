// FreeZone BD - problem reporter. Catches errors in the website and in the Android app (the app is this same website inside a WebView)
// and saves a short record to  errorLogs/{id}  so admins can see WHERE a problem happened (Admin panel > Problems).
//
// What is caught: JavaScript errors, unhandled promise failures (including Firebase "permission denied"), failed calls to the push Worker,
// and anything the code reports itself with  reportProblem("where", error).
// What is NOT caught: crashes of the native Android part itself (those need Firebase Crashlytics), and anything while the phone is offline.
// Safe by design: it never throws, never blocks the page, sends at most a few records per visit, and sends no passwords, messages or tokens.
import { APP_VERSION, PUSH_WORKER_URL } from "./app-info.js";

const MAX_PER_VISIT = 8;
const REPEAT_MS = 10 * 60 * 1000; // the same problem from the same phone is sent once per 10 minutes
let sent = 0;
let ready = null;

const clip = (value, n) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, n);
const pageName = () => clip((location.pathname.split("/").pop() || "index.html") + (location.hash ? "#" + location.hash.slice(1, 30) : ""), 80);
const isApp = () => document.documentElement.classList.contains("fz-native");

// strip anything that looks like a token / key / email from the text before it leaves the phone
const scrub = (text) => String(text)
  .replace(/([?&](?:auth|token|key|access_token|apikey)=)[^&\s]+/gi, "$1***")
  .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_.-]{10,}/g, "***")
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "***@***");

function fingerprint(kind, msg, src) {
  const s = kind + "|" + msg.replace(/\d+/g, "#").slice(0, 120) + "|" + src.replace(/\?.*$/, "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function loadFirebase() {
  if (!ready) {
    ready = Promise.all([
      import("./config.js"),
      import("https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js")
    ]).then(([cfg, fb]) => ({ cfg, fb })).catch(() => null);
  }
  return ready;
}

async function send(kind, rawMsg, rawSrc, rawStack, where) {
  try {
    if (sent >= MAX_PER_VISIT) return;
    if (navigator.onLine === false) return;
    const msg = clip(scrub(rawMsg), 300) || "(no message)";
    const src = clip(scrub(rawSrc), 200);
    const fp = fingerprint(kind, msg, src);
    try {
      const seen = JSON.parse(localStorage.getItem("fz-err-seen") || "{}");
      const now = Date.now();
      if (seen[fp] && now - seen[fp] < REPEAT_MS) return;
      seen[fp] = now;
      Object.keys(seen).forEach((k) => { if (now - seen[k] > REPEAT_MS) delete seen[k]; });
      localStorage.setItem("fz-err-seen", JSON.stringify(seen));
    } catch (e) { /* storage not available: still send, the per-visit limit protects us */ }
    sent++;
    const lib = await loadFirebase();
    if (!lib) return;
    const { cfg, fb } = lib;
    const record = {
      kind, msg, fp,
      page: clip(where || pageName(), 80),
      plat: isApp() ? "app" : "web",
      ver: clip(APP_VERSION, 20),
      ua: clip(navigator.userAgent, 200),
      at: fb.serverTimestamp()
    };
    if (src) record.src = src;
    const stack = clip(scrub(rawStack || ""), 1000);
    if (stack) record.stack = stack;
    const uid = cfg.auth && cfg.auth.currentUser && cfg.auth.currentUser.uid;
    if (uid) record.uid = uid;
    await fb.set(fb.push(fb.ref(cfg.db, "errorLogs")), record);
  } catch (e) { /* the reporter must never cause a problem itself */ }
}

const IGNORE = /ResizeObserver loop|Non-Error promise rejection captured|AbortError|The user aborted a request|Load failed$|NetworkError when attempting to fetch|Failed to fetch$/i;

window.addEventListener("error", (event) => {
  try {
    // a broken <img>/<script> tag fires "error" on the element, not on window
    if (event.target && event.target !== window && event.target.tagName) {
      const t = event.target;
      if (t.tagName === "SCRIPT" || t.tagName === "LINK") send("js", "Could not load a file: " + t.tagName.toLowerCase(), t.src || t.href || "", "");
      return;
    }
    const msg = event.message || (event.error && event.error.message) || "";
    if (IGNORE.test(msg)) return;
    const src = (event.filename || "").split("/").pop() + (event.lineno ? ":" + event.lineno : "");
    send("js", msg, src, event.error && event.error.stack);
  } catch (e) { /* ignore */ }
}, true);

window.addEventListener("unhandledrejection", (event) => {
  try {
    const reason = event.reason;
    const msg = (reason && (reason.message || reason.code)) || String(reason || "");
    if (IGNORE.test(msg)) return;
    const firebase = /permission[_ ]denied|PERMISSION_DENIED|auth\/|database\//i.test(msg + " " + ((reason && reason.code) || ""));
    send(firebase ? "firebase" : "promise", msg, "", reason && reason.stack);
  } catch (e) { /* ignore */ }
});

// calls to the push Worker (notifications, uploads, country check ...) that fail or answer with a server error
try {
  const realFetch = window.fetch;
  if (typeof realFetch === "function" && PUSH_WORKER_URL) {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const watched = url.indexOf(PUSH_WORKER_URL) === 0;
      const result = realFetch.apply(this, arguments);
      if (watched) {
        const route = url.slice(PUSH_WORKER_URL.length).split("?")[0] || "/";
        result.then((res) => { if (res && res.status >= 500) send("network", "Worker " + route + " answered " + res.status, route, ""); },
                    (err) => { send("network", "Worker " + route + " not reachable: " + ((err && err.message) || ""), route, ""); });
      }
      return result;
    };
  }
} catch (e) { /* ignore */ }

/** For code that catches an error itself but still wants admins to know:  reportProblem("Upload", error) */
export function reportProblem(where, error) {
  const msg = (error && (error.message || error.code)) || String(error || "");
  send("manual", msg, "", error && error.stack, where);
}
window.fzReportProblem = reportProblem;
