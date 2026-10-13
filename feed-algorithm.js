// FreeZone BD - the feed algorithm ("For you" ranking).
//
// HOW IT WORKS
//   Every post gets a score; the feed shows the highest scores first.
//     score = quality x freshness x (1 + relationship + interest)
//   Then the list is re-ordered for variety (same author twice in a row, posts already seen, ...).
//   Ads are placed by the same file, after the posts are ranked.
//
// THE FILE IS BUILT IN PARTS (each part fills one section below, nothing else changes):
//    1  structure and CONFIG ........... done
//    2  quality (likes, comments) ...... done        5  interest match (tags, kind of post) ... done
//    3  freshness (age, new-post chance) done        6  my interest profile (userInterests) ... done
//    4  relationship with the author . done          7  shares ... done  8  views / watch time ... done
//    9  "Not interested"      10  re-ordering ... done  11  hooked into the feed + Top / Latest switch ... done
//   12-14  ads (relevance, click rate, frequency cap, pacing) ... done
//   24  adult content (sex videos / posts) is never shown ... done
//   22  language (Bangla first) ... done   23  video watch time ... done
//   18  block / mute ... done   19  spam + engagement-bait filter ... done   20  new-account trust ... done   21  reports hide a post ... done
//   15  cold start (new people) ... done   16  privacy switch   17  checks and tuning ... done (validateConfig, feed-algorithm.test.mjs, feed-lab.html, ?debug badge)
//
// TUNING: every number is in CONFIG. Change a number there and the feed changes; no other code needs to be touched.
// The file is pure (no screen, no database), so it can be tested on its own. The caller gives it posts and a context.
//
//   context = {
//     me:           my uid
//     now:          time in ms (default: Date.now())
//     followingIds: { uid: time }   the people I follow
//     followerIds:  { uid: time }   the people who follow me (part 4: "mutual")
//     chattedIds:   { uid: true }   the people I chat with (part 4)
//     likedAuthors: { uid: count }  how many posts of each author I liked (part 4, see likedAuthorsFrom)
//     seen:         { postId: true } posts I already saw (part 8 fills it, part 10 uses it)
//     less:         { authors: {uid: time}, tags: {tag: time} } "Not interested" (part 9)
//     blocked:      { uid: true }   people I blocked          (part 18: their posts never appear; a Set or an array also works)
//     blockedBy:    { uid: true }   people who blocked me     (part 18: same)
//     muted:        { uid: true }   people I muted            (part 18: same)
//     authorCreatedAt: { uid: time } when each author joined (part 20; a post can also carry post.authorCreatedAt)
//     adultAuthors: { uid: true }   accounts an admin flagged for adult content (part 24: all their posts are hidden)
//     languages:    ["bn", "en"]    the languages I read (part 22; "bn" = Bangla, "en" = Latin letters). Missing = config.language.preferred
//   post fields that parts 22 and 23 read (all optional):
//     lang: "bn" | "en" | "mixed"   (else it is found from the text: detectLanguage)
//     videoURL, videoDuration (seconds), playsCount (how many times it was played), watchTimeMs (all watched time added up)
//   post fields that part 24 reads (all optional; the text is always checked):
//     nsfw / adult: true            an admin or the author marked it 18+
//     adultScore: 0..1              the answer of a picture / video checking service (the algorithm cannot see pictures itself)
//     labels: ["adult", ...]        labels from a checking service or an admin
//     reportReasons: { adult: 3 }   how many reports gave "adult / sexual / nudity" as the reason (reportsCount stays the total)
//     interests:    my interest profile { tags, authors, kinds } (parts 5 + 6, see learnInterest)
//     ...more keys are added by later parts, each part lists what it reads
//   }
import { extractTags } from "./hashtags.js";

