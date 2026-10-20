// FreeZone BD - Creator Program: asking for a payout.  HIDDEN until the admin opens it (appConfig/creatorPay/payoutsOpen = true).
// The money is sent by hand (bKash / Nagad) by the admin after checking. Nothing is paid from inside the app.
//
// Data:
//   creatorEarnings/{month}/{uid}.final = true   months the admin closed: these amounts are mine
//   creatorPayouts/{uid}/{id} = { amount, method: bkash | nagad, number, name?, status: pending | paid | rejected,
//                                 requestedAt, paidAt?, trxId?, reason? }     (I create it, only the admin changes it)
//   available = (all closed months) - (payouts that are pending or paid)
import { ref, get, push, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, showToast } from "./post.js";
import { monthKey } from "./creatorViews.js";

const METHODS = { bkash: "bKash", nagad: "Nagad" };
const NUMBER_RE = /^01[3-9][0-9]{8}$/;
const taka = (n) => "৳" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function recentMonths(count = 12) {
  const out = [];
  const d = new Date(Date.now() + 6 * 3600 * 1000);
  d.setUTCDate(1);
  for (let i = 0; i < count; i++) {
    out.push(monthKey(d.getTime() - 6 * 3600 * 1000));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

/** { open, minPayout, available, pendingSum, items } or { open: false } (then nothing at all is shown) */
export async function loadPayout(db, uid) {
  let pay = {};
  try { pay = (await get(ref(db, "appConfig/creatorPay"))).val() || {}; } catch (error) { return { open: false }; }
  if (pay.payoutsOpen !== true) return { open: false };
  const [months, payoutsSnap] = await Promise.all([
    Promise.all(recentMonths(12).map((m) => get(ref(db, `creatorEarnings/${m}/${uid}`)).then((s) => s.val()).catch(() => null))),
    get(ref(db, `creatorPayouts/${uid}`)).catch(() => null)
  ]);
  const earned = months.reduce((s, e) => s + (e && e.final === true ? Number(e.amount) || 0 : 0), 0);
  const items = [];
  if (payoutsSnap) payoutsSnap.forEach((c) => { items.push({ id: c.key, ...c.val() }); });
  items.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  const used = items.filter((i) => i.status === "pending" || i.status === "paid").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const pendingSum = items.filter((i) => i.status === "pending").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  return {
    open: true,
    minPayout: Number(pay.minPayout) > 0 ? Number(pay.minPayout) : 500,
    available: Math.max(0, Math.floor((earned - used) * 100) / 100),
    pendingSum,
    hasPending: items.some((i) => i.status === "pending"),
    items
  };
}

const STATUS = {
  pending: ["Being checked", "bg-primary-container/10 text-primary-container"],
  paid: ["Paid", "bg-online-emerald/15 text-online-emerald"],
  rejected: ["Not paid", "bg-error-container text-error"]
};

export function payoutHtml(p, ui) {
  const canAsk = p.available >= p.minPayout && !p.hasPending;
  const hint = p.hasPending
    ? "You already have a payout request. Wait until it is answered."
    : p.available < p.minPayout
      ? `You can ask for a payout when you have at least ${taka(p.minPayout)}.`
      : "The money is sent to your bKash or Nagad number after we check it.";
  const hist = p.items.slice(0, 5).map((i) => {
    const [label, cls] = STATUS[i.status] || ["?", ""];
    const date = i.requestedAt ? new Date(i.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    return `<div class="flex items-start justify-between gap-3 py-2.5 border-t border-slate-border/60">
      <div class="min-w-0">
        <div class="font-body-md text-body-md text-on-surface font-semibold">${taka(i.amount)} <span class="text-slate-muted font-normal">· ${escapeHtml(METHODS[i.method] || "")}</span></div>
        <div class="font-body-sm text-body-sm text-slate-muted">${date}${i.status === "paid" && i.trxId ? ` · ID ${escapeHtml(i.trxId)}` : ""}${i.status === "rejected" && i.reason ? ` · ${escapeHtml(i.reason)}` : ""}</div>
      </div>
      <span class="flex-shrink-0 px-2.5 py-1 rounded-full text-[12px] font-semibold ${cls}">${label}</span>
    </div>`;
  }).join("");
  return `
    <section class="rounded-2xl border border-slate-border bg-slate-surface p-4 cp-payout">
      <h2 class="font-label-lg text-label-lg text-on-surface font-semibold mb-3">Payout</h2>
      <div class="font-body-sm text-body-sm text-slate-muted">Ready to take out</div>
      <div class="text-[28px] leading-9 font-bold text-on-surface tabular-nums">${taka(p.available)}</div>
      <p class="font-body-sm text-body-sm text-slate-subtle mt-1">${hint}</p>
      <button type="button" class="cp-pay-open mt-3 ${ui.BTN_PRIMARY}" ${canAsk ? "" : "disabled"}>Ask for a payout</button>
      <form class="cp-pay-form mt-3 space-y-3" hidden autocomplete="off">
        <div class="grid grid-cols-2 gap-2">
          ${Object.entries(METHODS).map(([k, l], i) => `<label class="flex items-center justify-center gap-2 rounded-xl border border-slate-border py-2.5 font-body-md text-body-md has-[:checked]:border-primary-container has-[:checked]:bg-primary-container/10"><input type="radio" name="method" value="${k}" ${i === 0 ? "checked" : ""} class="sr-only"/>${l}</label>`).join("")}
        </div>
        <div>
          <label class="${ui.LABEL}">Mobile number (bKash / Nagad)</label>
          <input type="tel" inputmode="numeric" maxlength="11" class="cp-pay-number ${ui.INPUT}" placeholder="01XXXXXXXXX" />
        </div>
        <div>
          <label class="${ui.LABEL}">Name on the account (optional)</label>
          <input type="text" maxlength="40" class="cp-pay-name ${ui.INPUT}" />
        </div>
        <p class="font-body-sm text-body-sm text-slate-subtle">You ask for ${taka(p.available)}. Check the number: a wrong number cannot be undone.</p>
        <button type="submit" class="${ui.BTN_PRIMARY}">Send request</button>
      </form>
      ${hist ? `<div class="mt-4"><h3 class="font-label-lg text-label-lg text-on-surface font-semibold mb-1">Your requests</h3>${hist}</div>` : ""}
    </section>`;
}

/** wires the buttons; reload() is called after a request was sent */
export function bindPayout(root, { db, uid, payout, reload }) {
  const open = root.querySelector(".cp-pay-open");
  const form = root.querySelector(".cp-pay-form");
  if (!open || !form) return;
  open.addEventListener("click", () => { form.hidden = !form.hidden; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const number = form.querySelector(".cp-pay-number").value.trim();
    const method = (form.querySelector('input[name="method"]:checked') || {}).value || "bkash";
    const name = form.querySelector(".cp-pay-name").value.trim().slice(0, 40);
    if (!NUMBER_RE.test(number)) { showToast("Type a mobile number like 01XXXXXXXXX"); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Sending...";
    try {
      const data = { amount: payout.available, method, number, status: "pending", requestedAt: serverTimestamp() };
      if (name) data.name = name;
      await set(push(ref(db, `creatorPayouts/${uid}`)), data);
      showToast("Request sent");
      await reload();
    } catch (error) {
      console.error("Payout request:", error);
      showToast(error.code === "PERMISSION_DENIED" ? "Could not send: payouts are not open or the rules block it" : "Could not send. Try again");
      button.disabled = false;
      button.textContent = "Send request";
    }
  });
}
