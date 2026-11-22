// FreeZone Lite - calls to the Cloudflare Worker that need a signed-in person (the Worker checks the real records and writes them itself).
// workerCall(path, body, fresh) never throws. It answers { status, ok, data }:
//   status 0 = no network / no Worker address,  404 = an older Worker (the caller may use the old direct way),  other = the Worker's own answer.
import { PUSH_WORKER_URL } from "./app-info.js";
import { auth } from "./config.js";

export async function workerCall(path, body = {}, fresh = false, timeoutMs = 15000) {
  const base = String(PUSH_WORKER_URL || "").replace(/\/+$/, "");
  if (!base || !auth.currentUser) return { status: 0, ok: false, data: {} };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const token = await auth.currentUser.getIdToken(!!fresh);
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body), signal: ctl.signal });
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, ok: res.ok, data: data || {} };
  } catch (error) {
    return { status: 0, ok: false, data: {} };
  } finally {
    clearTimeout(timer);
  }
}

/** Deletes everything of mine on the server (steps; asks again until done). The last answer: ok && data.done, 409 = a payout / boost is still open. */
export async function deleteAccountOnServer() {
  let r = { status: 0, ok: false, data: {} };
  for (let i = 0; i < 25; i++) {
    r = await workerCall("/delete-account", {}, i === 0, 30000);
    if (!r.ok || r.data.done === true) return r;
  }
  return r;
}