/* ===================================================================
   CONFIG - all the numbers
=================================================================== */
export const DEFAULT_CONFIG = {
  version: 1,

  // How many of the newest posts are ranked (the feed loads this many at most)
  window: 400,

  // Part 2 - quality: what one like / comment / share / save is worth
  quality: {
    like: 1,
    comment: 3,
    share: 5,
    save: 2,
    minSample: 3,       // a post with fewer interactions than this is not trusted to be "great" yet
    cap: 60             // one post can never be worth more than this (a viral post must not bury everything)
  },

  // Part 3 - freshness
  freshness: {
    halfLifeHours: 18,  // after this time the post counts half
    newBoostHours: 1,   // the first hour: a small extra chance for every new post
    newBoost: 1.3,
    floor: 0.05         // very old posts never go to zero (they can still win if they are great)
  },

  // Part 4 - relationship with the author (added to the multiplier)
  relationship: {
    following: 0.5,
    mutual: 0.25,       // plus: they follow me too
    liked: 0.3,         // I liked / commented on their posts before (scaled by how often)
    chatted: 0.2,
    me: 0.35            // my own posts: kept near the top for a short while
  },

  // Part 5 and 6 - interest match (added to the multiplier)
  interest: {
    tag: 0.6,           // a hashtag I like
    author: 0.4,        // an author I like
    kind: 0.15,         // the kind of post I like (photo / text / poll)
    max: 1.2,           // total interest can never add more than this
    decayDays: 30,      // my old interests fade over this time (the value halves every decayDays)
    cap: 10,            // a score of 10 counts as "fully interested" (more adds nothing)
    keep: 60,           // my profile keeps the 60 strongest tags and authors
    maxTags: 3,         // learn from / match at most this many hashtags of a post
    learn: { like: 1, comment: 2, share: 3, save: 2, view: 0.3, follow: 3, hide: -4, watch: 0.5, watchFull: 1.2 }
  },

  // Part 7 and 8 - views
  views: {
    dwellMs: 2500,      // a post counts as "seen" after this long on the screen
    batch: 20,          // views are saved in groups, not one by one
    minViews: 30,       // the reaction rate (reactions / views) counts only after this many views
    rateGood: 0.1,      // a post where 10 of 100 viewers react is "very good"
    rateMin: 0.85,      // quality factor of a post nobody reacts to (many views, no reaction)
    rateMax: 1.3        // quality factor of a very good post
  },

  // Part 10 - re-ordering
  reorder: {
    sameAuthorGap: 2,   // the same author again only after this many other posts
    seenPenalty: 0.25,  // a post I saw before keeps only this part of its score
    reportPenalty: 0.5, // posts with reports lose score (per report, down to a minimum)
    reportMin: 0.2,
    lessAuthor: 0.4,    // "Not interested": that author is multiplied by this (fades over interest.decayDays)
    lessTag: 0.75,      // each hashtag of that post (at most 2 count)
    newAuthorSlots: 1,  // in every 10 posts, at least this many from people I do not follow yet (discovery)
    // Part 21 - too many reports: the post is not shown at all (my own posts are always shown to me)
    reportHide: 5,      // this many reports (or more) hide a post
    reportRate: 0.05,   // or: reports / views at least this much ...
    reportRateViews: 50 // ... once the post has at least this many views
  },

  // Part 12-14 - ads
  ads: {
    firstAfter: 3,          // never in the first posts
    every: 5,               // one ad slot after this many posts
    noBackToBack: true,
    maxPerDay: 10,          // one ad is shown to one person at most this many times a day (frequency cap)
    relevance: 0.5,         // how much matching my interests counts
    ctr: 0.5,               // how much the click rate counts
    explore: 0.1,           // 10% of the time a less-tested ad gets a chance
    testImpressions: 100,   // an ad with fewer impressions than this is "less tested"
    ctrPrior: 50,           // click rate is smoothed with this many imaginary average views (a new ad is not judged by 1 click)
    defaultCtr: 0.02,       // the average click rate when no ad has data yet
    maxTotalPerDay: 30,     // all ads together, per person per day (pacing)
    repeatPenalty: 0.5      // an ad already used in this feed counts half as much for the next slot
  },

  // Part 15 - cold start (new people with no interests yet)
  coldStart: {
    minSignals: 8,          // fewer learned signals than this = a new person
    popularWeight: 1.5,     // new people see more of the popular posts (quality counts to this power)
    newAuthorSlots: 2       // and more posts from people they do not follow yet (instead of reorder.newAuthorSlots)
  },

  // Part 19 - spam and engagement bait ("Comment YES and check your DMs"). severity = the sum of what is found, at most 1.
  //   score x max(min, 1 - severity); the likes and comments of a spammy post count less; severity >= hide = not shown.
  spam: {
    enabled: true,
    bait: 0.45,         // per bait phrase found (at most 2 count)
    link: 0.35,         // a post that is only a link
    manyLinks: 0.3,     // more than maxLinks links
    maxLinks: 2,
    hashtags: 0.3,      // more than maxHashtags hashtags
    maxHashtags: 8,
    shout: 0.2,         // ALL CAPS or the same character again and again
    repeat: 0.5,        // the same author posted the same text again
    minLength: 12,      // shorter texts are never counted as a repeat
    min: 0.1,           // the lowest score multiplier of a spammy post
    hide: 0.9,          // severity at or above this: the post is not shown
    baitPhrases: [
      "comment yes", "check your dm", "check your inbox", "following me to win", "follow me to win", "follow to win",
      "giveaway", "free money", "double your money", "send me money", "claim your prize", "you have won",
      "guaranteed profit", "earn money from home", "click the link to",
      "কমেন্টে ইয়েস লিখুন", "ইনবক্সে মেসেজ দিন", "ইনবক্সে নক করুন", "ফ্রি টাকা", "টাকা ইনকাম করুন", "গিভঅ্যাওয়ে", "লিংকে ক্লিক করুন"
    ]
  },

  // Part 20 - new-account trust: posts of very new accounts I do not know are shown a little less
  trust: {
    newDays: 7,         // an account is "new" for this many days
    min: 0.6,           // the score multiplier of a brand new account (grows to 1 over newDays)
    spamBoost: 0.5      // a new account's spam severity is multiplied by up to 1 + this
  },

  // Part 22 - language: Bangla first (the language is found from the letters: Bangla script or Latin script)
  language: {
    enabled: true,
    preferred: ["bn"],  // the languages I read, used when the caller does not know them (context.languages)
    match: 0.3,         // a post in my language: score x (1 + match)
    mixed: 0.15,        // a post that mixes Bangla and English: score x (1 + mixed) when I read Bangla or English
    mismatch: 0.85,     // a post in a language I do not read: score x this (people I follow / chat with are never lowered)
    minLetters: 8,      // fewer letters than this: the language is unknown, no change
    bnShare: 0.6,       // this much of the letters in Bangla script or more = Bangla
    enShare: 0.2        // this much or less = English (in between = mixed)
  },

  // Part 23 - video watch time (post.playsCount, post.watchTimeMs and post.videoDuration in seconds)
  watch: {
    minPlays: 20,       // the average watched part counts only after this many plays
    goodFraction: 0.6,  // people watching 60% of the video on average = a very good video
    min: 0.8,           // quality factor of a video nobody watches
    max: 1.35,          // quality factor of a very good video
    halfAt: 0.5,        // I watched at least this part of a video: it teaches my profile ("watch")
    fullAt: 0.9         // I watched (nearly) all of it ("watchFull")
  },

  // Part 24 - adult content (sex videos and posts). The algorithm reads the TEXT of a post (caption, title, poll),
  // the flags nsfw / adult, the labels, adultScore from a checking service and the reports with an adult reason.
  // It cannot look at a picture or a video itself: for those the reports, the flags and adultScore are what catch them.
  //   "blocked" = never shown (also not from people I follow)     "mild" = shown less (score x mildPenalty)
  adult: {
    enabled: true,
    mildPenalty: 0.5,   // score multiplier of a mild post (suggestive words)
    mildHide: 3,        // this many mild words in one post = blocked
    scoreHide: 0.7,     // post.adultScore at or above this = blocked
    scoreMild: 0.4,     // at or above this = mild
    reportHide: 2,      // this many reports with an adult reason = blocked
    reportMild: 1,      // one such report = mild
    authorPosts: 3,     // an author with this many blocked posts in one feed: all their posts are hidden
    labels: ["adult", "nsfw", "sexual", "porn", "explicit", "nudity", "18+"],
    reportReasons: ["adult", "sexual", "nudity", "porn", "nsfw"],
    // one blocked word is enough. Latin words match as whole words (also with s / es), Bangla words match at the start of a word.
    strongWords: [
      "porn", "porno", "pornhub", "pornography", "xvideos", "xnxx", "xhamster", "xxx", "nude", "nudes", "naked", "nsfw", "onlyfans",
      "sex video", "sex videos", "sex chat", "sex tape", "sexting", "adult video", "adult videos", "erotic", "erotica", "hentai",
      "blowjob", "handjob", "orgasm", "escort service", "call girl", "hookup", "choti golpo",
      "পর্ন", "পর্নো", "পর্নোগ্রাফি", "সেক্স ভিডিও", "সেক্স চ্যাট", "চটি গল্প", "নগ্ন", "ন্যুড", "যৌন ভিডিও", "এক্সএক্সএক্স"
    ],
    // each one only lowers the post; three of them in one post block it (they are normal words in other posts)
    mildWords: [
      "sex", "sexy", "hot girl", "hot girls", "hot video", "hot videos", "kiss scene", "bikini", "lingerie", "18 plus",
      "viral video", "leaked video", "leaked", "bed scene", "adult",
      "সেক্স", "সেক্সি", "যৌন", "হট ভিডিও", "ভাইরাল ভিডিও", "লিক ভিডিও", "চুমু"
    ]
  },

  // Part 16 - privacy
  privacy: {
    personalizedByDefault: true
  }
};

/** A copy of the config with some numbers changed: makeConfig({ quality: { comment: 4 } }). Used for tuning and tests. */
export function makeConfig(overrides = {}, base = DEFAULT_CONFIG) {
  const merge = (a, b) => {
    const out = Array.isArray(a) ? [...a] : { ...a };
    for (const key of Object.keys(b || {})) {
      out[key] = b[key] && typeof b[key] === "object" && !Array.isArray(b[key]) && a && typeof a[key] === "object"
        ? merge(a[key], b[key])
        : b[key];
    }
    return out;
  };
  return merge(JSON.parse(JSON.stringify(base)), overrides); // a deep copy: changing the result never changes the default
}

/**
 * Part 17: checks a config and returns a list of problems (an empty list = fine).
 * A wrong number (a negative half-life, a penalty above 1, "abc") is found here instead of breaking the feed.
 * Rules: every number is finite; weights >= 0; penalties and floors are in 0..1; counts are whole numbers >= 1.
 */
