// FreeZone BD - app information in ONE place.
// Used by: settings.js, about.js, feedback.js, help.js and the pages terms.html / privacy.html / guidelines.html.
// Change a value here and it changes everywhere.

export const APP_NAME = "FreeZone BD";
export const APP_TAGLINE = "Connect. Share. Chat.";
export const APP_VERSION = "1.0.0";

// The public address of the WEBSITE, with a slash at the end. Used (1) for the links people share from the app (inside the app the page
// address is only "localhost"), and (2) so the Android app can open those links itself ("app links").
// The site is read from this line by scripts/patch-android.mjs: change it only here.
export const SITE_URL = "https://freezonebd.github.io/FreeZone-BD-/";
const insideApp = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !/^https?:$/.test(location.protocol);
/**
 * The phone's own share sheet inside the Android app (Capacitor Share plugin: WhatsApp, Messenger, Telegram, SMS ... whatever is installed).
 * Resolves "done", "cancelled" or "unavailable" (not the app, or the plugin does not work): then the caller uses its own way.
 */
export async function nativeShare({ title = "", text = "", url = "", dialogTitle = "Share" } = {}) {
  try {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return "unavailable";
    const Share = cap.Plugins && cap.Plugins.Share;
    if (!Share || typeof Share.share !== "function") return "unavailable";
    const started = Date.now();
    try {
      await Share.share({ title, text, url, dialogTitle });
      return "done";
    } catch (error) {
      // a refusal that comes AFTER the sheet was shown (or says "cancel") is the person closing it; an instant one means the plugin failed
      const said = String((error && (error.message || error.errorMessage)) || error);
      return /cancel/i.test(said) || Date.now() - started > 1000 ? "cancelled" : "unavailable";
    }
  } catch (error) {
    return "unavailable";
  }
}

/**
 * Saves a photo or a video to the phone's gallery inside the Android app (our own native plugin FzMedia: Pictures/FreeZone BD, Movies/FreeZone BD).
 * Resolves { status: "done" | "unavailable" | "unsupported" | "failed", error? }
 *   unavailable = not the app (a browser) or no plugin: the caller uses its web way;  unsupported = an Android older than 10.
 */
export async function nativeSaveMedia({ url, kind = "image" } = {}) {
  try {
    const cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return { status: "unavailable" };
    const Media = (cap.Plugins && cap.Plugins.FzMedia) || (typeof cap.registerPlugin === "function" ? cap.registerPlugin("FzMedia") : null);
    if (!Media || typeof Media.saveToGallery !== "function") return { status: "unavailable" };
    try {
      await Media.saveToGallery({ url, kind });
      return { status: "done" };
    } catch (error) {
      const said = String((error && (error.message || error.errorMessage)) || error);
      if (/unsupported/i.test(said)) return { status: "unsupported" };
      if (/not implemented|not available|not found/i.test(said) && /plugin|FzMedia/i.test(said)) return { status: "unavailable" };
      return { status: "failed", error: said.slice(0, 120) };
    }
  } catch (error) {
    return { status: "unavailable" };
  }
}

/**
 * Saves a video: into the gallery inside the app; in a browser it starts a normal download (Cloudinary links get "fl_attachment",
 * which makes the server send the file as a download). notify(text) shows a message. Resolves true when the save was started.
 */
export async function saveVideo(url, notify = () => {}) {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) { notify("Could not save this video"); return false; }
  notify("Saving video...");
  const r = await nativeSaveMedia({ url, kind: "video" });
  if (r.status === "done") { notify("Video saved to your gallery"); return true; }
  if (r.status === "failed") { notify("Could not save the video: " + r.error); return false; }
  if (r.status === "unsupported") { notify("Saving needs Android 10 or newer on this phone"); return false; }
  try {
    const link = url.replace("/video/upload/", "/video/upload/fl_attachment/");
    const a = document.createElement("a");
    a.href = link;
    a.download = `freezone-${Date.now()}.mp4`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    notify("Download started");
    return true;
  } catch (error) {
    notify("Could not save the video");
    return false;
  }
}

/** The start of a link to share: the real website inside the app, the page you are on in a browser. */
export function shareBase(page = "feed.html") {
  if (SITE_URL && insideApp()) return new URL(page, SITE_URL);
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  return url;
}

// The address of your push-notification Worker (Cloudflare). Leave "" until the Worker is set up: then push is simply off.
// Looks like "https://freezone-push.YOURNAME.workers.dev"
export const PUSH_WORKER_URL = "https://freezone-push.abdulrohimrire.workers.dev";
export const LEGAL_UPDATED = "October 15, 2026";
export const LEGAL_UPDATED_BN = "১৫ অক্টোবর ২০২৬";

// The minimum age to use FreeZone BD (shown in the Terms and the Privacy Policy). Under 18 means a child under the Personal Data Protection Ordinance 2025.
export const MIN_AGE = 18;

// WHO runs the app. These three lines are printed in the Terms, Privacy Policy and Guidelines. Fill them in before release.
export const OPERATOR_NAME = "Abdul Rohim"; // your full name (or the company name, if you register one later)
export const OPERATOR_ADDRESS = "বরিশাল সদর, বরিশাল, বাংলাদেশ (Barishal Sadar, Barishal, Bangladesh)"; // your postal address in Bangladesh (leave "" to hide the line)

// Put your real support email here (for example "support@yourdomain.com").
// While it is empty, the app shows "Settings > Report a problem" as the way to reach you instead.
export const SUPPORT_EMAIL = "abdulrohimrire@gmail.com";

// The link people receive when they are invited
export function getInviteLink() {
  return (SITE_URL && insideApp() ? new URL("login.html", SITE_URL) : new URL("login.html", location.href)).href;
}
