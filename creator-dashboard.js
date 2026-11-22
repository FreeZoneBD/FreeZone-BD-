// FreeZone BD - Settings > Creator Program > Creator Dashboard
// This month's earnings, how your posts did, weekly goals, your latest post and comments waiting for a reply.
// Everything comes from data the app already has (posts, followers, comments, creatorEarnings); nothing is written here.
//   render(root, ctx)  ctx.go(page) = open another settings page, ctx.currentUser, ctx.db
import { ref, get, query, orderByChild, equalTo, limitToLast } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, showToast, timeAgo, avatarHtml } from "./post.js";
import { formSkeleton } from "./skeleton.js";
import { monthKey } from "./creatorViews.js";
import { loadPayout } from "./creator-payout.js";

const DAY = 86400000;
const GOALS = { posts: 7, reactions: 10, followers: 5 };
const num = (n) => Number(n || 0).toLocaleString("en-US");
const compact = (n) => {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return num(n);
};
const taka = (n) => "৳" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

const CSS = `
.cd{max-width:32rem;margin:0 auto;padding-bottom:48px}
.cd-box{background:rgb(var(--c-slate-surface));border-top:1px solid rgb(var(--c-slate-border));border-bottom:1px solid rgb(var(--c-slate-border));padding:16px;margin-top:10px}
.cd-hero{position:relative;overflow:hidden;padding:18px 16px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
.cd-hero::before{content:"";position:absolute;width:160px;height:160px;border-radius:50%;background:#fff;opacity:.12;right:-40px;top:-60px}
.cd-hr{position:relative;display:flex;gap:12px;align-items:center}
.cd-av{position:relative;flex:none}
.cd-av>*:first-child{width:54px!important;height:54px!important;border-radius:50%;border:2px solid rgba(255,255,255,.6);object-fit:cover}
.cd-vk{position:absolute;right:-3px;bottom:-3px;width:21px;height:21px;border-radius:50%;background:#2fc48d;color:#04231a;display:flex;align-items:center;justify-content:center;border:2px solid #2563eb}
.cd-vk .material-symbols-outlined{font-size:13px;font-weight:900}
.cd-nm{font-size:18px;font-weight:800}.cd-fl{font-size:12.5px;color:#dbe8ff;margin-top:2px}
.cd-el{position:relative;margin-top:16px;font-size:13.5px;color:#e6eeff}
.cd-amt{position:relative;font-size:36px;font-weight:800;margin-top:2px;line-height:1.2}
.cd-ef{position:relative;font-size:12.5px;color:#cfe0ff}
.cd-hst{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.cd-hst div{background:rgba(255,255,255,.16);border-radius:14px;padding:9px 6px;text-align:center}
.cd-hst b{display:block;font-size:17px}.cd-hst i{font-style:normal;font-size:11.5px;color:#dbe8ff}
.cd-learn{position:relative;display:inline-block;margin-top:12px;background:#fff;color:#2563eb;font-weight:800;padding:8px 16px;border-radius:999px;font-size:14px;border:0}
.cd-ttl{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}
.cd-ttl h2{font-size:17px;font-weight:800}.cd-ttl span{font-size:12.5px;color:rgb(var(--c-slate-muted))}
.cd-tabs{display:flex;background:rgb(var(--c-surface-container));border:1px solid rgb(var(--c-slate-border));border-radius:999px;padding:3px;margin-bottom:10px}
.cd-tab{flex:1;text-align:center;padding:7px 0;font-size:13.5px;font-weight:700;color:rgb(var(--c-slate-muted));border-radius:999px;border:0;background:none}
.cd-tab.on{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
.cd-sm{font-size:12.5px;color:rgb(var(--c-slate-subtle));margin-bottom:6px}
.cd-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid rgb(var(--c-slate-border));width:100%;text-align:left;background:none;border-left:0;border-right:0;border-bottom:0}
.cd-row.first{border-top:0}
.cd-chip{width:38px;height:38px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.cd-chip .material-symbols-outlined{font-size:21px}
.cd-rl{flex:1;font-size:15.5px;font-weight:600;min-width:0}
.cd-rv{font-size:17px;font-weight:800}
.cd-dl{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;min-width:56px;text-align:center}
.cd-dl.up{background:rgba(47,196,141,.15);color:#2fc48d}.cd-dl.dn{background:rgba(255,107,107,.15);color:#ff6b6b}.cd-dl.no{color:rgb(var(--c-slate-subtle));font-weight:600}
.cd-gl{margin-bottom:14px}.cd-gl:last-child{margin-bottom:0}
.cd-gh{display:flex;justify-content:space-between;font-size:14.5px;font-weight:600;margin-bottom:8px}
.cd-gh b{color:rgb(var(--c-slate-muted))}
.cd-bar{height:8px;border-radius:9px;background:rgb(var(--c-surface-container));overflow:hidden}.cd-bar div{height:100%;border-radius:9px}
.cd-lp{display:flex;gap:12px;width:100%;text-align:left;background:none;border:0;padding:0}
.cd-th{position:relative;width:84px;height:84px;border-radius:14px;background:rgb(var(--c-surface-container)) center/cover;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;overflow:hidden}
.cd-th .material-symbols-outlined{font-size:34px;text-shadow:0 1px 8px rgba(0,0,0,.5)}
.cd-lp p{font-size:14px;line-height:1.55;flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.cd-g4{display:grid;grid-template-columns:repeat(4,1fr);margin-top:14px;border:1px solid rgb(var(--c-slate-border));border-radius:14px;background:rgb(var(--c-surface-container))}
.cd-g4 div{padding:10px 0;text-align:center;border-left:1px solid rgb(var(--c-slate-border))}.cd-g4 div:first-child{border:0}
.cd-g4 b{display:block;font-size:16px}.cd-g4 i{font-style:normal;font-size:11.5px;color:rgb(var(--c-slate-muted))}
.cd-boost{margin-top:12px;height:44px;border-radius:999px;border:1px solid rgba(91,140,255,.5);color:#6c9bff;font-weight:800;font-size:14.5px;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;background:none}
.cd-cm{display:flex;gap:11px;padding:10px 0;border-top:1px solid rgb(var(--c-slate-border));width:100%;text-align:left;background:none;border-left:0;border-right:0;border-bottom:0}
.cd-cm.first{border-top:0}
.cd-cm .av{width:38px;height:38px;border-radius:50%;background:#2563eb;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.cd-cn{font-size:14px;font-weight:700}.cd-cn i{font-style:normal;font-weight:500;font-size:12px;margin-left:6px;color:rgb(var(--c-slate-subtle))}
.cd-ct{font-size:14px;margin-top:2px;color:rgb(var(--c-slate-muted));display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cd-ok{display:flex;gap:12px;align-items:center}
.cd-ok>span{width:44px;height:44px;border-radius:50%;background:rgba(47,196,141,.18);color:#2fc48d;display:flex;align-items:center;justify-content:center;flex:none}
.cd-ok b{font-size:15px}.cd-ok p{font-size:13px;line-height:1.5;margin-top:2px;color:rgb(var(--c-slate-muted))}
.cd-act{font-size:12px;font-weight:700;padding:4px 11px;border-radius:99px}
.cd-links{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cd-link{background:rgb(var(--c-surface-container));border:1px solid rgb(var(--c-slate-border));border-radius:14px;padding:13px;font-size:14.5px;font-weight:700;display:flex;gap:10px;align-items:center;text-align:left}
.cd-link .material-symbols-outlined{color:#6c9bff;font-size:21px}
`;

