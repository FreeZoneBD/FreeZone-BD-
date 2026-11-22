// FreeZone BD - Login / Sign up (page by page) / Forgot password
import { auth, db } from "./config.js";
import { initTheme } from "./theme.js";
initTheme();
// the login page is dark-first: with no saved choice it stays dark (a saved light/dark choice is respected)
try { if (!localStorage.getItem("fz-theme")) document.documentElement.classList.add("dark"); } catch (e) {}

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import { ref, get, set, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

/* ---------------------------------------------------------------
   Settings
---------------------------------------------------------------- */
const DEFAULT_PAGE = "./feed.html";
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED = ["admin", "administrator", "support", "help", "freezone", "freezonebd", "official", "moderator", "root", "system", "staff", "team", "null", "undefined"];
const SIGNUP_STEPS = ["name", "username", "email", "password", "terms"];
const GOOGLE_STEPS = ["name", "username", "terms"]; // a Google account already has an email, so no email / password pages

/* ---------------------------------------------------------------
   Messages (Bangla first, English below)
---------------------------------------------------------------- */
const MESSAGES = {
  "auth/invalid-credential": ["ইমেইল বা পাসওয়ার্ড ভুল হয়েছে।", "Incorrect email or password."],
  "auth/wrong-password": ["পাসওয়ার্ড ভুল হয়েছে।", "Incorrect password."],
  "auth/user-not-found": ["এই ইমেইলে কোনো অ্যাকাউন্ট নেই।", "No account found with this email."],
  "auth/invalid-email": ["ইমেইল ঠিকানাটি সঠিক নয়।", "Please enter a valid email address."],
  "auth/missing-password": ["পাসওয়ার্ড লিখুন।", "Please enter your password."],
  "auth/too-many-requests": ["অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", "Too many attempts. Please try again later."],
  "auth/network-request-failed": ["ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না।", "Please check your internet connection."],
  "auth/user-disabled": ["এই অ্যাকাউন্টটি বন্ধ করে দেওয়া হয়েছে।", "This account has been disabled."],
  "auth/email-already-in-use": ["এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে। লগইন করুন।", "This email is already registered. Try logging in."],
  "auth/weak-password": ["পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে।", "Password must be at least 6 characters."],
  "auth/operation-not-allowed": ["ইমেইল দিয়ে লগইন চালু করা নেই।", "Email/password sign-in is not enabled in Firebase."],
  "auth/requires-recent-login": ["আবার লগইন করে চেষ্টা করুন।", "Please log in again and retry."],
  "auth/account-exists-with-different-credential": ["এই ইমেইল দিয়ে আগে অন্যভাবে অ্যাকাউন্ট খোলা হয়েছে। ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন।", "An account with this email already exists. Log in with your email and password."],
  "auth/popup-blocked": ["পপআপ বন্ধ করা আছে। অনুমতি দিয়ে আবার চেষ্টা করুন।", "The sign-in window was blocked. Allow pop-ups and try again."]
};

const CUSTOM = {
  "need-email": ["ইমেইল লিখুন।", "Please enter your email."],
  "need-password": ["পাসওয়ার্ড লিখুন।", "Please enter your password."],
  "need-name": ["নাম কমপক্ষে ২ অক্ষরের হতে হবে।", "Name must be at least 2 characters."],
  "bad-username": ["ইউজারনেম ৩–২০ অক্ষরের হতে হবে। শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা, _ এবং . চলবে।", "Username must be 3–20 characters: small letters, numbers, _ and . only."],
  "username-taken": ["এই ইউজারনেম আগে থেকেই আছে। অন্যটি বেছে নিন।", "This username is already taken. Pick another one."],
  "username-reserved": ["এই ইউজারনেম ব্যবহার করা যাবে না।", "This username is reserved. Pick another one."],
  "username-check-failed": ["ইউজারনেম যাচাই করা যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।", "Could not check the username. Check your connection and try again."],
  "need-terms": ["চালিয়ে যেতে শর্তাবলী ও গোপনীয়তা নীতিতে সম্মতি দিন।", "Please accept the Terms and Privacy Policy to continue."],
  "google-failed": ["Google দিয়ে লগইন করা যায়নি। আবার চেষ্টা করুন।", "Google sign-in did not work. Please try again."],
  "profile-failed": ["প্রোফাইল তৈরি করা যায়নি। আবার চেষ্টা করুন।", "Could not create your profile. Please try again."],
  "reset-sent": ["পাসওয়ার্ড রিসেটের লিংক পাঠানো হয়েছে। ইনবক্স (এবং স্প্যাম) দেখুন।", "If an account exists for this email, a reset link has been sent."],
  "unknown": ["কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।", "Something went wrong. Please try again."]
};

/* ---------------------------------------------------------------
   Elements
---------------------------------------------------------------- */
const $ = (selector) => document.querySelector(selector);
const bootEl = $("#boot");
const pageEl = $("#page");
const steps = {};
document.querySelectorAll("[data-step]").forEach((el) => { steps[el.dataset.step] = el; });

// "Add account" mode (?add=1): someone is already signed in and wants to log into / create another account.
// The current account stays signed in until the new login works, so cancelling changes nothing.
const addMode = new URLSearchParams(window.location.search).get("add") === "1";
const addBar = $("#addBar");
const addCancel = $("#addCancel");
if (addMode) {
  if (addBar) addBar.hidden = false;
  if (addCancel) addCancel.addEventListener("click", () => window.location.replace(getNextUrl()));
}

const loginEmail = $("#loginEmail");
const loginPassword = $("#loginPassword");
const rememberMe = $("#rememberMe");
const loginBtn = $("#loginBtn");
const resetEmail = $("#resetEmail");
const resetBtn = $("#resetBtn");
const signupName = $("#signupName");
const signupUsername = $("#signupUsername");
const signupEmail = $("#signupEmail");
const signupPassword = $("#signupPassword");
const agreeTerms = $("#agreeTerms");
const signupBtn = $("#signupBtn");
const usernameHint = $("#usernameHint");
const unNext = $("#unNext");

const firstInput = { login: loginEmail, reset: resetEmail, name: signupName, username: signupUsername, email: signupEmail, password: signupPassword, terms: null };

/* ---------------------------------------------------------------
   Redirect helpers
---------------------------------------------------------------- */
// Where to go after login. Supports ?next=feed.html?post=ID (same site only).
function getNextUrl() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return DEFAULT_PAGE;
  try {
    const url = new URL(next, window.location.href);
    const sameSite = url.origin === window.location.origin;
    const isLoginPage = /login\.html$/i.test(url.pathname);
    if (!sameSite || isLoginPage) return DEFAULT_PAGE;
    return url.pathname + url.search + url.hash;
  } catch (error) {
    return DEFAULT_PAGE;
  }
}
const goNext = () => window.location.replace(getNextUrl());

