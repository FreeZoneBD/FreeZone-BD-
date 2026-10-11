// FreeZone BD - Boost post (paid). The person who wrote a post can pay to show it between other people's posts, marked "Sponsored".
//
//   openBoost({ post })   the steps: 1 package, 2 button + link, 3 payment (bKash / Nagad), done
//   openMyBoosts()        my boosts: status, views, clicks, and "Request a refund" (only for 3 days after approval)
//
// Data (Firebase Realtime Database) - see database.rules.json:
//   boosts/{id} = { uid, postId, days, price, btnText, link, method: "bkash"|"nagad", trxId, senderNumber, screenshotURL,
//                   status: "pending"|"active"|"rejected"|"expired"|"refund_requested"|"refunded", createdAt,
//                   approvedAt?, startAt?, endAt?, refundUntil?, adminNote?, refundReason? }
//   boostTrx/{method_TRXID} = uid          (the same Transaction ID can never be used twice)
//   config/boost = { bkash: "01XXXXXXXXX", nagad: "01XXXXXXXXX" }     (set by the admin)
// Only an admin can approve. The feed (ads.js) shows the boosts the admin has approved (boostLive/{id}).

import { ref, get, set, update, remove, push, query, orderByChild, equalTo, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { db, auth } from "./config.js";
import { uploadToImgbb, prepareImage } from "./imgbb.js";
import { escapeHtml, showToast } from "./post.js";

// Must match database.rules.json (the rules reject any other price)
export const PLANS = [
  { days: 30, price: 300 },
  { days: 60, price: 500 },
  { days: 120, price: 1000 }
];
export const REFUND_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const BTN_MAX = 24;
const SHOT_MAX_MB = 10;
const BTN_IDEAS = ["Learn more", "Shop now", "Order now", "Contact us", "Visit page", "Sign up"];
const METHODS = {
  bkash: { label: "bKash", color: "#e2136e" },
  nagad: { label: "Nagad", color: "#f6921e" }
};
const STATUS = {
  pending: { label: "Waiting for approval", cls: "bg-amber-100 text-amber-800" },
  active: { label: "Running", cls: "bg-green-100 text-green-800" },
  rejected: { label: "Not approved", cls: "bg-red-100 text-red-700" },
  expired: { label: "Ended", cls: "bg-slate-200 text-slate-700" },
  refund_requested: { label: "Refund requested", cls: "bg-blue-100 text-blue-800" },
  refunded: { label: "Refunded", cls: "bg-slate-200 text-slate-700" }
};

const taka = (n) => "৳" + Number(n).toLocaleString("en-US");
const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

// the clear refund rule, shown in English and Bangla
function refundNoteHtml() {
  return `
    <div class="rounded-xl border border-slate-border bg-surface-container-low p-3 text-[13px] leading-relaxed text-on-surface">
      <div class="font-semibold flex items-center gap-1.5 mb-1"><span class="material-symbols-outlined text-[18px]">undo</span>Refund policy</div>
      <div>You can ask for a refund within <b>${REFUND_DAYS} days after your boost is approved</b>. After ${REFUND_DAYS} days a refund is <b>not possible</b>. A refunded boost stops running.</div>
      <div class="mt-1.5 text-slate-muted">বুস্ট অনুমোদনের দিন থেকে <b>${REFUND_DAYS} দিনের মধ্যে</b> টাকা ফেরত চাইতে পারবেন। ${REFUND_DAYS} দিন পর ফেরত <b>সম্ভব নয়</b>। ফেরত দিলে বুস্ট বন্ধ হয়ে যাবে।</div>
    </div>`;
}

// ---------------------------------------------------------------- sheet frame
function openSheet(title, { onBack } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "fz-boost fixed inset-0 z-[9999] bg-background text-on-surface flex flex-col";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.innerHTML = `
    <div class="bs-head h-14 shrink-0 flex items-center gap-1 px-2 border-b border-slate-border">
      <button type="button" class="bs-back w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-container" aria-label="Back"><span class="material-symbols-outlined">arrow_back</span></button>
      <div class="bs-title flex-1 font-bold text-[17px] truncate">${escapeHtml(title)}</div>
      <div class="bs-extra"></div>
    </div>
    <div class="bs-body flex-1 overflow-y-auto overscroll-contain"></div>`;
  document.body.appendChild(wrap);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const api = {
    el: wrap,
    body: wrap.querySelector(".bs-body"),
    setTitle: (t) => { wrap.querySelector(".bs-title").textContent = t; },
    setBack: (fn) => { onBack = fn; },
    extra: wrap.querySelector(".bs-extra"),
    close() {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      wrap.remove();
    }
  };
  const back = () => (onBack ? onBack() : api.close());
  const onKey = (e) => { if (e.key === "Escape") back(); };
  document.addEventListener("keydown", onKey);
  wrap.querySelector(".bs-back").addEventListener("click", back);
  return api;
}

const BTN = "w-full h-12 rounded-xl font-bold text-[15px] flex items-center justify-center gap-2 transition-all active:scale-[0.98]";
const PRIMARY = `${BTN} bg-primary-container text-white disabled:opacity-40 disabled:active:scale-100`;
const FIELD = "w-full rounded-xl border border-slate-border bg-slate-surface px-3.5 py-3 text-[15px] text-on-surface outline-none focus:border-primary-container";
const LABEL = "text-[13px] font-semibold text-slate-muted mb-1.5";

function postPreviewHtml(post) {
  const img = (post.imageURLs && post.imageURLs[0]) || post.imageURL || post.thumbURL || (post.video && (post.video.thumbURL || post.video.poster)) || "";
  const text = (post.text || "").trim();
  return `
    <div class="flex gap-3 items-center rounded-xl border border-slate-border bg-slate-surface p-2.5">
      ${img ? `<img src="${escapeHtml(img)}" alt="" class="w-14 h-14 rounded-lg object-cover bg-surface-container shrink-0">` : `<div class="w-14 h-14 rounded-lg bg-surface-container shrink-0 flex items-center justify-center text-slate-muted"><span class="material-symbols-outlined">article</span></div>`}
      <div class="min-w-0 flex-1 text-[14px] leading-snug line-clamp-3">${text ? escapeHtml(text.slice(0, 160)) : '<span class="text-slate-muted">Your post</span>'}</div>
    </div>`;
}

// the link must start with https:// (we add it when the person leaves it out)
export function cleanLink(raw) {
  let v = String(raw || "").trim();
  if (!v) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
  if (/\s/.test(v) || v.length > 600) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return "";
    return u.href;
  } catch (e) { return ""; }
}

