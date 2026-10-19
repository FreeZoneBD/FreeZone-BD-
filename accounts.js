// FreeZone BD - several accounts on one phone.
// Firebase keeps ONE person signed in at a time, so this list only remembers who has used this phone
// (name, @username, photo, email). Passwords are never saved: switching sends the person to the
// login page with the email already filled in. The current account stays signed in until the
// new login succeeds, so cancelling or a wrong password changes nothing.
const KEY = "fz-accounts";
export const MAX_ACCOUNTS = 5;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function getAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((a) => a && typeof a.uid === "string").slice(0, MAX_ACCOUNTS) : [];
  } catch (error) {
    return [];
  }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS))); } catch (error) { /* storage blocked: nothing to remember */ }
}

// Called every time the feed opens: adds the signed-in account, or refreshes its name and photo.
export function rememberAccount(user, profile) {
  if (!user || !user.uid) return;
  const list = getAccounts();
  const entry = {
    uid: user.uid,
    email: user.email || "",
    name: (profile && profile.name) || user.displayName || "FreeZone User",
    username: (profile && profile.username) || "",
    photoURL: profile && typeof profile.photoURL === "string" && profile.photoURL.startsWith("https://") ? profile.photoURL : ""
  };
  const i = list.findIndex((a) => a.uid === user.uid);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else if (list.length < MAX_ACCOUNTS) list.push(entry);
  else return; // full: the person removes one first
  save(list);
}

export function forgetAccount(uid) {
  save(getAccounts().filter((a) => a.uid !== uid));
}

// Go to the login page without signing out. Push notifications of the old account stop first.
async function goLogin({ email = "", signup = false } = {}) {
  try {
    if (window.fzPush && window.fzPush.unregister) {
      await Promise.race([window.fzPush.unregister(), new Promise((resolve) => setTimeout(resolve, 2500))]);
    }
  } catch (error) { /* ignore */ }
  const q = new URLSearchParams({ add: "1", next: "feed.html" });
  if (email) q.set("email", email);
  if (signup) q.set("tab", "signup");
  window.location.href = "./login.html?" + q.toString();
}

const avatar = (a, size) =>
  a.photoURL
    ? `<img class="${size} rounded-full object-cover flex-shrink-0" src="${esc(a.photoURL)}" alt="" />`
    : `<span class="${size} rounded-full bg-primary-container text-white flex items-center justify-center flex-shrink-0 font-bold" data-notr>${esc((a.name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`;

// The bottom sheet: the accounts on this phone + "Log into another account" / "Create new account"
export function openAccountSwitcher({ currentUid } = {}) {
  if (document.querySelector(".fz-acc-sheet")) return;
  const overlay = document.createElement("div");
  overlay.className = "fz-acc-sheet fixed inset-0 z-[9998] flex items-end justify-center bg-black/40";

  const paint = () => {
    const list = getAccounts();
    const full = list.length >= MAX_ACCOUNTS;
    overlay.innerHTML = `
      <div class="w-full max-w-lg bg-slate-surface text-on-surface rounded-t-3xl shadow-2xl px-4 pt-4 pb-[max(1.25rem,var(--fz-bottom,env(safe-area-inset-bottom,0px)))]" role="dialog" aria-modal="true" aria-label="Switch account">
        <div class="flex items-center gap-2 mb-2">
          <button type="button" class="ac-close w-10 h-10 -ml-1 rounded-full flex items-center justify-center active:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[24px]">close</span></button>
          <h2 class="flex-1 text-[18px] font-semibold">Switch account</h2>
        </div>
        <div class="max-h-[52vh] overflow-y-auto overscroll-contain">
          ${list
            .map((a) => {
              const mine = a.uid === currentUid;
              return `
            <div class="flex items-center gap-1">
              <button type="button" class="ac-row flex-1 min-w-0 flex items-center gap-3 px-2 py-2.5 rounded-xl text-left active:bg-surface-container" data-uid="${esc(a.uid)}">
                ${avatar(a, "w-11 h-11 text-[18px]")}
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold text-[16px] truncate" data-notr>${esc(a.name)}</span>
                  <span class="block text-[14px] text-slate-muted truncate" data-notr>${a.username ? "@" + esc(a.username) : esc(a.email)}</span>
                </span>
                ${mine ? `<span class="material-symbols-outlined text-[24px] text-primary-container" style="font-variation-settings:'FILL' 1;" aria-label="Current account">check_circle</span>` : ""}
              </button>
              ${mine ? "" : `<button type="button" class="ac-del w-10 h-10 rounded-full flex items-center justify-center text-slate-muted active:bg-surface-container" data-uid="${esc(a.uid)}" aria-label="Remove from this list"><span class="material-symbols-outlined text-[20px]">close</span></button>`}
            </div>`;
            })
            .join("")}
        </div>
        <div class="mt-3 pt-3 border-t border-slate-border">
          ${full ? `<p class="text-[13px] text-slate-muted text-center mb-2">You can keep up to ${MAX_ACCOUNTS} accounts. Remove one to add another.</p>` : ""}
          <button type="button" class="ac-login w-full h-12 rounded-full bg-primary-container text-white font-semibold text-[16px] active:scale-[.98] transition-all ${full ? "opacity-50" : ""}" ${full ? "disabled" : ""}>Log into another account</button>
          <button type="button" class="ac-create w-full h-11 mt-1 text-primary-container font-semibold text-[15px] active:opacity-70 ${full ? "opacity-50" : ""}" ${full ? "disabled" : ""}>Create new account</button>
        </div>
      </div>`;
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === overlay || event.target.closest(".ac-close")) return close();
    const del = event.target.closest(".ac-del");
    if (del) { forgetAccount(del.dataset.uid); return paint(); }
    const row = event.target.closest(".ac-row");
    if (row) {
      if (row.dataset.uid === currentUid) return close();
      const acc = getAccounts().find((a) => a.uid === row.dataset.uid);
      close();
      return goLogin({ email: acc ? acc.email : "" });
    }
    if (event.target.closest(".ac-login")) { close(); return goLogin(); }
    if (event.target.closest(".ac-create")) { close(); return goLogin({ signup: true }); }
  });

  paint();
  document.body.appendChild(overlay);
}