/* ---------------------------------------------------------------
   UI helpers
---------------------------------------------------------------- */
let current = "login";

function showMsg(step, key, kind = "error") {
  const box = steps[step]?.querySelector(".msg");
  if (!box) return;
  const pair = MESSAGES[key] || CUSTOM[key] || CUSTOM.unknown;
  box.className = "msg mt-3 rounded-xl px-3.5 py-2.5 text-[14px] " + (kind === "success" ? "bg-emerald-50 text-emerald-800" : "bg-error-container text-on-error-container");
  box.querySelector(".bn").textContent = pair[0];
  box.querySelector(".en").textContent = pair[1];
  box.hidden = false;
}
function clearMsg(step = current) {
  const form = steps[step];
  if (!form) return;
  const box = form.querySelector(".msg");
  if (box) box.hidden = true;
  form.querySelectorAll(".field[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}
function fail(step, input, key) {
  showMsg(step, key);
  if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
  return false;
}
function setLoading(button, loading, label) {
  button.disabled = loading;
  button.innerHTML = loading ? `<span class="spinner"></span><span>${label}</span>` : label;
}
const friendlyKey = (error) => (MESSAGES[error?.code] ? error.code : "unknown");

// the page you see: one full screen at a time
let navCount = 0;
function showStep(name, { dir = "fwd", focus = true } = {}) {
  if (!steps[name]) name = "login";
  Object.entries(steps).forEach(([key, el]) => { el.hidden = key !== name; });
  const el = steps[name];
  el.classList.remove("step-in-fwd", "step-in-back");
  void el.offsetWidth;
  el.classList.add(dir === "back" ? "step-in-back" : "step-in-fwd");
  current = name;
  window.scrollTo(0, 0);
  if (name === "terms") fillSummary();
  if (name === "username") onEnterUsername();
  if (focus && firstInput[name]) setTimeout(() => firstInput[name].focus(), 60);
}
function goStep(name) {
  navCount++;
  history.pushState({ step: name, n: navCount }, "");
  showStep(name, { dir: "fwd" });
}
function goBack(fallback) {
  if (history.state && history.state.n > 0) history.back();
  else { history.replaceState({ step: fallback, n: 0 }, ""); navCount = 0; showStep(fallback, { dir: "back" }); }
}
window.addEventListener("popstate", (event) => {
  const st = event.state;
  if (googleUser && (!st || st.step === "login")) { cancelGoogle(); return; } // Back from the Google profile pages: sign out again
  if (!st) { showStep("login", { dir: "back", focus: false }); return; }
  const dir = (st.n || 0) < navCount ? "back" : "fwd";
  navCount = st.n || 0;
  showStep(st.step, { dir });
});

document.querySelectorAll("[data-back]").forEach((btn) => btn.addEventListener("click", () => {
  if (googleUser) {
    // Google sign-up: the first page goes back to login (and signs out again), the last page goes back to the username
    if (current === "name") return cancelGoogle();
    if (current === "terms") return goBack("username");
  }
  goBack(btn.dataset.back);
}));
document.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => goStep(btn.dataset.go)));
$("#forgotBtn").addEventListener("click", () => { resetEmail.value = loginEmail.value.trim(); goStep("reset"); });

