// FreeZone BD - uploads of videos, their cover pictures and voice messages (Cloudinary, free plan, no card).
// The phone asks our Cloudflare Worker for a signed upload ticket (only signed-in people get one, and the file goes into
// their own name), then sends the file straight to Cloudinary. The Cloudinary secret never leaves the Worker.
//
//   uploadVideo(file, { uid, kind, signal, onProgress, onPrepare }) -> https URL   (onPrepare: the "making it smaller" step)      kind: "posts" | "stories" | "chat"
//   uploadThumb(blob,  { uid, kind, signal })            -> https URL      (the cover picture of a video)
//   uploadAudio(blob,  { uid, kind, signal, onProgress }) -> https URL     (voice messages)
//   deleteMedia(urls)                                    -> true/false     (removes the files of a deleted post or story)
//
// Old Firebase Storage version: Firebase now needs a paid (Blaze) plan for Storage, so it is no longer used.

import { auth } from "./config.js";
import { compressVideo } from "./video-tools.js";
import * as appInfo from "./app-info.js"; // a namespace import: a missing PUSH_WORKER_URL is just undefined

const abortError = () => Object.assign(new Error("Upload cancelled"), { name: "AbortError" });

const workerBase = () => String(appInfo.PUSH_WORKER_URL || "").replace(/\/+$/, "");

// Asks the Worker for the ticket of ONE file
async function getTicket(kind, type, signal) {
  const base = workerBase();
  const user = auth && auth.currentUser;
  if (!base) throw Object.assign(new Error("Storage is not connected"), { code: "no-storage" });
  if (!user) throw Object.assign(new Error("Please log in again"), { code: "no-login" });
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}/sign`, {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ kind, type }),
    signal
  }).catch((error) => { throw error && error.name === "AbortError" ? abortError() : Object.assign(new Error("No internet connection"), { code: "network" }); });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 429) throw Object.assign(new Error((data && data.error) || "Video storage is full for now. Please try again later."), { code: "storage-full" });
  if (!res.ok || !data || !data.ok) throw Object.assign(new Error(`Upload setup failed (${res.status}): ${(data && data.error) || "no answer from the server"}`), { code: "sign-failed", status: res.status });
  return data;
}

function sendFile(blob, ticket, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const form = new FormData();
    form.append("file", blob);
    form.append("api_key", ticket.apiKey);
    form.append("timestamp", String(ticket.timestamp));
    form.append("folder", ticket.folder);
    form.append("public_id", ticket.publicId);
    form.append("signature", ticket.signature);
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const done = () => { if (signal) signal.removeEventListener("abort", onAbort); };
    xhr.open("POST", ticket.uploadUrl);
    xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable && e.total) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      done();
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      const url = json && (json.secure_url || json.url);
      if (xhr.status >= 200 && xhr.status < 300 && typeof url === "string" && url.startsWith("https://")) {
        if (onProgress) onProgress(1);
        return resolve(url);
      }
      const why = json && json.error && json.error.message;
      reject(Object.assign(new Error(`Upload failed (${xhr.status}): ${why || "Cloudinary did not accept the file"}`), { code: "upload-failed", status: xhr.status }));
    };
    xhr.onerror = () => { done(); reject(Object.assign(new Error("No internet connection"), { code: "network" })); };
    xhr.onabort = () => { done(); reject(abortError()); };
    xhr.send(form);
  });
}

async function upload(blob, kind, type, opts = {}) {
  const ticket = await getTicket(kind, type, opts.signal);
  return sendFile(blob, ticket, opts);
}

// A big video is first made smaller on the phone (720p, about 1.8 Mbit/s), see compressVideo. onPrepare(0..1) tells how far that is.
export const uploadVideo = async (file, { uid, kind = "posts", signal, onProgress, onPrepare } = {}) => {
  // the ticket comes FIRST: if the daily video limit (5) or the storage is full, the person hears it at once and does not
  // wait for the video to be made smaller. (A ticket is valid for an hour: much longer than making a video smaller.)
  const ticket = await getTicket(kind, "video", signal);
  let toSend = file;
  try { toSend = (await compressVideo(file, { signal, onProgress: onPrepare })).file; } catch (error) { if (error && error.name === "AbortError") throw error; }
  return sendFile(toSend, ticket, { signal, onProgress });
};

export const uploadThumb = (blob, { uid, kind = "posts", signal } = {}) => upload(blob, kind, "image", { signal });

// Voice message: audio/webm;codecs=opus, audio/mp4 ... -> https URL
export const uploadAudio = (blob, { uid, kind = "chat", signal, onProgress } = {}) => {
  const base = String(blob.type || "audio/webm").split(";")[0];
  return upload(new Blob([blob], { type: base }), kind, "audio", { signal, onProgress });
};

// Removes the Cloudinary files of a deleted post or story (best effort: it never throws and never blocks the delete).
// Only our own Cloudinary links are sent; photos kept elsewhere (imgbb) are ignored. The Worker checks the owner again.
export async function deleteMedia(urls) {
  try {
    const list = (Array.isArray(urls) ? urls : [urls])
      .filter((u) => typeof u === "string" && /^https:\/\/res\.cloudinary\.com\//.test(u))
      .slice(0, 4);
    const base = workerBase();
    const user = auth && auth.currentUser;
    if (!list.length || !base || !user) return false;
    const idToken = await user.getIdToken();
    const res = await fetch(`${base}/destroy`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ urls: list }),
      keepalive: true
    });
    return res.ok;
  } catch (error) {
    return false;
  }
}
