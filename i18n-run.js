// FreeZone BD - shows the Bengali texts. Runs only when the language is Bengali (see i18n.js).
// Every text of the app is written in English in the code. This file looks at the screen, and when a text (or a
// placeholder / title / aria-label) is one we have a Bengali version of, it swaps it. It also watches the page, so texts
// that appear later (toasts, sheets, lists) are changed too. Texts written by people (posts, comments, chat, bios)
// are never touched.
(function () {
  var B = window.FZ_BN;
  if (!B) return;
  var D = B.d, PRE = B.pre, PAT = B.pat;
  var DIG = "০১২৩৪৫৬৭৮৯";
  function digits(s) { return String(s).replace(/\d/g, function (d) { return DIG.charAt(d); }); }
  var own = Object.prototype.hasOwnProperty;

  // one trimmed text -> Bengali, or null
  function conv(s) {
    if (own.call(D, s)) return D[s];
    for (var i = 0; i < PAT.length; i++) {
      var m = s.match(PAT[i][0]);
      if (!m) continue;
      var t = PAT[i][1];
      if (typeof t === "function") return t(m);
      return t.replace(/\{(t?)(\d)\}/g, function (all, tr, n) {
        var v = m[Number(n)];
        if (v === undefined) return "";
        if (tr) { var c = conv(v); return c == null ? v : c; }
        return /^\d+$/.test(v) ? digits(v) : v;
      });
    }
    for (var j = 0; j < PRE.length; j++) {
      var k = PRE[j];
      if (s.indexOf(k) === 0) return D[k] + s.slice(k.length);
    }
    return null;
  }

  // a text with its spaces around -> Bengali, or null when nothing changes
  function tr(text) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m || !m[2]) return null;
    var out = conv(m[2]);
    if (out == null || out === m[2]) return null;
    return m[1] + out + m[3];
  }
  window.FZI18N.t = function (text) { var r = tr(String(text)); return r == null ? text : r; };

  var HARD = ".material-symbols-outlined,script,style,textarea,pre,code,[data-notr],[contenteditable]";
  var USER = ".whitespace-pre-wrap,.post-text,.fz-bubble,.iv-text,.fz-rl-text,.cm-item p,.fz-n-quote";
  function skip(el) {
    if (el.nodeType !== 1) return false;
    try { return !!(el.closest(HARD) || el.matches(USER)); } catch (e) { return false; }
  }

  function text(node) {
    var p = node.parentNode;
    if (!p || skip(p)) return;
    var out = tr(node.data);
    if (out != null) node.data = out;
  }
  var ATTRS = ["placeholder", "title", "aria-label"];
  function attrs(el) {
    if (skip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute && el.getAttribute(ATTRS[i]);
      if (!v) continue;
      var out = tr(v);
      if (out != null) el.setAttribute(ATTRS[i], out);
    }
  }
  function walk(node) {
    if (node.nodeType === 3) { text(node); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    attrs(node);
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
  }

  var obs = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === "childList") { for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]); }
      else if (r.type === "characterData") text(r.target);
      else if (r.type === "attributes") attrs(r.target);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  function first() { walk(document.documentElement); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", first); else first();

  // alert / confirm / prompt of the browser
  function many(msg) { return String(msg).split("\n").map(function (line) { var r = tr(line); return r == null ? line : r; }).join("\n"); }
  ["alert", "confirm", "prompt"].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function (message) { arguments[0] = many(message); return orig.apply(window, arguments); };
  });
})();