// show / hide password
document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    button.querySelector(".material-symbols-outlined").textContent = show ? "visibility_off" : "visibility";
  });
});

// clear the red border as soon as the user edits a field
document.addEventListener("input", (event) => {
  if (event.target.matches(".field")) { event.target.removeAttribute("aria-invalid"); clearMsg(current); }
});

/* ---------------------------------------------------------------
   LOGIN
---------------------------------------------------------------- */
steps.login.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMsg("login");
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email) return fail("login", loginEmail, "need-email");
  if (!EMAIL_RE.test(email)) return fail("login", loginEmail, "auth/invalid-email");
  if (!password) return fail("login", loginPassword, "need-password");

  setLoading(loginBtn, true, "Logging in...");
  try {
    await setPersistence(auth, rememberMe.checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
    goNext();
  } catch (error) {
    console.error(error);
    showMsg("login", friendlyKey(error));
    setLoading(loginBtn, false, "Login");
  }
});

/* ---------------------------------------------------------------
   FORGOT PASSWORD
---------------------------------------------------------------- */
steps.reset.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMsg("reset");
  const email = resetEmail.value.trim();
  if (!email) return fail("reset", resetEmail, "need-email");
  if (!EMAIL_RE.test(email)) return fail("reset", resetEmail, "auth/invalid-email");

  setLoading(resetBtn, true, "Sending...");
  try {
    await sendPasswordResetEmail(auth, email);
    showMsg("reset", "reset-sent", "success");
  } catch (error) {
    console.error(error);
    // For privacy we do not reveal whether the email exists
    if (error.code === "auth/user-not-found") showMsg("reset", "reset-sent", "success");
    else showMsg("reset", friendlyKey(error));
  }
  setLoading(resetBtn, false, "Send reset link");
});

/* ---------------------------------------------------------------
   USERNAME: one registry node per name (usernames/{name} = uid)
   so two people can never own the same name, even at the same moment.
---------------------------------------------------------------- */
const availCache = new Map(); // name -> true (free) / false (taken)

// true = free, false = taken, throws when it could not be checked
async function isFree(name) {
  if (availCache.has(name)) return availCache.get(name);
  const snap = await get(ref(db, `usernames/${name}`));
  const free = !snap.exists();
  availCache.set(name, free);
  return free;
}

