// FreeZone BD - Settings > Creator Program
// A person applies, an admin approves (admin panel > Creators). Approved creators get a green tick next to their name (monetize.js).
// Earnings and payouts are NOT open yet: this page only shows the rules and the progress. Nothing about payments is shown here.
//
// Data (Firebase Realtime Database):
//   appConfig/creator   = { open, minFollowers, minPosts, minAgeDays, minViews }     set by the admin (read by everyone)
//   creatorApps/{uid}   = { status: pending | approved | rejected | revoked, appliedAt, name, username, photoURL,
//                           followers, posts, views, ageDays, reason?, reviewedAt?, reviewedBy? }
//   monetized/{uid}     = true                                                         the tick (admin only)
//   creatorEarnings/{month}/{uid} = { amount, v, p, f, viewers, qualified, final }       my numbers, written by the admin panel (earnings are estimates until "final")
//   appConfig/creatorPay = { minViewers, ... }
import {
  ref,
  get,
  set,
  query,
  orderByChild,
  equalTo,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

import { escapeHtml, showToast } from "./post.js";
import { formSkeleton } from "./skeleton.js";
import { tickHtml } from "./monetize.js";
import { monthKey } from "./creatorViews.js";
import { loadPayout, payoutHtml, bindPayout } from "./creator-payout.js";
import { PUSH_WORKER_URL } from "./app-info.js";
import { auth } from "./config.js";

// Which country is this phone in? The Worker reads it from the network address ("" when it cannot be known: then nobody is blocked).
// The program is open only in Bangladesh for now (OPEN_COUNTRIES). A VPN can change the answer, so the admin also sees the country on the application.
const OPEN_COUNTRIES = ["BD"];
async function workerPost(path) {
  const base = String(PUSH_WORKER_URL || "").replace(/\/+$/, "");
  if (!base || !auth.currentUser) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: "{}", signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_RULES = { open: true, minFollowers: 100, minPosts: 10, minAgeDays: 30, minViews: 1000 };
const DAY = 86400000;
const num = (n) => Number(n || 0).toLocaleString("en-US");

async function readStats(db, uid) {
  const [userSnap, followersSnap, postsSnap] = await Promise.all([
    get(ref(db, `users/${uid}`)),
    get(ref(db, `followers/${uid}`)).catch(() => null),
    get(query(ref(db, "posts"), orderByChild("uid"), equalTo(uid))).catch(() => null)
  ]);
  const profile = userSnap.val() || {};
  let posts = 0;
  let views = 0;
  if (postsSnap) {
    postsSnap.forEach((child) => {
      posts += 1;
      views += Number(child.val() && child.val().viewsCount) || 0;
    });
  }
  const created = Number(profile.createdAt) || Date.now();
  return {
    profile,
    followers: followersSnap ? followersSnap.size : 0,
    posts,
    views,
    ageDays: Math.max(0, Math.floor((Date.now() - created) / DAY))
  };
}

export async function render(root, ctx) {
  const { ui, db, currentUser } = ctx;
  const uid = currentUser.uid;
  root.innerHTML = `<div class="max-w-lg mx-auto pb-12">${formSkeleton(3)}</div>`;

  let rules = { ...DEFAULT_RULES };
  let app = null;
  let stats = null;
  let cur = null; // my earnings this month
  let prev = null; // and last month
  let minViewers = 5;
  let country = ""; // 2-letter code of where this phone is ("" = unknown)
  let payout = { open: false }; // the payout card stays hidden until the admin opens it (creator-payout.js)

  const load = async () => {
    const [cfgSnap, appSnap, st] = await Promise.all([
      get(ref(db, "appConfig/creator")).catch(() => null),
      get(ref(db, `creatorApps/${uid}`)).catch(() => null),
      readStats(db, uid)
    ]);
    rules = { ...DEFAULT_RULES, ...((cfgSnap && cfgSnap.val()) || {}) };
    app = appSnap ? appSnap.val() : null;
    if (!country) { const r = await workerPost("/country"); country = (r && r.country) || ""; }
    stats = st;
    cur = null;
    prev = null;
    if (app && app.status === "approved") {
      const now = Date.now();
      const lastMonth = monthKey(now - 31 * DAY);
      const [c, p, pay] = await Promise.all([
        get(ref(db, `creatorEarnings/${monthKey(now)}/${uid}`)).catch(() => null),
        get(ref(db, `creatorEarnings/${lastMonth}/${uid}`)).catch(() => null),
        get(ref(db, "appConfig/creatorPay/minViewers")).catch(() => null)
      ]);
      cur = c && c.exists() ? c.val() : null;
      prev = p && p.exists() ? p.val() : null;
      if (pay && pay.exists()) minViewers = Number(pay.val()) || 0;
      payout = await loadPayout(db, uid).catch(() => ({ open: false }));
    } else {
      payout = { open: false };
    }
  };

  const check = (label, value, need, unit = "") => {
    const ok = value >= need;
    const pct = need > 0 ? Math.min(100, Math.round((value / need) * 100)) : 100;
    return { label, value, need, unit, ok, pct };
  };

  const taka = (n) => "৳" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

  // My views and the estimated earnings of this month (the admin updates them; they are estimates until the month is closed)
  const earningsHtml = () => {
    const stat = (label, value) =>
      `<div class="rounded-xl bg-surface-container-low px-3 py-2.5"><div class="font-body-sm text-body-sm text-slate-muted">${label}</div><div class="font-semibold text-on-surface tabular-nums">${num(value)}</div></div>`;
    const body = cur
      ? `<div class="flex items-end justify-between gap-3">
           <div>
             <div class="font-body-sm text-body-sm text-slate-muted">${cur.final ? "Earnings" : "Estimated earnings"}</div>
             <div class="text-[28px] leading-9 font-bold text-on-surface tabular-nums">${taka(cur.amount)}</div>
           </div>
           <span class="px-2.5 py-1 rounded-full text-[12px] font-semibold ${cur.final ? "bg-online-emerald/15 text-online-emerald" : "bg-primary-container/10 text-primary-container"}">${cur.final ? "Final" : "Estimate"}</span>
         </div>
         <div class="grid grid-cols-2 gap-2 mt-3">
           ${stat("Videos watched", cur.v)}${stat("Posts seen", cur.p)}${stat("Profile visits", cur.f)}${stat("Different viewers", cur.viewers)}
         </div>
         ${cur.qualified === false ? `<p class="font-body-sm text-body-sm text-slate-muted mt-3">You need at least ${num(minViewers)} different viewers in a month to earn.</p>` : ""}`
      : `<p class="font-body-md text-body-md text-on-surface-variant">Your numbers for this month will show here after the next update.</p>`;
    const last = prev ? `<p class="font-body-md text-body-md text-on-surface-variant mt-3">Last month: <b class="text-on-surface">${taka(prev.amount)}</b> (${prev.final ? "final" : "estimate"})</p>` : "";
    return `
      <section class="cp2-box">
        <h2 class="cp2-h2" style="margin-bottom:12px">This month</h2>
        ${body}${last}
        <p class="font-body-sm text-body-sm text-slate-subtle mt-3">These are estimates. The final amount depends on what the platform earns and on everybody's views. ${payout.open ? "Only closed months can be paid out." : "Nothing is paid out yet."}</p>
      </section>`;
  };

  const draw = () => {
    const checks = [
      check("Followers", stats.followers, rules.minFollowers),
      check("Posts", stats.posts, rules.minPosts),
      check("Account age", stats.ageDays, rules.minAgeDays, " days"),
      check("Views on your posts", stats.views, rules.minViews)
    ];
    const allOk = checks.every((c) => c.ok);
    const status = app && app.status;

    const wrongCountry = !!country && !OPEN_COUNTRIES.includes(country);
    let statusHtml;
    if (status === "approved") {
      statusHtml = ui.infoBox({
        icon: "verified",
        tone: "ok",
        html: `<b class="text-on-surface">You are in the Creator Program</b> ${tickHtml(uid) || ""}<br>A green tick is shown next to your name. Earnings are not open yet. We will tell you here when they start.`
      });
    } else if (status === "pending") {
      statusHtml = ui.infoBox({
        icon: "hourglass_top",
        tone: "info",
        html: `<b class="text-on-surface">Your application is being checked.</b><br>We will review it soon. You do not need to do anything.`
      });
    } else if (status === "revoked") {
      statusHtml = ui.infoBox({
        icon: "block",
        tone: "warn",
        html: `<b class="text-on-surface">Your Creator Program access was turned off.</b>${
          app.reason ? `<br>Reason: ${escapeHtml(app.reason)}` : ""
        }<br>The green tick was removed. You can read the rules below. For questions use Settings &gt; Report a problem.`
      });
    } else if (status === "rejected") {
      statusHtml = ui.infoBox({
        icon: "info",
        tone: "warn",
        html: `<b class="text-on-surface">Your application was not approved.</b>${
          app.reason ? `<br>Reason: ${escapeHtml(app.reason)}` : ""
        }<br>You can apply again when you meet the rules.`
      });
    } else if (wrongCountry) {
      statusHtml = ui.infoBox({
        icon: "public",
        tone: "info",
        html: `<b class="text-on-surface">Not open in your country yet.</b><br>The Creator Program is open only in Bangladesh for now. We will open it for everyone later.`
      });
    } else if (rules.open === false) {
      statusHtml = ui.infoBox({ icon: "lock_clock", tone: "info", html: `<b class="text-on-surface">Applications are closed right now.</b><br>Please check again later.` });
    } else {
      statusHtml = ui.infoBox({
        icon: "workspace_premium",
        tone: "info",
        html: allOk
          ? `<b class="text-on-surface">You meet all the requirements.</b><br>You can apply now.`
          : `<b class="text-on-surface">Keep growing.</b><br>You can apply when all the requirements below are met.`
      });
    }

    const canApply = (!status || status === "rejected") && rules.open !== false && allOk && !wrongCountry;
    const showApply = !status || status === "rejected";

    const inlineStatus = !["approved", "pending", "revoked", "rejected"].includes(status) && !wrongCountry && rules.open !== false;
    const doneCount = checks.filter((c) => c.ok).length;
    const avg = Math.round((checks.reduce((sum, c) => sum + c.pct, 0) / checks.length));
    const ICONS = ["group", "article", "calendar_month", "visibility"];
    const circ = 2 * Math.PI * 27;

    const header = inlineStatus
      ? `<div class="cp2-top">
           <div class="cp2-ring"><svg viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="cp2g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#2fc48d"/></linearGradient></defs><circle cx="32" cy="32" r="27" fill="none" stroke="rgb(var(--c-surface-container))" stroke-width="7"/><circle cx="32" cy="32" r="27" fill="none" stroke="${allOk ? "#2fc48d" : "url(#cp2g)"}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - avg / 100)).toFixed(1)}" transform="rotate(-90 32 32)"/></svg><b>${avg}%</b></div>
           <div class="min-w-0">
             <div class="cp2-tt">${allOk ? "You meet all the requirements." : "Keep growing."}</div>
             <div class="cp2-ts">${allOk ? "You can apply now." : "You can apply when all the requirements below are met."}</div>
             <div class="cp2-tm">${doneCount} of ${checks.length} requirements met</div>
           </div>
         </div>`
      : `<h2 class="cp2-h2">Requirements</h2>`;

    const dashRow =
      status === "approved"
        ? `<button type="button" class="cp-dash cp2-box cp2-row">
             <span class="cp2-chip" style="background:#5b8cff22;color:#5b8cff"><span class="material-symbols-outlined">insights</span></span>
             <span class="cp2-rl">Open Creator Dashboard</span>
             <span class="material-symbols-outlined text-slate-subtle">chevron_right</span>
           </button>`
        : "";

    root.innerHTML = `
      <style>
        .cp2{max-width:32rem;margin:0 auto;padding-bottom:48px}
        .cp2-box{display:block;width:100%;background:rgb(var(--c-slate-surface));border-top:1px solid rgb(var(--c-slate-border));border-bottom:1px solid rgb(var(--c-slate-border));padding:16px;margin-top:10px;text-align:left}
        .cp2-hero{position:relative;overflow:hidden;padding:20px 16px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
        .cp2-hero::before,.cp2-hero::after{content:"";position:absolute;border-radius:50%;background:#fff}
        .cp2-hero::before{width:150px;height:150px;right:-40px;top:-64px;opacity:.12}
        .cp2-hero::after{width:100px;height:100px;right:70px;bottom:-76px;opacity:.08}
        .cp2-hr{position:relative;display:flex;align-items:center;gap:12px}
        .cp2-bd{width:52px;height:52px;border-radius:16px;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;flex:none}
        .cp2-bd .material-symbols-outlined{font-size:28px}
        .cp2-ht{font-size:21px;font-weight:800;line-height:1.3}
        .cp2-hs{position:relative;font-size:14px;line-height:1.6;margin-top:12px;color:rgba(255,255,255,.95)}
        .cp2-chips{position:relative;display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
        .cp2-chips span{background:rgba(255,255,255,.2);font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:99px;display:inline-flex;align-items:center;gap:5px}
        .cp2-chips .material-symbols-outlined{font-size:15px}
        .cp2-note{display:flex;gap:10px;padding:12px 16px;background:rgba(59,130,246,.10);border-bottom:1px solid rgba(59,130,246,.25);font-size:13px;line-height:1.55;color:rgb(var(--c-slate-muted))}
        .cp2-note .material-symbols-outlined{font-size:20px;color:#5b8cff;flex:none}
        .cp2-top{display:flex;gap:14px;align-items:center;margin-bottom:6px}
        .cp2-ring{position:relative;width:64px;height:64px;flex:none}
        .cp2-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px}
        .cp2-tt{font-size:17.5px;font-weight:800}
        .cp2-ts{font-size:13px;line-height:1.5;margin-top:2px;color:rgb(var(--c-slate-muted))}
        .cp2-tm{font-size:12.5px;font-weight:600;margin-top:3px;color:rgb(var(--c-slate-subtle))}
        .cp2-h2{font-size:17px;font-weight:800;margin-bottom:8px}
        .cp2-ck{padding:12px 0;border-top:1px solid rgb(var(--c-slate-border))}
        .cp2-cr{display:flex;align-items:center;gap:12px;font-size:15.5px}
        .cp2-chip{width:38px;height:38px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex:none}
        .cp2-chip .material-symbols-outlined{font-size:21px}
        .cp2-cl{flex:1;font-weight:600;min-width:0}
        .cp2-cr b{font-weight:800}
        .cp2-cr i{font-style:normal;font-size:13.5px;color:rgb(var(--c-slate-muted));margin-left:-6px}
        .cp2-cb{display:flex;align-items:center;gap:10px;margin-top:10px}
        .cp2-bar{flex:1;height:8px;border-radius:9px;background:rgb(var(--c-surface-container));overflow:hidden}
        .cp2-bar div{height:100%;border-radius:9px}
        .cp2-cb span{font-size:12.5px;font-weight:700;width:40px;text-align:right;color:rgb(var(--c-slate-muted))}
        .cp2-sh{display:flex;gap:10px;align-items:center;border-top:1px solid rgb(var(--c-slate-border));padding-top:12px;font-size:13px;color:rgb(var(--c-slate-muted))}
        .cp2-sh .material-symbols-outlined{font-size:20px}
        .cp2 .cp-apply{width:100%;height:50px;border-radius:999px;border:0;color:#fff;font-weight:800;font-size:16px;background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 8px 20px rgba(37,99,235,.35)}
        .cp2 .cp-apply:disabled{background:rgb(var(--c-surface-container));color:rgb(var(--c-slate-subtle));box-shadow:none;opacity:1}
        .cp2-hint{text-align:center;font-size:12.5px;margin-top:9px;color:rgb(var(--c-slate-muted))}
        .cp2-step{display:flex;gap:12px;margin-bottom:14px}.cp2-step:last-child{margin-bottom:0}
        .cp2-sn{flex:none;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}
        .cp2-s1{font-size:15.5px;font-weight:700}.cp2-s2{font-size:14px;line-height:1.55;margin-top:2px;color:rgb(var(--c-slate-muted))}
        .cp2-rule{display:flex;gap:11px;font-size:14px;line-height:1.55;margin-top:10px;color:rgb(var(--c-on-surface-variant))}
        .cp2-rule i{flex:none;width:22px;height:22px;border-radius:50%;background:rgba(255,107,107,.15);color:#ff6b6b;display:flex;align-items:center;justify-content:center;margin-top:1px}
        .cp2-rule i .material-symbols-outlined{font-size:14px}
        .cp2-row{display:flex;align-items:center;gap:12px}
        .cp2-rl{flex:1;font-size:16px;font-weight:700}
        .cp2-terms{display:block;text-align:center;margin:16px;font-weight:700;font-size:14.5px;color:#6c9bff}
      </style>
      <div class="cp2">
        <div class="cp2-hero">
          <div class="cp2-hr"><div class="cp2-bd"><span class="material-symbols-outlined">workspace_premium</span></div><div class="cp2-ht">Earn from what people love</div></div>
          <div class="cp2-hs">Share a part of what FreeZone BD earns with the people whose posts and videos people love.</div>
          <div class="cp2-chips"><span>45% shared with creators</span><span><span class="material-symbols-outlined">public</span>Bangladesh only</span></div>
        </div>
        <div class="cp2-note"><span class="material-symbols-outlined">public</span><p>The Creator Program is open only in Bangladesh for now. We plan to open it for everyone later.</p></div>
        <div class="px-0">
          ${inlineStatus ? "" : `<div class="px-4 mt-3">${statusHtml}</div>`}
          ${dashRow}
          ${status === "approved" ? earningsHtml() : ""}
          ${status === "approved" && payout.open ? `<div class="px-4 mt-3">${payoutHtml(payout, ui)}</div>` : ""}

          <section class="cp2-box">
            ${header}
            ${checks
              .map((c, i) => {
                const tone = c.ok ? "#2fc48d" : "#5b8cff";
                const fill = c.ok ? "background:#2fc48d" : "background:linear-gradient(135deg,#3b82f6,#2563eb)";
                return `
              <div class="cp2-ck">
                <div class="cp2-cr">
                  <span class="cp2-chip" style="background:${tone}22;color:${tone}"><span class="material-symbols-outlined">${c.ok ? "check" : ICONS[i]}</span></span>
                  <span class="cp2-cl">${escapeHtml(c.label)}</span>
                  <b class="tabular-nums">${num(c.value)}</b><i class="tabular-nums">/ ${num(c.need)}${c.unit}</i>
                </div>
                <div class="cp2-cb"><div class="cp2-bar"><div style="width:${Math.max(2, c.pct)}%;${fill}"></div></div><span>${c.pct}%</span></div>
              </div>`;
              })
              .join("")}
            <div class="cp2-sh"><span class="material-symbols-outlined">verified_user</span>No serious report or rule break on your account.</div>
          </section>

          ${
            showApply
              ? `<section class="cp2-box"><button type="button" class="cp-apply" ${canApply ? "" : "disabled"}>${status === "rejected" ? "Apply again" : "Apply to the Creator Program"}</button>${allOk ? "" : `<p class="cp2-hint">The button turns on when you meet all the requirements</p>`}</section>`
              : ""
          }

          <section class="cp2-box">
            <h2 class="cp2-h2" style="margin-bottom:12px">How it works</h2>
            ${[
              ["Apply", "You apply, then we check your account. Only approved creators are counted."],
              ["Share of earnings", "45% of what FreeZone BD earns each month is shared with approved creators. The platform keeps 55%."],
              ["Your part grows", "The more people see your posts, videos and profile, the bigger your part."],
              ["Only real views", "Only real views count. Your own views, new accounts and fake views are not counted."],
              ["Earnings vary", "Earnings depend on what the platform earns. Nothing is promised in advance."]
            ]
              .map(([t, d], i) => `<div class="cp2-step"><span class="cp2-sn">${i + 1}</span><div><div class="cp2-s1">${t}</div><div class="cp2-s2">${d}</div></div></div>`)
              .join("")}
          </section>

          <section class="cp2-box">
            <h2 class="cp2-h2">Rules</h2>
            <p class="cp2-s2" style="margin-top:6px">We can turn the program off for an account, and the green tick goes away, when it:</p>
            ${[
              "Posts sexual or obscene photos, videos or words.",
              "Behaves in an abusive, hateful or harassing way.",
              "Uses fake accounts or tricks to raise views or followers.",
              "Breaks the Community Guidelines in any other serious way."
            ]
              .map((t) => `<div class="cp2-rule"><i><span class="material-symbols-outlined">close</span></i><span>${t}</span></div>`)
              .join("")}
          </section>
          <a href="creator-terms.html" target="_blank" rel="noopener" class="cp2-terms">Read the Creator Program Terms</a>
        </div>
      </div>`;

    root.querySelector(".cp-dash")?.addEventListener("click", () => ctx.go?.("creator-dashboard"));

    if (status === "approved" && payout.open) bindPayout(root, { db, uid, payout, reload: async () => { await load(); draw(); } });

    const applyBtn = root.querySelector(".cp-apply");
    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        if (applyBtn.disabled) return;
        applyBtn.disabled = true;
        applyBtn.textContent = "Sending...";
        try {
          await set(ref(db, `creatorApps/${uid}`), {
            status: "pending",
            appliedAt: serverTimestamp(),
            name: String(stats.profile.name || currentUser.displayName || "").slice(0, 40),
            username: String(stats.profile.username || "").slice(0, 20),
            photoURL: String(stats.profile.photoURL || "").slice(0, 600),
            followers: stats.followers,
            posts: stats.posts,
            views: stats.views,
            ageDays: stats.ageDays
          });
          workerPost("/creator-country"); // the Worker saves the country next to the application (the admin sees it)
          showToast("Application sent");
          await load();
          draw();
        } catch (error) {
          console.error("Creator application:", error);
          showToast(error.code === "PERMISSION_DENIED" ? "Could not send: database rules block it" : "Could not send. Try again");
          applyBtn.disabled = false;
          applyBtn.textContent = "Apply to the Creator Program";
        }
      });
    }
  };

  try {
    await load();
    draw();
  } catch (error) {
    console.error("Creator page:", error);
    root.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-16">Could not load this page. Please try again.</p>`;
  }
}
