// FreeZone BD - makes web addresses in posts, comments, messages and bios tappable.
// linkifyText(text, escapeHtml, { tags, own }) -> safe HTML: the text is escaped first, then https://... and www.... become links.
//   tags: also turn #hashtags into links (posts)
//   own:  the text sits on a coloured chat bubble: the link keeps the bubble's text colour (underlined)
// Only http and https addresses become links. In the Android app, native.js opens them in the phone's browser.
import { linkifyHashtags } from "./hashtags.js";

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// punctuation at the end belongs to the sentence, not to the address; a ")" is kept when the address opened a "(" itself
function trimUrl(url) {
  for (;;) {
    const c = url.slice(-1);
    if (/[.,;:!?'"\]}]/.test(c)) url = url.slice(0, -1);
    else if (c === ")" && url.split(")").length > url.split("(").length) url = url.slice(0, -1);
    else return url;
  }
}

export function linkifyText(text, escapeHtml, { tags = false, own = false } = {}) {
  const source = String(text ?? "");
  const plain = (part) => (tags ? linkifyHashtags(part, escapeHtml) : escapeHtml(part));
  const cls = own ? "fz-link underline break-all" : "fz-link text-primary underline underline-offset-2 break-all";
  let html = "";
  let last = 0;
  for (const match of source.matchAll(URL_RE)) {
    const url = trimUrl(match[0]);
    if (url.length < 5) continue;
    const href = /^www\./i.test(url) ? "https://" + url : url;
    let shown = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (shown.length > 48) shown = shown.slice(0, 45) + "…";
    html += plain(source.slice(last, match.index));
    html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow ugc" class="${cls}" data-fz-ext="1">${escapeHtml(shown)}</a>`;
    last = match.index + url.length;
  }
  return html + plain(source.slice(last));
}