function validateUsername(name) {
  if (!USERNAME_RE.test(name) || /^\.|\.$|\.\./.test(name)) return "bad-username";
  if (RESERVED.includes(name)) return "username-reserved";
  return null;
}

let unState = "idle"; // idle | checking | free | taken | bad | unknown
let unRun = 0;
let unTimer = null;

function setUnState(state, text, tone) {
  unState = state;
  const tones = { neutral: "text-slate-subtle", good: "text-online-emerald", bad: "text-error" };
  usernameHint.textContent = text;
  usernameHint.className = `text-[13.5px] mt-2 min-h-[20px] ${tones[tone]}`;
  const icon = {
    checking: `<span class="spinner dark"></span>`,
    free: `<span class="material-symbols-outlined text-online-emerald" style="font-variation-settings:'FILL' 1;">check_circle</span>`,
    taken: `<span class="material-symbols-outlined text-error" style="font-variation-settings:'FILL' 1;">cancel</span>`,
    bad: `<span class="material-symbols-outlined text-error" style="font-variation-settings:'FILL' 1;">cancel</span>`
  }[state] || "";
  $("#unState").innerHTML = icon;
  unNext.disabled = state === "checking" || state === "taken" || state === "bad" || !signupUsername.value;
}

function normalizeUsername(value) {
  return value.replace(/^@/, "").toLowerCase().replace(/\s/g, "");
}

async function checkUsername() {
  const value = signupUsername.value;
  const run = ++unRun;
  clearTimeout(unTimer);
  if (!value) { setUnState("idle", "3-20 characters: small letters, numbers, _ and .", "neutral"); hideSuggest(); return; }
  const problem = validateUsername(value);
  if (problem) {
    setUnState("bad", problem === "username-reserved" ? "This username is reserved" : "Use 3-20 small letters, numbers, _ or . (no dot at the start or end)", "bad");
    hideSuggest();
    return;
  }
  setUnState("checking", "Checking...", "neutral");
  unTimer = setTimeout(async () => {
    try {
      const free = await isFree(value);
      if (run !== unRun) return;
      if (free) { setUnState("free", `@${value} is available`, "good"); hideSuggest(); }
      else { setUnState("taken", `@${value} is already taken`, "bad"); showSuggestions(value); }
    } catch (error) {
      console.warn("Username check failed:", error);
      if (run === unRun) setUnState("unknown", "Could not check right now. It is checked again when you create the account.", "neutral");
    }
  }, 350);
}

signupUsername.addEventListener("input", () => {
  signupUsername.value = normalizeUsername(signupUsername.value);
  checkUsername();
});

/* suggestions: only names that are really free */
const hideSuggest = () => { $("#unSuggest").hidden = true; };
let suggestRun = 0;

function latinBase(text) {
  const words = String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return { words, joined: words.join("").slice(0, 14) };
}
function candidatesFor(seed) {
  const { words, joined } = latinBase(seed);
  const base = joined.length >= 3 ? joined : "user";
  const rnd = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
  const list = [base, words.length > 1 ? `${words[0]}.${words[1]}`.slice(0, 20) : `${base}.bd`, `${base}_bd`, `${base}${rnd(2)}`, `${base}${rnd(3)}`, `${base}.${rnd(2)}`, `${base}_${rnd(3)}`, `${base}${rnd(4)}`, `${base}${rnd(4)}`];
  return [...new Set(list)].map((n) => n.slice(0, 20)).filter((n) => !validateUsername(n));
}
async function findFree(seed, want = 4) {
  const found = [];
  const names = candidatesFor(seed);
  const flags = await Promise.all(names.map((n) => isFree(n).catch(() => null)));
  names.forEach((n, i) => { if (flags[i] === true && found.length < want) found.push(n); });
  return found;
}
async function showSuggestions(seed) {
  const run = ++suggestRun;
  const found = await findFree(seed);
  if (run !== suggestRun || signupUsername.value !== seed) return;
  const box = $("#unSuggest");
  if (!found.length) { box.hidden = true; return; }
  $("#unChips").innerHTML = found.map((n) => `<button type="button" class="chip" data-name="${n}">@${n}</button>`).join("");
  box.hidden = false;
}
$("#unChips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-name]");
  if (!chip) return;
  signupUsername.value = chip.dataset.name;
  checkUsername();
});

