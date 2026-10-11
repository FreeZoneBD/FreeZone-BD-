// FreeZone BD - emoji picker (a bottom sheet) that types into any text box.
// openEmojiPicker(inputEl)  -> puts the chosen emoji at the cursor and keeps the box's maxlength.
// Recently used emojis are remembered on this phone.

const GROUPS = [
  { key: "smile", icon: "😀", name: "Smileys", list: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 💀 👻 👽 🤖 💩" },
  { key: "hands", icon: "👍", name: "People", list: "👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 🦾 ✍️ 💅 🤳 🙋 🙆 🙅 🙇 🤦 🤷 💁 🧑‍💻 👨‍🍳 👩‍🎓 👶 👦 👧 👨 👩 🧓 👴 👵 🕌 🧕 👳 💃 🕺 🏃 🚶" },
  { key: "heart", icon: "❤️", name: "Hearts", list: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✨ 🌟 ⭐ 🔥 💥 💫 💦 💨 🎉 🎊 🎈 🎁 🏆 🥇 💯 ✅ ❌ ⚠️ ❓ ❗ 💬 💭 🔔 📌 🔒 🔑" },
  { key: "nature", icon: "🌸", name: "Nature", list: "🌸 🌹 🌺 🌻 🌼 🌷 🌱 🌿 🍀 🍃 🌴 🌳 🌾 🍂 🍁 🌍 🌙 ☀️ ⛅ ☁️ 🌧️ ⛈️ ⚡ ❄️ 🌈 🌊 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦅 🦉 🐢 🐍 🐠 🐟 🐬 🐳 🦋 🐝 🐞" },
  { key: "food", icon: "🍔", name: "Food", list: "🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🥔 🍞 🧀 🥚 🍳 🍗 🍖 🌭 🍔 🍟 🍕 🌮 🍜 🍝 🍛 🍣 🍤 🍚 🍦 🍩 🍪 🎂 🍰 🍫 🍬 ☕ 🍵 🥤 🧃 🍺 🍽️" },
  { key: "fun", icon: "⚽", name: "Activities", list: "⚽ 🏀 🏏 🏑 🎾 🏸 🎱 🏓 🥊 🎯 🎮 🕹️ 🎲 🎵 🎶 🎤 🎧 🎸 🎹 📷 🎬 📚 ✏️ 💻 📱 💡 🚗 🚌 🚆 ✈️ 🚀 🚲 🏠 🏫 🏥 🕋 🛍️ 💰 💎 🎓 ⏰ 📅" }
];
const RECENT_KEY = "fz_recent_emojis";
const split = (list) => list.split(" ");

const readRecent = () => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v.slice(0, 24) : []; } catch (e) { return []; }
};
const rememberRecent = (emoji) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, 24))); } catch (e) { /* storage unavailable */ }
};

/** Puts `text` at the cursor of the input / textarea. Returns false when the box is full. */
export function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  if (el.maxLength > 0 && next.length > el.maxLength) return false;
  el.value = next;
  const pos = start + text.length;
  try { el.setSelectionRange(pos, pos); } catch (e) { /* not supported */ }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

export function openEmojiPicker(inputEl, { onPick } = {}) {
  if (document.querySelector(".fz-emoji-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "fz-emoji-overlay fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/30";
  const recent = readRecent();
  const groups = recent.length ? [{ key: "recent", icon: "🕘", name: "Recent", list: recent.join(" ") }, ...GROUPS] : GROUPS;
  overlay.innerHTML = `
    <div class="w-full max-w-lg bg-slate-surface rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col" style="max-height:60vh" role="dialog" aria-modal="true" aria-label="Emoji">
      <div class="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-slate-border overflow-x-auto" style="scrollbar-width:none">
        ${groups.map((g, i) => `<button type="button" class="emo-tab flex-shrink-0 w-10 h-10 rounded-xl text-[22px] flex items-center justify-center ${i === 0 ? "bg-surface-container" : ""}" data-i="${i}" aria-label="${g.name}">${g.icon}</button>`).join("")}
        <button type="button" class="emo-close ml-auto flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-slate-muted hover:bg-surface-container" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
      </div>
      <div class="emo-grid overflow-y-auto p-2 grid" style="grid-template-columns:repeat(8,minmax(0,1fr))"></div>
    </div>`;
  const grid = overlay.querySelector(".emo-grid");
  const show = (index) => {
    overlay.querySelectorAll(".emo-tab").forEach((t, i) => t.classList.toggle("bg-surface-container", i === index));
    grid.innerHTML = split(groups[index].list).map((e) => `<button type="button" class="emo w-full aspect-square rounded-lg text-[24px] flex items-center justify-center active:bg-surface-container" data-e="${e}">${e}</button>`).join("");
    grid.scrollTop = 0;
  };
  show(0);
  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target === overlay) return close();
    const tab = event.target.closest(".emo-tab");
    if (tab) return show(Number(tab.dataset.i));
    if (event.target.closest(".emo-close")) return close();
    const btn = event.target.closest(".emo");
    if (!btn) return;
    const emoji = btn.dataset.e;
    if (insertAtCursor(inputEl, emoji)) {
      rememberRecent(emoji);
      onPick?.(emoji);
    } else {
      btn.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 160 }); // the box is full
    }
  });
  document.body.appendChild(overlay);
}
