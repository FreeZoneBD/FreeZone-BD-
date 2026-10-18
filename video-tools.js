import { saveVideo } from "./app-info.js";

// FreeZone BD - small helpers shared by every place that takes a video (post, story, chat).
// Nothing here uploads anything; it only looks at a video file on this phone.
//   probeVideo(file)               -> { duration, width, height }   (rejects with code "unsupported" when this phone cannot play it)
//   checkVideoFile(file, limit)    -> { ok, code, message }          limit = LIMITS.post | LIMITS.story | LIMITS.chat
//   captureFrame(file|url, time)   -> Blob (a JPEG picture of that moment of the video)
//   formatDuration(sec) / formatSize(bytes)

// The limits (the admin will be able to change them later)
export const LIMITS = {
  post:  { mb: 50, sec: 60 },
  story: { mb: 30, sec: 20 },
  chat:  { mb: 25, sec: 60 }
};

export const formatDuration = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const formatSize = (bytes) => {
  const mb = (Number(bytes) || 0) / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

const fail = (code, message) => Object.assign(new Error(message), { code });

// Opens the file in a hidden <video> to read its length and size. Gives up after 8 seconds.
function withVideo(source, run) {
  return new Promise((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const own = typeof source !== "string";
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const done = () => { clearTimeout(timer); video.removeAttribute("src"); video.load(); if (own) URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { done(); reject(fail("unsupported", "This video could not be opened")); }, 8000);
    video.onerror = () => { done(); reject(fail("unsupported", "This video could not be opened")); };
    video.onloadedmetadata = async () => {
      try { const out = await run(video); done(); resolve(out); } catch (error) { done(); reject(error); }
    };
    video.src = url;
  });
}

export function probeVideo(file) {
  return withVideo(file, (video) => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw fail("unsupported", "This video has no length");
    return { duration, width: video.videoWidth || 0, height: video.videoHeight || 0 };
  });
}

export function captureFrame(source, time = 0, { maxWidth = 720, quality = 0.82 } = {}) {
  return withVideo(source, (video) => new Promise((resolve, reject) => {
    const at = Math.min(Math.max(0, Number(time) || 0), Math.max(0, (video.duration || 0) - 0.05));
    const draw = () => {
      try {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return reject(fail("unsupported", "No picture in this video"));
        const scale = Math.min(1, maxWidth / w);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(fail("capture", "Could not make a picture"))), "image/jpeg", quality);
      } catch (error) { reject(fail("capture", "Could not make a picture")); }
    };
    if (at < 0.01) { video.onseeked = null; video.requestVideoFrameCallback ? requestAnimationFrame(draw) : draw(); return; }
    video.onseeked = draw;
    video.currentTime = at;
  }));
}

/** Checks the type, the size and (when `probe` is true) the length. Never throws. */
export async function checkVideoFile(file, limit = LIMITS.post, { probe = true } = {}) {
  if (!file || !String(file.type || "").startsWith("video/")) return { ok: false, code: "type", message: "Please choose a video file" };
  if (file.size > limit.mb * 1024 * 1024) return { ok: false, code: "size", message: `This video is too big (max ${limit.mb} MB)` };
  if (!probe) return { ok: true };
  try {
    const info = await probeVideo(file);
    if (info.duration > limit.sec + 0.5) return { ok: false, code: "long", message: `This video is too long (max ${limit.sec} seconds)`, info };
    return { ok: true, info };
  } catch (error) {
    return { ok: false, code: "unsupported", message: "This video format cannot be played on this phone. Try an MP4 video." };
  }
}

/**
 * Makes a big video smaller BEFORE it is uploaded (saves the free Cloudinary space and the phone's data).
 * The video is played once, quietly, on a canvas and recorded again at 720p and about 1.8 Mbit/s.
 * It takes about as long as the video itself (a 20 s video: about 20 s).
 * Resolves { file, compressed }. It never fails: if anything goes wrong (the phone cannot record MP4, the result is not
 * smaller, a timeout ...) the ORIGINAL file is returned. Only a cancel (AbortSignal) rejects, with name "AbortError".
 *   options.onProgress(0..1)  options.signal  options.maxSide (1280)  options.videoBps  options.audioBps  options.minBytes
 *   options.allowWebm (false) - WebM files have no length inside, so the player cannot seek; only used by tests.
 */