// coming to this page: suggest a name from the full name, if the box is empty
async function onEnterUsername() {
  if (signupUsername.value) { checkUsername(); return; }
  setUnState("idle", "3-20 characters: small letters, numbers, _ and .", "neutral");
  hideSuggest();
  const run = ++suggestRun;
  try {
    const found = await findFree(signupName.value);
    if (run !== suggestRun || signupUsername.value || !found.length) return;
    $("#unChips").innerHTML = found.map((n) => `<button type="button" class="chip" data-name="${n}">@${n}</button>`).join("");
    $("#unSuggest").hidden = false;
  } catch (error) { /* suggestions are optional */ }
}

/* ---------------------------------------------------------------
   Password strength
---------------------------------------------------------------- */
signupPassword.addEventListener("input", () => {
  const value = signupPassword.value;
  let score = 0;
  if (value.length >= 6) score++;
  if (value.length >= 10) score++;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  if (!value) score = 0;
  const colors = ["bg-error", "bg-orange-400", "bg-yellow-400", "bg-online-emerald"];
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  document.querySelectorAll(".strength").forEach((bar, index) => {
    bar.className = "strength h-1.5 flex-1 rounded-full transition-colors " + (index < score ? colors[score - 1] : "bg-surface-container");
  });
  $("#strengthText").textContent = value ? labels[score] : "";
});

/* ---------------------------------------------------------------
   SIGN UP, page by page
---------------------------------------------------------------- */
steps.name.addEventListener("submit", (event) => {
  event.preventDefault();
  clearMsg("name");
  signupName.value = signupName.value.replace(/\s+/g, " ").trim();
  if (signupName.value.length < 2) return fail("name", signupName, "need-name");
  goStep("username");
});

steps.username.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMsg("username");
  const value = signupUsername.value;
  const problem = validateUsername(value);
  if (problem) return fail("username", signupUsername, problem);
  setLoading(unNext, true, "Checking...");
  let free = null;
  try { free = await isFree(value); } catch (error) { console.warn("Username check failed:", error); }
  setLoading(unNext, false, "Next");
  if (free === false) { setUnState("taken", `@${value} is already taken`, "bad"); showSuggestions(value); return fail("username", signupUsername, "username-taken"); }
  goStep(googleUser ? "terms" : "email");
});

steps.email.addEventListener("submit", (event) => {
  event.preventDefault();
  clearMsg("email");
  const email = signupEmail.value.trim();
  if (!email) return fail("email", signupEmail, "need-email");
  if (!EMAIL_RE.test(email)) return fail("email", signupEmail, "auth/invalid-email");
  goStep("password");
});

steps.password.addEventListener("submit", (event) => {
  event.preventDefault();
  clearMsg("password");
  if (signupPassword.value.length < 6) return fail("password", signupPassword, "auth/weak-password");
  goStep("terms");
});

function fillSummary() {
  const name = signupName.value.trim();
  $("#sumAvatar").textContent = (name.charAt(0) || "?").toUpperCase();
  $("#sumName").textContent = name;
  $("#sumUser").textContent = "@" + signupUsername.value;
  $("#sumEmail").textContent = signupEmail.value.trim();
}

// go back to an earlier page to fix something
function backTo(stepName, input, key) {
  const flow = googleUser ? GOOGLE_STEPS : SIGNUP_STEPS;
  const idx = flow.indexOf(stepName);
  const here = flow.indexOf(current);
  const jump = here - idx;
  const finish = () => { showMsg(stepName, key); if (input) input.setAttribute("aria-invalid", "true"); };
  if (jump > 0 && history.state && history.state.n >= jump) {
    const onPop = () => { window.removeEventListener("popstate", onPop); setTimeout(finish, 0); };
    window.addEventListener("popstate", onPop);
    history.go(-jump);
  } else { showStep(stepName, { dir: "back" }); finish(); }
}

let signingUp = false; // stops the "already logged in" redirect while the profile is being created