export function validateConfig(config = DEFAULT_CONFIG) {
  const bad = [];
  const need = (path, test, rule) => {
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), config);
    if (typeof value !== "number" || !Number.isFinite(value) || !test(value)) bad.push(`${path} = ${JSON.stringify(value)} (${rule})`);
  };
  const atLeast = (min) => (v) => v >= min;
  const unit = (v) => v >= 0 && v <= 1;
  const whole = (v) => Number.isInteger(v) && v >= 1;
  ["quality.like", "quality.comment", "quality.share", "quality.save", "quality.cap", "relationship.following", "relationship.mutual",
    "relationship.liked", "relationship.chatted", "relationship.me", "interest.tag", "interest.author", "interest.kind", "interest.max",
    "ads.relevance", "ads.ctr", "reorder.sameAuthorGap", "reorder.newAuthorSlots", "views.dwellMs", "freshness.newBoostHours"].forEach((p) => need(p, atLeast(0), "must be 0 or more"));
  need("window", whole, "a whole number, 1 or more");
  need("quality.minSample", atLeast(1), "1 or more");
  need("freshness.halfLifeHours", (v) => v > 0, "above 0");
  need("freshness.floor", (v) => v > 0 && v <= 1, "above 0, at most 1");
  need("freshness.newBoost", atLeast(1), "1 or more (1 = no boost)");
  ["reorder.seenPenalty", "reorder.reportPenalty", "reorder.reportMin", "reorder.lessAuthor", "reorder.lessTag", "ads.explore", "ads.repeatPenalty", "views.rateMin"].forEach((p) => need(p, unit, "between 0 and 1"));
  need("views.rateMax", atLeast(1), "1 or more");
  need("views.rateGood", (v) => v > 0 && v <= 1, "above 0, at most 1");
  need("views.minViews", atLeast(1), "1 or more");
  ["views.batch", "ads.firstAfter", "ads.maxPerDay", "ads.maxTotalPerDay", "interest.keep", "interest.maxTags", "coldStart.minSignals"].forEach((p) => need(p, whole, "a whole number, 1 or more"));
  need("ads.every", (v) => Number.isInteger(v) && v >= 2, "a whole number, 2 or more");
  need("interest.decayDays", atLeast(1), "1 or more");
  need("interest.cap", (v) => v > 0, "above 0");
  need("ads.ctrPrior", atLeast(1), "1 or more");
  need("ads.defaultCtr", (v) => v > 0 && v < 1, "between 0 and 1");
  need("coldStart.popularWeight", atLeast(1), "1 or more (1 = off)");
  need("coldStart.newAuthorSlots", atLeast(0), "0 or more");
  const learn = (config.interest && config.interest.learn) || {};
  Object.keys(DEFAULT_CONFIG.interest.learn).forEach((k) => need(`interest.learn.${k}`, k === "hide" ? (v) => v <= 0 : atLeast(0), k === "hide" ? "0 or less" : "0 or more"));
  if (!learn || typeof learn !== "object") bad.push("interest.learn is missing");
  need("reorder.reportHide", whole, "a whole number, 1 or more");
  need("reorder.reportRate", (v) => v > 0 && v <= 1, "above 0, at most 1");
  need("reorder.reportRateViews", whole, "a whole number, 1 or more");
  ["spam.bait", "spam.link", "spam.manyLinks", "spam.hashtags", "spam.shout", "spam.repeat", "spam.min", "trust.min"].forEach((p) => need(p, unit, "between 0 and 1"));
  need("spam.hide", (v) => v > 0 && v <= 1, "above 0, at most 1");
  ["spam.maxLinks", "spam.maxHashtags"].forEach((p) => need(p, atLeast(0), "0 or more"));
  need("spam.minLength", atLeast(1), "1 or more");
  need("trust.newDays", (v) => v > 0, "above 0");
  need("trust.spamBoost", atLeast(0), "0 or more");
  ["language.match", "language.mixed"].forEach((p) => need(p, atLeast(0), "0 or more"));
  need("language.mismatch", (v) => v > 0 && v <= 1, "above 0, at most 1");
  need("language.minLetters", atLeast(1), "1 or more");
  need("language.bnShare", (v) => v > 0 && v <= 1, "above 0, at most 1");
  need("language.enShare", (v) => v >= 0 && v < 1, "0 or more, below 1");
  if (config.language && config.language.enShare > config.language.bnShare) bad.push("language.enShare must not be above language.bnShare");
  if (!config.language || !Array.isArray(config.language.preferred)) bad.push("language.preferred must be a list like [\"bn\"]");
  need("watch.minPlays", whole, "a whole number, 1 or more");
  need("watch.goodFraction", (v) => v > 0 && v <= 1, "above 0, at most 1");
  need("watch.min", unit, "between 0 and 1");
  need("watch.max", atLeast(1), "1 or more");
  ["watch.halfAt", "watch.fullAt"].forEach((p) => need(p, (v) => v > 0 && v <= 1, "above 0, at most 1"));
  if (config.watch && config.watch.halfAt > config.watch.fullAt) bad.push("watch.halfAt must not be above watch.fullAt");
  need("adult.mildPenalty", unit, "between 0 and 1");
  ["adult.mildHide", "adult.reportHide", "adult.reportMild", "adult.authorPosts"].forEach((p) => need(p, whole, "a whole number, 1 or more"));
  ["adult.scoreHide", "adult.scoreMild"].forEach((p) => need(p, (v) => v > 0 && v <= 1, "above 0, at most 1"));
  if (config.adult && config.adult.scoreMild > config.adult.scoreHide) bad.push("adult.scoreMild must not be above adult.scoreHide");
  ["strongWords", "mildWords", "labels", "reportReasons"].forEach((k) => { if (!config.adult || !Array.isArray(config.adult[k])) bad.push(`adult.${k} must be a list`); });
  if (!config.spam || !Array.isArray(config.spam.baitPhrases)) bad.push("spam.baitPhrases must be a list of phrases");
  if (config.reorder && config.reorder.reportMin > config.reorder.reportPenalty) bad.push("reorder.reportMin must not be above reorder.reportPenalty");
  if (config.ads && config.ads.maxTotalPerDay < config.ads.maxPerDay) bad.push("ads.maxTotalPerDay must be at least ads.maxPerDay");
  return bad;
}

/* ===================================================================
   Small helpers (shared by all parts)
=================================================================== */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
/** A count made gentle: 0,1,3,10,100 -> 0,0.69,1.39,2.4,4.6 (the 100th like is worth far less than the 1st) */
export const soft = (count) => Math.log1p(Math.max(0, num(count)));

export const hoursSince = (time, now = Date.now()) => Math.max(0, (num(now) - num(time, now)) / 3600000);
export const daysSince = (time, now = Date.now()) => hoursSince(time, now) / 24;

export const likesOf = (post) => num(post.likesCount);
export const commentsOf = (post) => num(post.commentsCount);
export const sharesOf = (post) => num(post.sharesCount);   // added by part 7
export const viewsOf = (post) => num(post.viewsCount);     // added by part 8