export async function compressVideo(file, options = {}) {
  const { signal, onProgress, maxSide = 1280, videoBps = 1800000, audioBps = 96000, minBytes = 3 * 1024 * 1024, allowWebm = false } = options;
  const original = { file, compressed: false };
  const abortError = () => Object.assign(new Error("Upload cancelled"), { name: "AbortError" });
  if (signal && signal.aborted) throw abortError();
  try {
    if (!file || file.size < minBytes) return original;
    const Recorder = window.MediaRecorder;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!Recorder || !AudioCtx || !HTMLCanvasElement.prototype.captureStream) return original;
    const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"].concat(allowWebm ? ["video/webm;codecs=vp8,opus", "video/webm"] : []);
    const mimeType = types.find((t) => { try { return Recorder.isTypeSupported(t); } catch (e) { return false; } });
    if (!mimeType) return original;
    const baseType = mimeType.split(";")[0];
    const ext = baseType === "video/mp4" ? "mp4" : "webm";

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    let ac = null;
    let recorder = null;
    let timer = 0;
    let frameId = 0;
    const cleanup = () => {
      clearTimeout(timer);
      if (frameId) { try { video.cancelVideoFrameCallback ? video.cancelVideoFrameCallback(frameId) : cancelAnimationFrame(frameId); } catch (e) { /* ignore */ } }
      try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (e) { /* ignore */ }
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) { /* ignore */ }
      try { if (ac) ac.close(); } catch (e) { /* ignore */ }
      URL.revokeObjectURL(url);
    };

    const result = await new Promise((resolve, reject) => {
      let finished = false;
      const end = (value, error) => { if (finished) return; finished = true; if (signal) signal.removeEventListener("abort", onAbort); cleanup(); error ? reject(error) : resolve(value); };
      const onAbort = () => end(null, abortError());
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      video.onerror = () => end(original);
      video.onloadedmetadata = async () => {
        try {
          const duration = video.duration, w = video.videoWidth, h = video.videoHeight;
          if (!Number.isFinite(duration) || duration <= 0 || !w || !h) return end(original);
          const scale = Math.min(1, maxSide / Math.max(w, h));
          // already small enough (low bitrate, small picture): leave it alone
          if (scale === 1 && (file.size * 8) / duration < videoBps * 1.3) return end(original);
          const even = (n) => Math.max(2, Math.round(n / 2) * 2);
          const canvas = document.createElement("canvas");
          canvas.width = even(w * scale);
          canvas.height = even(h * scale);
          const g = canvas.getContext("2d");
          const stream = canvas.captureStream(30);

          ac = new AudioCtx();
          await ac.resume();
          if (ac.state !== "running") return end(original); // the sound could not be recorded: do not lose it
          const source = ac.createMediaElementSource(video); // the sound goes to the recorder, not to the speaker
          const sink = ac.createMediaStreamDestination();
          source.connect(sink);
          sink.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

          const chunks = [];
          recorder = new Recorder(stream, { mimeType, videoBitsPerSecond: videoBps, audioBitsPerSecond: audioBps });
          recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
          recorder.onerror = () => end(original);
          recorder.onstop = () => {
            if (finished) return;
            const blob = new Blob(chunks, { type: baseType });
            if (!blob.size || blob.size >= file.size * 0.9) return end(original); // not really smaller
            const name = String(file.name || "video").replace(/\.[^.]+$/, "") + "." + ext;
            end({ file: new File([blob], name, { type: baseType }), compressed: true });
          };

          const paint = () => {
            if (finished) return;
            g.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (onProgress) onProgress(Math.min(1, video.currentTime / duration));
            frameId = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(paint) : requestAnimationFrame(paint);
          };
          video.onended = () => { try { g.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (e) { /* ignore */ } setTimeout(() => { try { recorder.stop(); } catch (e) { end(original); } }, 200); };
          timer = setTimeout(() => end(original), duration * 2000 + 15000); // far too slow: give up and send the original
          recorder.start(1000);
          await video.play();
          paint();
        } catch (error) { end(original); }
      };
    });
    if (onProgress && result && result.compressed) onProgress(1);
    return result || original;
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    return original;
  }
}

/** Full-screen player (tap X or press Escape to close). video = { url, thumb? } */
export function openVideoPlayer(video) {
  if (!video || !video.url) return;
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[9999] bg-black flex items-center justify-center";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Video");
  overlay.innerHTML = `
    <video src="${esc(video.url)}" ${video.thumb ? `poster="${esc(video.thumb)}"` : ""} class="max-w-full max-h-full" controls autoplay playsinline></video>
    <button type="button" class="fz-vp-close absolute right-3 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center" style="top:max(0.75rem, env(safe-area-inset-top));" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
    <button type="button" class="fz-vp-save absolute right-16 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center" style="top:max(0.75rem, env(safe-area-inset-top));" aria-label="Save video"><span class="material-symbols-outlined">download</span></button>`;
  const player = overlay.querySelector("video");
  const close = () => { player.pause(); player.removeAttribute("src"); player.load(); overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.querySelector(".fz-vp-close").addEventListener("click", close);
  let saving = false;
  overlay.querySelector(".fz-vp-save").addEventListener("click", async () => {
    if (saving) return;
    saving = true;
    await saveVideo(video.url, (text) => {
      const t = document.createElement("div");
      t.textContent = text;
      t.style.cssText = "position:absolute;left:50%;bottom:calc(40px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:rgba(20,20,24,.92);color:#fff;padding:9px 16px;border-radius:99px;font:14px/1.3 system-ui,sans-serif;max-width:80%;text-align:center;pointer-events:none;";
      overlay.appendChild(t);
      setTimeout(() => t.remove(), 2200);
    });
    saving = false;
  });
  player.addEventListener("error", close);
  document.body.appendChild(overlay);
}
