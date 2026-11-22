// FreeZone BD - Post insights (full-screen page, opened from "Post insights" in the menu of my own post).
// Read-only. Shows what the database really has for this post and compares it with my other recent posts:
//   Views (viewsCount: one per person who saw it), Likes, Comments, Shares, and the rates against views.
// Viewers, profile visits, follows and the views-over-time chart come from postStats (post-stats.js): anonymous hourly counters
// that only exist for views made after that feature was installed (and not for the Flutter app yet).
import { ref, get, query, orderByChild, equalTo, limitToLast } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { escapeHtml, timeAgo, avatarHtml, postImageUrls, showToast } from "./post.js";

const STYLE_ID = "fz-pi-style";
const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const fmt = (v) => Math.round(v).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function styles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
  .pi{position:fixed;inset:0;z-index:75;display:flex;flex-direction:column;background:rgb(var(--c-background,11 18 32));color:rgb(var(--c-on-surface,230 237 247))}
  .pi-bar{display:flex;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 12px;border-bottom:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-bar b{flex:1;text-align:center;font-size:17px;font-weight:800;margin-right:36px}
  .pi-back{width:36px;height:36px;border-radius:50%;background:rgb(var(--c-surface-container,22 33 58));display:flex;align-items:center;justify-content:center}
  .pi-body{flex:1;overflow-y:auto;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 28px)}
  .pi-card{padding:16px;background:rgb(var(--c-slate-surface,17 26 46));border-bottom:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-pr{display:flex;gap:10px;align-items:center}.pi-pr b{font-size:15px}.pi-pr span{color:rgb(var(--c-slate-muted,143 160 189));font-size:13px}
  .pi-txt{margin:10px 0;line-height:1.5;font-size:15px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden;white-space:pre-wrap;word-break:break-word}
  .pi-img{width:100%;max-height:200px;object-fit:cover;border-radius:12px;display:block}
  .pi-ac{display:flex;gap:22px;margin-top:12px;color:rgb(var(--c-slate-muted,143 160 189));font-size:13px}
  .pi h3{font-size:19px;font-weight:800;margin:22px 16px 4px}
  .pi-sub{color:rgb(var(--c-slate-muted,143 160 189));font-size:13px;margin:0 16px 12px}
  .pi-grid{display:grid;grid-template-columns:1fr 1fr;margin-top:12px;border-top:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-tile{padding:14px 16px;min-height:104px;border-bottom:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-tile:nth-child(odd){border-right:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-tile small{color:rgb(var(--c-slate-muted,143 160 189));font-size:13px}.pi-tile strong{display:block;font-size:30px;font-weight:800;margin-top:4px}
  .pi-tile em{font-style:normal;font-size:12.5px;color:rgb(var(--c-slate-muted,143 160 189))}.pi-up{color:#2fc48d!important}.pi-dn{color:#ff7a93!important}
  .pi-cmp{padding:0 16px}.pi-cr{margin:12px 0}.pi-cr .l{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:6px}
  .pi-tr{height:8px;border-radius:99px;background:rgb(var(--c-surface-container,22 33 58));position:relative;margin-bottom:5px}
  .pi-tr i{display:block;height:100%;border-radius:99px}
  .pi-leg{display:flex;gap:18px;color:rgb(var(--c-slate-muted,143 160 189));font-size:13px;margin:6px 0 0}.pi-leg i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
  .pi-rate{display:flex;align-items:center;gap:14px;padding:12px 16px;border-top:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-ic{width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center}
  .pi-rate b{flex:1;font-size:15.5px}.pi-rate span{font-weight:800;font-size:15.5px}
  .pi-chips{display:flex;gap:8px;padding:12px 16px}.pi-chip{border:1px solid rgb(var(--c-slate-border,34 48 73));border-radius:999px;padding:8px 16px;font-weight:700;font-size:13.5px;background:transparent;color:inherit}
  .pi-chip.on{background:linear-gradient(135deg,#3b82f6,#2563eb);border-color:transparent;color:#fff}
  .pi-chw{padding:0 16px 0 40px}.pi-ch{position:relative;border-bottom:2px solid currentColor;border-top:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-ch:after{content:"";position:absolute;left:0;right:0;top:50%;border-top:1px solid rgb(var(--c-slate-border,34 48 73))}
  .pi-y{position:absolute;left:-34px;font-size:11px;color:rgb(var(--c-slate-muted,143 160 189))}
  .pi-xl{display:flex;justify-content:space-between;color:rgb(var(--c-slate-muted,143 160 189));font-size:12.5px;margin-top:8px}
  .pi-empty{padding:34px 0;text-align:center;color:rgb(var(--c-slate-muted,143 160 189));font-size:13.5px}
  .pi-note{margin:18px 16px 0;color:rgb(var(--c-slate-muted,143 160 189));font-size:12.5px;line-height:1.5}
  `;
  document.head.appendChild(s);
}

const metrics = (p) => ({
  views: n(p.viewsCount),
  likes: n(p.likesCount) || (p.likes ? Object.keys(p.likes).length : 0),
  comments: n(p.commentsCount),
  shares: n(p.sharesCount)
});

export async function openPostInsights(post, { db, me }) {
  if (!post || !me || post.uid !== me) { showToast("You can only see insights of your own posts"); return; }
  styles();
  const el = document.createElement("div");
  el.className = "pi";
  el.innerHTML = `<div class="pi-bar"><button type="button" class="pi-back" aria-label="Back"><span class="material-symbols-outlined">arrow_back</span></button><b>Post insights</b></div><div class="pi-body"><div style="padding:60px 0;text-align:center;opacity:.7">Loading…</div></div>`;
  document.body.appendChild(el);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const close = () => { el.remove(); document.body.style.overflow = prevOverflow; };
  el.querySelector(".pi-back").addEventListener("click", close);
  const body = el.querySelector(".pi-body");

  let fresh = post, others = [], stats = {};
  try {
    const [one, mine, st] = await Promise.all([
      get(ref(db, `posts/${post.id}`)),
      get(query(ref(db, "posts"), orderByChild("uid"), equalTo(me), limitToLast(21))),
      get(ref(db, `postStats/${post.id}`)).catch(() => null)
    ]);
    if (st && st.exists()) stats = st.val() || {};
    if (one.exists()) fresh = { id: post.id, ...one.val() };
    mine.forEach((s) => { if (s.key !== post.id) others.push(metrics(s.val() || {})); });
  } catch (e) {
    body.innerHTML = `<div style="padding:60px 24px;text-align:center;opacity:.75">Could not load insights. Check your connection and try again.</div>`;
    return;
  }

  const m = metrics(fresh);
  const HOUR = 3600000;
  const tot = { v: 0, vf: 0, u: 0, uf: 0, p: 0, fo: 0 };
  const byHour = {};
  Object.keys(stats).forEach((h) => {
    const row = stats[h] || {};
    byHour[Number(h)] = row;
    Object.keys(tot).forEach((k) => { tot[k] += n(row[k]); });
  });
  const hasStats = Object.keys(byHour).length > 0;
  // chart: hourly while the post is young (up to 48 h), daily after that (last 14 days)
  const nowH = Math.floor(Date.now() / HOUR);
  const startH = Math.min(Math.floor((Number(fresh.createdAt) || Date.now()) / HOUR), nowH - 1); // at least two points, so a line can be drawn
  const hourly = nowH - startH <= 48;
  const points = (tab) => {
    const val = (row) => (tab === "followers" ? n(row.vf) : tab === "non" ? Math.max(0, n(row.v) - n(row.vf)) : n(row.v));
    const out = [];
    if (hourly) {
      for (let h = startH; h <= nowH; h++) out.push({ at: h * HOUR, y: byHour[h] ? val(byHour[h]) : 0 });
    } else {
      const DAY = 86400000, today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Math.min(14, Math.max(2, Math.ceil((Date.now() - (Number(fresh.createdAt) || Date.now())) / DAY) + 1));
      for (let i = days - 1; i >= 0; i--) {
        const d0 = today.getTime() - i * DAY, d1 = d0 + DAY;
        let y = 0;
        Object.keys(byHour).forEach((h) => { const t = Number(h) * HOUR; if (t >= d0 && t < d1) y += val(byHour[h]); });
        out.push({ at: d0, y });
      }
    }
    return out;
  };
  const labelOf = (t) => { const d = new Date(t); return hourly ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: undefined, hour12: true }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
  const chartSvg = (tab) => {
    const pts = points(tab), W = 330, H = 150;
    const max = Math.max(1, ...pts.map((p) => p.y));
    const top = max <= 4 ? max : Math.ceil(max / 4) * 4;
    const X = (i) => (pts.length < 2 ? 0 : (i / (pts.length - 1)) * W), Y = (v) => H - (v / top) * (H - 6) - 2;
    const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" ");
    return `<div class="pi-ch"><span class="pi-y" style="top:-8px">${fmt(top)}</span><span class="pi-y" style="top:${H / 2 - 8}px">${fmt(top / 2)}</span><span class="pi-y" style="bottom:-8px">0</span>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="display:block;overflow:visible"><defs><linearGradient id="pig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6" stop-opacity=".35"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${W} ${H} L0 ${H}Z" fill="url(#pig)"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>
      <div class="pi-xl"><span>${escapeHtml(labelOf(pts[0].at))}</span><span>${escapeHtml(labelOf(pts[pts.length - 1].at))}</span></div>`;
  };
  const keys = ["views", "likes", "comments", "shares"];
  const typical = {};
  keys.forEach((k) => { typical[k] = others.length ? others.reduce((a, o) => a + o[k], 0) / others.length : 0; });
  const delta = (k) => {
    if (!others.length) return `<em>No other posts to compare</em>`;
    const t = typical[k];
    if (t <= 0) return `<em>Typical 0</em>`;
    const d = Math.round(((m[k] - t) / t) * 100);
    const cls = d > 0 ? "pi-up" : d < 0 ? "pi-dn" : "";
    return `<em class="${cls}">${d > 0 ? "▲ " : d < 0 ? "▼ " : ""}${d === 0 ? "" : Math.abs(d) + "% · "}Typical ${fmt(t)}</em>`;
  };
  const statTile = (label, v) => `<div class="pi-tile"><small>${label}</small><strong>${hasStats ? fmt(v) : "–"}</strong><em>${hasStats ? " " : "No data yet"}</em></div>`;
  const tile = (label, k) => `<div class="pi-tile"><small>${label}</small><strong>${fmt(m[k])}</strong>${delta(k)}</div>`;
  const cmp = (label, k, color) => {
    const top = Math.max(m[k], typical[k], 1);
    return `<div class="pi-cr"><div class="l"><span>${label}</span><b>${fmt(m[k])}</b></div>
      <div class="pi-tr"><i style="width:${(m[k] / top) * 100}%;background:${color}"></i></div>
      <div class="pi-tr" style="height:5px"><i style="width:${(typical[k] / top) * 100}%;background:#5b6b88"></i></div></div>`;
  };
  const rate = (label, k, bg, fg, icon) => `<div class="pi-rate"><div class="pi-ic" style="background:${bg};color:${fg}"><span class="material-symbols-outlined">${icon}</span></div><b>${label}</b><span>${pct(m[k], m.views)}%</span></div>`;
  const img = postImageUrls(fresh)[0];

  body.innerHTML = `
    <div class="pi-card">
      <div class="pi-pr">${avatarHtml(fresh.photoURL, "w-10 h-10")}<div><b>${escapeHtml(fresh.name || "You")}</b> <span>· ${escapeHtml(timeAgo(fresh.createdAt))}</span></div></div>
      ${fresh.text ? `<div class="pi-txt">${escapeHtml(fresh.text)}</div>` : `<div style="height:10px"></div>`}
      ${img ? `<img class="pi-img" src="${escapeHtml(img)}" alt="" loading="lazy" onerror="this.remove()"/>` : ""}
      <div class="pi-ac"><span>♡ ${fmt(m.likes)}</span><span>◯ ${fmt(m.comments)}</span><span>↗ ${fmt(m.shares)}</span></div>
    </div>
    <h3>Summary</h3>
    <div class="pi-grid">${tile("Views", "views")}${statTile("Viewers", tot.u)}${statTile("Profile visits", tot.p)}${statTile("Follows", tot.fo)}</div>
    <h3>Views over time</h3>
    <div class="pi-chips"><button type="button" class="pi-chip on" data-tab="all">All</button><button type="button" class="pi-chip" data-tab="followers">Followers</button><button type="button" class="pi-chip" data-tab="non">Non-followers</button></div>
    <div class="pi-chw">${hasStats ? chartSvg("all") : `<div class="pi-empty">No data yet. Views made from now on will appear here.</div>`}</div>
    <h3>This post vs your typical post</h3>
    <div class="pi-sub">${others.length ? `Typical = average of your last ${others.length} other post${others.length === 1 ? "" : "s"}` : "Post more to see how this one compares"}</div>
    <div class="pi-cmp">${cmp("Views", "views", "#3b82f6")}${cmp("Likes", "likes", "#ff4d6d")}${cmp("Comments", "comments", "#2fc48d")}${cmp("Shares", "shares", "#6c9bff")}
      <div class="pi-leg"><span><i style="background:#3b82f6"></i>This post</span><span><i style="background:#5b6b88"></i>Your typical post</span></div></div>
    <h3>What impacts your views</h3><div class="pi-sub">Rates are worked out from views</div>
    ${rate("Like rate", "likes", "rgba(255,77,109,.15)", "#ff4d6d", "favorite")}
    ${rate("Comment rate", "comments", "rgba(47,196,141,.15)", "#2fc48d", "chat_bubble")}
    ${rate("Share rate", "shares", "rgba(59,130,246,.15)", "#6c9bff", "send")}
    <div class="pi-note">Views never include your own. Viewers, profile visits, follows and the chart only count views made after this feature started, and not the older FreeZone app yet. Nothing here shows who viewed.</div>`;
  body.querySelectorAll(".pi-chip").forEach((b) => b.addEventListener("click", () => {
    body.querySelectorAll(".pi-chip").forEach((x) => x.classList.toggle("on", x === b));
    const w = body.querySelector(".pi-chw");
    if (w && hasStats) w.innerHTML = chartSvg(b.dataset.tab);
  }));
}
