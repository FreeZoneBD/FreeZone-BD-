// FreeZone BD - chat search helpers.
//  matchChat(item, text)      does an inbox row match (name, @username, last message)?
//  findMessages(messages, text) ids of the messages that contain every word (oldest first)
//  highlightIn(el, text)      wraps the found words of a message bubble in <mark>
//  createMessageSearchBar()   the bar inside a conversation: input, "2 of 5", up / down, close

const words = (text) => String(text || "").toLowerCase().split(/\s+/).filter(Boolean);

export function matchChat(item, text) {
  const w = words(text);
  if (!w.length) return true;
  const user = item.user || {};
  const hay = [user.name, user.username, item.lastMessage].filter(Boolean).join(" \n ").toLowerCase();
  return w.every((word) => hay.includes(word.replace(/^@/, "")));
}

export function findMessages(messages, text) {
  const w = words(text);
  if (!w.length) return [];
  return messages
    .filter((m) => m && !m.deleted && !m.reaction && typeof m.text === "string" && m.text)
    .filter((m) => { const t = m.text.toLowerCase(); return w.every((word) => t.includes(word)); })
    .map((m) => m.id);
}

export function highlightIn(el, text) {
  const w = words(text).sort((a, b) => b.length - a.length);
  if (!el || !w.length) return;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${w.map(escape).join("|")})`, "gi");
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (node.parentElement && node.parentElement.closest("mark.fz-hit,button")) return;
    const value = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(value)) return;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(value))) {
      if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "fz-hit";
      mark.style.cssText = "background:#fde047;color:#111827;border-radius:3px;padding:0 1px";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
}

export function clearHighlights(el) {
  if (!el) return;
  el.querySelectorAll("mark.fz-hit").forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent));
    parent.normalize();
  });
}

// handlers: onInput(text), onStep(+1 | -1)  (-1 = older match, +1 = newer), onEarlier(), onClose()
export function createMessageSearchBar({ onInput, onStep, onEarlier, onClose }) {
  const el = document.createElement("div");
  el.className = "fz-msearch sticky z-10 bg-background/95 backdrop-blur border-b border-slate-border/60 px-3 py-2 flex items-center gap-2";
  el.innerHTML = `
    <input class="fz-ms-input flex-1 min-w-0 bg-slate-surface border border-slate-border focus:border-primary-container rounded-full px-4 py-2 text-[16px] outline-none" type="search" maxlength="60" placeholder="Search in this chat" autocomplete="off" />
    <span class="fz-ms-count text-[12.5px] text-slate-muted whitespace-nowrap"></span>
    <button type="button" class="fz-ms-earlier hidden px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-[12px] font-semibold whitespace-nowrap">Search earlier</button>
    <button type="button" class="fz-ms-up w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container disabled:opacity-30" aria-label="Older match"><span class="material-symbols-outlined text-[22px] pointer-events-none">keyboard_arrow_up</span></button>
    <button type="button" class="fz-ms-down w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container disabled:opacity-30" aria-label="Newer match"><span class="material-symbols-outlined text-[22px] pointer-events-none">keyboard_arrow_down</span></button>
    <button type="button" class="fz-ms-close w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container" aria-label="Close search"><span class="material-symbols-outlined text-[22px] pointer-events-none">close</span></button>`;
  const input = el.querySelector(".fz-ms-input");
  const countEl = el.querySelector(".fz-ms-count");
  const earlier = el.querySelector(".fz-ms-earlier");
  const up = el.querySelector(".fz-ms-up");
  const down = el.querySelector(".fz-ms-down");
  let timer = null;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => onInput(input.value.trim()), 200); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onStep(e.shiftKey ? 1 : -1); }
    if (e.key === "Escape") onClose();
  });
  up.addEventListener("click", () => onStep(-1));
  down.addEventListener("click", () => onStep(1));
  earlier.addEventListener("click", () => onEarlier());
  el.querySelector(".fz-ms-close").addEventListener("click", () => onClose());
  return {
    el,
    focus: () => input.focus(),
    get text() { return input.value.trim(); },
    /** index = 0-based position of the selected match (or -1), total = matches, canSearchEarlier = older messages exist */
    setState({ index, total, canSearchEarlier, typed }) {
      countEl.textContent = !typed ? "" : total ? `${index + 1} of ${total}` : "No matches";
      up.disabled = !total || index <= 0;
      down.disabled = !total || index >= total - 1;
      earlier.classList.toggle("hidden", !(typed && canSearchEarlier));
    },
    destroy() { clearTimeout(timer); el.remove(); }
  };
}
