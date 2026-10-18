// FreeZone BD - the Android app (Capacitor) support. A plain script, loaded first in feed.html and login.html.
// In a normal browser this file does nothing at all. Inside the Android app it:
//   1. marks the page   <html class="fz-native">   (other code and CSS can use it)
//   2. makes room for the status bar and the gesture bar (the app is edge-to-edge on Android 15 / 16)
//   3. hides the Boost button for now (paid promotion needs Google Play Billing in the store version)
//   4. makes the Android Back button close sheets, pages and posts like the arrow does, and exits on a double press
//   5. opens website links (feed.html?post=...) inside the app (Android app links)
//   7. Terms / Privacy / Guidelines opened from Settings open in this window, and Back returns to Settings
//   6. shows a "new version available" box (update-check.js, values from Firebase appConfig)
(function () {
  var cap = window.Capacitor;
  var native = !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  if (!native) return;

  var root = document.documentElement;
  root.classList.add("fz-native");

  // let the page draw under the system bars, then pad it ourselves
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta && !/viewport-fit/.test(meta.content)) meta.content += ", viewport-fit=cover";

  var css = document.createElement("style");
  css.textContent = [
    // Capacitor's SystemBars (insetsHandling: css) gives --safe-area-inset-*, the browser gives env(); use the larger one
    "html.fz-native{--fz-top:max(env(safe-area-inset-top,0px),var(--safe-area-inset-top,0px));--fz-bottom:max(env(safe-area-inset-bottom,0px),var(--safe-area-inset-bottom,0px));}",
    "html.fz-native .fz-topbar{padding-top:var(--fz-top);}",
    "html.fz-native #pageView>header,html.fz-native #postDetail>header{padding-top:var(--fz-top);height:calc(3.5rem + var(--fz-top));}",
    "html.fz-native .fz-bottomnav{height:calc(52px + var(--fz-bottom));padding-bottom:var(--fz-bottom);}",
    "html.fz-native .fz-fab{bottom:calc(52px + var(--fz-bottom) + 16px) !important;}",
    "html.fz-native .step{padding-top:var(--fz-top);}",
    // pages that draw their own header (profile, search, chat inbox, conversation) also stay below the status bar
    "html.fz-native .pf-top{padding-top:var(--fz-top);height:calc(2.75rem + var(--fz-top));}",
    "html.fz-native .fz-inbox-head,html.fz-native .fz-convhead{padding-top:var(--fz-top);height:calc(3.5rem + var(--fz-top));}",
    "html.fz-native .fz-s-top{padding-top:var(--fz-top);}",
    // Boost (paid) is not offered in the Android version until Google Play Billing is added
    "html.fz-native .boost-btn{display:none !important;}",
    // no grey flash when tapping, no text selection on buttons
    "html.fz-native{-webkit-tap-highlight-color:transparent;}",
    "html.fz-native button{-webkit-user-select:none;user-select:none;}"
  ].join("\n");
  document.head.appendChild(css);

  /* ------------------------------------------------------------
     Android Back button
  ------------------------------------------------------------ */
  var CLOSE = '[aria-label="Back"],[aria-label="Close"],[aria-label="close"],[data-close],[class*="-close"],[class*="close-"]';

  // a sheet / dialog / viewer that was added to the page on top of everything
  function closeTopOverlay() {
    var kids = Array.prototype.slice.call(document.body.children).reverse();
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.id === "pageView" || el.id === "postDetail" || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "NAV" || el.tagName === "HEADER" || el.tagName === "MAIN") continue;
      var s = getComputedStyle(el);
      if (s.position !== "fixed" || s.display === "none" || el.hidden) continue;
      var btn = el.querySelector(CLOSE);
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  var lastBack = 0;
  function toast(text) {
    var t = document.createElement("div");
    t.textContent = text;
    t.style.cssText = "position:fixed;left:50%;bottom:calc(90px + var(--fz-bottom,0px));transform:translateX(-50%);background:rgba(20,20,24,.92);color:#fff;padding:9px 16px;border-radius:99px;font:14px/1.3 system-ui,sans-serif;z-index:99999;max-width:80%;text-align:center;";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  function onBack() {
    // 1. sheets and dialogs
    if (closeTopOverlay()) return;
    // 2. an open post, then an open page (profile, chat, settings, search ...)
    var post = document.getElementById("postDetail");
    if (post && !post.hidden) { var pb = post.querySelector("header button"); if (pb) { pb.click(); return; } }
    var page = document.getElementById("pageView");
    if (page && !page.hidden) { var back = document.getElementById("pageViewBack"); if (back) { back.click(); return; } }
    // 3. login screens: go one step back, the page keeps its own history
    if (/login\.html$/i.test(location.pathname) && history.state && history.state.n > 0) { history.back(); return; }
    // 4. the feed: first scroll to the top, then a double press leaves the app
    if (window.scrollY > 200) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    var now = Date.now();
    if (now - lastBack < 2000) {
      var app = cap.Plugins && cap.Plugins.App;
      if (app && app.exitApp) app.exitApp();
      return;
    }
    lastBack = now;
    toast("Press back again to exit");
  }

  var App = cap.Plugins && cap.Plugins.App;
  if (App && App.addListener) App.addListener("backButton", onBack);
  window.__fzNativeBack = onBack; // for tests

  // 5. app links: a link of the website (feed.html?post=ID, ?u=name, ?profile=uid) that is tapped in WhatsApp, a browser ... opens HERE.
  //    The page is loaded again with the same parameters; feed.js then opens the post or the profile (and sends a person who is
  //    not logged in to login.html first, which brings them back).
  var LINK_KEYS = ["post", "profile", "u", "chat"];
  function openLink(url) {
    try {
      var u = new URL(url);
      if (u.protocol !== "https:") return;
      var keep = new URLSearchParams();
      LINK_KEYS.forEach(function (k) { var v = u.searchParams.get(k); if (v && v.length <= 200) keep.set(k, v); });
      if (![...keep.keys()].length) return; // a plain link to the site: the app is already open
      // the same link twice within 5 seconds (the launch link AND the "opened" event) is handled once
      var last = null;
      try { last = JSON.parse(sessionStorage.getItem("fzLink") || "null"); } catch (e) { last = null; }
      if (last && last.url === u.href && Date.now() - last.at < 5000) return;
      try { sessionStorage.setItem("fzLink", JSON.stringify({ url: u.href, at: Date.now() })); } catch (e) { /* ignore */ }
      location.replace("feed.html?" + keep.toString());
    } catch (e) { /* not a link we understand: ignore */ }
  }
  window.__fzOpenLink = openLink; // for tests
  if (App && App.addListener) App.addListener("appUrlOpen", function (event) { if (event && event.url) openLink(event.url); });
  if (App && App.getLaunchUrl) App.getLaunchUrl().then(function (r) { if (r && r.url) openLink(r.url); }).catch(function () { /* none */ });
  // 7. Terms / Privacy / Guidelines (opened from Settings or Help): the app has no browser tabs, so the page replaces the app screen.
  //    Remember "Settings" as the place to come back to; the Back button of that page (and the phone's Back) then returns there.
  var LEGAL = /(^|\/)(terms|privacy|guidelines|delete-account)\.html$/i;
  function openLegal(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin || !LEGAL.test(u.pathname)) return false;
      if (!/(^|\/)feed\.html$/i.test(location.pathname)) return false; // from the login screen the normal behaviour is fine
      try { history.replaceState(null, "", "feed.html?open=settings"); } catch (e) { /* ignore */ }
      location.href = u.href;
      return true;
    } catch (e) { return false; }
  }
  window.__fzOpenLegal = openLegal; // for tests
  var plainOpen = window.open;
  window.open = function (url) { if (url && openLegal(String(url))) return null; return plainOpen.apply(window, arguments); };
  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (a && openLegal(a.href)) event.preventDefault();
  }, true);

  // 6. update message
  try { import("./update-check.js").catch(function () { /* ignore */ }); } catch (e) { /* ignore */ }
})();
