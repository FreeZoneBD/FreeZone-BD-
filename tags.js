// FreeZone BD - post tags: a feeling / activity ("😊 feeling happy") and a place ("📍 Dhaka").
// openFeelingSheet(current) and openPlaceSheet(current) resolve with the chosen text, "" to remove the tag, or null when closed.

const FEELINGS = [
  ["😊", "feeling happy"], ["🥰", "feeling loved"], ["😇", "feeling blessed"], ["🤩", "feeling excited"], ["🙏", "feeling grateful"], ["😎", "feeling cool"],
  ["😌", "feeling relaxed"], ["🥳", "feeling festive"], ["😢", "feeling sad"], ["😴", "feeling tired"], ["😡", "feeling angry"], ["🤒", "feeling sick"]
];
const ACTIVITIES = [
  ["🍽️", "eating"], ["☕", "drinking tea / coffee"], ["📺", "watching"], ["🎧", "listening to"], ["📖", "reading"], ["🎮", "playing"],
  ["🚌", "traveling"], ["🎉", "celebrating"], ["🕌", "praying"], ["💪", "working out"], ["💻", "working"], ["🏏", "watching cricket"]
];
const PLACE_KEY = "fz_recent_places";
const readPlaces = () => { try { const v = JSON.parse(localStorage.getItem(PLACE_KEY) || "[]"); return Array.isArray(v) ? v.slice(0, 6) : []; } catch (e) { return []; } };
export const rememberPlace = (place) => { try { localStorage.setItem(PLACE_KEY, JSON.stringify([place, ...readPlaces().filter((p) => p !== place)].slice(0, 6))); } catch (e) { /* ignore */ } };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function sheet(title, bodyHtml, wire) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/40";
    overlay.innerHTML = `
      <div class="w-full max-w-lg bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col" style="max-height:80vh" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 class="font-headline-sm text-headline-sm text-on-surface font-semibold">${esc(title)}</h2>
          <button type="button" class="tg-close w-8 h-8 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
        </div>
        <div class="tg-body overflow-y-auto px-4 pb-5">${bodyHtml}</div>
      </div>`;
    const close = (value) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(value); };
    const onKey = (event) => { if (event.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (event) => { event.stopPropagation(); if (event.target === overlay) close(null); });
    overlay.querySelector(".tg-close").addEventListener("click", () => close(null));
    wire(overlay, close);
    document.body.appendChild(overlay);
    overlay.querySelector("input")?.focus?.();
  });
}

const chip = (emoji, text) => `<button type="button" class="tg-pick flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-container-low text-left active:bg-surface-container" data-v="${esc(emoji + " " + text)}"><span class="text-[22px]">${emoji}</span><span class="font-body-md text-body-md text-on-surface">${esc(text)}</span></button>`;
const INPUT = "w-full bg-surface-container-low border border-transparent focus:border-primary-container focus:ring-2 focus:ring-primary-container/15 rounded-xl px-3.5 py-2.5 text-[16px] outline-none";

export function openFeelingSheet(current = "") {
  const body = `
    <p class="font-label-md text-label-md text-slate-muted mt-1 mb-2">Feeling</p>
    <div class="grid grid-cols-2 gap-2">${FEELINGS.map(([e, t]) => chip(e, t)).join("")}</div>
    <p class="font-label-md text-label-md text-slate-muted mt-4 mb-2">Doing</p>
    <div class="grid grid-cols-2 gap-2">${ACTIVITIES.map(([e, t]) => chip(e, t)).join("")}</div>
    <p class="font-label-md text-label-md text-slate-muted mt-4 mb-2">Or write your own</p>
    <div class="flex gap-2"><input type="text" class="tg-own ${INPUT}" maxlength="40" placeholder="e.g. 🎂 celebrating my birthday" /><button type="button" class="tg-own-ok px-4 rounded-xl bg-primary-container text-white font-label-md text-label-md font-semibold disabled:opacity-50" disabled>Add</button></div>
    ${current ? `<button type="button" class="tg-clear w-full mt-4 py-2.5 rounded-xl text-error font-label-lg text-label-lg bg-surface-container">Remove "${esc(current)}"</button>` : ""}`;
  return sheet("How are you feeling?", body, (overlay, close) => {
    const own = overlay.querySelector(".tg-own"), ok = overlay.querySelector(".tg-own-ok");
    own.addEventListener("input", () => (ok.disabled = !own.value.trim()));
    ok.addEventListener("click", () => close(own.value.trim().slice(0, 40)));
    own.addEventListener("keydown", (e) => { if (e.key === "Enter" && own.value.trim()) close(own.value.trim().slice(0, 40)); });
    overlay.addEventListener("click", (event) => {
      const pick = event.target.closest(".tg-pick");
      if (pick) close(pick.dataset.v);
      if (event.target.closest(".tg-clear")) close("");
    });
  });
}

export function openPlaceSheet(current = "") {
  const recent = readPlaces();
  const body = `
    <div class="flex gap-2 mt-1"><input type="text" class="tg-place ${INPUT}" maxlength="60" value="${esc(current)}" placeholder="Where are you? e.g. Dhaka, Cox's Bazar" /><button type="button" class="tg-place-ok px-4 rounded-xl bg-primary-container text-white font-label-md text-label-md font-semibold disabled:opacity-50" ${current ? "" : "disabled"}>Add</button></div>
    ${recent.length ? `<p class="font-label-md text-label-md text-slate-muted mt-4 mb-2">Recent places</p><div class="flex flex-wrap gap-2">${recent.map((p) => `<button type="button" class="tg-recent px-3 py-1.5 rounded-full bg-surface-container text-on-surface font-label-md text-label-md" data-v="${esc(p)}">📍 ${esc(p)}</button>`).join("")}</div>` : ""}
    ${current ? `<button type="button" class="tg-clear w-full mt-4 py-2.5 rounded-xl text-error font-label-lg text-label-lg bg-surface-container">Remove place</button>` : ""}`;
  return sheet("Add a place", body, (overlay, close) => {
    const input = overlay.querySelector(".tg-place"), ok = overlay.querySelector(".tg-place-ok");
    const done = () => { const v = input.value.trim().replace(/\s+/g, " ").slice(0, 60); if (v) { rememberPlace(v); close(v); } };
    input.addEventListener("input", () => (ok.disabled = !input.value.trim()));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); });
    ok.addEventListener("click", done);
    overlay.addEventListener("click", (event) => {
      const r = event.target.closest(".tg-recent");
      if (r) close(r.dataset.v);
      if (event.target.closest(".tg-clear")) close("");
    });
  });
}

/** The small line under the author's name: "😊 feeling happy · 📍 Dhaka" (empty when the post has neither). */
export function tagLineHtml(post, escapeHtml) {
  const parts = [];
  if (post && post.feeling) parts.push(escapeHtml(post.feeling));
  if (post && post.place) parts.push(`<span class="material-symbols-outlined text-[13px] align-[-2px]">location_on</span> ${escapeHtml(post.place)}`);
  return parts.length ? `<div class="post-tags text-on-surface-variant text-[13px] leading-[18px] truncate">${parts.join(" · ")}</div>` : "";
}
