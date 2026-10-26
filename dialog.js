/* In-app question box (replaces the browser's confirm()).
   const yes = await fzConfirm("Delete this post?", { confirmLabel: "Delete", danger: true });
   Looks like the rest of the app (light and dark), has no web address in it, and Back closes it as "No". */
export function fzConfirm(message, options = {}) {
  const { confirmLabel = "OK", cancelLabel = "Cancel", danger = false } = options;
  return new Promise((resolve) => {
    const old = document.getElementById("fzConfirm");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.id = "fzConfirm";
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.55);";
    const box = document.createElement("div");
    box.style.cssText = "width:100%;max-width:340px;border-radius:18px;padding:20px 18px 14px;background:rgb(var(--c-slate-surface,255 255 255));color:rgb(var(--c-on-background,25 28 30));box-shadow:0 20px 50px rgba(15,23,42,.35);font-family:inherit;";
    const text = document.createElement("p");
    text.style.cssText = "margin:0 0 16px;font-size:15px;line-height:1.5;white-space:pre-line;";
    text.textContent = message;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";
    const mk = (label, primary) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "min-height:44px;padding:0 18px;border-radius:12px;font-size:14px;font-weight:600;border:0;cursor:pointer;" +
        (primary ? `background:${danger ? "#d92d20" : "#1d9bf0"};color:#fff;` : "background:rgb(var(--c-slate-border,226 232 240));color:rgb(var(--c-on-background,25 28 30));");
      return b;
    };
    const no = mk(cancelLabel, false);
    const yes = mk(confirmLabel, true);
    row.append(no, yes);
    box.append(text, row);
    wrap.append(box);
    document.body.append(wrap);

    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onPop);
      wrap.remove();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } };
    const onPop = () => finish(false);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", onPop);
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) finish(false); });
    no.focus();
  });
}