steps.terms.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMsg("terms");

  const name = signupName.value.trim().replace(/\s+/g, " ");
  const username = signupUsername.value;
  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  if (!agreeTerms.checked) return showMsg("terms", "need-terms");
  if (googleUser) return finishGoogle(name, username);

  signingUp = true;
  setLoading(signupBtn, true, "Creating account...");
  const reset = () => { signingUp = false; setLoading(signupBtn, false, "Create account"); };

  let user = null;
  let claimed = false;
  const undo = async () => {
    if (!user) return;
    if (claimed) await remove(ref(db, `usernames/${username}`)).catch(() => {});
    await user.delete().catch(() => signOut(auth));
    user = null;
  };

  try {
    await setPersistence(auth, browserLocalPersistence);
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    user = credential.user;

    // Reserve the username first. The database allows this only if nobody owns the name.
    try {
      await set(ref(db, `usernames/${username}`), user.uid);
      claimed = true;
    } catch (error) {
      const code = error?.code || "";
      await undo();
      reset();
      if (/permission/i.test(code)) {
        availCache.set(username, false);
        backTo("username", signupUsername, "username-taken");
        setUnState("taken", `@${username} is already taken`, "bad");
        showSuggestions(username);
      } else {
        showMsg("terms", "username-check-failed");
      }
      return;
    }

    await updateProfile(user, { displayName: name }).catch(() => {});

    try {
      await set(ref(db, `users/${user.uid}`), {
        name,
        nameLower: name.toLowerCase(),
        username,
        photoURL: "",
        bio: "",
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Profile write failed:", error);
      await undo(); // do not leave an account (or a reserved name) without a profile behind
      reset();
      return showMsg("terms", "profile-failed");
    }

    goNext();
  } catch (error) {
    console.error(error);
    await undo();
    reset();
    const key = friendlyKey(error);
    if (key === "auth/email-already-in-use" || key === "auth/invalid-email") backTo("email", signupEmail, key);
    else if (key === "auth/weak-password") backTo("password", signupPassword, key);
    else showMsg("terms", key);
  }
});


/* ---------------------------------------------------------------
   GOOGLE SIGN-IN
   - Browser: a Firebase popup.
   - Android app: Google blocks sign-in inside a WebView, so the native Google account picker is used
     (plugin @capacitor-firebase/authentication with skipNativeAuth). It only returns Google's ID token;
     the sign-in itself is then done here with the same Firebase JS auth as email login, so the rest of the app
     sees one normal signed-in user.
   - A first-time Google user has no profile yet: name -> username -> confirm, written the same way as the email sign-up.
     A profile that already exists is never overwritten.
---------------------------------------------------------------- */
let googleUser = null; // set while a Google user is finishing the profile
const googleBtn = $("#googleBtn");
const isGoogleUser = (user) => !!user && (user.providerData || []).some((p) => p.providerId === "google.com");

function nativeGooglePlugin() {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return null;
  return (cap.Plugins && cap.Plugins.FirebaseAuthentication) || (typeof cap.registerPlugin === "function" ? cap.registerPlugin("FirebaseAuthentication") : null);
}

async function googleCredentialOrPopup() {
  const plugin = nativeGooglePlugin();
  if (plugin) {
    const result = await plugin.signInWithGoogle(); // skipNativeAuth is set in capacitor.config.json
    const idToken = result?.credential?.idToken;
    if (!idToken) throw Object.assign(new Error("no-id-token"), { code: "google-failed" });
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken, result?.credential?.accessToken || undefined));
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

const GOOGLE_LABEL = "Continue with Google";
function setGoogleBusy(busy) {
  googleBtn.disabled = busy;
  loginBtn.disabled = busy;
  googleBtn.querySelector("span").textContent = busy ? "Please wait..." : GOOGLE_LABEL;
}