// ---------------------------------------------------------------- 1) the boost steps
export async function openBoost({ post }) {
  const me = auth.currentUser;
  if (!me || !post || post.uid !== me.uid) { showToast("You can only boost your own posts"); return; }
  if (post.audience === "me" || post.audience === "followers") {
    showToast("Only public posts can be boosted. Change “Who can see this” to Public first.");
    return;
  }
  const sheet = openSheet("Boost post");
  sheet.body.innerHTML = `<div class="p-10 text-center text-slate-muted">Loading…</div>`;
  let cfg = null, mine = [];
  try {
    const [c, m] = await Promise.all([
      get(ref(db, "config/boost")),
      get(query(ref(db, "boosts"), orderByChild("uid"), equalTo(me.uid)))
    ]);
    cfg = c.exists() ? c.val() : null;
    m.forEach((s) => { mine.push({ id: s.key, ...s.val() }); });
  } catch (e) {
    sheet.body.innerHTML = `<div class="p-10 text-center text-slate-muted">Could not load. Check your connection and try again.</div>`;
    return;
  }
  const methods = Object.keys(METHODS).filter((k) => cfg && cfg[k]);
  if (!methods.length) {
    sheet.body.innerHTML = `<div class="p-10 text-center"><span class="material-symbols-outlined text-[44px] text-slate-muted">construction</span><div class="font-bold mt-2">Boost is not available right now</div><div class="text-slate-muted text-[14px] mt-1">Please try again later.</div></div>`;
    return;
  }
  const running = mine.find((b) => b.postId === post.id && (b.status === "pending" || b.status === "active" || b.status === "refund_requested"));
  if (running) {
    sheet.body.innerHTML = `<div class="p-8 text-center"><span class="material-symbols-outlined text-[44px] text-primary-container">campaign</span><div class="font-bold mt-2">This post already has a boost</div><div class="text-slate-muted text-[14px] mt-1">${escapeHtml(STATUS[running.status].label)}. You can see it in My boosts.</div><button type="button" class="bs-my mt-5 ${PRIMARY}">My boosts</button></div>`;
    sheet.body.querySelector(".bs-my").addEventListener("click", () => { sheet.close(); openMyBoosts(); });
    return;
  }
  if (mine.filter((b) => b.status === "pending").length >= 3) {
    sheet.body.innerHTML = `<div class="p-8 text-center text-slate-muted">You already have 3 boosts waiting for approval. Please wait until they are checked.</div>`;
    return;
  }

  const st = { plan: PLANS[0], btnText: "", link: "", method: methods[0], trxId: "", sender: "", shot: "", uploading: false, sending: false };

  const stepPlan = () => {
    sheet.setTitle("Choose a package");
    sheet.setBack(null);
    sheet.body.innerHTML = `
      <div class="max-w-lg mx-auto p-4 space-y-4">
        ${postPreviewHtml(post)}
        <p class="text-[14px] text-slate-muted">Your post will be shown to people between other posts, marked <b>Sponsored</b>, with a button that goes to your link.</p>
        <div class="space-y-2.5 bs-plans">
          ${PLANS.map((p) => `
            <button type="button" data-days="${p.days}" class="bs-plan w-full flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors">
              <span class="bs-radio w-5 h-5 rounded-full border-2 shrink-0"></span>
              <span class="flex-1"><span class="block font-bold text-[16px]">${p.days} days</span><span class="block text-[13px] text-slate-muted">${taka(Math.round(p.price / p.days * 10) / 10)} per day</span></span>
              <span class="font-extrabold text-[20px]">${taka(p.price)}</span>
            </button>`).join("")}
        </div>
        <button type="button" class="bs-next ${PRIMARY}">Next</button>
        <button type="button" class="bs-my w-full text-center text-[14px] font-semibold text-primary-container py-2">My boosts</button>
      </div>`;
    const paint = () => sheet.body.querySelectorAll(".bs-plan").forEach((b) => {
      const on = Number(b.dataset.days) === st.plan.days;
      b.style.borderColor = on ? "var(--fz-brand, #1877f2)" : "";
      b.classList.toggle("border-slate-border", !on);
      b.querySelector(".bs-radio").style.background = on ? "var(--fz-brand, #1877f2)" : "transparent";
      b.querySelector(".bs-radio").style.borderColor = on ? "var(--fz-brand, #1877f2)" : "";
    });
    paint();
    sheet.body.querySelector(".bs-plans").addEventListener("click", (e) => {
      const b = e.target.closest(".bs-plan");
      if (!b) return;
      st.plan = PLANS.find((p) => p.days === Number(b.dataset.days));
      paint();
    });
    sheet.body.querySelector(".bs-next").addEventListener("click", stepButton);
    sheet.body.querySelector(".bs-my").addEventListener("click", () => { sheet.close(); openMyBoosts(); });
  };

  const stepButton = () => {
    sheet.setTitle("Your button");
    sheet.setBack(stepPlan);
    sheet.body.innerHTML = `
      <div class="max-w-lg mx-auto p-4 space-y-4">
        <p class="text-[14px] text-slate-muted">People will see this button under your post. When they tap it they go to your link.</p>
        <div>
          <div class="${LABEL}">Button name</div>
          <input class="bs-btn ${FIELD}" maxlength="${BTN_MAX}" placeholder="e.g. Order now" value="${escapeHtml(st.btnText)}">
          <div class="flex flex-wrap gap-1.5 mt-2">${BTN_IDEAS.map((t) => `<button type="button" class="bs-idea px-2.5 py-1 rounded-full border border-slate-border text-[13px]">${t}</button>`).join("")}</div>
        </div>
        <div>
          <div class="${LABEL}">Link (where the button goes)</div>
          <input class="bs-link ${FIELD}" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="https://example.com" value="${escapeHtml(st.link)}">
          <div class="bs-linkerr text-[12.5px] text-error mt-1" hidden>Enter a valid link that starts with https://</div>
          <div class="text-[12.5px] text-slate-muted mt-1">Only https:// links are allowed. The team checks the link before approving.</div>
        </div>
        <div>
          <div class="${LABEL}">Preview</div>
          <div class="rounded-xl border border-slate-border bg-slate-surface p-3"><div class="bs-prev-btn rounded-lg bg-primary-container text-white text-center font-bold py-2.5 text-[15px]"></div></div>
        </div>
        <button type="button" class="bs-next ${PRIMARY}">Next: Payment</button>
      </div>`;
    const btn = sheet.body.querySelector(".bs-btn"), link = sheet.body.querySelector(".bs-link"), prev = sheet.body.querySelector(".bs-prev-btn"), err = sheet.body.querySelector(".bs-linkerr");
    const sync = () => { st.btnText = btn.value.trim(); prev.textContent = st.btnText || "Button name"; };
    btn.addEventListener("input", sync);
    sync();
    sheet.body.querySelectorAll(".bs-idea").forEach((b) => b.addEventListener("click", () => { btn.value = b.textContent; sync(); }));
    sheet.body.querySelector(".bs-next").addEventListener("click", () => {
      sync();
      const clean = cleanLink(link.value);
      if (!st.btnText) { showToast("Write a name for the button"); btn.focus(); return; }
      if (!clean) { err.hidden = false; link.focus(); return; }
      err.hidden = true;
      st.link = clean;
      stepPay();
    });
  };

  const stepPay = () => {
    sheet.setTitle("Payment");
    sheet.setBack(stepButton);
    sheet.body.innerHTML = `
      <div class="max-w-lg mx-auto p-4 space-y-4 pb-10">
        <div class="rounded-xl bg-surface-container-low p-3 flex items-center justify-between text-[14px]">
          <span><b>${st.plan.days} days</b> boost</span><span class="font-extrabold text-[18px]">${taka(st.plan.price)}</span>
        </div>
        <div>
          <div class="${LABEL}">Pay with</div>
          <div class="grid grid-cols-${methods.length} gap-2.5 bs-methods">
            ${methods.map((k) => `<button type="button" data-m="${k}" class="bs-method h-12 rounded-xl border-2 font-bold text-[15px]" style="--c:${METHODS[k].color}">${METHODS[k].label}</button>`).join("")}
          </div>
        </div>
        <div class="bs-send rounded-xl border border-slate-border bg-slate-surface p-3.5 space-y-2"></div>
        <div>
          <div class="${LABEL}">Number you sent from</div>
          <input class="bs-sender ${FIELD}" inputmode="numeric" maxlength="14" placeholder="01XXXXXXXXX" value="${escapeHtml(st.sender)}">
        </div>
        <div>
          <div class="${LABEL}">Transaction ID (TrxID)</div>
          <input class="bs-trx ${FIELD} uppercase" maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="e.g. 9A7B6C5D4E" value="${escapeHtml(st.trxId)}">
          <div class="bs-trxerr text-[12.5px] text-error mt-1" hidden>The Transaction ID is 6 to 20 letters or numbers.</div>
        </div>
        <div>
          <div class="${LABEL}">Payment screenshot</div>
          <input type="file" class="bs-file hidden" accept="image/*">
          <button type="button" class="bs-pick w-full rounded-xl border-2 border-dashed border-slate-border p-4 text-center text-slate-muted">
            <span class="bs-pick-in block"><span class="material-symbols-outlined text-[30px]">add_photo_alternate</span><span class="block text-[14px] font-semibold">Upload screenshot</span></span>
          </button>
          <div class="bs-shot hidden mt-2 relative"><img alt="Screenshot" class="w-full max-h-72 object-contain rounded-xl border border-slate-border bg-black/5"><button type="button" class="bs-shot-x absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Remove"><span class="material-symbols-outlined text-[18px]">close</span></button></div>
          <div class="bs-up text-[13px] text-slate-muted mt-1" hidden></div>
        </div>
        <div class="bs-done-wrap space-y-3" hidden>
          <button type="button" class="bs-complete ${PRIMARY}">Complete</button>
        </div>
        ${refundNoteHtml()}
        <div class="text-[12.5px] text-slate-muted">Your boost starts only after the team checks your payment and approves it.</div>
      </div>`;
    const q = (s) => sheet.body.querySelector(s);
    const sendBox = q(".bs-send"), sender = q(".bs-sender"), trx = q(".bs-trx"), trxErr = q(".bs-trxerr"), doneWrap = q(".bs-done-wrap");
    const paintMethod = () => {
      q(".bs-methods").querySelectorAll(".bs-method").forEach((b) => {
        const on = b.dataset.m === st.method;
        b.style.borderColor = on ? METHODS[b.dataset.m].color : "";
        b.style.background = on ? METHODS[b.dataset.m].color : "transparent";
        b.style.color = on ? "#fff" : "";
        b.classList.toggle("border-slate-border", !on);
      });
      const num = cfg[st.method];
      sendBox.innerHTML = `
        <div class="text-[14px]">Open your <b>${METHODS[st.method].label}</b> app and choose <b>Send Money</b> (not Payment or Cash Out):</div>
        <div class="flex items-center gap-2"><div class="flex-1 font-extrabold text-[22px] tracking-wide">${escapeHtml(num)}</div><button type="button" class="bs-copy px-3 h-9 rounded-full border border-slate-border text-[13px] font-semibold">Copy</button></div>
        <div class="text-[14px]">Amount: <b>${taka(st.plan.price)}</b></div>
        <div class="text-[12.5px] text-slate-muted">After sending, copy the Transaction ID from the message and paste it below.</div>`;
      sendBox.querySelector(".bs-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(num); showToast("Number copied"); } catch (e) { showToast(num); }
      });
    };
    paintMethod();
    q(".bs-methods").addEventListener("click", (e) => {
      const b = e.target.closest(".bs-method");
      if (b) { st.method = b.dataset.m; paintMethod(); }
    });
    const trxOk = () => /^[A-Z0-9]{6,20}$/.test(st.trxId);
    const refresh = () => {
      st.sender = sender.value.replace(/[^0-9+]/g, "");
      st.trxId = trx.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (trx.value !== st.trxId) trx.value = st.trxId;
      trxErr.hidden = !st.trxId || trxOk();
      doneWrap.hidden = !(trxOk() && st.shot && st.sender.length >= 10 && !st.uploading);
    };
    sender.addEventListener("input", refresh);
    trx.addEventListener("input", refresh);
    const file = q(".bs-file"), shotBox = q(".bs-shot"), pick = q(".bs-pick"), up = q(".bs-up");
    const showShot = () => {
      shotBox.classList.toggle("hidden", !st.shot);
      pick.classList.toggle("hidden", !!st.shot);
      if (st.shot) shotBox.querySelector("img").src = st.shot;
    };
    pick.addEventListener("click", () => file.click());
    q(".bs-shot-x").addEventListener("click", () => { st.shot = ""; file.value = ""; showShot(); refresh(); });
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { showToast("Choose an image"); return; }
      if (f.size > SHOT_MAX_MB * 1024 * 1024) { showToast(`The image is too big (max ${SHOT_MAX_MB} MB)`); return; }
      st.uploading = true; up.hidden = false; up.textContent = "Uploading… 0%"; refresh();
      try {
        const blob = await prepareImage(f, 1600, 0.85);
        st.shot = await uploadToImgbb(blob, "payment.jpg", { onProgress: (p) => { up.textContent = `Uploading… ${Math.round(p * 100)}%`; } });
        showShot();
      } catch (e) {
        showToast("Upload failed. Try again.");
      }
      st.uploading = false; up.hidden = true; refresh();
    });
    q(".bs-complete").addEventListener("click", async (e) => {
      if (st.sending) return;
      st.sending = true;
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = "Sending…";
      const ok = await submit();
      st.sending = false;
      if (!ok) { btn.disabled = false; btn.textContent = "Complete"; }
    });
    refresh();
  };

  const submit = async () => {
    const key = `${st.method}_${st.trxId}`;
    try {
      try {
        await set(ref(db, `boostTrx/${key}`), me.uid);
      } catch (e) {
        showToast("This Transaction ID was already used. Check it and try again.");
        return false;
      }
      const id = push(ref(db, "boosts")).key;
      try {
        await set(ref(db, `boosts/${id}`), {
          uid: me.uid, postId: post.id, days: st.plan.days, price: st.plan.price,
          btnText: st.btnText, link: st.link, method: st.method, trxId: st.trxId,
          senderNumber: st.sender, screenshotURL: st.shot, status: "pending", createdAt: serverTimestamp()
        });
      } catch (e) {
        remove(ref(db, `boostTrx/${key}`)).catch(() => {}); // free the ID again so it can be sent once more
        showToast("Could not send. Check your connection and try again.");
        return false;
      }
      stepDone();
      return true;
    } catch (e) {
      showToast("Something went wrong. Try again.");
      return false;
    }
  };

  const stepDone = () => {
    sheet.setTitle("Sent");
    sheet.setBack(() => sheet.close());
    sheet.body.innerHTML = `
      <div class="max-w-lg mx-auto p-6 text-center space-y-4">
        <div class="w-16 h-16 rounded-full bg-green-100 text-green-700 mx-auto flex items-center justify-center"><span class="material-symbols-outlined text-[36px]">check_circle</span></div>
        <div class="font-extrabold text-[20px]">Sent to the team</div>
        <p class="text-[14px] text-slate-muted">We will check your payment (${METHODS[st.method].label} ${taka(st.plan.price)}, ID ${escapeHtml(st.trxId)}). When your boost is approved it starts running and you get a notification. You can follow it in My boosts.</p>
        ${refundNoteHtml()}
        <button type="button" class="bs-my ${PRIMARY}">My boosts</button>
        <button type="button" class="bs-ok w-full py-2 text-[14px] font-semibold text-slate-muted">Close</button>
      </div>`;
    sheet.body.querySelector(".bs-my").addEventListener("click", () => { sheet.close(); openMyBoosts(); });
    sheet.body.querySelector(".bs-ok").addEventListener("click", () => sheet.close());
  };

  stepPlan();
}

