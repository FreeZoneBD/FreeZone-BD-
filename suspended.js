// FreeZone BD - "Your account is suspended" full-screen page.
// Shown once after sign-in while profile.suspended === true, and again when the red bar is tapped.
// The person can still read the app ("Continue to read-only mode"), appeal (opens Report a problem), read the guidelines or log out.
import { escapeHtml } from "./post.js";

const STYLE_ID = "fz-susp-style";
function styles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
  .su{position:fixed;inset:0;z-index:90;overflow-y:auto;background:linear-gradient(180deg,#2a0f18,#0b1220 55%);color:#e6edf7;padding:calc(env(safe-area-inset-top,0px) + 8px) 16px calc(env(safe-area-inset-bottom,0px) + 24px)}
  .su-sh{width:92px;height:92px;border-radius:30px;margin:30px auto 14px;background:linear-gradient(135deg,#ff4d6d,#e11d48);display:flex;align-items:center;justify-content:center;box-shadow:0 14px 34px rgba(225,29,72,.4)}
  .su-t{font-size:25px;font-weight:800;text-align:center;line-height:1.3}
  .su-s{color:#8fa0bd;text-align:center;margin:8px 10px 18px;line-height:1.55;font-size:14.5px}
  .su-l{font-size:12px;font-weight:800;letter-spacing:.8px;color:#8fa0bd;margin:16px 2px 8px}
  .su-b{background:#111a2e;border:1px solid #223049;border-radius:18px;padding:4px 16px;margin-bottom:12px}
  .su-r{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid #223049;line-height:1.45}.su-r:first-child{border:0}
  .su-d{width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;font-weight:800}
  .su-r small{display:block;color:#8fa0bd;font-size:12.5px;margin-top:2px}
  .su-ok{background:rgba(47,196,141,.15);color:#2fc48d}.su-no{background:rgba(255,77,109,.15);color:#ff4d6d}
  .su-btn{height:50px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15.5px;margin-top:10px;width:100%;border:0;color:#fff}
  .su-pri{background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 8px 20px rgba(37,99,235,.35)}.su-sec{border:1px solid #223049;background:#111a2e}
  .su-lk{display:block;width:100%;text-align:center;font-weight:700;margin-top:16px;background:none;border:0;padding:6px}
  `;
  document.head.appendChild(s);
}

const dateText = (t) => {
  const v = Number(t);
  if (!v) return "";
  try { return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
};

/** showSuspended(profile, { onAppeal, onGuidelines, onLogout }) */
export function showSuspended(profile, h = {}) {
  if (document.querySelector(".su")) return;
  styles();
  const reason = String(profile.suspendReason || "").trim();
  const when = dateText(profile.suspendedAt);
  const el = document.createElement("div");
  el.className = "su";
  el.innerHTML = `
    <div class="su-sh"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16.5v.1"/></svg></div>
    <div class="su-t">Your account is suspended</div>
    <div class="su-s">Some features are turned off because of a problem with your account. You can still read the app.</div>
    <div class="su-l">REASON</div>
    <div class="su-b"><div class="su-r"><span class="su-d su-no">!</span><div><b>${escapeHtml(reason || "Not following the Community Guidelines")}</b>${when ? `<small>Suspended on ${escapeHtml(when)}</small>` : ""}</div></div></div>
    <div class="su-l">WHAT YOU CAN DO</div>
    <div class="su-b">
      <div class="su-r"><span class="su-d su-ok">✓</span><div>Read posts and reels<small>View profiles and notifications</small></div></div>
      <div class="su-r"><span class="su-d su-ok">✓</span><div>Delete your own posts<small>Edit your profile, change settings</small></div></div>
      <div class="su-r"><span class="su-d su-no">✕</span><div>Post, comment, send messages<small>React, follow, call</small></div></div>
    </div>
    <button type="button" class="su-btn su-pri" data-a="appeal">Appeal this decision</button>
    <button type="button" class="su-btn su-sec" data-a="rules">Read Community Guidelines</button>
    <button type="button" class="su-lk" data-close data-a="go" style="color:#9db4ff">Continue to read-only mode</button>
    <button type="button" class="su-lk" data-a="out" style="color:#ff7a93">Log out</button>`;
  document.body.appendChild(el);
  const done = () => el.remove();
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "go") done();
    else if (a === "appeal") { done(); h.onAppeal?.(); }
    else if (a === "rules") h.onGuidelines?.();
    else if (a === "out") h.onLogout?.();
  });
}