/** The reactions of a post as plain numbers (shares, views and saves are filled in by parts 7 and 8) */
export const interactionCounts = (post) => ({
  likes: likesOf(post),
  comments: commentsOf(post),
  shares: sharesOf(post),
  saves: num(post.savesCount)
});

/** { authorUid: how many of their posts I liked } counted in a list of posts (each post keeps its likes) */
export function likedAuthorsFrom(posts, me) {
  const counts = {};
  if (!me) return counts;
  (posts || []).forEach((post) => {
    if (post && post.uid && post.uid !== me && post.likes && post.likes[me]) counts[post.uid] = (counts[post.uid] || 0) + 1;
  });
  return counts;
}

export const hasPhoto = (post) => !!(post.imageURL || (post.imageURLs && Object.keys(post.imageURLs).length));
export const hasPoll = (post) => !!(post.poll && post.poll.options);
/** "video" | "photo" | "poll" | "text": the kind of a post (used by the interest match; a video keeps its cover in imageURL) */
export const hasVideo = (post) => !!(post && post.videoURL);
export const kindOf = (post) => (hasPoll(post) ? "poll" : hasVideo(post) ? "video" : hasPhoto(post) ? "photo" : "text");
/** One profile entry { s: score, t: time } as it is worth now (it halves every `decayDays`) */
export function interestValue(entry, now = Date.now(), decayDays = 30) {
  if (!entry || !Number.isFinite(entry.s)) return 0;
  return entry.s * Math.pow(0.5, Math.max(0, daysSince(entry.t, now)) / Math.max(1, decayDays));
}

/**
 * Part 6: what I do changes my profile.  profile = { tags: {tag: {s,t}}, authors: {uid: {s,t}}, kinds: {kind: {s,t}} }
 * action is a key of config.interest.learn (like, comment, share, save, view, follow, hide). Changes `profile` in place.
 * Returns true when something changed.
 */
export function learnInterest(profile, post, action, config = DEFAULT_CONFIG, now = Date.now()) {
  const c = config.interest;
  const weight = c.learn[action];
  if (!profile || !post || !Number.isFinite(weight) || weight === 0) return false;
  const add = (map, key, w) => {
    if (!key) return;
    const value = interestValue(map[key], now, c.decayDays) + w;
    map[key] = { s: Math.round(clamp(value, -c.cap * 2, c.cap * 4) * 1000) / 1000, t: now };
  };
  tagsOf(post).slice(0, c.maxTags).forEach((tag) => add(profile.tags, tag, weight));
  add(profile.authors, post.uid, weight);
  add(profile.kinds, kindOf(post), weight * 0.5);
  [profile.tags, profile.authors].forEach((map) => {
    const keys = Object.keys(map);
    if (keys.length <= c.keep) return;
    keys.sort((a, b) => Math.abs(interestValue(map[a], now, c.decayDays)) - Math.abs(interestValue(map[b], now, c.decayDays)))
      .slice(0, keys.length - c.keep).forEach((key) => delete map[key]);
  });
  return true;
}

export const emptyInterests = () => ({ tags: {}, authors: {}, kinds: {} });

export const tagsOf = (post) => extractTags(post.text || "");

/* ===================================================================
   PARTS 18-21: BLOCK / MUTE, SPAM, NEW-ACCOUNT TRUST, REPORTS
   Posts that must not be shown are taken out BEFORE ranking (filterPosts); the rest get a lower score.
   My own posts are never taken out and never lowered (I always see what I posted).
=================================================================== */
/** true when `key` is in an object { key: true|time }, a Set or an array (false / 0 / missing = no) */
const has = (collection, key) => {
  if (!collection || key == null) return false;
  if (collection instanceof Set) return collection.has(key);
  if (Array.isArray(collection)) return collection.includes(key);
  return !!collection[key];
};
const spamOf = (config) => (config && config.spam) || DEFAULT_CONFIG.spam;
const trustOf = (config) => (config && config.trust) || DEFAULT_CONFIG.trust;
const reorderOf = (config) => ({ ...DEFAULT_CONFIG.reorder, ...((config && config.reorder) || {}) });

/** lower case, no punctuation, one space between words (works for Bangla too) */
export const normalizeText = (text) => String(text == null ? "" : text).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Part 19: { postId: how many EARLIER posts of the same author had the same text } (only the repeats are listed) */
export function duplicateCounts(posts, minLength = 12) {
  const seen = new Map();
  const out = {};
  (Array.isArray(posts) ? posts : []).filter((post) => post && typeof post === "object")
    .sort((a, b) => num(a.createdAt) - num(b.createdAt))
    .forEach((post) => {
      const text = normalizeText(post.text);
      if (!post.uid || text.length < minLength) return;
      const key = `${post.uid}|${text}`;
      const n = seen.get(key) || 0;
      if (n > 0 && post.id) out[post.id] = n;
      seen.set(key, n + 1);
    });
  return out;
}

/** Part 20: 1 = no doubt, down to trust.min for an account that joined just now (unknown age = 1, no penalty) */
export function trustFactor(post, context = {}, config = DEFAULT_CONFIG) {
  const t = trustOf(config);
  const uid = post && post.uid;
  if (!uid || uid === context.me) return 1;
  if (has(context.followingIds, uid) || has(context.chattedIds, uid)) return 1; // I know this person
  const created = num(post.authorCreatedAt) || num(context.authorCreatedAt && context.authorCreatedAt[uid]);
  if (!created) return 1;
  return t.min + (1 - t.min) * clamp(daysSince(created, context.now) / Math.max(0.01, t.newDays), 0, 1);
}

/**
 * Part 19: how spammy a post looks, 0 (fine) to 1 (certainly spam).
 *   engagement bait ("comment YES", "check your DMs", "follow me to win") + link-only + too many links
 *   + too many hashtags + ALL CAPS / repeated characters + the same text posted again (context.dupOf, see duplicateCounts)
 * A very new account counts as more suspicious (trust.spamBoost).
 */