async function load(db, uid) {
  const safe = (p, fallback) => p.catch(() => fallback);
  const [userSnap, appSnap, postsSnap, followersSnap] = await Promise.all([
    safe(get(ref(db, `users/${uid}`)), null),
    safe(get(ref(db, `creatorApps/${uid}`)), null),
    safe(get(query(ref(db, "posts"), orderByChild("uid"), equalTo(uid))), null),
    safe(get(ref(db, `followers/${uid}`)), null)
  ]);
  const profile = (userSnap && userSnap.val()) || {};
  const app = (appSnap && appSnap.val()) || {};
  const posts = [];
  if (postsSnap) {
    postsSnap.forEach((c) => {
      const p = c.val() || {};
      posts.push({
        id: c.key,
        raw: { id: c.key, ...p },
        at: Number(p.createdAt) || 0,
        views: Number(p.viewsCount) || 0,
        likes: Number(p.likesCount) || 0,
        comments: Number(p.commentsCount) || 0,
        shares: Number(p.sharesCount) || 0,
        thumb: String(p.videoThumb || p.imageURL || (Array.isArray(p.imageURLs) ? p.imageURLs[0] : "") || ""),
        text: String(p.text || ""),
        video: !!p.videoURL
      });
    });
  }
  posts.sort((a, b) => b.at - a.at);
  const followTimes = [];
  if (followersSnap) followersSnap.forEach((c) => { followTimes.push(Number(c.val()) || 0); });

  // comments of other people on your newest posts that you have not answered
  const pending = [];
  for (const p of posts.filter((x) => x.comments > 0).slice(0, 3)) {
    try {
      const snap = await get(query(ref(db, `posts/${p.id}/comments`), limitToLast(30)));
      snap.forEach((c) => {
        const d = c.val() || {};
        if (d.uid === uid) return;
        const answered = Object.values(d.replies || {}).some((r) => r && r.uid === uid);
        if (answered) return;
        pending.push({ postId: p.id, name: String(d.name || "FreeZone User"), photoURL: d.photoURL || "", text: String(d.text || ""), at: Number(d.createdAt) || 0 });
      });
    } catch (error) { /* this post is skipped */ }
  }
  pending.sort((a, b) => b.at - a.at);

  let cur = null;
  let prev = null;
  let payout = { open: false };
  if (app.status === "approved") {
    const now = Date.now();
    const [c, p] = await Promise.all([
      safe(get(ref(db, `creatorEarnings/${monthKey(now)}/${uid}`)), null),
      safe(get(ref(db, `creatorEarnings/${monthKey(now - 31 * DAY)}/${uid}`)), null)
    ]);
    cur = c && c.exists() ? c.val() : null;
    prev = p && p.exists() ? p.val() : null;
    payout = await loadPayout(db, uid).catch(() => ({ open: false }));
  }
  return { profile, app, posts, followTimes, pending: pending.slice(0, 3), cur, prev, payout };
}

