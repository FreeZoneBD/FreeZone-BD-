// FreeZone BD - settings for audio / video calls (call.js)
//
// STUN lets two phones find each other. It is free and enough for most Wi-Fi calls.
// Some mobile-data networks (4G) also need a TURN relay. The relay details are fetched from the push Worker
// (which keeps the Cloudflare TURN key secret); if that is not set up or not reachable, calls use STUN only.
import { auth } from "./config.js";
import { PUSH_WORKER_URL } from "./app-info.js";

const STUN_ONLY = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
export const ICE_SERVERS = STUN_ONLY;

export const RING_TIMEOUT_MS = 45000; // the caller gives up (missed call) after this long

const KEEP_MS = 6 * 60 * 60 * 1000; // the relay details are valid for 24 hours; asked again after 6
let cached = null;                  // { at, servers }
let inflight = null;

/** The servers to use right now (instant): the relay ones when they were fetched, otherwise STUN only. */
export function currentIceServers() {
  return cached && Date.now() - cached.at < KEEP_MS ? cached.servers : STUN_ONLY;
}

/** Fetches the relay details in the background. Never fails and never waits longer than timeoutMs. */
export function warmIceServers(timeoutMs = 2500) {
  const base = String(PUSH_WORKER_URL || "").replace(/\/+$/, "");
  if (!base || !auth.currentUser) return Promise.resolve(currentIceServers());
  if (cached && Date.now() - cached.at < KEEP_MS) return Promise.resolve(cached.servers);
  if (!inflight) {
    inflight = (async () => {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const res = await fetch(base + "/ice", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + idToken },
          body: "{}"
        });
        const data = res.ok ? await res.json() : null;
        const list = data && Array.isArray(data.iceServers) ? data.iceServers : [];
        if (list.length) cached = { at: Date.now(), servers: [...list, ...STUN_ONLY] };
      } catch (error) { /* STUN only */ }
      inflight = null;
    })();
  }
  return Promise.race([inflight, new Promise((resolve) => setTimeout(resolve, timeoutMs))]).then(currentIceServers);
}
