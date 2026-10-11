// FreeZone BD - scan a QR code with the camera.
// openQrScanner({ accept, title, hint }) -> Promise<string | null>
//   resolves with the text of the first accepted QR code, or null when the person closes the scanner.
//   accept(text) -> true to take it; false = keep scanning and show "not a FreeZone code".
//   rejects with Error("denied" | "nocamera" | "unsupported") so the caller can offer "choose a picture" instead.
import { loadJsQr } from "./qr-read.js";

const SIDE = 640;        // the camera frame is scaled to this width before reading (fast on phones)
const INTERVAL = 120;    // ms between reads

export async function openQrScanner({ accept = () => true, title = "Scan QR code", hint = "Point the camera at a QR code" } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("unsupported");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (error) {
    const name = error && error.name;
    throw new Error(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "nocamera");
  }

  // The reader: the phone's own (fast) or jsQR
  let detector = null;
  if ("BarcodeDetector" in window) {
    try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (error) { detector = null; }
  }
  let jsQR = null;
  if (!detector) {
    try { jsQR = await loadJsQr(); } catch (error) { stream.getTracks().forEach((t) => t.stop()); throw new Error("unsupported"); }
  }

  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "fz-scanner";
    root.style.cssText = "position:fixed;inset:0;z-index:130;background:#000;color:#fff;display:flex;flex-direction:column";
    root.setAttribute("role", "dialog");
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;gap:8px;position:relative;z-index:2">
        <button type="button" class="fz-sc-close" aria-label="Close" style="width:40px;height:40px;border-radius:999px;background:rgba(255,255,255,.18);color:#fff;font-size:20px">✕</button>
        <span class="fz-sc-title" style="font-weight:700;font-size:16px;flex:1;text-align:center"></span>
        <span style="width:40px"></span>
      </div>
      <div style="position:relative;flex:1;min-height:0;overflow:hidden">
        <video class="fz-sc-video" playsinline muted autoplay style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none">
          <div style="width:min(70vw,300px);aspect-ratio:1/1;border-radius:20px;box-shadow:0 0 0 100vmax rgba(0,0,0,.55);border:3px solid rgba(255,255,255,.9)"></div>
        </div>
      </div>
      <div class="fz-sc-hint" style="padding:16px 20px 24px;text-align:center;font-size:15px;min-height:60px"></div>`;
    root.querySelector(".fz-sc-title").textContent = title;
    const hintEl = root.querySelector(".fz-sc-hint");
    hintEl.textContent = hint;
    document.body.appendChild(root);

    const video = root.querySelector(".fz-sc-video");
    video.srcObject = stream;
    video.play().catch(() => {});

    let done = false, timer = null, wrongAt = 0, lastWrong = "";
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d", { willReadFrequently: true });

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      root.remove();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === "Escape") finish(null); };
    document.addEventListener("keydown", onKey);
    root.querySelector(".fz-sc-close").addEventListener("click", () => finish(null));

    const read = async () => {
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          let text = "";
          if (detector) {
            const found = await detector.detect(video);
            text = found && found[0] ? found[0].rawValue : "";
          } else {
            const scale = Math.min(1, SIDE / video.videoWidth);
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            g.drawImage(video, 0, 0, canvas.width, canvas.height);
            const result = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
            text = result && result.data ? result.data : "";
          }
          text = String(text || "").trim();
          if (text && !done) {
            if (accept(text)) return finish(text);
            if (text !== lastWrong || Date.now() - wrongAt > 2500) {
              lastWrong = text; wrongAt = Date.now();
              hintEl.textContent = "This is not a FreeZone profile QR code. Keep looking.";
              hintEl.style.color = "#fca5a5";
              setTimeout(() => { if (!done) { hintEl.textContent = hint; hintEl.style.color = ""; } }, 2500);
            }
          }
        } catch (error) { /* one frame could not be read: try the next */ }
      }
      if (!done) timer = setTimeout(read, INTERVAL);
    };
    read();
  });
}