export async function render(root, ctx) {
  const { db, currentUser } = ctx;
  const uid = currentUser.uid;
  // Back goes to the Creator Program page (the settings list is one more step)
  ctx.setBack?.(() => ctx.go("creator"));
  root.innerHTML = `<div class="max-w-lg mx-auto pb-12">${formSkeleton(3)}</div>`;

  let data;
  try {
    data = await load(db, uid);
  } catch (error) {
    console.error("Creator dashboard:", error);
    root.innerHTML = `<p class="text-center text-slate-muted font-body-md text-body-md py-16">Could not load this page. Please try again.</p>`;
    return;
  }
  const approved = data.app.status === "approved";
  let period = 0; // 0 = 28 days, 1 = 7 days, 2 = today

  const metrics = (from, to) => {
    let v = 0;
    let e = 0;
    data.posts.forEach((p) => { if (p.at >= from && p.at < to) { v += p.views; e += p.likes + p.comments + p.shares; } });
    return { views: v, engagement: e, followers: data.followTimes.filter((t) => t >= from && t < to).length };
  };
  const periodMetrics = () => {
    const now = Date.now();
    let from;
    let prevFrom;
    if (period === 2) {
      const d = new Date(now); d.setHours(0, 0, 0, 0);
      from = d.getTime(); prevFrom = from - DAY;
    } else {
      const len = (period === 0 ? 28 : 7) * DAY;
      from = now - len; prevFrom = from - len;
    }
    return [metrics(from, now + 1), metrics(prevFrom, from)];
  };
  const delta = (cur, prev) => {
    if (!prev && !cur) return `<span class="cd-dl no">no change</span>`;
    if (!prev) return `<span class="cd-dl up">New</span>`;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return `<span class="cd-dl no">no change</span>`;
    return `<span class="cd-dl ${pct > 0 ? "up" : "dn"}">${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}%</span>`;
  };
  const metricRow = (icon, color, label, cur, prev, first) =>
    `<div class="cd-row${first ? " first" : ""}"><span class="cd-chip" style="background:${color}22;color:${color}"><span class="material-symbols-outlined">${icon}</span></span><span class="cd-rl">${label}</span><span class="cd-rv tabular-nums">${compact(cur)}</span>${delta(cur, prev)}</div>`;
  const goalRow = (label, value, need, fill) => {
    const pct = Math.min(100, Math.round((value / need) * 100));
    return `<div class="cd-gl"><div class="cd-gh"><span>${label}</span><b class="tabular-nums">${Math.min(value, need)}/${need}</b></div><div class="cd-bar"><div style="width:${Math.max(2, pct)}%;background:${fill}"></div></div></div>`;
  };
  const chipRow = (icon, color, label, right, onId, first) =>
    `<button type="button" class="cd-row${first ? " first" : ""}" ${onId ? `data-act="${onId}"` : ""}><span class="cd-chip" style="background:${color}22;color:${color}"><span class="material-symbols-outlined">${icon}</span></span><span class="cd-rl">${label}</span>${right}<span class="material-symbols-outlined text-slate-subtle">chevron_right</span></button>`;

  const draw = () => {
    const { profile, app, posts, followTimes, pending, cur, prev, payout } = data;
    const name = profile.name || currentUser.displayName || "You";
    const fin = !!(cur && cur.final);
    const hero = approved
      ? `<div class="cd-hero"><div class="cd-hr"><div class="cd-av">${avatarHtml(profile.photoURL, "w-14 h-14")}<span class="cd-vk"><span class="material-symbols-outlined">check</span></span></div><div class="min-w-0"><div class="cd-nm truncate">${escapeHtml(name)}</div><div class="cd-fl">${num(followTimes.length)} followers · Creator Program member</div></div></div>
          <div class="cd-el">${fin ? "Earnings this month" : "Estimated earnings this month"}</div>
          <div class="cd-amt tabular-nums">${taka(cur && cur.amount)}</div>
          <div class="cd-ef">The final amount is set when the month closes</div>
          <div class="cd-hst"><div><b class="tabular-nums">${num(cur && cur.v)}</b><i>Videos watched</i></div><div><b class="tabular-nums">${num(cur && cur.p)}</b><i>Posts seen</i></div><div><b class="tabular-nums">${num(cur && cur.f)}</b><i>Profile visits</i></div></div></div>`
      : `<div class="cd-hero"><div class="cd-hr"><div class="cd-av">${avatarHtml(profile.photoURL, "w-14 h-14")}</div><div class="min-w-0"><div class="cd-nm truncate">${escapeHtml(name)}</div><div class="cd-fl">${num(followTimes.length)} followers</div></div></div>
          <div class="cd-amt" style="font-size:20px;margin-top:16px">You are not in the Creator Program yet</div>
          <button type="button" class="cd-learn" data-act="program">Learn more</button></div>`;

    const [cm, pm] = periodMetrics();
    const tabs = ["28 days", "7 days", "Today"].map((t, i) => `<button type="button" class="cd-tab${i === period ? " on" : ""}" data-period="${i}">${t}</button>`).join("");
    const perf = `<section class="cd-box"><div class="cd-ttl"><h2>Performance</h2><span>vs previous period</span></div><div class="cd-tabs">${tabs}</div><p class="cd-sm">Counts posts published in this period</p>
      ${metricRow("visibility", "#c084fc", "Views", cm.views, pm.views, true)}${metricRow("favorite", "#ff6b8a", "Engagement", cm.engagement, pm.engagement)}${metricRow("person_add", "#5b8cff", "New followers", cm.followers, pm.followers)}</section>`;

    const weekAgo = Date.now() - 7 * DAY;
    const wp = posts.filter((p) => p.at >= weekAgo);
    const goals = `<section class="cd-box"><div class="cd-ttl"><h2>This week’s goals</h2></div>
      ${goalRow("Post 7 times", wp.length, GOALS.posts, "linear-gradient(135deg,#3b82f6,#2563eb)")}
      ${goalRow("Get 10 reactions", wp.reduce((s, p) => s + p.likes + p.comments + p.shares, 0), GOALS.reactions, "#2fc48d")}
      ${goalRow("Gain 5 followers", followTimes.filter((t) => t >= weekAgo).length, GOALS.followers, "#fbbf24")}</section>`;

    const lp = posts[0];
    const latest = lp
      ? `<section class="cd-box"><div class="cd-ttl"><h2>Latest post</h2><span>${escapeHtml(timeAgo(lp.at))}</span></div>
          <button type="button" class="cd-lp" data-act="open-post"><span class="cd-th" ${lp.thumb.startsWith("https://") ? `style="background-image:url('${escapeHtml(lp.thumb)}')"` : ""}>${lp.video ? `<span class="material-symbols-outlined">play_circle</span>` : ""}</span><p>${escapeHtml(lp.text) || "&nbsp;"}</p></button>
          <div class="cd-g4"><div><b class="tabular-nums">${compact(lp.views)}</b><i>Views</i></div><div><b class="tabular-nums">${compact(lp.likes)}</b><i>Likes</i></div><div><b class="tabular-nums">${compact(lp.comments)}</b><i>Comments</i></div><div><b class="tabular-nums">${compact(lp.shares)}</b><i>Shares</i></div></div>
          <button type="button" class="cd-boost" data-act="boost"><span class="material-symbols-outlined text-[20px]">rocket_launch</span>Boost this post</button></section>`
      : `<section class="cd-box"><div class="cd-ttl"><h2>Latest post</h2></div><p class="text-slate-muted">You have no posts yet.</p></section>`;

    const reply = `<section class="cd-box"><div class="cd-ttl"><h2>Needs your reply</h2></div>${
      pending.length
        ? pending.map((c, i) => `<button type="button" class="cd-cm${i === 0 ? " first" : ""}" data-post="${escapeHtml(c.postId)}"><span class="av">${escapeHtml((c.name || "?").trim().charAt(0).toUpperCase())}</span><span class="min-w-0"><div class="cd-cn">${escapeHtml(c.name)}<i>${escapeHtml(timeAgo(c.at))}</i></div><div class="cd-ct">${escapeHtml(c.text)}</div></span></button>`).join("")
        : `<div class="cd-ok"><span><span class="material-symbols-outlined">check</span></span><div><b>You are all caught up</b><p>Comments you haven’t responded to yet will appear here.</p></div></div>`
    }</section>`;

    const state = approved
      ? `<span class="cd-act" style="background:rgba(47,196,141,.15);color:#2fc48d">Active</span>`
      : app.status === "pending"
        ? `<span class="cd-act" style="background:rgba(91,140,255,.15);color:#6c9bff">Pending</span>`
        : `<span class="cd-act" style="background:rgb(var(--c-surface-container));color:rgb(var(--c-slate-muted))">Not joined</span>`;
    const pay = `<section class="cd-box"><div class="cd-ttl"><h2>Earnings and payout</h2></div>
      ${chipRow("workspace_premium", "#fbbf24", "Creator Program", state, "program", true)}
      ${approved ? chipRow("account_balance_wallet", "#ff9f43", "Payout", `<b>${payout.open ? taka(payout.available) : "Not open yet"}</b>`, "program") : ""}
      ${approved ? chipRow("calendar_month", "#c084fc", "Last month", `<b>${taka(prev && prev.amount)}</b>`, "program") : ""}</section>`;

    const link = (icon, label, act) => `<button type="button" class="cd-link" data-act="${act}"><span class="material-symbols-outlined">${icon}</span>${label}</button>`;
    const links = `<section class="cd-box"><div class="cd-links">${link("settings", "Settings", "settings")}${link("favorite", "Support", "help")}${link("menu_book", "Creator terms", "terms")}${link("rocket_launch", "Boost a post", "myboosts")}</div></section>`;

    root.innerHTML = `<style>${CSS}</style><div class="cd">${hero}${perf}${goals}${latest}${reply}${pay}${links}</div>`;

    root.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => { period = Number(b.dataset.period); draw(); }));
    const acts = {
      program: () => ctx.go("creator"),
      settings: () => ctx.goMain(),
      help: () => ctx.go("help"),
      terms: () => window.open("creator-terms.html", "_blank", "noopener"),
      myboosts: () => import("./boost.js").then((m) => m.openMyBoosts()).catch(() => showToast("Could not open Boost. Try again.")),
      boost: () => import("./boost.js").then((m) => m.openBoost({ post: lp.raw })).catch(() => showToast("Could not open Boost. Try again.")),
      "open-post": () => ctx.onOpenPost?.(lp.id)
    };
    root.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", () => acts[el.dataset.act]?.()));
    root.querySelectorAll("[data-post]").forEach((el) => el.addEventListener("click", () => ctx.onOpenPost?.(el.dataset.post)));
  };
  draw();
}
