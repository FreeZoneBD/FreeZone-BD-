// FreeZone BD - "Sending post…" bar (shown on the Feed while a post uploads in the background)
// create.js runs the upload (postQueue) and announces every change with the "fz-postq" event.
// This file only draws the bar; Cancel / Retry / Discard are passed on to create.js.

let inited = false;

export function initSendBar({ onView } = {}) {
  if (inited) return;
  inited = true;

  const style = document.createElement("style");
  style.textContent = `
    .fz-sendbar{position:fixed;left:0;right:0;z-index:56;max-width:32rem;margin:0 auto;background:rgb(var(--c-slate-surface));border-top:1px solid rgb(var(--c-slate-border));border-bottom:1px solid rgb(var(--c-slate-border));box-shadow:0 -6px 20px rgba(0,0,0,.18);transform:translateY(8px);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
    .fz-sendbar.on{transform:none;opacity:1;pointer-events:auto}
    .fz-sendbar .r{display:flex;align-items:center;gap:12px;padding:11px 16px}
    .fz-sendbar .th{width:38px;height:38px;border-radius:10px;flex:none;background:rgb(var(--c-surface-container)) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#6c9bff}
    .fz-sendbar .m{flex:1;min-width:0}
    .fz-sendbar .m b{display:block;font-size:15px;font-weight:700;line-height:20px}
    .fz-sendbar .m small{display:block;font-size:12.5px;color:rgb(var(--c-slate-muted));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fz-sendbar button{font-size:14.5px;font-weight:800;padding:8px 6px;flex:none;background:none;border:0;cursor:pointer}
    .fz-sendbar .cancel,.fz-sendbar .discard{color:#ff7a93}
    .fz-sendbar .view,.fz-sendbar .retry{color:#6c9bff}
    .fz-sendbar .pb{height:3px;background:rgb(var(--c-surface-container))}
    .fz-sendbar .pb div{height:100%;width:0;background:linear-gradient(90deg,#3b82f6,#2fc48d);transition:width .2s ease-out}
    .fz-sendbar.done{background:linear-gradient(135deg,rgba(47,196,141,.16),transparent),rgb(var(--c-slate-surface))}
    .fz-sendbar.done .m b{color:#2fc48d}
    .fz-sendbar.failed .m b{color:#ff7a93}
    html.fz-sending .fz-fab{transform:translateY(calc(-1 * var(--fz-send-h,0px)));transition:transform .18s}
    @media (prefers-reduced-motion:reduce){.fz-sendbar,.fz-sendbar .pb div,html.fz-sending .fz-fab{transition:none}}
  `;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "fz-sendbar";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = `<div class="r"><div class="th"><span class="material-symbols-outlined" style="font-size:22px">image</span></div><div class="m"><b></b><small></small></div><span class="acts" style="display:flex;gap:4px"></span></div><div class="pb"><div></div></div>`;
  document.body.appendChild(bar);

  const titleEl = bar.querySelector("b");
  const subEl = bar.querySelector("small");
  const actsEl = bar.querySelector(".acts");
  const thEl = bar.querySelector(".th");
  const fillEl = bar.querySelector(".pb div");
  let shown = false;

  const place = () => {
    // Sits right above the bottom bar (the bottom bar can slide away while scrolling)
    const nav = document.querySelector(".fz-bottomnav");
    let bottom = 0;
    if (nav) {
      const top = nav.getBoundingClientRect().top;
      bottom = Math.max(0, window.innerHeight - top);
    }
    bar.style.bottom = bottom + "px";
  };
  let raf = 0;
  const schedulePlace = () => { if (shown && !raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  window.addEventListener("resize", schedulePlace);
  document.addEventListener("scroll", schedulePlace, { capture: true, passive: true });

  const show = (on) => {
    shown = on;
    bar.classList.toggle("on", on);
    document.documentElement.classList.toggle("fz-sending", on);
    if (on) {
      place();
      document.documentElement.style.setProperty("--fz-send-h", bar.offsetHeight + "px");
    }
  };

  const queue = () => import("./create.js").then((m) => m.postQueue);

  actsEl.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const what = btn.className;
    if (what.includes("cancel")) queue().then((q) => q.cancel());
    else if (what.includes("retry")) queue().then((q) => q.retry());
    else if (what.includes("discard")) queue().then((q) => q.discard());
    else if (what.includes("view")) {
      const id = bar.dataset.postId;
      queue().then((q) => q.discard());
      if (id && onView) onView(id);
    }
  });

  window.addEventListener("fz-postq", (event) => {
    const s = event.detail || {};
    if (s.status === "idle") { show(false); return; }
    bar.classList.toggle("done", s.status === "done");
    bar.classList.toggle("failed", s.status === "failed");
    bar.dataset.postId = s.postId || "";
    if (s.thumb) { thEl.style.backgroundImage = `url("${s.thumb}")`; thEl.firstElementChild.style.display = "none"; }
    else { thEl.style.backgroundImage = ""; thEl.firstElementChild.style.display = ""; }
    if (s.status === "sending") {
      titleEl.textContent = "Sending post…";
      subEl.textContent = s.sub || "";
      fillEl.style.width = Math.round((s.fraction || 0) * 100) + "%";
      actsEl.innerHTML = s.canCancel === false ? "" : `<button type="button" class="cancel">Cancel</button>`;
    } else if (s.status === "done") {
      titleEl.textContent = "Your post was sent";
      subEl.textContent = s.sub || "";
      fillEl.style.width = "100%";
      actsEl.innerHTML = `<button type="button" class="view">View</button>`;
    } else if (s.status === "failed") {
      titleEl.textContent = "Post not sent";
      subEl.textContent = s.message || "Try again";
      fillEl.style.width = "0%";
      actsEl.innerHTML = `<button type="button" class="retry">Retry</button><button type="button" class="discard">Discard</button>`;
    }
    show(true);
  });
}
