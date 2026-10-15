// FreeZone BD - app information in ONE place.
// Used by: settings.js, about.js, feedback.js, help.js and the pages terms.html / privacy.html / guidelines.html.
// Change a value here and it changes everywhere.

export const APP_NAME = "FreeZone BD";
export const APP_TAGLINE = "Connect. Share. Chat.";
export const APP_VERSION = "1.0.0";

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
  return new URL("login.html", location.href).href;
}
