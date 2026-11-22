// FreeZone BD - Google Analytics (website only).
// Measurement ID: change it here and nowhere else.
// It does NOT run inside the Android app, on localhost, or when the browser says "Do Not Track".
// No user id, name, e-mail or post text is ever sent: only the page address and the usual anonymous visit data.
(function () {
  var ID = "G-8R17HS56HV";
  try {
    var cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return;
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === "file:") return;
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", ID);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
    document.head.appendChild(s);
  } catch (e) { /* analytics must never break the app */ }
})();
