// FreeZone BD - read a QR code from a picture (a saved QR image, a screenshot or a photo).
// Uses the phone's built-in reader when it has one (Chrome on Android); otherwise loads the small jsQR reader once.
// readQrFromFile(file) -> the text inside the QR code, or "" when no QR code could be found.

const JSQR_URL = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
let jsQrPromise = null;

export function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQrPromise) {
    jsQrPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = JSQR_URL;
      script.async = true;
      script.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error("QR reader missing")));
      script.onerror = () => { jsQrPromise = null; reject(new Error("QR reader could not load")); };
      document.head.appendChild(script);
    });
  }
  return jsQrPromise;
}

async function toBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch (error) { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export async function readQrFromFile(file) {
  const image = await toBitmap(file);
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;

  if ("BarcodeDetector" in window) {
    try {
      const found = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(image);
      if (found && found[0] && found[0].rawValue) return found[0].rawValue;
    } catch (error) {
      // fall back to jsQR below
    }
  }

  const jsQR = await loadJsQr();
  // Try the picture at a few sizes: very large photos and tiny QR images both read better when resized
  for (const limit of [1000, 600, 1600]) {
    const scale = Math.min(1, limit / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(image, 0, 0, w, h);
    const result = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (result && result.data) return result.data;
  }
  return "";
}