export function spamSeverity(post, context = {}, config = DEFAULT_CONFIG) {
  const sp = spamOf(config);
  if (!sp.enabled || !post || typeof post !== "object") return 0;
  if (post.uid && post.uid === context.me) return 0;
  const raw = String(post.text == null ? "" : post.text);
  if (!raw.trim()) return 0;
  let severity = 0;
  const text = ` ${normalizeText(raw)}`;
  const phrases = (sp.baitPhrases || []).map(normalizeText).filter(Boolean);
  const hits = phrases.filter((phrase) => text.includes(` ${phrase}`)).length;
  severity += Math.min(hits, 2) * sp.bait;
  const urls = raw.match(/https?:\/\/\S+|www\.\S+/gi) || [];
  if (urls.length > 0 && normalizeText(raw.replace(/https?:\/\/\S+|www\.\S+/gi, " ")).length < 15) severity += sp.link;
  if (urls.length > sp.maxLinks) severity += sp.manyLinks;
  if ((raw.match(/#[\p{L}\p{M}\p{N}_]+/gu) || []).length > sp.maxHashtags) severity += sp.hashtags;
  const letters = (raw.match(/\p{L}/gu) || []).length;
  const upper = (raw.match(/\p{Lu}/gu) || []).length;
  if ((letters >= 20 && upper / letters > 0.7) || /(.)\1{9,}/u.test(raw)) severity += sp.shout;
  if (context.dupOf && post.id && context.dupOf[post.id] > 0) severity += sp.repeat;
  if (severity > 0) {
    // 0 = an old account, 1 = an account that joined just now
    const t = trustOf(config);
    const newness = clamp((1 - trustFactor(post, context, config)) / Math.max(0.01, 1 - t.min), 0, 1);
    severity *= 1 + newness * t.spamBoost;
  }
  return clamp(severity, 0, 1);
}

/**
 * Parts 18, 19, 21: why a post must not be shown at all, or "" when it can be shown.
 *   "blocked" | "blockedBy" | "muted"  (part 18)   "reports" (part 21)   "spam" (part 19)
 */
export function hiddenReason(post, context = {}, config = DEFAULT_CONFIG) {
  if (!post || typeof post !== "object") return "";
  const uid = post.uid;
  if (uid && uid === context.me) return "";
  if (uid) {
    if (has(context.blocked, uid)) return "blocked";
    if (has(context.blockedBy, uid)) return "blockedBy";
    if (has(context.muted, uid)) return "muted";
    if (has(context.adultAuthors, uid)) return "adultAuthor"; // part 24
  }
  if (adultCheck(post, config).level === "blocked") return "adult"; // part 24
  const r = reorderOf(config);
  const reports = num(post.reportsCount);
  if (reports > 0) {
    if (reports >= r.reportHide) return "reports";
    const views = viewsOf(post);
    if (views >= r.reportRateViews && reports / views >= r.reportRate) return "reports";
  }
  if (spamSeverity(post, context, config) >= spamOf(config).hide) return "spam";
  return "";
}

/** { kept, hidden: [{ post, reason }] } - the posts that may be ranked and the ones taken out (for tuning and the debug badge) */
export function filterPosts(posts, context = {}, config = DEFAULT_CONFIG) {
  const list = (Array.isArray(posts) ? posts : []).filter((post) => post && typeof post === "object");
  const ctx = { ...context, dupOf: context.dupOf || duplicateCounts(list, spamOf(config).minLength) };
  const kept = [];
  const hidden = [];
  list.forEach((post) => {
    const reason = hiddenReason(post, ctx, config);
    if (reason) hidden.push({ post, reason }); else kept.push(post);
  });
  // part 24: an author whose posts are blocked again and again loses the rest of their posts in this feed too
  const limit = adultOf(config).authorPosts;
  const count = {};
  hidden.forEach((item) => { if (item.reason === "adult" && item.post.uid) count[item.post.uid] = (count[item.post.uid] || 0) + 1; });
  const bad = Object.keys(count).filter((uid) => count[uid] >= limit && uid !== context.me);
  if (!bad.length) return { kept, hidden };
  const rest = [];
  kept.forEach((post) => { if (post.uid && bad.includes(post.uid)) hidden.push({ post, reason: "adultAuthor" }); else rest.push(post); });
  return { kept: rest, hidden };
}

/* ===================================================================
   PART 22: LANGUAGE (Bangla first)     PART 23: VIDEO WATCH TIME
=================================================================== */
const languageOf = (config) => (config && config.language) || DEFAULT_CONFIG.language;
const watchOf = (config) => (config && config.watch) || DEFAULT_CONFIG.watch;

/**
 * Part 22: "bn" (Bangla script), "en" (Latin letters), "mixed" (both) or "" (too little text to tell).
 * Links, #hashtags and @names are not counted. Bangla written with Latin letters ("ki khobor") looks like English.
 */
export function detectLanguage(text, config = DEFAULT_CONFIG) {
  const l = languageOf(config);
  const clean = String(text == null ? "" : text).replace(/https?:\/\/\S+|www\.\S+/gi, " ").replace(/[#@][\p{L}\p{M}\p{N}_]+/gu, " ");
  const bn = (clean.match(/[\u0980-\u09FF]/g) || []).length;
  const en = (clean.match(/[A-Za-z]/g) || []).length;
  if (bn + en < l.minLetters) return "";
  const share = bn / (bn + en);
  return share >= l.bnShare ? "bn" : share <= l.enShare ? "en" : "mixed";
}

/** a list of language codes from ["bn","en"], a Set, { bn: true } or "bn" */
const languageList = (value) => {
  const list = typeof value === "string" ? [value] : value instanceof Set ? [...value] : Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value).filter((k) => value[k]) : [];
  return list.map((code) => String(code).trim().toLowerCase()).filter(Boolean);
};

/**
 * Part 22: the score multiplier of a post for the languages I read (context.languages, else config.language.preferred).
 *   my language = 1 + match, mixed Bangla/English = 1 + mixed, another language = mismatch, unknown = 1.
 *   My own posts and people I follow or chat with are never lowered.
 */
export function languageFactor(post, context = {}, config = DEFAULT_CONFIG) {
  const l = languageOf(config);
  if (!l.enabled || !post || typeof post !== "object") return 1;
  const uid = post.uid;
  if (uid && uid === context.me) return 1;
  const mine = languageList(context.languages != null ? context.languages : l.preferred);
  if (!mine.length) return 1;
  const given = typeof post.lang === "string" ? post.lang.trim().toLowerCase() : "";
  const lang = given || detectLanguage(post.text, config);
  if (!lang) return 1;
  if (lang === "mixed") return mine.includes("bn") || mine.includes("en") ? 1 + l.mixed : 1;
  if (mine.includes(lang)) return 1 + l.match;
  if (uid && (has(context.followingIds, uid) || has(context.chattedIds, uid))) return 1;
  return l.mismatch;
}

/**
 * Part 23: the quality factor of a VIDEO from how much of it people watch. 1 = not a video / not enough data.
 *   average watched part = watchTimeMs / (playsCount x video length), at most 1
 *   factor = min ... max, reaching max when the average is `goodFraction` or more
 */
export function watchFactor(post, config = DEFAULT_CONFIG) {
  const w = watchOf(config);
  if (!hasVideo(post) || post.watchTimeMs == null) return 1;
  const plays = num(post.playsCount);
  const lengthMs = num(post.videoDuration) * 1000;
  if (plays < w.minPlays || lengthMs <= 0) return 1;
  const fraction = clamp(num(post.watchTimeMs) / (plays * lengthMs), 0, 1);
  return w.min + (w.max - w.min) * clamp(fraction / Math.max(0.01, w.goodFraction), 0, 1);
}

/**
 * Part 23: what watching taught my profile: "watchFull" (nearly all), "watch" (at least half) or "" (just scrolled past).
 * Use it like:  learnInterest(profile, post, watchAction(post, watchedMs, config), config)
 * A video of unknown length counts as "watch" after 15 seconds.
 */
export function watchAction(post, watchedMs, config = DEFAULT_CONFIG) {
  const w = watchOf(config);
  if (!hasVideo(post)) return "";
  const watched = num(watchedMs);
  const lengthMs = num(post.videoDuration) * 1000;
  if (lengthMs <= 0) return watched >= 15000 ? "watch" : "";
  const fraction = watched / lengthMs;
  return fraction >= w.fullAt ? "watchFull" : fraction >= w.halfAt ? "watch" : "";
}

/* ===================================================================
   PART 24: ADULT CONTENT (sex videos and posts)
=================================================================== */
const adultOf = (config) => (config && config.adult) || DEFAULT_CONFIG.adult;
const ADULT_PATTERNS = [/(?:^|[\s(])(?:18|১৮)\s*(?:\+|plus)(?=$|[\s).,!?])/i]; // "18+" and "18 plus"

/** lower case, letters and digits only; a word that mixes letters and digits is read as leet speak (p0rn, s3x); "sexxx" = "sex" */
function adultText(raw) {
  const leet = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b" };
  const words = String(raw == null ? "" : raw).toLowerCase().split(/\s+/).map((word) => {
    let w = word;
    if (/[a-z]/.test(w) && /[0-9]/.test(w)) w = w.replace(/[0-9]/g, (d) => leet[d] || d);
    if (!/^x+$/.test(w)) w = w.replace(/([a-z])\1{2,}/g, "$1");
    return w;
  });
  return ` ${normalizeText(words.join(" "))} `;
}

/** does the (padded) text contain the word? Bangla words match at the start of a word, Latin words as whole words (also + s / es) */
const containsWord = (padded, term) => {
  const w = normalizeText(term);
  if (!w) return false;
  if (/[\u0980-\u09FF]/.test(w)) return padded.includes(` ${w}`);
  return padded.includes(` ${w} `) || padded.includes(` ${w}s `) || padded.includes(` ${w}es `);
};

const labelList = (value) => (typeof value === "string" ? [value] : Array.isArray(value) ? value : value && typeof value === "object" ? Object.keys(value).filter((k) => value[k]) : [])
  .map((x) => String(x).trim().toLowerCase());

/**
 * Part 24: is this post (or ad) adult content?  Returns { level: "blocked" | "mild" | "ok", reasons: [...] }.
 *   blocked: a flag (nsfw / adult), a label, adultScore >= scoreHide, reports with an adult reason >= reportHide,
 *            a blocked word ("porn", "xxx", "sex video", "পর্ন" ...) or "18+", or `mildHide` mild words together
 *   mild:    adultScore >= scoreMild, one adult report, or 1-2 mild words
 * Use it when someone writes a post too (create.js): if (adultCheck({ text }).level !== "ok") ...
 */
export function adultCheck(post, config = DEFAULT_CONFIG) {
  const a = adultOf(config);
  const result = { level: "ok", reasons: [] };
  if (!a.enabled || !post || typeof post !== "object") return result;
  const block = (reason) => { result.level = "blocked"; result.reasons.push(reason); };
  const soften = (reason) => { if (result.level === "ok") result.level = "mild"; result.reasons.push(reason); };

  if (post.nsfw === true || post.adult === true || post.adultContent === true) block("flag");
  const labels = labelList(post.labels);
  const bad = new Set((a.labels || []).map((x) => String(x).toLowerCase()));
  if (labels.some((label) => bad.has(label))) block("label");
  const score = num(post.adultScore);
  if (score >= a.scoreHide) block("score"); else if (score >= a.scoreMild) soften("score");
  const reasons = post.reportReasons && typeof post.reportReasons === "object" ? post.reportReasons : {};
  const adultReports = (a.reportReasons || []).reduce((sum, key) => sum + num(reasons[key]), 0);
  if (adultReports >= a.reportHide) block("reports"); else if (adultReports >= a.reportMild) soften("reports");

  const poll = post.poll && post.poll.options ? Object.values(post.poll.options).map((o) => (o && typeof o === "object" ? o.text : o)).join(" ") : "";
  const raw = [post.text, post.caption, post.title, poll].filter((x) => typeof x === "string" && x).join(" \n ");
  if (raw) {
    const padded = adultText(raw);
    if (ADULT_PATTERNS.some((pattern) => pattern.test(raw))) block("18+");
    const strong = (a.strongWords || []).filter((word) => containsWord(padded, word));
    if (strong.length) block(`word:${strong[0]}`);
    const mild = (a.mildWords || []).filter((word) => containsWord(padded, word));
    if (mild.length >= a.mildHide) block(`words:${mild.length}`); else if (mild.length) soften(`mild:${mild[0]}`);
  }
  return result;
}

/* ===================================================================
   PARTS - one scorer for each section. Each returns a number.
   Until its part is built a scorer returns a neutral value, so the feed is simply newest first.
=================================================================== */
export const PARTS = {
  /**
   * Part 2: how good the post is. 1 = an ordinary post, more = people reacted to it.
   *   weighted = likes x like + comments x comment + shares x share (+ saves), at most `cap`
   *   quality  = 1 + log(1 + weighted) x trust        (the 100th like is worth far less than the 1st)
   *   trust    = interactions / minSample, at most 1  (a post with 1 lucky comment is not "great" yet)
   */
  quality(post, context, config) {
    const q = config.quality;
    const counts = interactionCounts(post);
    const total = counts.likes + counts.comments + counts.shares + counts.saves;
    const v = config.views;
    const views = viewsOf(post);
    // Part 8: reaction rate. With enough views, a post people react to gets a bonus, one they scroll past loses a little.
    const rateFactor = views >= v.minViews
      ? v.rateMin + (v.rateMax - v.rateMin) * clamp((total / views) / v.rateGood, 0, 1)
      : 1;
    if (total <= 0) return rateFactor < 1 ? rateFactor : 1;
    const weighted = clamp(counts.likes * q.like + counts.comments * q.comment + counts.shares * q.share + counts.saves * q.save, 0, q.cap);
    const trust = clamp(total / Math.max(1, q.minSample), 0, 1);
    return (1 + soft(weighted) * trust) * (views >= v.minViews ? rateFactor : 1);
  },

  /**
   * Part 3: how fresh. 1 = brand new, 0.5 after one half-life, never below `floor`.
   * The first `newBoostHours` get a small extra (it fades out smoothly), so a new post is seen before it has any likes.
   */
  freshness(post, context, config) {
    const f = config.freshness;
    if (!num(post.createdAt)) return f.floor;                          // no time on the post: treated as very old
    const age = hoursSince(post.createdAt, context.now);               // a time in the future (clock difference) counts as 0
    const decay = Math.pow(0.5, age / Math.max(0.01, f.halfLifeHours));
    const boost = age < f.newBoostHours ? 1 + (f.newBoost - 1) * (1 - age / Math.max(0.01, f.newBoostHours)) : 1;
    return Math.max(f.floor, decay * boost);
  },

  /**
   * Part 4: how close I am to the author. Adds to the multiplier (0 = a stranger).
   *   my own post: a little extra   |  I follow them: +following (+mutual when they follow me too)
   *   I liked their posts before: +liked, growing with how many (full at 5)   |  we chat: +chatted
   */
  relationship(post, context, config) {
    const r = config.relationship;
    const uid = post.uid;
    if (!uid) return 0;
    if (uid === context.me) return r.me;
    let value = 0;
    if (context.followingIds && context.followingIds[uid]) {
      value += r.following;
      if (context.followerIds && context.followerIds[uid]) value += r.mutual;
    }
    const liked = num(context.likedAuthors && context.likedAuthors[uid]);
    if (liked > 0) value += r.liked * clamp(soft(liked) / soft(5), 0, 1);
    if (context.chattedIds && context.chattedIds[uid]) value += r.chatted;
    return value;
  },

  /**
   * Part 5: how well the post matches my interest profile (context.interests, made by part 6). 0 = no match.
   *   interest = tag match x tag + author match x author + kind match x kind, never above `max`
   *   a match is soft(score) / soft(cap), 0..1; only positive scores add (a "not interested" never makes a bonus)
   * Tags: the best 2 hashtags of the post count.
   */
  interest(post, context, config) {
    const profile = context.interests;
    if (!profile) return 0;
    const c = config.interest;
    const now = context.now;
    const norm = (map, key) => {
      const v = interestValue(map && map[key], now, c.decayDays);
      return v > 0 ? clamp(soft(v) / soft(c.cap), 0, 1) : 0;
    };
    const tagMatches = tagsOf(post).slice(0, c.maxTags).map((t) => norm(profile.tags, t)).sort((a, b) => b - a).slice(0, 2);
    const tag = tagMatches.reduce((sum, m) => sum + m, 0) / 2;
    const author = post.uid ? norm(profile.authors, post.uid) : 0;
    const kind = norm(profile.kinds, kindOf(post));
    return clamp(tag * c.tag + author * c.author + kind * c.kind, 0, c.max);
  },

  /** Part 4 + 5 + 6 together: the extra multiplier for me */
  affinity(post, context, config) {
    return PARTS.relationship(post, context, config) + PARTS.interest(post, context, config);
  }
};

/* ===================================================================
   Scoring and ranking
=================================================================== */
/**
 * Part 15: how "new" a person is, 0 = I know their taste, 1 = I know nothing yet.
 * signals = how many weighted actions are in the profile (the authors' scores add up to about one point per like).
 * Without context.interests (the caller does not track interests) nobody is treated as new.
 */
export function profileSignals(profile) {
  if (!profile || !profile.authors) return 0;
  return Object.keys(profile.authors).reduce((sum, uid) => sum + Math.abs(num(profile.authors[uid] && profile.authors[uid].s)), 0);
}

export function coldness(context = {}, config = DEFAULT_CONFIG) {
  if (!context.interests) return 0;
  const min = Math.max(1, config.coldStart.minSignals);
  return clamp(1 - profileSignals(context.interests) / min, 0, 1);
}

/** The score of one post, with the numbers behind it (for tuning: see "explain" below). */
export function scorePost(post, context = {}, config = DEFAULT_CONFIG) {
  const ctx = { ...context, now: context.now ?? Date.now() };
  const cold = coldness(ctx, config);
  // a new person: popular posts count more (quality is >= 1, so a higher power lifts the popular ones)
  const spam = spamSeverity(post, ctx, config); // part 19
  const trust = trustFactor(post, ctx, config); // part 20
  // the likes and comments of a spammy post count less (bait posts collect reactions on purpose)
  const watch = watchFactor(post, config);       // part 23: a video people watch to the end is better
  const language = languageFactor(post, ctx, config); // part 22
  const quality = (1 + (Math.pow(PARTS.quality(post, ctx, config), 1 + (config.coldStart.popularWeight - 1) * cold) - 1) * (1 - spam)) * watch;
  const freshness = PARTS.freshness(post, ctx, config);
  const affinity = PARTS.affinity(post, ctx, config);
  const spamMultiplier = spam > 0 ? Math.max(spamOf(config).min, 1 - spam) : 1;
  const adult = adultCheck(post, config).level === "mild" ? adultOf(config).mildPenalty : 1; // part 24: suggestive posts are shown less
  const score = quality * freshness * (1 + affinity) * spamMultiplier * trust * language * adult;
  return { score: Number.isFinite(score) ? score : 0, quality, freshness, affinity, cold, spam, trust, language, watch, adult };
}

/* ===================================================================
   Part 10 - re-ordering
=================================================================== */
/** Posts I saw before keep only a part of the score; posts with reports lose score. (reportsCount is used when a post has it) */
export function applyPenalties(item, context = {}, config = DEFAULT_CONFIG) {
  const r = config.reorder;
  let multiplier = 1;
  if (context.seen && item.post.id && context.seen[item.post.id]) multiplier *= r.seenPenalty;
  const reports = num(item.post.reportsCount);
  if (reports > 0) multiplier *= Math.max(r.reportMin, Math.pow(r.reportPenalty, reports));
  // Part 9: "Not interested" (context.less = { authors: {uid: time}, tags: {tag: time} }); the effect fades with time
  const less = context.less;
  if (less) {
    const now = num(context.now) || Date.now();
    const fade = (time) => clamp(1 - daysSince(time, now) / Math.max(1, config.interest.decayDays), 0, 1);
    const shrink = (factor, strength) => 1 - (1 - factor) * strength;
    if (item.post.uid && less.authors && less.authors[item.post.uid]) multiplier *= shrink(r.lessAuthor, fade(less.authors[item.post.uid]));
    if (less.tags) {
      tagsOf(item.post).filter((tag) => less.tags[tag]).slice(0, 2).forEach((tag) => { multiplier *= shrink(r.lessTag, fade(less.tags[tag])); });
    }
  }
  item.penalty = multiplier;
  item.score *= multiplier;
  return item;
}

/**
 * Takes the posts best first and makes the feed pleasant:
 *   - the same author never appears again until `sameAuthorGap` other posts have passed
 *   - in every block of 10, at least `newAuthorSlots` posts come from people I do not follow (discovery)
 * It only moves a post a little way down (it looks at the next 30 posts); it never drops a post.
 */
export function reorder(scored, context = {}, config = DEFAULT_CONFIG) {
  const r = config.reorder;
  if (!Array.isArray(scored) || scored.length < 3) return scored;
  const rest = scored.slice();
  const out = [];
  const LOOK = 30;
  const followed = (item) => item.post.uid === context.me || !!(context.followingIds && context.followingIds[item.post.uid]);
  const gapOk = (item) => {
    if (!item.post.uid || r.sameAuthorGap <= 0) return true;
    for (let i = Math.max(0, out.length - r.sameAuthorGap); i < out.length; i++) if (out[i].post.uid === item.post.uid) return false;
    return true;
  };
  while (rest.length) {
    let pick = -1;
    const position = out.length;
    if (r.newAuthorSlots > 0 && position % 10 === 9) {
      const block = out.slice(position - 9);
      const strangers = block.filter((item) => !followed(item)).length;
      if (strangers < r.newAuthorSlots) {
        for (let i = 0; i < Math.min(rest.length, 60); i++) {
          if (!followed(rest[i]) && gapOk(rest[i])) { pick = i; break; }
        }
      }
    }
    if (pick < 0) {
      for (let i = 0; i < Math.min(rest.length, LOOK); i++) {
        if (gapOk(rest[i])) { pick = i; break; }
      }
    }
    if (pick < 0) pick = 0;
    out.push(rest.splice(pick, 1)[0]);
  }
  return out;
}

/**
 * Ranks posts for "For you". Returns the posts best first.
 *   options.explain  true: every item is { post, score, quality, freshness, affinity } instead of the plain post
 *   options.limit    how many to return (default: all)
 *   options.onHidden function(post, reason): called for every post taken out (blocked, blockedBy, muted, adult, adultAuthor, reports, spam)
 * The input is not changed. Posts with no id/time never crash it. Equal scores: the newer post first.
 */
export function rankPosts(posts, context = {}, config = DEFAULT_CONFIG, options = {}) {
  const ctx = { ...context, now: context.now ?? Date.now() };
  // parts 18, 19, 21: blocked / muted / reported-away / spam posts are taken out first (options.onHidden(post, reason) hears about them)
  const dupOf = ctx.dupOf || duplicateCounts(posts, spamOf(config).minLength);
  const { kept, hidden } = filterPosts(posts, { ...ctx, dupOf }, config);
  if (typeof options.onHidden === "function") hidden.forEach((item) => options.onHidden(item.post, item.reason));
  ctx.dupOf = dupOf;
  const list = kept;
  const scored = list
    .map((post) => applyPenalties({ post, ...scorePost(post, ctx, config) }, ctx, config))
    .sort((a, b) => b.score - a.score || num(b.post.createdAt) - num(a.post.createdAt));
  // a new person (part 15): more discovery slots
  const cold = coldness(ctx, config) > 0.5;
  const cfg = cold && config.coldStart.newAuthorSlots > config.reorder.newAuthorSlots
    ? { ...config, reorder: { ...config.reorder, newAuthorSlots: config.coldStart.newAuthorSlots } }
    : config;
  const ordered = reorder(scored, ctx, cfg);
  const out = options.limit ? ordered.slice(0, options.limit) : ordered;
  return options.explain ? out : out.map((item) => item.post);
}


/* ===================================================================
   PARTS 12-14: ADS
   12  relevance   - how well the ad matches my interests (the ad's tags, or the #hashtags in its text)
   13  click rate  - ads people click more are shown more (smoothed, so one lucky click does not decide)
   14  frequency cap + pacing - one ad at most `maxPerDay` times a day for me, all ads together at most
       `maxTotalPerDay`, never the same ad twice in a row, a few untested ads get a chance (explore)
   ads.js asks pickAdsForSlots() for the ads of the slots; the positions (every 5 posts) stay in ads.js / config/ads.
   adContext = { interests, now, adFreq: {adId: times shown to me today}, adTotal: ads shown to me today, hidden: Set|object of ad ids }
=================================================================== */

/** The tags of an ad: ad.tags (array, object {tag:true} or "a, b") or else the #hashtags in its text */
export function adTags(ad) {
  if (!ad) return [];
  let list = [];
  if (Array.isArray(ad.tags)) list = ad.tags;
  else if (ad.tags && typeof ad.tags === "object") list = Object.keys(ad.tags).filter((k) => ad.tags[k]);
  else if (typeof ad.tags === "string") list = ad.tags.split(/[,\s]+/);
  list = list.map((t) => String(t).trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
  if (!list.length) list = extractTags(`${ad.title || ""} ${ad.text || ""}`);
  return list.slice(0, 5);
}

/** Part 12: 0..1, how much the ad matches my interests (the best 2 tags; only positive interests count) */
export function adRelevance(ad, context = {}, config = DEFAULT_CONFIG) {
  const profile = context.interests;
  if (!profile || !profile.tags) return 0;
  const c = config.interest;
  const now = context.now || Date.now();
  const values = adTags(ad)
    .map((tag) => {
      const v = interestValue(profile.tags[tag], now, c.decayDays);
      return v > 0 ? clamp(soft(v) / soft(c.cap), 0, 1) : 0;
    })
    .sort((a, b) => b - a)
    .slice(0, 2);
  return values.length ? clamp(values[0] + (values[1] || 0) * 0.5, 0, 1) : 0; // the best tag counts fully, the second half
}

/** The average click rate of all ads (the starting point for a new ad) */
export function averageCtr(ads, config = DEFAULT_CONFIG) {
  let clicks = 0, views = 0;
  (ads || []).forEach((ad) => { clicks += num(ad.clicks); views += num(ad.impressions); });
  return views >= 100 && clicks > 0 ? clicks / views : config.ads.defaultCtr;
}

/** Part 13: the click-rate factor. 1 = average ad, up to 3^ctr for a very good one, down to 0.25^ctr for a poor one */
export function adCtrFactor(ad, average, config = DEFAULT_CONFIG) {
  const a = config.ads;
  const avg = Math.max(0.0001, average || a.defaultCtr);
  const smooth = (num(ad.clicks) + avg * a.ctrPrior) / (num(ad.impressions) + a.ctrPrior);
  return Math.pow(clamp(smooth / avg, 0.25, 3), a.ctr);
}

/** Score of one ad: click-rate factor x (1 + relevance). Higher = shown sooner */
export function scoreAd(ad, context = {}, config = DEFAULT_CONFIG, average) {
  const relevance = adRelevance(ad, context, config);
  const ctr = adCtrFactor(ad, average ?? config.ads.defaultCtr, config);
  return { score: ctr * (1 + 2 * config.ads.relevance * relevance), relevance, ctr };
}

/** Part 14: may this ad be shown to me now? (not hidden by me, under the daily caps) */
export function adAllowed(ad, context = {}, config = DEFAULT_CONFIG) {
  if (adultCheck(ad, config).level !== "ok") return false; // part 24: an ad with adult content is never shown
  const hidden = context.hidden;
  if (hidden && (typeof hidden.has === "function" ? hidden.has(ad.id) : hidden[ad.id])) return false;
  if (num(context.adFreq && context.adFreq[ad.id]) >= config.ads.maxPerDay) return false;
  return true;
}

/**
 * Chooses the ads for `slotCount` slots. Returns one list per slot: the ad to show first, then 2 spare ads
 * (ads.js uses a spare when the first one's picture does not load).
 *   - the daily caps are applied, the best score goes first, an ad used already in this feed counts less (repeatPenalty)
 *   - never the same ad in two slots in a row (when there is another one), see config.ads.noBackToBack
 *   - `explore` of the time a less-tested ad is shown instead (rng is Math.random; tests give their own)
 */
export function pickAdsForSlots(ads, slotCount, context = {}, config = DEFAULT_CONFIG, rng = Math.random) {
  const a = config.ads;
  const pool = (Array.isArray(ads) ? ads : []).filter((ad) => ad && ad.id && adAllowed(ad, context, config));
  const left = Math.max(0, a.maxTotalPerDay - num(context.adTotal));
  const count = Math.min(Math.max(0, slotCount), left);
  if (!pool.length || !count) return [];
  const average = averageCtr(pool, config);
  const base = new Map(pool.map((ad) => [ad.id, scoreAd(ad, context, config, average).score]));
  const used = new Map();
  const out = [];
  for (let i = 0; i < count; i++) {
    const previous = out.length ? out[out.length - 1][0] : null;
    const options = pool.filter((ad) => !(a.noBackToBack && previous && ad.id === previous.id && pool.length > 1));
    const ranked = options
      .map((ad) => ({ ad, value: base.get(ad.id) * Math.pow(a.repeatPenalty, used.get(ad.id) || 0) }))
      .sort((x, y) => y.value - x.value)
      .map((x) => x.ad);
    let first = ranked[0];
    const untested = ranked.filter((ad) => num(ad.impressions) < a.testImpressions);
    if (untested.length && rng() < a.explore) first = untested[Math.floor(rng() * untested.length) % untested.length];
    const list = [first, ...ranked.filter((ad) => ad !== first)].slice(0, 3);
    used.set(first.id, (used.get(first.id) || 0) + 1);
    out.push(list);
  }
  return out;
}