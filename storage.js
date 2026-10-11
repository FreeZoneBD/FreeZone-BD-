// FreeZone BD - uploads to Firebase Storage (videos and their cover pictures).
// Works only after config.js exports `storage` (see features.js). Until then nothing here is called.
// uploadVideo(file, { uid, kind, signal, onProgress }) -> download URL     kind: "posts" | "stories" | "chat"
// uploadThumb(blob,  { uid, kind, signal })            -> download URL
// uploadAudio(blob,  { uid, kind, signal, onProgress }) -> download URL  (voice messages)

import * as cfg from "./config.js";
import { ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";

const abortError = () => Object.assign(new Error("Upload cancelled"), { name: "AbortError" });
const rand = () => Math.random().toString(36).slice(2, 8);

function upload(blob, path, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!cfg.storage) return reject(Object.assign(new Error("Storage is not connected"), { code: "no-storage" }));
    if (signal && signal.aborted) return reject(abortError());
    const task = uploadBytesResumable(sRef(cfg.storage, path), blob, { contentType: blob.type || "application/octet-stream" });
    const onAbort = () => task.cancel();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    task.on(
      "state_changed",
      (snap) => onProgress && snap.totalBytes && onProgress(snap.bytesTransferred / snap.totalBytes),
      (error) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(error && error.code === "storage/canceled" ? abortError() : error);
      },
      async () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        try { resolve(await getDownloadURL(task.snapshot.ref)); } catch (error) { reject(error); }
      }
    );
  });
}

export const uploadVideo = (file, { uid, kind = "posts", signal, onProgress } = {}) => {
  const ext = (file.type.split("/")[1] || "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "mp4";
  return upload(file, `${kind}/${uid}/${Date.now()}-${rand()}.${ext}`, { signal, onProgress });
};

export const uploadThumb = (blob, { uid, kind = "posts", signal } = {}) =>
  upload(blob, `${kind}/${uid}/${Date.now()}-${rand()}-cover.jpg`, { signal });

// Voice message: audio/webm;codecs=opus, audio/mp4 ... -> download URL
export const uploadAudio = (blob, { uid, kind = "chat", signal, onProgress } = {}) => {
  const base = String(blob.type || "audio/webm").split(";")[0];
  const ext = (base.split("/")[1] || "webm").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "webm";
  return upload(new Blob([blob], { type: base }), `${kind}/${uid}/${Date.now()}-${rand()}-voice.${ext}`, { signal, onProgress });
};
