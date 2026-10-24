# FreeZone BD – সম্পূর্ণ গাইড

**Connect. Share. Chat.** · ভার্সন ১.০.০ · হালনাগাদ ২৩ অক্টোবর ২০২৬

FreeZone BD একটি বাংলাভাষী সোশ্যাল অ্যাপ। একই কোড দুই জায়গায় চলে: **ওয়েবসাইট** (GitHub Pages) এবং **Android অ্যাপ** (Capacitor 8, প্যাকেজ `com.freezonebd.app`)। সঙ্গে আছে আলাদা **অ্যাডমিন সাইট** আর একটি **Cloudflare Worker** (পুশ নোটিফিকেশন, ছবি/ভিডিও আপলোড, কলের সার্ভার)।

এই ফাইলে আছে: কী কোথায় থাকে, কীভাবে চালু করতে হয়, প্রতিটি ফিচার কী করে, ডেটা কোথায় থাকে, কী টেস্ট করতে হয়, সমস্যা হলে কী করতে হয়।

> **নিয়ম:** এই ফাইলে কোনো গোপন কী, পাসওয়ার্ড বা টোকেন লেখা যাবে না। সেগুলো থাকে শুধু GitHub Secrets ও Cloudflare Secrets-এ।

---

## সূচি

1. [এক নজরে](#১-এক-নজরে)
2. [রেপো ও ফোল্ডার](#২-রেপো-ও-ফোল্ডার)
3. [প্রথমবার চালু করা](#৩-প্রথমবার-চালু-করা)
4. [অ্যাপের কাঠামো](#৪-অ্যাপের-কাঠামো)
5. [ফিচার](#৫-ফিচার)
6. [Creator Program (আয়)](#৬-creator-program-আয়)
7. [Boost ও Sponsored](#৭-boost-ও-sponsored)
8. [Android অ্যাপ](#৮-android-অ্যাপ)
9. [Cloudflare Worker](#৯-cloudflare-worker)
10. [অ্যাডমিন সাইট](#১০-অ্যাডমিন-সাইট)
11. [ডেটার কাঠামো](#১১-ডেটার-কাঠামো)
12. [Firebase Rules](#১২-firebase-rules)
13. [ওয়েবসাইট: আইনি পেজ, robots, sitemap](#১৩-ওয়েবসাইট-আইনি-পেজ-robots-sitemap)
14. [ফাইলের তালিকা](#১৪-ফাইলের-তালিকা)
15. [টেস্ট চেকলিস্ট](#১৫-টেস্ট-চেকলিস্ট)
16. [সমস্যা ও সমাধান](#১৬-সমস্যা-ও-সমাধান)
17. [নিরাপত্তা](#১৭-নিরাপত্তা)
18. [আপডেট দেওয়ার নিয়ম](#১৮-আপডেট-দেওয়ার-নিয়ম)
19. [যা এখনো বাকি বা অজানা](#১৯-যা-এখনো-বাকি-বা-অজানা)

---

## ১. এক নজরে

| অংশ | কী দিয়ে তৈরি | কোথায় চলে |
|---|---|---|
| ইউজার অ্যাপ (ওয়েব) | Vanilla JavaScript (ES modules), Tailwind (CDN) | GitHub Pages: `https://freezonebd.github.io/FreeZone-BD-/` |
| Android অ্যাপ | একই ফাইল, Capacitor 8, Tailwind বিল্ড করা, অফলাইন ফন্ট | Google Play; GitHub Actions বিল্ড করে |
| লগইন ও ডেটা | Firebase Authentication (ইমেইল/পাসওয়ার্ড) + Realtime Database | Firebase |
| ছবি | imgbb, তবে কী থাকে Worker-এ (ব্রাউজারে নয়) | Worker `/upload` |
| ভিডিও ও ভয়েস | Cloudinary (ফ্রি প্ল্যান), সাইন করা টিকেটে সরাসরি আপলোড | Worker `/sign` |
| পুশ নোটিফিকেশন | Firebase Cloud Messaging, পাঠায় Worker | Worker `/notify` |
| অডিও/ভিডিও কল | WebRTC, STUN + Cloudflare TURN | Worker `/ice` |
| অ্যাডমিন প্যানেল | আলাদা সাইট, আলাদা রেপো | যেকোনো HTTPS হোস্ট |

বিল্ড টুল ছাড়া ওয়েবসাইট চলে: ফাইল আপলোড করলেই হয়। শুধু Android অ্যাপ বিল্ডে Node লাগে।

**মূল নীতি:** ব্রাউজার বা অ্যাপের কোডে কোনো গোপন কী নেই। আসল নিরাপত্তা Firebase Rules-এ ও Worker-এ।

---

## ২. রেপো ও ফোল্ডার

| রেপো | কী থাকে | কাজ |
|---|---|---|
| `FreeZone-BD-Android` (প্রাইভেট) | `freezone-android.zip` অথবা আনজিপ করা ফোল্ডার: `web/`, `firebase/`, `scripts/`, `push-worker/`, `.github/workflows/` | Android বিল্ড + Worker Deploy |
| `FreeZone-BD-` (ওয়েবসাইট) | `web/`-এর ফাইলগুলো রেপোর মূলে (সাব-ফোল্ডার নেই), সঙ্গে `sitemap.xml` | GitHub Pages প্রজেক্ট সাইট |
| `FreeZoneBD.github.io` (ইউজার সাইট) | `robots.txt`, `google…html` (Search Console যাচাই), `.well-known/assetlinks.json`, `.nojekyll` | সাইটের **মূল** (`freezonebd.github.io/`) |
| অ্যাডমিন সাইট রেপো | `admin-site/`-এর ফাইল | আলাদা হোস্ট |

কেন ইউজার সাইট আলাদা: সার্চ ইঞ্জিন শুধু ডোমেইনের মূলের `robots.txt` পড়ে, আর Android App Links-এর `assetlinks.json` মূলের `/.well-known/`-এ থাকতে হয়। প্রজেক্ট সাইটের (`/FreeZone-BD-/`) ভেতরে রাখলে কাজ করে না।

### `freezone-android/` ফোল্ডারের গঠন

```
web/                 অ্যাপের আসল কোড (ওয়েবসাইটের একই ফাইল)। native.js শুধু Android অ্যাপের ভেতরে কাজ করে
www/                 npm run build:web বানায়। কখনো হাতে বদলাবেন না। রেপোতে থাকে না
firebase/            database.rules.json, storage.rules (Firebase Console-এ Publish করতে হয়, অ্যাপের অংশ নয়)
scripts/             build-web.mjs, patch-android.mjs
push-worker/         worker.js (Cloudflare Worker)
.github/workflows/   android.yml, create-keystore.yml, show-fingerprint.yml, deploy-worker.yml
android/             রেপোতে থাকে না; প্রতি বিল্ডে তৈরি হয়
APP-LINKS.md         ওয়েব লিংক অ্যাপে খোলার নিয়ম
README-ANDROID.md    Android অংশের সংক্ষিপ্ত নোট
```

---

## ৩. প্রথমবার চালু করা

### ৩.১ Firebase

1. Firebase-এ প্রজেক্ট খুলুন, একটি Web app যোগ করুন।
2. Authentication > Sign-in method > **Email/Password** চালু করুন।
3. **Realtime Database** বানান।
4. Authentication > Settings > **Authorised domains**-এ যোগ করুন: `freezonebd.github.io`, অ্যাডমিন সাইটের ডোমেইন, এবং `localhost` (Android অ্যাপ ফাইল চালায় `https://localhost` থেকে)।
5. Realtime Database > Rules-এ `firebase/database.rules.json`-এর **পুরো লেখা** পেস্ট করে **Publish** করুন। ফাইল বদলালে প্রতিবার আবার Publish।
6. Project settings > Web app config থেকে মান নিয়ে `web/config.js` বানান (নমুনা: `config.example.js`)। এটি `auth` ও `db` এক্সপোর্ট করে। সব মডিউল `./config.js` থেকে এগুলো নেয়।
7. Firebase API key-কে শুধু নিজের ডোমেইনের জন্য সীমিত করুন (Google Cloud Console > Credentials)।

Firebase SDK-এর ভার্সন সব ফাইলে `12.2.1`। বদলালে সব ফাইলে একসাথে বদলান।

### ৩.২ অ্যাডমিন অ্যাকাউন্ট

Realtime Database-এ `admins/{আপনার uid}` = `true` বসান। মালিকের জন্য `owner` লিখুন (মালিককে প্যানেল থেকে সরানো যায় না)। uid পাবেন Authentication > Users থেকে।

### ৩.৩ app-info.js (এক জায়গায় সব তথ্য)

`web/app-info.js`-এ আছে: `APP_NAME`, `APP_VERSION`, `SITE_URL` (ওয়েবসাইটের ঠিকানা, শেষে `/`), `PUSH_WORKER_URL` (Worker-এর ঠিকানা), `MIN_AGE` (১৮), `OPERATOR_NAME` ও ঠিকানা, `SUPPORT_EMAIL`, আইনি পেজের তারিখ (`LEGAL_UPDATED`, `LEGAL_UPDATED_BN`)। এক জায়গায় বদলালে সব পেজে বদলায়। `SITE_URL` `scripts/patch-android.mjs`-ও পড়ে, তাই শুধু এখানেই বদলান।

### ৩.৪ Cloudflare Worker (ছবি, ভিডিও, পুশ, কল)

Cloudflare-এ Worker `freezone-push` বানিয়ে `push-worker/worker.js` বসান। **Settings > Variables and secrets**-এ এগুলো দিন (মান কখনো চ্যাটে বা ফাইলে লিখবেন না):

| নাম | ধরন | কাজ |
|---|---|---|
| `PROJECT_ID` | লেখা | Firebase প্রজেক্ট আইডি |
| `DB_URL` | লেখা | Realtime Database-এর ঠিকানা |
| `SERVICE_ACCOUNT` | Secret | Firebase service-account JSON (পুশ পাঠাতে) |
| `IMGBB_KEY` | Secret | imgbb API key (ছবি আপলোড) |
| `CLOUDINARY_CLOUD` | লেখা | ভিডিও: Cloud name |
| `CLOUDINARY_KEY` | লেখা | ভিডিও: API key |
| `CLOUDINARY_SECRET` | Secret | ভিডিও: API secret (প্রতিটি আপলোড সাইন করে) |
| `TURN_KEY_ID`, `TURN_KEY_TOKEN` | লেখা / Secret | ঐচ্ছিক: Cloudflare TURN (মোবাইল ডেটায় কলের জন্য) |
| `METERED_APP`, `METERED_KEY` | লেখা / Secret | ঐচ্ছিক বিকল্প TURN (কার্ড ছাড়া) |

তারপর `web/app-info.js`-এর `PUSH_WORKER_URL`-এ Worker-এর ঠিকানা বসান।

**অটো Deploy:** `.github/workflows/deploy-worker.yml` `push-worker/` (বা zip) বদলালে নিজে Worker Deploy করে। এর জন্য রেপোর Settings > Secrets and variables > Actions-এ দুটি Secret লাগে: `CLOUDFLARE_API_TOKEN` (টেমপ্লেট "Edit Cloudflare Workers") ও `CLOUDFLARE_ACCOUNT_ID`। Deploy `--keep-vars` দিয়ে চলে, তাই ড্যাশবোর্ডে বসানো Variable মুছে যায় না। দেখুন: Actions ট্যাব > "Deploy worker" সবুজ টিক।

### ৩.৫ ওয়েবসাইট হোস্টিং

`FreeZone-BD-` রেপোর Settings > Pages: Source "Deploy from a branch", Branch `main`, ফোল্ডার `/ (root)`। `web/`-এর বদলানো ফাইলগুলো রেপোর মূলে একই নামে বসান। `config.js` নিজের রেখে দিন, ওভাররাইট করবেন না।

### ৩.৬ পুরনো ইউজারনেম রেজিস্ট্রি (একবার)

ইউজারনেম `usernames/{নাম} = uid` নোডে রাখা হয়, যাতে একই নাম দুজন না পায়। যারা আগে থেকে আছে: অ্যাডমিন প্যানেল > Users > **Sync usernames now**। একাধিকবার চালালে ক্ষতি নেই। এটি কাজ করতে `usernames`-এর মাথায় অ্যাডমিন-রিড নিয়ম লাগে (পুরো তালিকা শুধু অ্যাডমিন পড়ে); সর্বশেষ `database.rules.json`-এ তা আছে।

### ৩.৭ Android অ্যাপ বিল্ড

দেখুন [৮. Android অ্যাপ](#৮-android-অ্যাপ)।

---

## ৪. অ্যাপের কাঠামো

অ্যাপ আসলে দুটি HTML পেজ: `login.html` (লগইন) ও `feed.html` (বাকি সবকিছু)। `feed.js` প্রতিটি "পেজ" দরকারমতো আলাদা মডিউল হিসেবে লোড করে (dynamic import), তাই শুরুর লোড হালকা।

| জায়গা | কী খোলে | মডিউল |
|---|---|---|
| নিচের বার: Home | ফিড (For you / Following) | `feed.js` |
| নিচের বার: Search | সার্চ | `search.js` |
| নিচের বার: Video | Reels (পূর্ণ স্ক্রিন) | `reels.js` |
| নিচের বার: Chat | ইনবক্স ও কথোপকথন | `chat.js` |
| নিচের বার: Notifications | নোটিফিকেশন | `notification.js` |
| ভাসমান **+** | পোস্ট তৈরি | `create.js` |
| উপরে বামে অ্যাভাটার | নিজের প্রোফাইল | `profile.js` |
| উপরে ডানে বন্ধু আইকন | Friends | `friends.js` |
| প্রোফাইলের ⋮ মেনু | সেটিংস | `settings.js` |

প্রতিটি পেজ `mount(container, ctx)` এক্সপোর্ট করে। `ctx`-এ থাকে `db`, `currentUser`, `followingIds`, `postActions` ইত্যাদি। নতুন পেজ যোগ করতে `feed.js`-এর `pageModules` তালিকায় এক লাইন যোগ করুন।

**নিচে নামলে বার লুকায়:** `hide-bars.js` স্ক্রল করলে উপরের বার, ট্যাব, নিচের মেনু ও **+** বাটন সরিয়ে দেয়; ওপরে স্ক্রল করলে বা থামলে ফিরে আসে।

**স্ক্রিন সাইজ:** মোবাইলে পুরো প্রস্থ। চওড়া স্ক্রিনে (ল্যাপটপ, বা ফোনে "Desktop site") ফিড ও সাব-পেজ একটি কেন্দ্রে বসা প্রায় ৭২০px কলামে থাকে (`feed.html`-এর CSS)। নিরাপদ এলাকার জন্য `--fz-top` ও `--fz-bottom` ভেরিয়েবল ব্যবহার হয়; Android অ্যাপে `native.js` সেগুলো বসায়, ওয়েবসাইটে `env(safe-area-inset-*)` থেকে আসে।

**ভাষা:** ডিফল্ট ইংরেজি। Settings > Language থেকে বাংলা। `i18n.js` ভাষা ঠিক করে, বাংলা হলে `i18n-bn.js` (শব্দতালিকা) ও `i18n-run.js` (স্ক্রিনের লেখা বদলায়) লোড হয়। নতুন ইংরেজি লেখা যোগ করলে `i18n-bn.js`-এর `d` তালিকায় বাংলা বসান। যেখানে অনুবাদ চলবে না সেখানে `data-notr` দিন।

---

## ৫. ফিচার

### ৫.১ লগইন ও সাইন-আপ (`login.html`, `login.js`)

ধাপগুলো পূর্ণ স্ক্রিন পেজ, ব্রাউজারের Back বাটনও ধাপে ধাপে পিছায়।

- **লগইন:** ইমেইল, পাসওয়ার্ড, Remember me, Forgot password (ইমেইল আছে কি না জানানো হয় না)।
- **সাইন-আপ ৫ ধাপ:** নাম (২+ অক্ষর) → ইউজারনেম (লাইভ available/taken ও সাজেশন) → ইমেইল → পাসওয়ার্ড (৬+, শক্তির বার) → নিশ্চিত (১৮+ ও শর্তে সম্মতি)।
- **ইউজারনেমের নিয়ম:** ৩–২০ অক্ষর; ছোট হাতের `a-z`, সংখ্যা, `_`, `.`। শুরু/শেষে ডট বা পরপর দুই ডট চলবে না। `admin`, `support`, `freezone` ইত্যাদি সংরক্ষিত। ইউজারনেম পরে বদলানো যায় না।
- **অ্যাকাউন্ট খোলার ক্রম:** Auth-এ ইউজার → `usernames/{নাম}` দখল (Rules শুধু খালি নামে লিখতে দেয়) → `users/{uid}` প্রোফাইল। কোনো ধাপ ব্যর্থ হলে অ্যাকাউন্ট ও দখল করা নাম মুছে ফেলা হয়।
- **লিংক:** `login.html?tab=signup` সরাসরি সাইন-আপ; `?next=feed.html?post=ID` লগইনের পর ওই পেজে (শুধু একই সাইটে)।
- **একাধিক অ্যাকাউন্ট** (`accounts.js`): এক ফোনে সর্বোচ্চ ৫টি অ্যাকাউন্টের নাম মনে রাখে। পাসওয়ার্ড **কখনো সেভ হয় না**; Settings > Switch account চাপলে লগইন পেজে ইমেইল ভরা অবস্থায় যায়। নতুন লগইন সফল না হওয়া পর্যন্ত বর্তমান অ্যাকাউন্ট থেকে যায়।

### ৫.২ ফিড (`feed.js`)

- **For you / Following:** For you অ্যালগরিদমে সাজানো; Following শুধু যাদের ফলো করেন ও নিজের পোস্ট। পছন্দ মনে থাকে (`feed-tabs.js`)।
- পাতায় পাতায় লোড (`feed-pager.js`); নিচে পড়ার সময় নতুন পোস্ট "↑ new posts" বাটনে আসে (`feed-new.js`); স্ক্রল মনে রাখা (`scroll-memory.js`); টেনে রিফ্রেশ (`pull-refresh.js`); অফলাইন বার (`offline-bar.js`)।
- People you may like সোয়াইপ কার্ড (`suggest.js`); খালি অবস্থার বার্তা (`empty-state.js`)।
- অ্যাডমিনের ঘোষণা ব্যানার ও রক্ষণাবেক্ষণ মোড (`status.js`)।
- **ফিড অ্যালগরিদম** (`feed-algorithm.js`): স্কোরে সময়, এনগেজমেন্ট (লাইক/কমেন্ট/শেয়ার), রুচির প্রোফাইল (`interests.js`), সম্পর্ক, "দেখা" পোস্টের জরিমানা। "Not interested" (`less.js`) লেখক ও ট্যাগ কিছুদিন নামায়। (স্বয়ংক্রিয় টেস্ট ফাইল `feed-algorithm.test.mjs` আলাদা ব্যাকআপ ফোল্ডারে আছে, `web/`-এ নেই।)
- **ভিউ গণনা** (`views.js`): পোস্টের অর্ধেক ~২.৫ সেকেন্ড পর্দায় থাকলে "দেখা"; `viewsCount` প্রতি জন প্রতি পোস্টে একবার বাড়ে; নিজের পোস্ট গোনা হয় না।

### ৫.৩ পোস্ট কার্ড ও পোস্ট তৈরি (`post.js`, `create.js`)

- কার্ড: অ্যাভাটার, নাম, @username, সময়, "edited", অডিয়েন্স আইকন, ⋯ মেনু; লেখা (লম্বা হলে "আরও দেখুন"), `#হ্যাশট্যাগ`, feeling ও স্থান ট্যাগ, ১–৪টি ছবি, ভিডিও, পোল।
- অ্যাকশন: লাইক (ছবিতে ডাবল ট্যাপও), কমেন্ট, শেয়ার, সেভ। ছবি ভিউয়ার ফেসবুক স্টাইলে।
- অডিয়েন্স: `public`, `followers`, `me` (প্রাইভেট অ্যাকাউন্টের পোস্টেও প্রযোজ্য; নিয়ম `canViewPost()`-এ)।
- পোল ২–৪ অপশন, ভোট `pollVotes/{postId}/{uid}`-এ, ফল লাইভ।
- তৈরি: লেখা, ৪টি পর্যন্ত ছবি, ভিডিও, পোল, feeling, স্থান (`tags.js`), ইমোজি (`emoji.js`); ছবি ক্রপ (`crop.js`) ও সংকোচনের পর আপলোড, প্রগ্রেস ও Cancel। সাসপেন্ড অ্যাকাউন্ট পোস্ট করতে পারে না।

### ৫.৪ কমেন্ট (`comments.js`)

**পূর্ণ স্ক্রিনের শিট** (উপরে ← বাটন ও "Comments" শিরোনাম, নিচে অ্যাভাটারসহ গোল কমেন্ট বক্স ও পাঠানোর আইকন)। প্রতিটি কমেন্টে নাম, @handle, সময়, লাইক, রিপ্লাই; রিপ্লাই সংখ্যা দেখা যায়। এডিট ও ডিলিট চলে; সংশ্লিষ্ট মানুষকে নোটিফিকেশন যায়। পোস্ট কার্ডে শেষ কমেন্টের প্রিভিউ (`post.js`) অ্যাভাটারসহ।

### ৫.৫ সার্চ (`search.js`)

- খালি বক্সে: **Recent** (শুধু এই ফোনে, সর্বোচ্চ ১২টি; ✕ ও Clear all), **Trending** (গত ৭ দিনের সবচেয়ে ব্যবহৃত `#ট্যাগ`), People you may know।
- লিখলে ফিল্টার: All · People · Posts · Photos · Polls। People নাম বা @username-এর শুরু মিলিয়ে খোঁজে (২+ অক্ষর); নিজে, ব্লক, মিউট ও সাসপেন্ড বাদ। Posts শুধু সবচেয়ে নতুন ৪০০ পোস্টে খোঁজে; পুরনো পোস্টের জন্য `#ট্যাগ` পেজ (`hashtag.js`)।

### ৫.৬ প্রোফাইল (`profile.js`)

ব্যানার (৩:১, ১৫০০×৫০০, শুধু অ্যাডমিন বসাতে পারে: `users/{uid}/bannerURL`), ছবি, নাম, @username, বায়ো (১৫০ অক্ষর), ফলোয়ার/ফলোয়িং/পোস্ট সংখ্যা। নিজের প্রোফাইলে Edit profile, QR কোড ও শেয়ার; অন্যেরটায় Follow / Following / Requested, Message, ⋯ (ব্লক, রিপোর্ট)। ট্যাব: Posts, Photos, Videos (ফিচার-গেট), Saved (শুধু নিজের)।

### ৫.৭ বন্ধু, ফলো, প্রাইভেট অ্যাকাউন্ট (`friends.js`, `privacy.js`, `suggest.js`)

ট্যাব: Suggestions, Followers, Following, Find people। `users/{uid}/isPrivate = true` হলে ফলো করতে অনুরোধ পাঠাতে হয় ("Requested"); মালিক নোটিফিকেশন থেকে Confirm বা Delete করেন।

### ৫.৮ চ্যাট ও কল (`chat.js`, `call.js`)

- এক-এক কথোপকথন, রিয়েলটাইম: ছবি, এডিট, ডিলিট, রিপ্লাই, ফরওয়ার্ড, রিঅ্যাকশন, Seen, অনলাইন/Last seen, চ্যাট খোঁজা (`chat-search.js`)।
- ভিডিও ও ভয়েস মেসেজ ফিচার-গেটের নিয়ন্ত্রণে।
- **কল:** WebRTC, Firebase শুধু সংকেত বহন করে (`calls/{calleeUid}/{callId}`)। কল আসার খবর পুশ হয়ে যায়, অ্যাপ বন্ধ থাকলেও। মোবাইল ডেটায় কলের জন্য Worker `/ice` TURN দেয় (`call-config.js`); TURN সেট না থাকলে শুধু STUN, তখন কিছু নেটওয়ার্কে কল জুড়ে না। এক সময়ে একটি কল।

### ৫.৯ স্টোরি (`story.js`)

ফিডের ওপরে স্টোরি বার, পূর্ণ স্ক্রিন ভিউয়ার, ২৪ ঘণ্টা পর অদৃশ্য; কারা দেখেছে তার তালিকা, রিপ্লাই, রিঅ্যাকশন; অ্যাডমিনের দেওয়া গান (`music/`)। ভিডিও স্টোরি ফিচার-গেটের নিয়ন্ত্রণে।

### ৫.১০ Reels ও ভিডিও (`reels.js`, `features.js`, `video-tools.js`, `storage.js`)

- Reels পূর্ণ স্ক্রিন, এক সোয়াইপে একটি। লাইক পোস্টের একই `likes`-এ যায়।
- **আপলোড সীমা** (`video-tools.js`): পোস্ট ৫০ MB / ৬০ সেকেন্ড; স্টোরি ৩০ MB / ২০ সেকেন্ড; চ্যাট ২৫ MB / ৬০ সেকেন্ড। আপলোডের আগে ভিডিও ছোট করা হয়।
- ভিডিও আপলোড করে `storage.js`: Worker থেকে সাইন করা টিকেট নিয়ে সরাসরি **Cloudinary**-তে পাঠায়। Worker প্রতি জনকে ২৪ ঘণ্টায় সীমিত সংখ্যক ভিডিও (সর্বোচ্চ ৫টি) আপলোড করতে দেয়। পোস্ট বা স্টোরি মুছলে ফাইলও মোছা হয় (`/destroy`)।
- **ফিচার-গেট:** প্রতিটি ফিচারের তিন অবস্থা, অ্যাডমিনের Features পেজ থেকে বদলায়, সঙ্গে সঙ্গে কার্যকর:

  | মোড | ফল |
  |---|---|
  | `on` (ডিফল্ট) | আসল ফিচার চলে |
  | `soon` | সাদা পূর্ণ পেজে "Coming soon" |
  | `hidden` | বাটন দেখা যায় না |

  ফিচারের চাবি: `postVideo`, `storyVideo`, `chatVideo`, `voiceMessage`, `profileVideos`, `reels`। ডেটা `config/features`-এ (না থাকলে `on`)।
- **Firebase Storage আর ব্যবহার হয় না** (Firebase এখন Storage-এর জন্য Blaze প্ল্যান চায়)। `firebase/storage.rules` পুরনো, দরকার নেই।

### ৫.১১ নোটিফিকেশন (`notification.js`)

- পেজ: চিপ All / Unread; ⋯ মেনুতে Mark all as read, Clear all; গ্রুপ New, Today, Yesterday, This week, Earlier; প্রতিটি সারিতে Remove; Follow request-এ Confirm/Delete।
- **ধরন:** `like`, `comment`, `reply`, `commentLike`, `follow`, `boost`, `creator` (Creator Program-এর অনুমোদন/বাতিল/বন্ধ/চালু; ট্যাপ করলে Creator Program পেজ খোলে)।
- **পুশ:** নোটিফিকেশন লেখার পর অ্যাপ Worker `/notify`-কে জানায়; Worker যাচাই করে সত্যিই হয়েছে কি না, তারপর FCM-এ পাঠায় (ব্লক ও ইউজারের সেটিং মেনে)। অ্যাডমিন প্যানেল থেকে Boost ও Creator নোটিফিকেশনেও পুশ যায়। `creator` পুশ শুধু অ্যাডমিনের পাঠানো গ্রহণ করে (যাতে কেউ "FreeZone Team" সেজে ভুয়া পুশ না পাঠাতে পারে)।

### ৫.১২ সেটিংস (`settings.js`, `help.js`, `feedback.js`, `about.js`)

Edit profile (ছবি, নাম ৬০ দিনে একবার, বায়ো) · Change password · **Creator Program** · Message alerts / Likes, comments and follows / Call alerts (পুশ চালু-বন্ধ) · Dark mode (Light / Dark / System) · Auto-play videos · Language · Show my active status · Private account · Blocked accounts · Help center · Report a problem · Invite friends · About · Terms of Service · Privacy Policy · Community guidelines · **Creator Program Terms** · Switch account · Log out · Delete account।

### ৫.১৩ ব্লক, মিউট, রিপোর্ট

- **ব্লক** (`block.js`): `blocks/{me}/{they}`, ফিড, সার্চ, সাজেশন ও Sponsored থেকেও বাদ।
- **মিউট** (`mute.js`): `mutes/{me}/{they}`; ফিড, সার্চ, `#ট্যাগ` মানে। এখনো কোনো মেনুতে মিউট বাটন নেই, শুধু `muteAccount()` ফাংশন আছে।
- **রিপোর্ট:** পোস্ট ও প্রোফাইল রিপোর্ট অ্যাডমিন প্যানেলের Reports পেজে যায়।

---

## ৬. Creator Program (আয়)

ছোট পরিসরে চালু, **আপাতত শুধু বাংলাদেশের জন্য** (পেমেন্ট বাংলাদেশের bKash/Nagad নম্বরে); পরে সবার জন্য চালুর পরিকল্পনা। এটি Creator Program পেজের ওপরে ও `creator-terms.html`-এ লেখা আছে; দেশ চেনা হয় Worker-এর `/country` দিয়ে (Cloudflare নেটওয়ার্ক ঠিকানা থেকে দেশের ২ অক্ষরের কোড দেয়): বাংলাদেশের (`BD`) বাইরে হলে আবেদনের বাটন বন্ধ ও "Not open in your country yet" বার্তা; দেশ জানা না গেলে কাউকে আটকানো হয় না। আবেদন করলে Worker (`/creator-country`) দেশটি `creatorApps/{uid}/country`-তে লিখে দেয় (শুধু Worker লিখতে পারে, ইউজার নকল করতে পারে না) এবং অ্যাডমিনের Creators পেজে দেখায় (`BD` ছাড়া লাল)। VPN ব্যবহার করলে ফল ভুল হতে পারে, তাই অনুমোদনের আগে অ্যাডমিন দেশ দেখে নেন। খোলা দেশের তালিকা `creator.js`-এর `OPEN_COUNTRIES`-এ; সবার জন্য খুলতে সেটি খালি `[]` নয়, `wrongCountry` শর্ত বাদ দিন বা সব দেশ যোগ করুন। ইউজার আবেদন করে, অ্যাডমিন অনুমোদন দেয়, অনুমোদিত ক্রিয়েটর নামের পাশে **সবুজ টিক** পায় ও আয় গণনায় আসে। টাকা তোলার অংশ **ডিফল্টে বন্ধ**, অ্যাডমিন একটি সুইচ দিলে চালু হয়।

### ৬.১ ইউজারের দিক (Settings > Creator Program, `creator.js`)

- অবস্থা কার্ড: Not applied / Pending / Approved / Rejected / Turned off / Closed।
- **যোগ্যতার শর্ত** (অ্যাডমিন বদলাতে পারে; ডিফল্ট): ১০০ ফলোয়ার, ১০টি পোস্ট, অ্যাকাউন্ট ৩০ দিনের পুরনো, মোট ১০০০ ভিউ। প্রগ্রেস বার দেখায়। সব শর্ত পূরণ হলে **Apply** বাটন; আবেদনে সংখ্যাগুলোর একটি স্ন্যাপশট থাকে।
- অনুমোদিত হলে এই মাসের ও গত মাসের **আনুমানিক আয়** (মাস বন্ধ হলে "চূড়ান্ত"), ভিউয়ের হিসাব (ভিডিও/ছবি/প্রোফাইল ও আলাদা দর্শক)।
- টাকা তোলার ফর্ম শুধু তখনই দেখা যায় যখন অ্যাডমিন "Open payouts" চালু করেছেন।
- নিয়ম ও Creator Program Terms-এর লিংক পেজের নিচে।

### ৬.২ সবুজ টিক (`monetize.js`)

`monetized/{uid} = true` থাকলে নামের পাশে টিক। দেখায়: পোস্ট কার্ড, কমেন্ট, প্রোফাইল, Reels, চ্যাট (তালিকা ও কথোপকথনের হেডার), সার্চ, বন্ধু তালিকা, সাজেশন। `data-tick-uid` বা পোস্টের লেখক এলিমেন্ট দেখে একটি MutationObserver টিক বসায় ও সরায়। অ্যাডমিন বন্ধ করলে সঙ্গে সঙ্গে সব জায়গা থেকে টিক চলে যায়।

### ৬.৩ ভিউ গণনা (`creatorViews.js`)

কেউ ক্রিয়েটরের ভিডিও (`v`), ছবি (`p`) দেখলে বা প্রোফাইলে গেলে (`f`) `creatorViews/{মাস}/{ক্রিয়েটর}/{দর্শক}`-এ গোনা হয়। ছাঁকনি:

- নিজের ভিউ ও অ-ক্রিয়েটরের ভিউ গোনা হয় না।
- একই কনটেন্ট একই দর্শকের জন্য দিনে একবার (ফোনে `fz_cv`-এ মনে রাখে)।
- ৮ সেকেন্ডের ব্যাচে লেখা হয়।
- Rules: দর্শকের অ্যাকাউন্ট কমপক্ষে ২৪ ঘণ্টার পুরনো হতে হবে; প্রতিটি সংখ্যা ০–৬০; মান কমানো যায় না।
- মাসের হিসাব বাংলাদেশ সময় (UTC+6) ধরে।

### ৬.৪ আয়ের হিসাব (অ্যাডমিন: Creator earnings, `earnings-calc.js`)

- মাসের **নিট আয়** অ্যাডমিন হাতে বসান। তার **৪৫%** ক্রিয়েটরদের পুল, ৫৫% প্ল্যাটফর্মের (`SHARE = 0.45`)।
- ওজন (ডিফল্ট): ভিডিও ভিউ ১, ছবি ভিউ ০.৩, প্রোফাইল ভিজিট ০.৫।
- প্রতি দর্শক প্রতি ধরনে সর্বোচ্চ `viewerCap` (ডিফল্ট ৩০) গোনা হয়।
- কমপক্ষে `minViewers` (ডিফল্ট ৫) আলাদা দর্শক না থাকলে সেই মাসে আয় ০।
- একজন ক্রিয়েটর পুলের সর্বোচ্চ `maxSharePct` (ডিফল্ট ২০%) পায়; বাকি অংশ অবণ্টিত থাকে।
- **Calculate estimate** আনুমানিক হিসাব লিখে (`creatorEarnings/{মাস}/{uid}`)। **Close month (final)** চূড়ান্ত করে; শুধু বন্ধ মাসের আয় টাকা তোলায় গোনা হয়। **Re-open** আবার খোলে।
- হিসাব অ্যাডমিন ব্রাউজারে হয়; সূত্র নমুনা ডেটায় পরীক্ষা করা। আসল ডেটায় প্রথম মাসের ফল অবশ্যই হাতে মিলিয়ে নিন।

### ৬.৫ টাকা তোলা (`creator-payout.js`, অ্যাডমিন: Creator payouts)

- অ্যাডমিন > Creator payouts > **Open payouts** চালু না করলে ইউজার ফর্ম দেখে না, Rules-ও লিখতে দেয় না (`appConfig/creatorPay/payoutsOpen`)।
- ইউজারের উপলব্ধ অঙ্ক = গত ১২ মাসের **চূড়ান্ত** আয় − আগের অনুরোধ (pending + paid)। ন্যূনতম অঙ্ক `minPayout` (ডিফল্ট ৫০০ টাকা)।
- ফর্ম: bKash বা Nagad, নম্বর (`01[3-9]xxxxxxxx`), ঐচ্ছিক নাম। অনুরোধ `creatorPayouts/{uid}/{id}`-এ `pending` হিসেবে যায়।
- অ্যাডমিন: নম্বর কপি, টাকা পাঠিয়ে **Mark as paid** (ট্রানজ্যাকশন আইডি দিতে হয়), বা কারণসহ Reject। দাবির অঙ্ক বন্ধ মাসের আয়ের চেয়ে বেশি হলে লাল সতর্কবার্তা (Rules অঙ্ক যাচাই করতে পারে না, তাই অ্যাডমিনকে মিলিয়ে নিতে হয়)।
- **ভুল নম্বরে পাঠানো টাকা ফেরানো যায় না**; ফর্মে ও Terms-এ এটি লেখা আছে।

### ৬.৬ অ্যাডমিন: Creators পেজ (`page-creators.js`)

ট্যাব: Waiting / Active / Turned off / Rejected / All। কাজ: **Approve**, **Reject** (কারণসহ), **Turn off** (কারণ: অশ্লীল কনটেন্ট, গালিগালাজ/হয়রানি, ভুয়া ভিউ, গাইডলাইন ভঙ্গ, বা নিজের লেখা), **Turn on again**। প্রতিটি কাজে `creatorApps/{uid}` ও `monetized/{uid}` একসাথে বদলায়, ইউজার নোটিফিকেশন ও পুশ পায়, অ্যাডমিন লগে লেখা হয়। একই পেজে **যোগ্যতার শর্ত** সম্পাদনা ও "Applications open" সুইচ (`appConfig/creator`)।

### ৬.৭ আইনি বিষয়

- `creator-terms.html` (বাংলা + ইংরেজি): ১৮+ ও অনুমোদন, ৪৫/৫৫ ভাগ, ভিউ গণনা, আনুমানিক আয়, মাস বন্ধ, bKash/Nagad পেমেন্ট ও ভুল নম্বর, সবুজ টিক, বন্ধ করার কারণ, কর, শর্ত বদল ও যোগাযোগ।
- **কর:** বাংলাদেশে ক্রিয়েটরদের আয়ের করের নিয়ম ২০২৬-২৭ বাজেটে বদলাচ্ছে বলে খবরে এসেছে; চূড়ান্ত আইনে কী দাঁড়িয়েছে তা এই গাইড লেখার সময় নিশ্চিত করা যায়নি। Terms-এ লেখা আছে: আইনে বাধ্যতামূলক হলে উৎসে কর কাটা হবে, না হলে নয়। **টাকা দেওয়া শুরুর আগে** NBR-এর সর্বশেষ নিয়ম দেখুন বা একজন হিসাবরক্ষককে জিজ্ঞেস করুন।
- আইনি লেখা প্রকাশের আগে একজন বাংলাদেশি আইনজীবীকে দিয়ে দেখিয়ে নিন।

### ৬.৮ পরিচিত সীমা

- ভিউ মোট সংখ্যা, গত ৩০ দিনের জানালা নয়।
- আবেদনের যোগ্যতার সংখ্যাগুলো ইউজারের ফোন থেকে লেখা স্ন্যাপশট; অ্যাডমিন Approve-এর আগে দেখে নেন।
- ২০% সীমায় পুলের কিছু অংশ অবণ্টিত থাকে।
- টাকা পাঠানো পুরো হাতে, কোনো স্বয়ংক্রিয় পেমেন্ট নেই।

---

## ৭. Boost ও Sponsored

ইউজার টাকা দিয়ে নিজের পাবলিক পোস্ট অন্যদের ফিডে "Sponsored" হিসেবে দেখাতে পারে। অ্যাডমিন পেমেন্ট যাচাই করে অনুমোদন দেয়। (`boost.js`, `ads.js`, অ্যাডমিন `page-boosts.js`)

**Android অ্যাপে Boost বাটন লুকানো** (`native.js`), কারণ Google Play-তে অ্যাপের ভেতরের ডিজিটাল পণ্যে Play Billing লাগে। ওয়েবসাইটে চালু।

| মেয়াদ | দাম |
|---|---|
| ৩০ দিন | ৳ ৩০০ |
| ৬০ দিন | ৳ ৫০০ |
| ১২০ দিন | ৳ ১০০০ |

দাম `database.rules.json`-এও স্থির, তাই বদলাতে `boost.js` ও Rules দুটোই বদলান।

**ইউজারের ধাপ:** পোস্টের ⋯ > Boost post → প্যাকেজ → বাটনের নাম ও https লিংক → পেমেন্ট (bKash/Nagad-এ Send Money, প্রেরকের নম্বর, TrxID, স্ক্রিনশট) → অর্ডার `pending` হয়ে অ্যাডমিনের কাছে যায়।

**নিয়ম:** শুধু নিজের পাবলিক পোস্ট। একই পোস্টে pending/active/refund_requested থাকলে নতুন অর্ডার নয়; একসাথে সর্বোচ্চ ৩টি pending। TrxID একবারই ব্যবহার করা যায় (`boostTrx/{method_TRXID} = uid`)। অনুমোদনের পর ৩ দিন পর্যন্ত ফেরত চাওয়া যায়; অ্যাডমিন নিজে ফেরত পাঠিয়ে "Mark as refunded" দেন।

**দেখানো:** অনুমোদনে অ্যাডমিন `boostLive/{id}` লেখে; `ads.js` আসল পোস্ট `posts/{postId}` থেকে এনে দেখায়। ফিডে ৩য় পোস্টের পর, তারপর প্রতি ৫টিতে; প্রোফাইলে ২য় পোস্টের পর, তারপর প্রতি ৬টিতে। নিজের Boost নিজের প্রোফাইলে আসে না; নিজের ভিউ/ক্লিক গোনা হয় না। লিংকে `rel="noopener noreferrer sponsored"`।

**মেয়াদ শেষ:** অ্যাডমিনের "End and notify"; Re-open করে নতুন প্যাকেজ ও নতুন TrxID দিয়ে আবার চালু করা যায়। বুস্টের নোটিফিকেশনের সাথে এখন ফোনে পুশও যায়।

অ্যাডমিনের সেটিং: bKash/Nagad নম্বর Boosts পেজে বসাতে হয় (`config/boost`); না বসালে ইউজার নম্বর দেখে না।

---

## ৮. Android অ্যাপ

প্যাকেজ `com.freezonebd.app` · minSdk 24 (Android 7) · compileSdk/**targetSdk 36 (Android 16)** · Capacitor 8 · Node 22, JDK 21।

### ৮.১ `web/native.js` কী করে (শুধু অ্যাপের ভেতরে)

- `<html class="fz-native">` বসায়; স্ট্যাটাস বার ও জেসচার বারের জন্য জায়গা রাখে (`--fz-top`, `--fz-bottom`)।
- Android Back বাটন শিট, পেজ ও পোস্ট বন্ধ করে; ফিডে ওপরে স্ক্রল করে; দুবার চাপলে বের হয়।
- Boost বাটন লুকায় (উপরে দেখুন)।
- ওয়েব লিংক (`feed.html?post=…`) অ্যাপের ভেতরেই খোলে (App Links); Terms/Privacy/Guidelines সেটিংস থেকে একই উইন্ডোতে খোলে, Back দিলে সেটিংসে ফেরে; পোস্টের ওয়েব ঠিকানা ফোনের ব্রাউজারে খোলে।
- **নতুন ভার্সনের বার্তা** (`update-check.js`): Firebase `appConfig`-এ `latestVersionCode` (সর্বশেষ বিল্ড নম্বর), `minVersionCode` (এর চেয়ে পুরনো বিল্ডকে আপডেট করতেই হবে), `message` (ঐচ্ছিক)। পুরনো বিল্ড একটি বন্ধযোগ্য বার্তা দেখে; `minVersionCode`-এর চেয়ে পুরনো বিল্ড বন্ধ করতে পারে না।

### ৮.২ `scripts/patch-android.mjs` (প্রতি বিল্ডে নেটিভ কোড বানায়)

SDK 36, ভার্সন ও সাইনিং বসায়; পারমিশন: INTERNET, ACCESS_NETWORK_STATE, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS; App Links intent-filter (`SITE_URL` থেকে)। দুটি ছোট নেটিভ প্লাগইন: **FzMedia** (ছবি/ভিডিও গ্যালারিতে সেভ) ও **FzBars** (Reels খোলা থাকলে কালো স্ট্যাটাস/নেভিগেশন বার)। WebView-এর টেক্সট জুম ১১৫%-এ সীমিত (ফোনের বড় ফন্ট সেটিংয়ে ডিজাইন ভাঙা ঠেকাতে)। Firebase `google-services.json` অ্যাসেটস থেকে পড়ে চালু হয়।

### ৮.৩ বিল্ড (GitHub Actions, কম্পিউটার ছাড়াই)

```
npm install
npm run android:setup     # build:web, cap add android, patch, cap sync
cd android && ./gradlew assembleRelease bundleRelease
```

`scripts/build-web.mjs` `web/` থেকে `www/` বানায়: CDN লিংক বদলে Tailwind কম্পাইল করে (`app.css`, `login.css`), ফন্ট (Inter, Hind Siliguri, Material Symbols) ও jsQR সঙ্গে দেয়। `web/`-এর ওয়েবসাইট ফাইল বদলায় না। কোডে টুকরো জুড়ে বানানো ক্লাস (যেমন `"bg-" + color`) Tailwind খুঁজে পায় না; পুরো ক্লাসের নাম কোথাও লিখুন।

**ফোন থেকে আপডেট:** রেপোতে নতুন `freezone-android.zip` একই নামে আপলোড করুন; বিল্ড নিজেই আনজিপ করে।

| Workflow | কাজ |
|---|---|
| `android.yml` | প্রতি push-এ debug APK (Actions > run > Artifacts); Release: `release = true` বা `v1.0.0` ট্যাগে সই করা APK + AAB; target SDK 36 না হলে বিল্ড ব্যর্থ |
| `create-keystore.yml` | সাইনিং কী একবার বানায় |
| `show-fingerprint.yml` | `assetlinks.json`-এর জন্য পাবলিক SHA-256 বের করে |
| `deploy-worker.yml` | `push-worker/` বদলালে Cloudflare Worker Deploy |

**GitHub Secrets (Settings > Secrets and variables > Actions):** `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (Create keystore থেকে); `GOOGLE_SERVICES_JSON` (Firebase থেকে); ঐচ্ছিক `PLAY_SERVICE_ACCOUNT_JSON` (AAB Play-এর internal track-এ পাঠায়); `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Worker Deploy)।

**ভার্সন:** `versionCode` = GitHub run নম্বর; `versionName` = `1.0.<run>` (বা ট্যাগ থেকে)।

### ৮.৪ App Links (ওয়েব লিংক অ্যাপে খোলা)

`APP-LINKS.md` দেখুন। সংক্ষেপে: `SITE_URL` থেকে intent-filter বসে; `https://freezonebd.github.io/.well-known/assetlinks.json` ইউজার সাইট রেপোতে থাকতে হবে (সঙ্গে `.nojekyll`); ফাইলটি বানাতে Actions > "Show app-link file" চালান। Debug বিল্ড যাচাই হয় না; সই করা release APK বা Play বিল্ডে পরীক্ষা করুন।

### ৮.৫ Google Play সংক্রান্ত

- Boost অ্যাপে লুকানো। Creator Program ইউজারকে **বাইরে থেকে** টাকা দেয় (ডিজিটাল পণ্য বিক্রি নয়), তাই এর জন্য Play Billing লাগে না। (Play-র নীতি বদলাতে পারে, জমা দেওয়ার আগে কনসোলে মিলিয়ে নিন।)
- নতুন ডেভেলপার অ্যাকাউন্টে প্রোডাকশনের আগে ক্লোজড টেস্টিং লাগে (প্রায় ১২ জন টেস্টার, ১৪ দিন)। কনসোলে বর্তমান শর্ত দেখে নিন।
- Data safety ফর্ম, কনটেন্ট রেটিং, স্টোর লিস্টিং, গোপনীয়তা নীতির ঠিকানা ও **অ্যাকাউন্ট মোছার ঠিকানা** (`delete-account.html`) কনসোলে দিতে হবে।

---

## ৯. Cloudflare Worker

`push-worker/worker.js`। প্রতিটি কল-এ `Authorization: Bearer <Firebase ID token>` লাগে; Worker টোকেন যাচাই করে (Google-এর কী দিয়ে) ইউজার চেনে। অ্যাডমিন যাচাই `admins/{uid}` পড়ে।

| পথ | কাজ |
|---|---|
| `POST /register`, `/unregister` | ফোনের FCM টোকেন সেভ/মোছা |
| `POST /notify` | `kind`: `message`, `call`, `notification`: সত্যিই ঘটেছে কি না ডেটাবেসে মিলিয়ে পুশ পাঠায় (২ মিনিটের পুরনো কিছু পাঠায় না; ব্লক ও সেটিং মানে) |
| `POST /ice` | কলের STUN + TURN সার্ভার |
| `POST /upload` | ছবি (সর্বোচ্চ ৮ MB) imgbb-তে পাঠায়, লিংক ফেরত দেয় |
| `POST /sign` | Cloudinary আপলোডের সাইন করা টিকেট (প্রতি জন ২৪ ঘণ্টায় সীমিত ভিডিও) |
| `POST /destroy` | মালিক বা অ্যাডমিনের Cloudinary ফাইল মোছে |
| `POST /usage` | অ্যাডমিনের জন্য Cloudinary ব্যবহার |

নোটিফিকেশন ধরন `like`, `comment`, `reply`, `commentLike`, `follow`, `boost`, `creator`। `boost` ও `creator` ইউজারের Activity-সেটিং উপেক্ষা করে (গুরুত্বপূর্ণ বার্তা); `creator` শুধু অ্যাডমিনের পাঠানোটা নেয়।

---

## ১০. অ্যাডমিন সাইট

আলাদা সাইট; ইউজার অ্যাপের একই Firebase প্রজেক্ট ও ডেটাবেস। `admin-site/README.md`-এ আলাদা সেটআপ গাইড আছে।

**পেজ** (`page-*.js`, `main.js`-এ নিবন্ধিত): Dashboard · Reports · Feedback · Users · **User lookup** · Posts · **Creators** · **Creator earnings** · **Creator payouts** · Boosts · Music · Cloud usage · Features · Announcements · Admins · Action log।

- **Users:** সাসপেন্ড/চালু; Sync usernames now।
- **User lookup** (`page-lookup.js`): User ID বা @username দিলে এক পেজে সব তথ্য, শুধু পড়া: প্রোফাইল ও অবস্থা, অ্যাকাউন্টের স্বাস্থ্য (ইউজারনেম রেজিস্ট্রি মিলছে কি না ইত্যাদি), কার্যকলাপ ও সাম্প্রতিক পোস্ট, Creator Program (আবেদন, দেশ, টিক, এই মাসের ভিউ ও আয়), টাকা তোলার অনুরোধ, Boost, তার বিরুদ্ধে রিপোর্ট, তার নিজের পাঠানো মেসেজ, তার ওপর অ্যাডমিনের কাজ। ইমেইল দেখা যায় না (Firebase Authentication-এ থাকে)। চ্যাট, সেভ করা পোস্ট ও ব্যক্তিগত সেটিং Rules-এ অ্যাডমিনের জন্যও বন্ধ।
- **Posts:** ফিডের মতো কার্ড; Details ও Delete।
- **Announcements:** ঘোষণা ব্যানার ও রক্ষণাবেক্ষণ মোড।
- **Features:** ভিডিও/Reels `on / soon / hidden`।
- **Music:** স্টোরির গান।
- **Cloud usage:** Cloudinary ফ্রি প্ল্যানের কতটা ব্যবহার হয়েছে (Worker `/usage` থেকে)।
- **Admins / Action log:** অ্যাডমিন যোগ/সরানো (নিজেকে নয়, মালিককে নয়); সব কাজের লগ (`adminLogs`)।
- নতুন পেজ: `page-name.js` বানান (`mount(container, ctx)` এক্সপোর্ট করবে) ও `main.js`-এর তালিকায় এক লাইন যোগ করুন। `ctx`-এ `db`, `ui`, `logAction`, `user` থাকে।

**পুশ:** Boost ও Creator নোটিফিকেশন লিখে অ্যাডমিন সাইট নিজে Worker `/notify` ডাকে (অ্যাডমিন একটি Firebase ইউজারই)। ব্যর্থ হলে অ্যাপের ভেতরের নোটিফিকেশন তবু থাকে।

---

## ১১. ডেটার কাঠামো

Realtime Database-এর মূল নোড (সত্যের উৎস সবসময় `database.rules.json`):

```
usernames/{name}            = uid               ইউজারনেম রেজিস্ট্রি
users/{uid}                 name, nameLower, username, bio, photoURL, bannerURL, isPrivate,
                            nameChangedAt, createdAt, suspended…
posts/{postId}              uid, name, username, photoURL, text, imageURLs, videoURL, videoThumb,
                            poll, feeling, place, audience, likes/{uid}, likesCount, commentsCount,
                            sharesCount, playsCount, watchTimeMs, viewsCount, createdAt, editedAt
                            comments/{id}[/replies/{id}] (লাইকসহ)
pollVotes/{postId}/{uid}    ভোটের অপশন
hashtags/{tag}/{postId}     সময় (সূচি)
following|followers/{uid}, savedPosts/{uid}
followRequests/{target}/{requester}, myRequests/{requester}/{target}
blocks/{me}/{they}, mutes/{me}/{they}
notifications/{uid}/{id}    type, from, fromName, postId, text, read, createdAt
chats/{chatId}              members, messages, reads, delivered, typing
userChats/{uid}/{chatId}    ইনবক্সের সারি;   chatClears/..  চ্যাট মোছার সময়
presence/{uid}              online, lastSeen
stories/{uid}, storyViews, storySeen, storyReactions
calls/{calleeUid}/{callId}  callerUid, video, status, offer, answer, ICE
userSettings/{uid}, userInterests/{uid}   ব্যক্তিগত
feedback/{uid}/{id}         "Report a problem"
reports, userReports        পোস্ট ও প্রোফাইল রিপোর্ট
music/{id}                  স্টোরির গান (অ্যাডমিন লেখে)
boosts, boostLive, boostTrx Boost
monetized/{uid}             = true             সবুজ টিক
creatorApps/{uid}           status: pending|approved|rejected|revoked, আবেদনের স্ন্যাপশট, reason…
creatorViews/{মাস}/{ক্রিয়েটর}/{দর্শক}   v, p, f (০–৬০)
creatorMonths/{মাস}         মাসের আয় ও অবস্থা (estimate|final)
creatorEarnings/{মাস}/{uid} ক্রিয়েটরের আয় (মালিক ও অ্যাডমিন পড়ে)
creatorPayouts/{uid}/{id}   amount, method, number, status, requestedAt…
config/announcement | maintenance | features | boost   অ্যাডমিনের সেটিং
appConfig/                  latestVersionCode, minVersionCode, message,
                            creator{open,minFollowers,minPosts,minAgeDays,minViews},
                            creatorPay{wVideo,wPhoto,wProfile,viewerCap,minViewers,maxSharePct,payoutsOpen,minPayout}
admins/{uid}                true | "owner"
adminLogs/{id}              অ্যাডমিনের কাজের লগ
```

---

## ১২. Firebase Rules

প্রধান নিয়ম:

- **usernames:** একটি নির্দিষ্ট নাম যে কেউ পড়তে পারে (সাইন-আপে যাচাইয়ের জন্য); পুরো তালিকা শুধু অ্যাডমিন। লেখা যায় শুধু খালি নামে ও নিজের uid দিয়ে; মুছতে পারে মালিক বা অ্যাডমিন। ফরম্যাট `^[a-z0-9_.]{3,20}$`।
- **users:** `name` ২–৪০ অক্ষর, বদলানো যায় ৬০ দিনে একবার; `username` পরে বদলায় না; `bannerURL`, `suspended` শুধু অ্যাডমিন।
- **posts:** তৈরি করতে নিজের uid; সাসপেন্ড হলে নয়। `likesCount`, `commentsCount`, `playsCount`, `viewsCount`, `watchTimeMs`, `sharesCount`-এর বাড়ার সীমা বাঁধা (একবারে কতটা বাড়তে পারে)।
- **notifications:** লিখতে পারে শুধু প্রেরক (`from == auth.uid`), নিজেকে নয়, ব্লক করা থাকলে নয়; `type` একটি নির্দিষ্ট তালিকা থেকে।
- **boosts:** মালিক ও অ্যাডমিন পড়ে; তালিকা শুধু `orderByChild("uid").equalTo(নিজের uid)`। তৈরি হয় শুধু `pending`-এ, নিজের পোস্টে, নির্ধারিত দামে ও বৈধ TrxID-সহ।
- **creator\*:** `monetized` অ্যাডমিন লেখে; `creatorApps` মালিক নতুন `pending` আবেদন করতে পারে (নতুন বা আগে `rejected` হলে); `creatorViews` শুধু দর্শক নিজে, ক্রিয়েটর `monetized` হলে, ২৪ ঘণ্টার পুরনো অ্যাকাউন্টে; `creatorMonths`/`creatorEarnings` অ্যাডমিন লেখে; `creatorPayouts` মালিক শুধু `pending` তৈরি করতে পারে, `monetized` হলে এবং `payoutsOpen == true` থাকলে।
- **appConfig, config/\*:** সবাই পড়ে (`appConfig`), অ্যাডমিন লেখে।
- **admins:** অ্যাডমিন যোগ/সরায় (নিজেকে নয়, `owner`-কে নয়)।

**.indexOn:** `users`: `username`, `name`, `nameLower`, `createdAt` · `posts`: `createdAt`, `uid` · `boosts`: `uid`, `status` · `boostLive`: `endAt` · `hashtags/{tag}`: `.value`।

> সতর্কতা: রুলগুলো স্বয়ংক্রিয়ভাবে আসল Firebase সার্ভারে পরীক্ষা করা হয়নি। Publish করার পর [টেস্ট চেকলিস্ট](#১৫-টেস্ট-চেকলিস্ট) একবার পুরো চালান।

---

## ১৩. ওয়েবসাইট: আইনি পেজ, robots, sitemap

### আইনি পেজ (দুই ভাষায়: বাংলা ও ইংরেজি)

| ফাইল | বিষয় |
|---|---|
| `terms.html` | শর্তাবলি (Boost ও ৩ দিনের ফেরত নীতিসহ) |
| `privacy.html` | গোপনীয়তা নীতি (Boost-পেমেন্টের তথ্যসহ) |
| `guidelines.html` | কমিউনিটি নির্দেশিকা |
| `creator-terms.html` | Creator Program-এর শর্তাবলি |
| `delete-account.html` | অ্যাকাউন্ট মোছার তথ্য (Play-র জন্য পাবলিক থাকতে হবে) |
| `legal.css` | এই পেজগুলোর স্টাইল |

নাম, ঠিকানা, ইমেইল ও তারিখ `app-info.js` থেকে বসে। লেখা বদলালে `LEGAL_UPDATED` ও `LEGAL_UPDATED_BN` নতুন তারিখ দিন। **প্রকাশের আগে** আইনজীবী ও হিসাবরক্ষককে দিয়ে দেখিয়ে নিন (ফেরত নীতি, bKash/Nagad চার্জ কে বহন করে, কর)।

### robots.txt ও sitemap.xml

- `robots.txt` থাকে **ইউজার সাইট রেপোতে** (`FreeZoneBD.github.io`, মূলে), কারণ সার্চ ইঞ্জিন শুধু ডোমেইনের মূলের ফাইল পড়ে। পাবলিক পেজ খোলা; `feed.html` ও `login.html` বন্ধ; নিচে সাইটম্যাপের ঠিকানা।
- `sitemap.xml` থাকে **ওয়েবসাইট রেপোতে** (`FreeZone-BD-`): মূল পেজ, `terms`, `privacy`, `guidelines`, `creator-terms`, `delete-account`।
- `feed.html` ও `login.html`-এ `<meta name="robots" content="noindex,nofollow">` আছে (robots.txt না মানলেও এটি সার্চ ফলাফল থেকে দূরে রাখে)।
- `robots.txt` শুধু ভদ্র বট মানে, লুকানোর উপায় নয়; আসল সুরক্ষা Firebase Rules-এ।
- নতুন পাবলিক পেজ যোগ করলে `sitemap.xml` ও `robots.txt`-এ যোগ করুন।

### Google Search Console

URL prefix `https://freezonebd.github.io/` দিয়ে প্রপার্টি যোগ করুন; **HTML file** পদ্ধতিতে যাচাই (ফাইলটি ইউজার সাইট রেপোতে আছে; **মুছবেন না**); Sitemaps-এ `FreeZone-BD-/sitemap.xml` জমা দিন। সাইট Google-এ আসতে কয়েক দিন থেকে কয়েক সপ্তাহ লাগে।

---

## ১৪. ফাইলের তালিকা

`web/`-এর ফাইল (সব একই ফোল্ডারে, সাব-ফোল্ডার নেই):

**পেজ ও প্রবেশদ্বার:** `login.html`, `login.js`, `feed.html`, `feed.js`, `index.html` (`feed.html`-এ পাঠায়)

**ফিচার মডিউল:** `post.js` (কার্ড, ছবি ভিউয়ার, পোল, রিপোর্ট, শেয়ার, সহায়ক), `create.js`, `comments.js`, `search.js`, `hashtag.js`, `hashtags.js`, `profile.js`, `friends.js`, `suggest.js`, `privacy.js`, `chat.js`, `chat-search.js`, `call.js`, `call-config.js`, `story.js`, `reels.js`, `notification.js`, `boost.js`, `ads.js`, `settings.js`, `help.js`, `feedback.js`, `about.js`, `block.js`, `mute.js`, `less.js`, `status.js`, `features.js`, `accounts.js`

**Creator Program:** `creator.js`, `creator-payout.js`, `creatorViews.js`, `monetize.js`, `creator-terms.html`

**ফিড ও অ্যালগরিদম:** `feed-algorithm.js`, `feed-pager.js`, `feed-new.js`, `feed-tabs.js`, `scroll-memory.js`, `pull-refresh.js`, `offline-bar.js`, `empty-state.js`, `hide-bars.js`, `interests.js`, `views.js`

**আপলোড ও মিডিয়া:** `imgbb.js` (ছবি, Worker দিয়ে), `storage.js` (ভিডিও/ভয়েস, Cloudinary), `video-tools.js`, `crop.js`, `emoji.js`, `tags.js`, `linkify.js`, `qr.js`, `qr-scan.js`, `qr-read.js`

**অ্যাপ ও সিস্টেম:** `config.js` (আপনার Firebase সংযোগ; `config.example.js` নমুনা), `app-info.js`, `native.js`, `push.js`, `update-check.js`, `theme.css`, `theme.js`, `i18n.js`, `i18n-bn.js`, `i18n-run.js`, `skeleton.js`, `legal.css`, আইনি HTML পেজ (উপরে), `logo.png`

**অ্যাপের বাইরে:** `firebase/database.rules.json`, `firebase/storage.rules` (পুরনো), `push-worker/worker.js`, `scripts/`, `.github/workflows/`

পুরনো বা ডেমো ফাইল (হোস্টে তোলার দরকার নেই): `feed-demo.html`, `feed-lab.html`, `admin-site-old/`, `admin-site-flat.zip`, `admins.json`, `README.html` (এই গাইডের পুরনো রূপ), `README.bn.md`।

---

## ১৫. টেস্ট চেকলিস্ট

সর্বশেষ Rules Publish ও ফাইল আপলোডের পর ফোনে (দুটি টেস্ট অ্যাকাউন্ট নিয়ে) করুন:

**অ্যাকাউন্ট:** নতুন সাইন-আপ (প্রতিটি ধাপ ও Back); নেওয়া ইউজারনেমে "taken"; লগইন, Remember me, Forgot password; Switch account।

**ফিড ও পোস্ট:** পোস্ট (লেখা, ১–৪ ছবি, পোল, ভিডিও), লাইক, কমেন্ট (পূর্ণ স্ক্রিন শিট), রিপ্লাই, শেয়ার, সেভ; For you / Following; নতুন পোস্ট বাটন; অফলাইন বার; অডিয়েন্স অন্য অ্যাকাউন্টে যাচাই; ব্লকের পর পোস্ট ও সার্চে আর আসে না।

**সার্চ, প্রোফাইল, বন্ধু:** Recent, ফিল্টার, Follow; প্রাইভেট অ্যাকাউন্টে অনুরোধ ও Confirm; প্রোফাইল এডিট; নাম ৬০ দিনের সীমা।

**চ্যাট ও কল:** মেসেজ, ছবি, Seen, অনলাইন; কল Wi-Fi ও **মোবাইল ডেটায়**; অ্যাপ বন্ধ রেখে কল আসার পুশ।

**পুশ:** দুই অ্যাকাউন্টে লাইক, কমেন্ট, মেসেজ পুশ আসে; সেটিংসে বন্ধ করলে আসে না।

**স্ক্রিন সাইজ:** ছোট ফোন, বড় ফন্ট সেটিং, ফোনে "Desktop site", ল্যাপটপ। ফিড ও সেটিংসের সাব-পেজ কেন্দ্রে ঠিকঠাক বসে কি না।

**Creator Program (টেস্ট অ্যাকাউন্ট):** অ্যাডমিন > Creators > যোগ্যতার শর্ত সাময়িকভাবে কমান → ইউজার Apply → অ্যাডমিন Approve → ইউজার নোটিফিকেশন ও পুশ পায় → সবুজ টিক সব জায়গায় (পোস্ট, কমেন্ট, প্রোফাইল, চ্যাট, সার্চ, বন্ধু) এবং **একবারই** দেখা যায় → অন্য অ্যাকাউন্টে ক্রিয়েটরের ভিডিও/ছবি/প্রোফাইল দেখুন (ভিউ গোনা হয় কি না) → Creator earnings > আয় বসিয়ে Calculate estimate → ইউজারের পেজে আনুমানিক আয় → Close month → Turn off করলে টিক চলে যায় ও ইউজার কারণসহ নোটিফিকেশন পায়। শেষে শর্ত আবার আসল মানে ফেরান।

**Payout (আসল টাকা পাঠানোর আগে):** Open payouts চালু → ছোট অঙ্কে অনুরোধ → অ্যাডমিন Mark as paid → বন্ধ রাখলে ইউজার ফর্ম দেখে না।

**Boost:** পুরো প্রবাহ (ওয়েবসাইটে): অর্ডার → অ্যাডমিন Approve → পুশ → অন্য অ্যাকাউন্টের ফিডে Sponsored; একই TrxID আবার দিলে আটকায়; Refund; মেয়াদ শেষ।

**অ্যাডমিন সাইট:** Sync usernames now; Users সাসপেন্ড ও চালু; Posts; Features বদলালে অ্যাপে সঙ্গে সঙ্গে বদলায়।

**Android:** Back বাটন; পুশ; গ্যালারিতে সেভ; ওয়েব লিংক অ্যাপে খোলে (release বিল্ডে); Reels-এ কালো বার; স্ট্যাটাস বারের নিচে লেখা ঢুকে যায় না।

---

## ১৬. সমস্যা ও সমাধান

**"permission denied"** — প্রায় সবসময় সর্বশেষ `database.rules.json` Publish হয়নি। Firebase Console > Realtime Database > Rules-এ পুরো ফাইল পেস্ট করে Publish করুন।

**Sync usernames now-এ "Permission denied"** — `usernames`-এর মাথায় অ্যাডমিন-রিড নিয়ম নেই (সর্বশেষ Rules Publish করুন), অথবা আপনার uid `admins`-এ নেই।

**লগইন হচ্ছে না / "unauthorized-domain"** — Authentication > Settings > Authorised domains-এ ডোমেইন যোগ করুন (Android-এর জন্য `localhost`)।

**ছবি আপলোড হচ্ছে না** — Worker চালু কি না, `PUSH_WORKER_URL` ঠিক কি না, Worker-এ `IMGBB_KEY` Secret আছে কি না, imgbb-র দিনের সীমা।

**ভিডিও আপলোড হচ্ছে না** — Worker-এ `CLOUDINARY_*` ঠিক কি না; Cloudinary ফ্রি সীমা শেষ কি না (অ্যাডমিন > Cloud usage); ২৪ ঘণ্টার ভিডিও সীমা।

**পুশ আসছে না** — Worker-এ `SERVICE_ACCOUNT` ঠিক কি না; ইউজার নোটিফিকেশন অনুমতি দিয়েছেন কি না (Android 13+); ইউজারের Settings-এ Alerts বন্ধ কি না; Worker-এ Deploy হয়েছে কি না (Actions > Deploy worker)।

**কল জুড়ছে না শুধু মোবাইল ডেটায়** — Worker-এ `TURN_KEY_ID`/`TURN_KEY_TOKEN` (বা Metered) নেই। দুজনেরই HTTPS ও ক্যামেরা/মাইক অনুমতি লাগে।

**Worker Deploy হচ্ছে না** — Actions > "Deploy worker" লাল হলে ভেতরের লেখা দেখুন। সাধারণত `CLOUDFLARE_API_TOKEN` বা `CLOUDFLARE_ACCOUNT_ID` Secret ভুল বা নেই। Deploy-এর পর Cloudflare-এ Variable/Secret ঠিক আছে কি না একবার দেখুন।

**`sitemap.xml` খুলছে না** — Pages আপডেট চলছে কি না দেখুন (Actions > "pages build and deployment" সবুজ টিক)। রেপো-ফোল্ডার ও Settings > Pages-এর Source ঠিক কি না দেখুন।

**People সার্চে কেউ আসছে না** — `users`-এর `.indexOn`-এ `username`, `name`, `nameLower` আছে কি না (Rules Publish)।

**Sponsored কার্ড আসছে না** — Boost `active` ও মেয়াদ বাকি কি না; পোস্ট পাবলিক কি না; লিংক https কি না; আপনি নিজেই লেখক নন তো; ✕ দিয়ে লুকিয়েছেন কি না।

**সবুজ টিক দেখা যাচ্ছে না** — `monetized/{uid}` `true` কি না; অ্যাপে `monetize.js` ও `feed.js` সর্বশেষ কি না; নামের এলিমেন্টে `data-tick-uid` আছে কি না।

**টিক দুবার আসছে** — `monetize.js`-এর সর্বশেষ সংস্করণ বসান (পুরনোটি নামের সাথে হ্যান্ডেল লাইনেও টিক বসাত)।

**ডিজাইন ফোনে ভাঙছে** — `feed.html` সর্বশেষ কি না; Android অ্যাপে নতুন বিল্ড দিন (টেক্সট জুম সীমা ও নিরাপদ এলাকা বিল্ডের অংশ)।

**আইকন চৌকো/অক্ষর দেখাচ্ছে** — Material Symbols ফন্ট লোড হয়নি (ইন্টারনেট বা ব্লক)।

---

## ১৬ক. সমস্যা মনিটরিং (Admin > Problems)

ওয়েবসাইট বা অ্যাপে কোনো সমস্যা হলে `web/errors.js` সেটা ধরে `errorLogs` নোডে ছোট রেকর্ড রাখে। অ্যাডমিন প্যানেলের **Problems** পেজে দেখা যায়: কী সমস্যা, কোন পেজ/ফাইল:লাইন, কতবার, কতজন ইউজার, Website না App, অ্যাপ ভার্সন, শেষ কখন, আর কোন ইউজার (User ID → User lookup-এ বসিয়ে দেখা যায়)।

- ধরা পড়ে: JavaScript এরর, ব্যর্থ কাজ (promise), Firebase "permission denied", Worker কল ব্যর্থ/৫xx।
- ধরা পড়ে না: অ্যাপের নেটিভ Android ক্র্যাশ (এর জন্য Firebase Crashlytics লাগবে), ফোন অফলাইন থাকলে হওয়া সমস্যা।
- পাসওয়ার্ড, মেসেজ, টোকেন পাঠানো হয় না; ইমেইল/টোকেনের মতো লেখা `***` করে দেওয়া হয়।
- একই সমস্যা একই ফোন থেকে ১০ মিনিটে একবার, আর এক ভিজিটে সর্বোচ্চ ৮টি।
- সমাধান হলে "Mark as fixed" চাপলে ওই সমস্যার রেকর্ড মুছে যায়।
- Rules-এ `errorLogs`: যে কেউ নতুন রেকর্ড লিখতে পারে (সাইজ সীমিত), পড়া/মোছা শুধু অ্যাডমিন। তাই rules আবার Publish করতে হবে।

## ১৭. নিরাপত্তা

- Firebase web config গোপন নয়; ডেটা বাঁচায় Rules। তাই `database.rules.json` সবসময় Publish ও হালনাগাদ রাখুন, আর Firebase API key নিজের ডোমেইনে সীমিত করুন।
- ব্রাউজারে বা রেপোতে কোনো গোপন কী নেই: imgbb, Cloudinary secret, Firebase service-account, TURN টোকেন সবই Worker Secrets-এ। কোনো কী কখনো ফাঁস হলে (চ্যাটে, স্ক্রিনশটে, কোডে) **সঙ্গে সঙ্গে বদলে নিন** (Cloudinary Key/Secret rotate করে Worker-এ নতুন মান বসান)।
- ফাইলে বা চ্যাটে service-account JSON, অ্যাডমিন পাসওয়ার্ড বা টোকেন রাখবেন না।
- অ্যাডমিনের সংখ্যা কম রাখুন, শক্ত পাসওয়ার্ড দিন। অ্যাডমিন সাইটে চাইলে Cloudflare Access দিয়ে অতিরিক্ত সুরক্ষা দিন।
- ইউজারের লেখা সবসময় `escapeHtml()` দিয়ে বসে; বাইরের লিংকে `rel="noopener noreferrer"` ও শুধু https।
- পেমেন্টের স্ক্রিনশট, TrxID ও টাকা তোলার নম্বর শুধু মালিক ও অ্যাডমিন পড়তে পারে।
- Worker ইউজার চেনে Firebase ID token দিয়ে, আর যা বলা হয় তা সত্যিই ঘটেছে কি না ডেটাবেসে মিলিয়ে নেয়।
- `config.js` ওয়েবসাইট রেপোতে আছে বলে সমস্যা নেই (এটি পাবলিক কনফিগ), কিন্তু রেপোর ভেতরে অন্য কোনো গোপন ফাইল রাখবেন না।
- Firebase App Check চালু করলে অতিরিক্ত সুরক্ষা পাবেন (বাকি কাজের তালিকায়)।

---

## ১৮. আপডেট দেওয়ার নিয়ম

1. বদলানো ফাইল রেপোতে একই নামে বসান (ওয়েবসাইট রেপোর মূলে; Android রেপোতে `web/`-এ বা নতুন zip)।
2. `database.rules.json` বদলালে **আগে Rules Publish**, তারপর অ্যাপ/সাইট।
3. `push-worker/worker.js` বদলালে Android রেপোতে বসান; "Deploy worker" নিজে চলবে।
4. অ্যাডমিন সাইটের ফাইল বদলালে অ্যাডমিন রেপোতে।
5. **সঙ্গে সঙ্গে বদলাতে হয় এমন জোড়া:** `login.html` + `login.js`; `ads.js` + `feed.js` + `profile.js`; `boost.js` + `page-boosts.js` + Rules; Creator-এর ক্ষেত্রে `creator.js` + `creatorViews.js` + `monetize.js` + `feed.js` + `profile.js` + `reels.js` + Rules + অ্যাডমিনের `page-creators.js`, `page-earnings.js`, `page-payouts.js`, `earnings-calc.js`।
6. ওয়েবসাইটে ব্রাউজারে হার্ড রিফ্রেশ করুন (ক্যাশ)।
7. যা-ই বদলান, **অ্যাপ ও ওয়েবসাইট** দুটোতেই বদলান যাতে মিলে থাকে; `config.js` ওভাররাইট করবেন না।
8. বড় বদলের পর টেস্ট চেকলিস্ট চালান।

**নতুন ফিচার যোগ করলে:**
- নতুন পেজ: `mount(container, ctx)` এক্সপোর্ট করে `feed.js`-এর `pageModules`-এ এক লাইন।
- নতুন ডেটা নোড: Rules ও দরকারি `.indexOn` যোগ করে Publish।
- নতুন নোটিফিকেশন ধরন: `notification.js`-এর `TYPES`, Rules-এর `type` তালিকা, Worker-এর `NOTE_TEXT`।
- নতুন ইংরেজি লেখা: `i18n-bn.js`-এ বাংলা।
- নতুন Help প্রশ্ন: `help.js`।
- ভিডিও-সংক্রান্ত ফিচার: `features.js`-এর `FEATURES`।
- নতুন পাবলিক পেজ: `sitemap.xml` ও `robots.txt`।

---

## ১৯. যা এখনো বাকি বা অজানা

**যাচাই হয়নি (আসল ডিভাইস/সার্ভারে পরীক্ষা বাকি):** Creator Program-এর পুরো প্রবাহ; Rules-এর সব নতুন অংশ; Worker-এর `creator`/`boost` পুশ; ছোট ও বড় স্ক্রিনে চূড়ান্ত চেহারা; মোবাইল ডেটায় TURN কল।

**কাজ বাকি (তালিকা):**
- ছোট ফোনে Reels বাটনের মাপ; ল্যাপটপে স্টোরি ভিউয়ার ও কল স্ক্রিন।
- ফিড দ্রুত চালু হওয়া: সমান্তরালে পড়া, ক্যাশ করা ফিড, Firebase SDK লোকালে রাখা।
- প্রোফাইল fade-in ও "Try again"।
- অ্যাপ লক (PIN/আঙুলের ছাপ)।
- Play in-app review বক্স; Crashlytics টেস্ট বাটন।
- Play Data safety উত্তর ও স্টোর লিস্টিং লেখা (বাংলা ও ইংরেজি)।
- Firebase App Check।
- মিউট বাটন মেনুতে।

**যা আপনাকে নিজে করতে হবে (চেকলিস্ট):**
- সর্বশেষ `database.rules.json` Publish; সর্বশেষ zip/ফাইল আপলোড।
- Cloudinary Key/Secret বদলে Worker-এ নতুন মান।
- Firebase API key সীমিত ও Authorised domains ঠিক।
- `appConfig/latestVersionCode` সেট।
- Play Console: Data safety, কনটেন্ট রেটিং, লিস্টিং ছবি/লেখা, `assetlinks.json`-এ SHA-256, ক্লোজড টেস্টিং।
- টাকা দেওয়ার আগে: কর নিয়ম যাচাই, Creator Terms ও বাকি আইনি পেজ আইনজীবীকে দিয়ে দেখানো, প্রথম মাসের আয়ের হিসাব হাতে মিলানো।

---

*অ্যাডমিন সাইটের আলাদা গাইড: `admin-site/README.md` · Android অংশের সংক্ষিপ্ত নোট: `freezone-android/README-ANDROID.md`*
