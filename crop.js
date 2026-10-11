// FreeZone BD - the photo cropper (profile picture and post photos).
// openCropper(file, options) -> Promise<Blob | null>   (null = cancelled; rejects if the file is not an image)
//   aspects: [{ id, label, ratio }]   ratio = width / height, or "auto" = the photo's own shape
//   circle: show a round frame (the result is still a square picture; the app shows it round)
//   outSize: exact output side in px for a square result (avatars), else maxSide limits the longest side
// Drag to move, pinch / wheel / slider to zoom, the turn button rotates by 90 degrees.

const MAX_ZOOM = 4;

const loadDrawable = (source) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(source);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This file is not a valid image.")); };
  img.src = url;
});

const sizeOf = (d) => ({ w: d.naturalWidth || d.width, h: d.naturalHeight || d.height });

export async function openCropper(source, options = {}) {
  const {
    aspects = [{ id: "sq", label: "1:1", ratio: 1 }],
    circle = false, outSize = 0, maxSide = 1280,
    title = "Crop photo", doneLabel = "Done"
  } = options;

  let img = await loadDrawable(source);
  let { w: iw, h: ih } = sizeOf(img);
  if (!iw || !ih) throw new Error("This file is not a valid image.");

  return new Promise((resolve) => {
    let aspect = aspects[0];
    let zoom = 1, cx = iw / 2, cy = ih / 2;
    let W = 0, H = 0, fw = 0, fh = 0, minS = 1, dpr = 1;

    const root = document.createElement("div");
    root.className = "fz-cropper";
    root.style.cssText = "position:fixed;inset:0;z-index:120;background:#000;display:flex;flex-direction:column;color:#fff;font-family:inherit";
    root.setAttribute("role", "dialog");
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;gap:8px">
        <button type="button" class="fz-cr-cancel" style="padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-weight:600">Cancel</button>
        <span style="font-weight:700;font-size:16px;text-align:center;flex:1">${title.replace(/[<>&]/g, "")}</span>
        <button type="button" class="fz-cr-done" style="padding:8px 16px;border-radius:999px;background:#2563eb;color:#fff;font-weight:700">${doneLabel.replace(/[<>&]/g, "")}</button>
      </div>
      <canvas class="fz-cr-stage" style="flex:1;min-height:0;width:100%;touch-action:none;cursor:grab"></canvas>
      <div style="padding:10px 14px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px;opacity:.7">−</span>
          <input class="fz-cr-zoom" type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" style="flex:1" aria-label="Zoom" />
          <span style="font-size:18px;opacity:.7">+</span>
          <button type="button" class="fz-cr-rot" aria-label="Rotate" style="width:40px;height:40px;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-size:20px">⟳</button>
        </div>
        <div class="fz-cr-aspects" style="display:${aspects.length > 1 ? "flex" : "none"};gap:8px;justify-content:center;flex-wrap:wrap"></div>
      </div>`;
    document.body.appendChild(root);

    const canvas = root.querySelector(".fz-cr-stage");
    const ctx = canvas.getContext("2d");
    const slider = root.querySelector(".fz-cr-zoom");
    const aspectRow = root.querySelector(".fz-cr-aspects");
    const ratioOf = (a) => (a.ratio === "auto" ? iw / ih : a.ratio);

    const paintAspects = () => {
      aspectRow.innerHTML = "";
      aspects.forEach((a) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.id = a.id;
        b.textContent = a.label;
        b.style.cssText = `padding:6px 14px;border-radius:999px;font-weight:600;font-size:14px;color:#fff;background:${a === aspect ? "#2563eb" : "rgba(255,255,255,.14)"}`;
        aspectRow.appendChild(b);
      });
    };

    const scale = () => minS * zoom;
    const clamp = () => {
      const s = scale();
      const hw = fw / (2 * s), hh = fh / (2 * s);
      cx = hw * 2 >= iw ? iw / 2 : Math.min(iw - hw, Math.max(hw, cx));
      cy = hh * 2 >= ih ? ih / 2 : Math.min(ih - hh, Math.max(hh, cy));
    };

    const layout = () => {
      dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
      const pad = 20, mw = Math.max(40, W - pad * 2), mh = Math.max(40, H - pad * 2), r = ratioOf(aspect);
      if (mw / mh > r) { fh = mh; fw = fh * r; } else { fw = mw; fh = fw / r; }
      minS = Math.max(fw / iw, fh / ih);
      clamp();
      draw();
    };

    const draw = () => {
      const s = scale();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, W / 2 - cx * s, H / 2 - cy * s, iw * s, ih * s);
      const x0 = (W - fw) / 2, y0 = (H - fh) / 2;
      ctx.fillStyle = "rgba(0,0,0,.62)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      if (circle) ctx.ellipse(W / 2, H / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2); else ctx.rect(x0, y0, fw, fh);
      ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2;
      ctx.beginPath();
      if (circle) ctx.ellipse(W / 2, H / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2); else ctx.rect(x0, y0, fw, fh);
      ctx.stroke();
      if (!circle) {
        ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 1; i < 3; i++) {
          ctx.moveTo(x0 + (fw * i) / 3, y0); ctx.lineTo(x0 + (fw * i) / 3, y0 + fh);
          ctx.moveTo(x0, y0 + (fh * i) / 3); ctx.lineTo(x0 + fw, y0 + (fh * i) / 3);
        }
        ctx.stroke();
      }
    };

    const setZoom = (z) => {
      zoom = Math.min(MAX_ZOOM, Math.max(1, z));
      slider.value = String(zoom);
      clamp(); draw();
    };

    // --- gestures ---
    const pointers = new Map();
    let pinch = 0;
    const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinch = dist();
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) {
        const s = scale();
        cx -= dx / s; cy -= dy / s;
        clamp(); draw();
      } else if (pointers.size === 2) {
        const d = dist();
        if (pinch > 0 && d > 0) setZoom(zoom * (d / pinch));
        pinch = d;
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); pinch = pointers.size === 2 ? dist() : 0; if (!pointers.size) canvas.style.cursor = "grab"; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.002)); }, { passive: false });
    slider.addEventListener("input", () => setZoom(Number(slider.value)));

    aspectRow.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      aspect = aspects.find((a) => a.id === b.dataset.id) || aspect;
      paintAspects(); layout();
    });

    root.querySelector(".fz-cr-rot").addEventListener("click", () => {
      const c = document.createElement("canvas");
      c.width = ih; c.height = iw;
      const g = c.getContext("2d");
      g.translate(ih, 0); g.rotate(Math.PI / 2);
      g.drawImage(img, 0, 0);
      img = c; [iw, ih] = [ih, iw];
      zoom = 1; cx = iw / 2; cy = ih / 2; slider.value = "1";
      layout();
    });

    // --- finish ---
    const onKey = (e) => { if (e.key === "Escape") finish(null); };
    const onResize = () => layout();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    let finished = false;
    const finish = (blob) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      root.remove();
      resolve(blob);
    };
    root.querySelector(".fz-cr-cancel").addEventListener("click", () => finish(null));
    root.querySelector(".fz-cr-done").addEventListener("click", () => {
      const s = scale();
      const cw = fw / s, ch = fh / s;                       // the framed part, in photo pixels
      let ow, oh;
      if (outSize) { ow = oh = outSize; }
      else { const k = Math.min(1, maxSide / Math.max(cw, ch)); ow = Math.max(1, Math.round(cw * k)); oh = Math.max(1, Math.round(ch * k)); }
      const out = document.createElement("canvas");
      out.width = ow; out.height = oh;
      const g = out.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, ow, oh);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, ow, oh);
      out.toBlob((blob) => finish(blob), "image/jpeg", 0.9);
    });

    paintAspects();
    requestAnimationFrame(layout);
  });
}