// ---------------------------------------------------------------- 2) my boosts
export async function openMyBoosts() {
  const me = auth.currentUser;
  if (!me) return;
  const sheet = openSheet("My boosts");
  sheet.body.innerHTML = `<div class="p-10 text-center text-slate-muted">Loading…</div>`;
  const load = async () => {
    let list = [];
    try {
      const snap = await get(query(ref(db, "boosts"), orderByChild("uid"), equalTo(me.uid)));
      snap.forEach((s) => { list.push({ id: s.key, ...s.val() }); });
    } catch (e) {
      sheet.body.innerHTML = `<div class="p-10 text-center text-slate-muted">Could not load. Check your connection.</div>`;
      return;
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    // views / clicks and post text
    await Promise.all(list.map(async (b) => {
      try {
        const [live, p] = await Promise.all([
          b.status === "active" || b.status === "expired" || b.status === "refund_requested" || b.status === "refunded" ? get(ref(db, `boostLive/${b.id}`)) : null,
          get(ref(db, `posts/${b.postId}`))
        ]);
        if (live && live.exists()) { b.views = live.val().impressions || 0; b.clicks = live.val().clicks || 0; }
        if (p.exists()) b.post = { id: b.postId, ...p.val() };
      } catch (e) { /* the card is shown without numbers */ }
    }));
    if (!list.length) {
      sheet.body.innerHTML = `<div class="p-10 text-center"><span class="material-symbols-outlined text-[44px] text-slate-muted">campaign</span><div class="font-bold mt-2">No boosts yet</div><div class="text-slate-muted text-[14px] mt-1">Open the ⋮ menu on your own post and choose Boost post.</div></div>`;
      return;
    }
    sheet.body.innerHTML = `<div class="max-w-lg mx-auto p-4 space-y-3">${list.map(cardHtml).join("")}<div class="pt-2">${refundNoteHtml()}</div></div>`;
    sheet.body.querySelectorAll(".bs-refund").forEach((b) => b.addEventListener("click", () => askRefund(list.find((x) => x.id === b.dataset.id))));
  };

  const cardHtml = (b) => {
    const s = STATUS[b.status] || STATUS.pending;
    const now = Date.now();
    let info = "";
    if (b.status === "pending") info = `We are checking your payment.`;
    if (b.status === "active") info = `Running until <b>${dateText(b.endAt)}</b>.`;
    if (b.status === "rejected") info = `${b.adminNote ? escapeHtml(b.adminNote) : "This boost was not approved."}`;
    if (b.status === "expired") info = `Ended on ${dateText(b.endAt)}. To run it again, make a new boost.`;
    if (b.status === "refund_requested") info = `We got your refund request and will send the money back.`;
    if (b.status === "refunded") info = `Your money was sent back and the boost stopped.`;
    let refund = "";
    if (b.status === "active" && b.refundUntil) {
      refund = now <= b.refundUntil
        ? `<button type="button" data-id="${b.id}" class="bs-refund mt-2 w-full h-10 rounded-xl border border-slate-border text-[14px] font-semibold">Request a refund</button><div class="text-[12px] text-slate-muted mt-1">You can ask for a refund until ${dateText(b.refundUntil)}.</div>`
        : `<div class="text-[12px] text-slate-muted mt-2">The ${REFUND_DAYS}-day refund time is over, so a refund is not possible.</div>`;
    }
    const stats = b.views != null ? `<div class="flex gap-4 text-[13px] mt-2 text-slate-muted"><span><b class="text-on-surface">${b.views}</b> views</span><span><b class="text-on-surface">${b.clicks}</b> clicks</span></div>` : "";
    return `
      <div class="rounded-2xl border border-slate-border bg-slate-surface p-3.5">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="px-2.5 py-0.5 rounded-full text-[12px] font-bold ${s.cls}">${s.label}</span>
          <span class="text-[13px] text-slate-muted">${b.days} days · ${taka(b.price)}</span>
        </div>
        ${b.post ? postPreviewHtml(b.post) : `<div class="text-[13px] text-slate-muted">The post was deleted</div>`}
        <div class="text-[13.5px] mt-2">${info}</div>
        <div class="text-[12.5px] text-slate-muted mt-1">Button: <b>${escapeHtml(b.btnText || "")}</b> → <span class="break-all">${escapeHtml(b.link || "")}</span></div>
        ${stats}${refund}
      </div>`;
  };

  const askRefund = (b) => {
    if (!b) return;
    const box = document.createElement("div");
    box.className = "fixed inset-0 z-[10000] bg-black/50 flex items-end sm:items-center justify-center";
    box.innerHTML = `
      <div class="w-full sm:max-w-sm bg-background rounded-t-2xl sm:rounded-2xl p-4 space-y-3">
        <div class="font-bold text-[17px]">Request a refund?</div>
        <p class="text-[13.5px] text-slate-muted">Your boost will stop and the team will send ${taka(b.price)} back to the number you paid from.</p>
        <textarea class="bs-why ${FIELD}" rows="3" maxlength="300" placeholder="Why? (optional)"></textarea>
        <div class="flex gap-2"><button type="button" class="bs-no flex-1 h-11 rounded-xl border border-slate-border font-semibold">Cancel</button><button type="button" class="bs-yes flex-1 h-11 rounded-xl bg-error text-white font-bold">Request refund</button></div>
      </div>`;
    document.body.appendChild(box);
    box.querySelector(".bs-no").addEventListener("click", () => box.remove());
    box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
    box.querySelector(".bs-yes").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const reason = box.querySelector(".bs-why").value.trim();
      try {
        await update(ref(db, `boosts/${b.id}`), reason ? { status: "refund_requested", refundReason: reason } : { status: "refund_requested" });
        box.remove();
        showToast("Refund requested");
        load();
      } catch (err) {
        btn.disabled = false;
        showToast("Could not send. The refund time may be over.");
      }
    });
  };

  load();
}
