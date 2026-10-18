// FreeZone BD - language switch (English is the default; Bengali can be chosen in Settings > Language).
// A plain script loaded first on every page. In English it does nothing more than this.
// In Bengali it loads i18n-bn.js (the words) and i18n-run.js (changes the texts on the screen).
(function () {
  var KEY = "fz-lang";
  var lang = "en";
  try { if (localStorage.getItem(KEY) === "bn") lang = "bn"; } catch (e) { /* no storage: English */ }
  window.FZI18N = {
    lang: lang,
    set: function (value) { try { localStorage.setItem(KEY, value === "bn" ? "bn" : "en"); } catch (e) { /* ignore */ } },
    t: function (text) { return text; }
  };
  if (lang !== "bn") return;
  document.documentElement.lang = "bn";
  document.documentElement.classList.add("fz-bn");
  document.write('<script src="./i18n-bn.js"><\/script><script src="./i18n-run.js"><\/script>');
})();