googleBtn.addEventListener("click", async () => {
  clearMsg("login");
  setGoogleBusy(true);
  signingUp = true; // hold the "already logged in" redirect until the profile has been checked
  try {
    await setPersistence(auth, rememberMe.checked ? browserLocalPersistence : browserSessionPersistence);
    const credential = await googleCredentialOrPopup();
    const user = credential.user;
    // does this person already have a FreeZone profile? (read the real answer: an error must never look like "no profile")
    const snap = await get(ref(db, `users/${user.uid}`));
    if (snap.exists()) { goNext(); return; }
    beginGoogleProfile(user);
  } catch (error) {
    const code = String(error?.code || error?.message || "");
    console.error(error);
    signingUp = false;
    if (auth.currentUser && isGoogleUser(auth.currentUser) && !addMode) await signOut(auth).catch(() => {}); // not half signed in
    // closing the account picker is not an error
    if (/cancel|closed-by-user|popup-closed|user-cancel|12501|12500/i.test(code)) { /* nothing to show */ }
    else showMsg("login", MESSAGES[error?.code] ? error.code : "google-failed");
    setGoogleBusy(false);
  }
});

function beginGoogleProfile(user) {
  googleUser = user;
  signingUp = true;
  setGoogleBusy(false);
  signupEmail.value = user.email || "";
  signupName.value = (user.displayName || "").replace(/\s+/g, " ").trim().slice(0, 40);
  signupUsername.value = "";
  agreeTerms.checked = false;
  navCount = 1;
  history.pushState({ step: "name", n: navCount }, "");
  showStep("name", { dir: "fwd", focus: false });
}

async function cancelGoogle() {
  googleUser = null;
  signingUp = false;
  await signOut(auth).catch(() => {});
  navCount = 0;
  history.replaceState({ step: "login", n: 0 }, "");
  showStep("login", { dir: "back", focus: false });
}

async function finishGoogle(name, username) {
  const user = googleUser;
  signingUp = true;
  setLoading(signupBtn, true, "Creating account...");
  const reset = () => setLoading(signupBtn, false, "Create account");
  let claimed = false;
  try {
    // never overwrite a profile that exists
    const existing = await get(ref(db, `users/${user.uid}`));
    if (existing.exists()) { goNext(); return; }

    try {
      await set(ref(db, `usernames/${username}`), user.uid);
      claimed = true;
    } catch (error) {
      reset();
      if (/permission/i.test(error?.code || "")) {
        availCache.set(username, false);
        backTo("username", signupUsername, "username-taken");
        setUnState("taken", `@${username} is already taken`, "bad");
        showSuggestions(username);
      } else showMsg("terms", "username-check-failed");
      return;
    }

    await updateProfile(user, { displayName: name }).catch(() => {});
    try {
      await set(ref(db, `users/${user.uid}`), {
        name,
        nameLower: name.toLowerCase(),
        username,
        photoURL: "",
        bio: "",
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Profile write failed:", error);
      if (claimed) await remove(ref(db, `usernames/${username}`)).catch(() => {}); // free the name again; the Google account stays, so Create can be tried again
      reset();
      return showMsg("terms", "profile-failed");
    }
    googleUser = null;
    goNext();
  } catch (error) {
    console.error(error);
    reset();
    showMsg("terms", friendlyKey(error));
  }
}

/* ---------------------------------------------------------------
   Start: already logged in? go straight to the feed
---------------------------------------------------------------- */
let firstAuthCheck = true;
function revealLogin() {
  if (!firstAuthCheck) return;
  firstAuthCheck = false;
  bootEl.hidden = true;
  pageEl.hidden = false;
  history.replaceState({ step: "login", n: 0 }, "");
  showStep("login", { focus: false }); // no keyboard pop-up on load
}

onAuthStateChanged(auth, async (user) => {
  if (user && !signingUp && !addMode) {
    // A Google account whose profile was never finished (app closed half way): finish it here instead of opening an empty feed
    if (isGoogleUser(user)) {
      try {
        const snap = await get(ref(db, `users/${user.uid}`));
        if (!snap.exists()) { revealLogin(); beginGoogleProfile(user); return; }
      } catch (error) { console.warn("Profile check failed:", error); }
    }
    goNext();
    return;
  }
  if (firstAuthCheck) {
    revealLogin();
    if (googleUser) return;
    const startParams = new URLSearchParams(window.location.search);
    if (startParams.get("tab") === "signup") goStep("name");
    else if (addMode && startParams.get("email")) {
      loginEmail.value = startParams.get("email");
      setTimeout(() => loginPassword.focus(), 80); // the email is known: ask only for the password
    }
  }
});
