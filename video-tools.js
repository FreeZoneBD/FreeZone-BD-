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
    <button type="button" class="fz-vp-close absolute right-3 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center" style="top:max(0.75rem, env(safe-area-inset-top));" aria-label="Close"><span class="material-symbols-outlined">close</span></button>`;
  const player = overlay.querySelector("video");
  const close = () => { player.pause(); player.removeAttribute("src"); player.load(); overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.querySelector(".fz-vp-close").addEventListener("click", close);
  player.addEventListener("error", close);
  document.body.appendChild(overlay);
}
