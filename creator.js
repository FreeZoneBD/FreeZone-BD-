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

  const load = async () => {
    const [cfgSnap, appSnap, st] = await Promise.all([
      get(ref(db, "appConfig/creator")).catch(() => null),
      get(ref(db, `creatorApps/${uid}`)).catch(() => null),
      readStats(db, uid)
    ]);
    rules = { ...DEFAULT_RULES, ...((cfgSnap && cfgSnap.val()) || {}) };
    app = appSnap ? appSnap.val() : null;
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
      <section class="rounded-2xl border border-slate-border bg-slate-surface p-4">
        <h2 class="font-label-lg text-label-lg text-on-surface font-semibold mb-3">This month</h2>
        ${body}${last}
        <p class="font-body-sm text-body-sm text-slate-subtle mt-3">These are estimates. The final amount depends on what the platform earns and on everybody's views. Nothing is paid out yet.</p>
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

    const canApply = (!status || status === "rejected") && rules.open !== false && allOk;
    const showApply = !status || status === "rejected";

    root.innerHTML = `
      <div class="max-w-lg mx-auto pb-12">
        ${ui.introHtml({
          icon: "workspace_premium",
          iconClass: "bg-online-emerald/15 text-online-emerald",
          title: "Creator Program",
          text: "Share a part of what FreeZone BD earns with the people whose posts and videos people love."
        })}

        <div class="px-4 mt-3 space-y-4">
          ${statusHtml}
          ${status === "approved" ? earningsHtml() : ""}

          <section class="rounded-2xl border border-slate-border bg-slate-surface p-4">
            <h2 class="font-label-lg text-label-lg text-on-surface font-semibold">Requirements</h2>
            <div class="mt-3 space-y-3.5">
              ${checks
                .map(
                  (c) => `
                <div>
                  <div class="flex items-center justify-between gap-3 font-body-md text-body-md">
                    <span class="flex items-center gap-2 min-w-0">
                      <span class="material-symbols-outlined text-[20px] ${c.ok ? "text-online-emerald" : "text-slate-subtle"}" style="font-variation-settings:'FILL' ${c.ok ? 1 : 0};">${c.ok ? "check_circle" : "radio_button_unchecked"}</span>
                      <span class="text-on-surface truncate">${escapeHtml(c.label)}</span>
                    </span>
                    <span class="text-slate-muted tabular-nums flex-shrink-0">${num(c.value)} / ${num(c.need)}${c.unit}</span>
                  </div>
                  <div class="mt-1.5 h-1.5 rounded-full bg-surface-container overflow-hidden"><div class="h-full rounded-full ${c.ok ? "bg-online-emerald" : "bg-primary-container"}" style="width:${c.pct}%"></div></div>
                </div>`
                )
                .join("")}
            </div>
            <p class="font-body-sm text-body-sm text-slate-subtle mt-3">No serious report or rule break on your account.</p>
          </section>

          ${
            showApply
              ? `<button type="button" class="cp-apply ${ui.BTN_PRIMARY}" ${canApply ? "" : "disabled"}>${status === "rejected" ? "Apply again" : "Apply to the Creator Program"}</button>`
              : ""
          }

          <section class="rounded-2xl border border-slate-border bg-slate-surface p-4">
            <h2 class="font-label-lg text-label-lg text-on-surface font-semibold">How it works</h2>
            <ul class="mt-2.5 space-y-2 font-body-md text-body-md text-on-surface-variant list-disc pl-5">
              <li>You apply, then we check your account. Only approved creators are counted.</li>
              <li>45% of what FreeZone BD earns each month is shared with approved creators. The platform keeps 55%.</li>
              <li>The more people see your posts, videos and profile, the bigger your part.</li>
              <li>Only real views count. Your own views, new accounts and fake views are not counted.</li>
              <li>Earnings depend on what the platform earns. Nothing is promised in advance.</li>
            </ul>
          </section>

          <section class="rounded-2xl border border-slate-border bg-slate-surface p-4">
            <h2 class="font-label-lg text-label-lg text-on-surface font-semibold">Rules</h2>
            <p class="font-body-md text-body-md text-on-surface-variant mt-2">We can turn the program off for an account, and the green tick goes away, when it:</p>
            <ul class="mt-2 space-y-2 font-body-md text-body-md text-on-surface-variant list-disc pl-5">
              <li>Posts sexual or obscene photos, videos or words.</li>
              <li>Behaves in an abusive, hateful or harassing way.</li>
              <li>Uses fake accounts or tricks to raise views or followers.</li>
              <li>Breaks the Community Guidelines in any other serious way.</li>
            </ul>
          </section>
        </div>
      </div>`;

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
