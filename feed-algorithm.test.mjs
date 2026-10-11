// FreeZone BD - checks for feed-algorithm.js.   Run:  node feed-algorithm.test.mjs
// Every number comes from DEFAULT_CONFIG, so after tuning (changing numbers) run this to see that nothing important broke.
import {
  rankPosts, scorePost, applyPenalties, reorder, makeConfig, validateConfig, DEFAULT_CONFIG as C, PARTS,
  learnInterest, emptyInterests, interestValue, coldness, pickAdsForSlots, adRelevance, adCtrFactor, adTags,
  spamSeverity, trustFactor, hiddenReason, filterPosts, duplicateCounts,
  detectLanguage, languageFactor, watchFactor, watchAction, kindOf, adultCheck, adAllowed
} from "./feed-algorithm.js";

let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) pass++; else { fail++; console.log("FAIL", name); } };
const H = 3600000, now = Date.now();
const P = (id, o = {}) => ({ id, uid: "u" + id, text: "post", createdAt: now - 5 * H, ...o });
const warm = () => { const p = emptyInterests(); for (let i = 0; i < 12; i++) learnInterest(p, P("w", { uid: "zz" }), "like", C, now); return p; };
const ctx = (o = {}) => ({ me: "me", now, interests: warm(), ...o });

// config
t("default config is valid", validateConfig(C).length === 0);
t("bad config is found", validateConfig(makeConfig({ freshness: { halfLifeHours: 0 }, ads: { every: 1 } })).length === 2);
t("makeConfig does not change the default", (makeConfig({ quality: { like: 9 } }), C.quality.like === 1));

// quality (2) and shares (7)
t("more reactions = higher quality", PARTS.quality(P("a", { likesCount: 20, commentsCount: 5 }), ctx(), C) > PARTS.quality(P("a", { likesCount: 1 }), ctx(), C));
t("a share is worth more than a like", PARTS.quality(P("a", { sharesCount: 3 }), ctx(), C) > PARTS.quality(P("a", { likesCount: 3 }), ctx(), C));
t("one lucky like is not trusted", PARTS.quality(P("a", { likesCount: 1 }), ctx(), C) < PARTS.quality(P("a", { likesCount: 6 }), ctx(), C));
t("viral post is capped", PARTS.quality(P("a", { likesCount: 1e6 }), ctx(), C) < 10);

// freshness (3)
t("new beats old (equal)", scorePost(P("n", { createdAt: now - H / 2 }), ctx(), C).score > scorePost(P("o", { createdAt: now - 48 * H }), ctx(), C).score);
t("half-life halves", Math.abs(PARTS.freshness(P("a", { createdAt: now - 18 * H }), ctx(), C) - 0.5) < 0.02);
t("old never zero", PARTS.freshness(P("a", { createdAt: now - 9999 * H }), ctx(), C) >= C.freshness.floor);
t("a great old post can beat a quiet new one", scorePost(P("g", { createdAt: now - 20 * H, likesCount: 80, commentsCount: 30 }), ctx(), C).score > scorePost(P("q", { createdAt: now - 3 * H }), ctx(), C).score);

// relationship (4)
t("followed author is higher", scorePost(P("a"), ctx({ followingIds: { ua: 1 } }), C).score > scorePost(P("a"), ctx(), C).score);
t("mutual is higher than following", scorePost(P("a"), ctx({ followingIds: { ua: 1 }, followerIds: { ua: 1 } }), C).score > scorePost(P("a"), ctx({ followingIds: { ua: 1 } }), C).score);

// interest (5, 6)
const pr = warm(); for (let i = 0; i < 5; i++) learnInterest(pr, P("c", { text: "#cats" }), "like", C, now);
t("matching tag is higher", PARTS.interest(P("a", { text: "#cats" }), ctx({ interests: pr }), C) > PARTS.interest(P("a", { text: "#cars" }), ctx({ interests: pr }), C));
t("interest never above max", PARTS.interest(P("a", { text: "#cats" }), ctx({ interests: pr }), C) <= C.interest.max);
t("interest fades (half in decayDays)", Math.abs(interestValue({ s: 8, t: now - C.interest.decayDays * 864e5 }, now, C.interest.decayDays) - 4) < 1e-6);
const neg = emptyInterests(); learnInterest(neg, P("a", { text: "#cats" }), "hide", C, now);
t("hide never gives a bonus", PARTS.interest(P("a", { text: "#cats" }), ctx({ interests: neg }), C) === 0);

// views (8), not interested (9), penalties
t("seen post goes down", rankPosts([P("1"), P("2")], ctx({ seen: { 1: now } }))[0].id === "2");
t("reported post goes down", rankPosts([P("1", { reportsCount: 3 }), P("2")], ctx())[0].id === "2");
t("not interested pushes the author down", rankPosts([P("1", { uid: "bad" }), P("2")], ctx({ less: { authors: { bad: now }, tags: {} } }))[0].id === "2");
t("low reaction rate loses", PARTS.quality(P("a", { viewsCount: 500 }), ctx(), C) < PARTS.quality(P("a"), ctx(), C));

// re-ordering (10)
const same = []; for (let i = 0; i < 12; i++) same.push(P("s" + i, { uid: i % 2 ? "x" : "y", createdAt: now - i * H }));
for (let i = 0; i < 6; i++) same.push(P("o" + i, { uid: "o" + i, createdAt: now - (i + 12) * H }));
const order = rankPosts(same, ctx());
t("same author not twice in a row", order.every((p, i) => i === 0 || p.uid !== order[i - 1].uid));
t("no post is lost", order.length === same.length && new Set(order.map((p) => p.id)).size === same.length);
t("input is not changed", same[0].id === "s0");

// ads (12-14)
const ad = (id, o = {}) => ({ id, title: id, text: "x", impressions: 500, clicks: 10, ...o });
const never = () => 0.99;
t("ad tags from text", adTags(ad("a", { text: "#shoes" })).join() === "shoes");
t("relevant ad first", pickAdsForSlots([ad("b", { tags: "cars" }), ad("a", { tags: "cats" })], 1, { interests: pr, now }, C, never)[0][0].id === "a");
t("click rate helps", adCtrFactor(ad("h", { clicks: 60 }), 0.02, C) > adCtrFactor(ad("l", { clicks: 1 }), 0.02, C));
const picks = pickAdsForSlots([ad("a"), ad("b")], 6, { now }, C, never);
t("ads: never twice in a row", picks.every((l, i) => i === 0 || l[0].id !== picks[i - 1][0].id));
t("ads: daily cap", pickAdsForSlots([ad("a")], 2, { now, adFreq: { a: C.ads.maxPerDay } }, C, never).length === 0);
t("ads: total cap", pickAdsForSlots([ad("a"), ad("b")], 9, { now, adTotal: C.ads.maxTotalPerDay - 1 }, C, never).length === 1);
t("ads: hidden is never shown", pickAdsForSlots([ad("a"), ad("b")], 1, { now, hidden: new Set(["a"]) }, C, never)[0][0].id === "b");

// cold start (15)
t("no profile key = not cold", coldness({}, C) === 0);
t("empty profile = cold", coldness({ interests: emptyInterests() }, C) === 1);
const hit = P("h", { likesCount: 40, commentsCount: 10 });
t("popular post lifts for a new person", scorePost(hit, { now, interests: emptyInterests() }, C).score > scorePost(hit, { now, interests: warm() }, C).score);


// block / mute (18)
const bm = [P("1", { uid: "bad" }), P("2", { uid: "ok" })];
t("blocked author is removed", rankPosts(bm, ctx({ blocked: { bad: true } })).map((p) => p.id).join() === "2");
t("muted author is removed", rankPosts(bm, ctx({ muted: { bad: now } })).map((p) => p.id).join() === "2");
t("author who blocked me is removed", rankPosts(bm, ctx({ blockedBy: { bad: true } })).map((p) => p.id).join() === "2");
t("a Set and an array work too", rankPosts(bm, ctx({ blocked: new Set(["bad"]) })).length === 1 && rankPosts(bm, ctx({ muted: ["bad"] })).length === 1);
t("false / 0 means not blocked", rankPosts(bm, ctx({ blocked: { bad: false } })).length === 2);
t("my own post is never removed", rankPosts([P("1", { uid: "me" })], ctx({ blocked: { me: true } })).length === 1);
const gone = []; rankPosts(bm, ctx({ blocked: { bad: true } }), C, { onHidden: (post, reason) => gone.push(post.id + ":" + reason) });
t("onHidden says why", gone.join() === "1:blocked");

// spam (19)
const bait = P("b", { text: "Need $20,000? Comment \u201CYES\u201D and check your DMs. First 10,000 only. Make sure you are following me to win", likesCount: 80, commentsCount: 60 });
t("engagement bait is found", spamSeverity(bait, ctx(), C) >= C.spam.hide);
t("engagement bait is not shown", rankPosts([bait, P("2")], ctx()).map((p) => p.id).join() === "2");
const same80 = { likesCount: 80, commentsCount: 60 };
t("a bait phrase lowers the score of a popular post", scorePost(P("a", { text: "Giveaway today", ...same80 }), ctx(), C).score < scorePost(P("a", { text: "Lovely day today", ...same80 }), ctx(), C).score / 2);
t("a normal post has no spam", spamSeverity(P("a", { text: "Went to the lake today, it was lovely #weekend" }), ctx(), C) === 0);
t("link-only post is lowered", spamSeverity(P("a", { text: "https://example.com/x" }), ctx(), C) >= C.spam.link);
t("a link with real text is fine", spamSeverity(P("a", { text: "Read my notes about the match here https://example.com/x" }), ctx(), C) === 0);
t("too many hashtags", spamSeverity(P("a", { text: "hello " + Array.from({ length: 12 }, (_, i) => "#t" + i).join(" ") }), ctx(), C) >= C.spam.hashtags);
t("ALL CAPS shouting", spamSeverity(P("a", { text: "BUY NOW BEST PRICE EVER HURRY UP" }), ctx(), C) >= C.spam.shout);
t("bangla bait is found", spamSeverity(P("a", { text: "ফ্রি টাকা পেতে ইনবক্সে মেসেজ দিন" }), ctx(), C) >= C.spam.hide);
t("my own spammy post is not touched", spamSeverity(P("a", { uid: "me", text: "Giveaway! comment yes" }), ctx(), C) === 0);
t("spam can be switched off", spamSeverity(bait, ctx(), makeConfig({ spam: { enabled: false } })) === 0);
const rep3 = [P("r1", { uid: "x", text: "Buy cheap watches today", createdAt: now - 3 * H }), P("r2", { uid: "x", text: "buy cheap watches today!", createdAt: now - 2 * H }), P("r3", { uid: "y", text: "Buy cheap watches today", createdAt: now - 1 * H })];
const dups = duplicateCounts(rep3);
t("same author repeating the text is found", dups.r2 === 1 && !dups.r1 && !dups.r3);
t("a repeat scores lower", scorePost(rep3[1], ctx({ dupOf: dups }), C).score < scorePost(rep3[1], ctx(), C).score);
t("short texts are never repeats", Object.keys(duplicateCounts([P("a", { uid: "x", text: "hi" }), P("b", { uid: "x", text: "hi" })])).length === 0);

// new-account trust (20)
const newer = P("n", { uid: "stranger", authorCreatedAt: now - H });
const older = P("o", { uid: "stranger", authorCreatedAt: now - 60 * 864e5 });
t("new account is trusted less", trustFactor(newer, ctx(), C) < trustFactor(older, ctx(), C));
t("brand new account = trust.min", Math.abs(trustFactor(P("a", { uid: "z", authorCreatedAt: now }), ctx(), C) - C.trust.min) < 1e-6);
t("old account = full trust", trustFactor(older, ctx(), C) === 1);
t("unknown age = no penalty", trustFactor(P("a", { uid: "z" }), ctx(), C) === 1);
t("age can come from the context", trustFactor(P("a", { uid: "z" }), ctx({ authorCreatedAt: { z: now } }), C) < 1);
t("someone I follow is always trusted", trustFactor(newer, ctx({ followingIds: { stranger: 1 } }), C) === 1);
t("a new account scores lower", scorePost(newer, ctx(), C).score < scorePost(older, ctx(), C).score);
const sameText = { text: "Link ONLY https://example.com/x" };
t("a new account's spam counts more", spamSeverity(P("a", { uid: "z", authorCreatedAt: now, ...sameText }), ctx(), C) > spamSeverity(P("a", { uid: "z", authorCreatedAt: now - 99 * 864e5, ...sameText }), ctx(), C));

// reports hide (21)
t("enough reports hide a post", hiddenReason(P("a", { reportsCount: C.reorder.reportHide }), ctx(), C) === "reports");
t("a few reports only lower it", hiddenReason(P("a", { reportsCount: C.reorder.reportHide - 1 }), ctx(), C) === "");
t("a high report rate hides a post", hiddenReason(P("a", { reportsCount: 4, viewsCount: 60 }), ctx(), C) === "reports");
t("a low report rate does not", hiddenReason(P("a", { reportsCount: 4, viewsCount: 5000 }), ctx(), C) === "");
t("my own reported post is still shown to me", hiddenReason(P("a", { uid: "me", reportsCount: 99 }), ctx(), C) === "");
const fp = filterPosts([P("1", { uid: "bad" }), P("2", { reportsCount: 9 }), P("3")], ctx({ blocked: { bad: true } }), C);
t("filterPosts splits kept and hidden", fp.kept.map((p) => p.id).join() === "3" && fp.hidden.map((h) => h.reason).join() === "blocked,reports");
t("new config values are valid", validateConfig(C).length === 0);
t("bad spam config is found", validateConfig(makeConfig({ spam: { hide: 0 }, trust: { min: 2 } })).length === 2);
t("input list is not changed by filtering", bm.length === 2 && bm[0].id === "1");


// language (22)
const BN = "আজ আমরা সবাই মিলে ঢাকায় ঘুরতে গিয়েছিলাম, খুব সুন্দর একটা দিন কাটালাম";
const EN = "Today we all went out together and had a really lovely day in the city";
t("bangla text is found", detectLanguage(BN) === "bn");
t("english text is found", detectLanguage(EN) === "en");
t("mixed text is found", detectLanguage("আজকের match টা দারুণ ছিল, what a game today ভাই") === "mixed");
t("short text is unknown", detectLanguage("ঠিক আছে") === "" && detectLanguage("ok") === "");
t("hashtags and links are not counted", detectLanguage("#সুন্দর #দিন https://example.com/abc @rahim") === "");
t("bangla first by default", scorePost(P("a", { text: BN }), ctx(), C).score > scorePost(P("a", { text: EN }), ctx(), C).score);
t("bangla post beats an equal english one in the feed", rankPosts([P("en", { text: EN }), P("bn", { text: BN })], ctx())[0].id === "bn");
t("a reader of english gets english first", rankPosts([P("bn", { text: BN }), P("en", { text: EN })], ctx({ languages: ["en"] }))[0].id === "en");
t("reading both = no difference", languageFactor(P("a", { text: BN }), ctx({ languages: ["bn", "en"] }), C) === languageFactor(P("a", { text: EN }), ctx({ languages: ["bn", "en"] }), C));
t("languages can be an object or a Set", languageFactor(P("a", { text: EN }), ctx({ languages: { en: true } }), C) === 1 + C.language.match && languageFactor(P("a", { text: EN }), ctx({ languages: new Set(["en"]) }), C) === 1 + C.language.match);
t("a post with unknown language is not changed", languageFactor(P("a", { text: "ok" }), ctx(), C) === 1);
t("post.lang beats the guess", languageFactor(P("a", { text: EN, lang: "bn" }), ctx(), C) === 1 + C.language.match);
t("mixed gets a small bonus", languageFactor(P("a", { text: "আজকের match টা দারুণ ছিল, what a game today ভাই" }), ctx(), C) === 1 + C.language.mixed);
t("people I follow are not lowered", languageFactor(P("a", { text: EN, uid: "f" }), ctx({ followingIds: { f: 1 } }), C) === 1);
t("my own post is not changed", languageFactor(P("a", { text: EN, uid: "me" }), ctx(), C) === 1);
t("language can be switched off", languageFactor(P("a", { text: EN }), ctx(), makeConfig({ language: { enabled: false } })) === 1);
t("language config is valid", validateConfig(C).length === 0 && validateConfig(makeConfig({ language: { mismatch: 0, enShare: 0.9 } })).length === 2);

// video watch time (23)
const vid = (o = {}) => P("v", { videoURL: "https://x/v.mp4", videoDuration: 20, playsCount: 100, ...o });
t("a video is a kind of its own", kindOf(vid()) === "video");
t("a watched video is better", watchFactor(vid({ watchTimeMs: 100 * 18000 }), C) > watchFactor(vid({ watchTimeMs: 100 * 2000 }), C));
t("a video nobody watches is lowered", watchFactor(vid({ watchTimeMs: 0 }), C) === C.watch.min);
t("a very good video gets the maximum", Math.abs(watchFactor(vid({ watchTimeMs: 100 * 20000 }), C) - C.watch.max) < 1e-9);
t("too few plays = no change", watchFactor(vid({ playsCount: 3, watchTimeMs: 0 }), C) === 1);
t("no watch data = no change", watchFactor(vid({ watchTimeMs: undefined }), C) === 1);
t("not a video = no change", watchFactor(P("a", { playsCount: 100, watchTimeMs: 0 }), C) === 1);
t("looping cannot beat the maximum", watchFactor(vid({ watchTimeMs: 100 * 90000 }), C) <= C.watch.max);
t("watch time lifts the video in the feed", rankPosts([P("x", { uid: "x" }), vid({ id: "good", uid: "g", watchTimeMs: 100 * 19000 }), vid({ id: "bad", uid: "b", watchTimeMs: 100 * 1000 })], ctx()).map((p) => p.id).indexOf("good") < rankPosts([P("x", { uid: "x" }), vid({ id: "good", uid: "g", watchTimeMs: 100 * 19000 }), vid({ id: "bad", uid: "b", watchTimeMs: 100 * 1000 })], ctx()).map((p) => p.id).indexOf("bad"));
t("watching to the end", watchAction(vid(), 19000, C) === "watchFull");
t("watching half", watchAction(vid(), 11000, C) === "watch");
t("scrolling past teaches nothing", watchAction(vid(), 2000, C) === "");
t("not a video teaches nothing", watchAction(P("a"), 99999, C) === "");
t("unknown length: 15 seconds count", watchAction(vid({ videoDuration: 0 }), 16000, C) === "watch" && watchAction(vid({ videoDuration: 0 }), 5000, C) === "");
const pv = emptyInterests();
t("watching a video teaches my profile", learnInterest(pv, vid({ uid: "vv", text: "#clips" }), watchAction(vid(), 19000, C), C, now) === true && pv.authors.vv.s > 0 && pv.kinds.video.s > 0);
t("scrolling past does not touch my profile", learnInterest(emptyInterests(), vid(), watchAction(vid(), 1000, C), C, now) === false);
t("watch config is valid", validateConfig(C).length === 0 && validateConfig(makeConfig({ watch: { halfAt: 0.95, min: 3 } })).length === 2);


// adult content (24)
const lvl = (o) => adultCheck(P("a", o), C).level;
t("a blocked word blocks the post", lvl({ text: "Watch the full porn video here" }) === "blocked");
t("xxx blocks", lvl({ text: "xxx" }) === "blocked");
t("leet speak is read (p0rn)", lvl({ text: "free p0rn clips" }) === "blocked");
t("stretched words are read (pornnnn)", lvl({ text: "pornnnn clips" }) === "blocked" && lvl({ text: "sexxxx video" }) === "blocked");
t("plural is found (nudes)", lvl({ text: "send nudes" }) === "blocked");
t("a phrase blocks (sex video)", lvl({ text: "Leaked sex video link in comments" }) === "blocked");
t("18+ blocks", lvl({ text: "Group for 18+ only" }) === "blocked" && lvl({ text: "18 plus videos" }) === "blocked");
t("the number 18 alone is fine", lvl({ text: "I turned 18 years old today, thank you everyone" }) === "ok");
t("whole words only (Essex, Sussex)", lvl({ text: "We visited Essex and Sussex last summer by train" }) === "ok");
t("bangla blocked word", lvl({ text: "পর্ন ভিডিও দেখুন এখানে" }) === "blocked" && lvl({ text: "সেক্স ভিডিও লিংক কমেন্টে" }) === "blocked");
t("bangla word with an ending is found", lvl({ text: "এই পর্নোগ্রাফির বিরুদ্ধে আমরা" }) === "blocked");
t("a normal bangla post is fine", lvl({ text: BN }) === "ok");
t("one mild word only lowers", lvl({ text: "Sexy new shoes on sale today" }) === "mild");
t("a news-like post is only lowered", lvl({ text: "A talk about sex education in schools" }) === "mild");
t("three mild words together block", lvl({ text: "sexy hot girls in bikini" }) === "blocked");
t("a mild post scores lower", scorePost(P("a", { text: "Sexy new shoes on sale today" }), ctx(), C).score < scorePost(P("a", { text: "Lovely new shoes on sale today" }), ctx(), C).score);
t("the nsfw / adult flag blocks", lvl({ nsfw: true }) === "blocked" && lvl({ adult: true }) === "blocked");
t("a label blocks", lvl({ labels: ["Adult"] }) === "blocked" && lvl({ labels: { nsfw: true } }) === "blocked" && lvl({ labels: ["cats"] }) === "ok");
t("adultScore from a checking service", lvl({ adultScore: 0.9 }) === "blocked" && lvl({ adultScore: 0.5 }) === "mild" && lvl({ adultScore: 0.1 }) === "ok");
t("reports with an adult reason block quickly", lvl({ reportReasons: { adult: 2 } }) === "blocked" && lvl({ reportReasons: { sexual: 1 } }) === "mild" && lvl({ reportReasons: { spam: 9 } }) === "ok");
t("the caption and the poll are read", lvl({ caption: "free porn" }) === "blocked" && lvl({ poll: { options: { 0: { text: "xxx" }, 1: { text: "b" } } } }) === "blocked");
t("a blocked post is not in the feed", rankPosts([P("1", { text: "watch porn here" }), P("2")], ctx()).map((p) => p.id).join() === "2");
t("a followed author is not an exception", rankPosts([P("1", { uid: "f", text: "watch porn here" }), P("2")], ctx({ followingIds: { f: 1 } })).map((p) => p.id).join() === "2");
t("popular adult posts do not win", rankPosts([P("1", { text: "free porn", likesCount: 900, commentsCount: 400 }), P("2")], ctx()).map((p) => p.id).join() === "2");
t("my own post is not taken out of my feed", hiddenReason(P("a", { uid: "me", text: "porn" }), ctx(), C) === "");
t("a flagged account is hidden", hiddenReason(P("a", { uid: "bad" }), ctx({ adultAuthors: { bad: true } }), C) === "adultAuthor");
const tooMany = [P("1", { uid: "z", text: "porn 1" }), P("2", { uid: "z", text: "porn 2" }), P("3", { uid: "z", text: "porn 3" }), P("4", { uid: "z", text: "A nice walk today" }), P("5", { uid: "ok" })];
const seenWhy = []; const left = rankPosts(tooMany, ctx(), C, { onHidden: (post, reason) => seenWhy.push(reason) });
t("an author with many blocked posts loses the rest too", left.map((p) => p.id).join() === "5" && seenWhy.filter((r) => r === "adult").length === 3 && seenWhy.includes("adultAuthor"));
t("one blocked post does not take the author", rankPosts([P("1", { uid: "z", text: "porn" }), P("2", { uid: "z", text: "A nice walk today" })], ctx()).map((p) => p.id).join() === "2");
t("an adult ad is never shown", adAllowed({ id: "ad", title: "Hot girls chat", text: "sexy xxx" }, {}, C) === false && adAllowed({ id: "ad2", title: "Shoes", text: "new shoes" }, {}, C) === true);
t("adult filter can be switched off", adultCheck({ text: "porn" }, makeConfig({ adult: { enabled: false } })).level === "ok");
t("adult word lists can be extended", adultCheck({ text: "banned thing" }, makeConfig({ adult: { strongWords: ["banned thing"] } })).level === "blocked");
t("adult config is valid", validateConfig(C).length === 0 && validateConfig(makeConfig({ adult: { mildPenalty: 2, scoreMild: 0.9 } })).length === 2);
t("the reason is given", adultCheck({ text: "free porn" }, C).reasons[0] === "word:porn");

// safety and speed
const junk = [null, undefined, 5, "x", {}, { id: "z" }, P("ok", { likesCount: "abc", createdAt: "yesterday" }), P("nan", { likesCount: NaN })];
let crashed = false; let r = []; try { r = rankPosts(junk, ctx()); } catch (e) { crashed = true; }
t("broken posts never crash", !crashed && r.length >= 3);
t("scores are always numbers", [P("a"), P("b", { likesCount: -5 }), P("c", { createdAt: now + 9e9 })].every((p) => Number.isFinite(scorePost(p, ctx(), C).score)));
const many = []; for (let i = 0; i < 400; i++) many.push(P("m" + i, { uid: "a" + (i % 40), likesCount: i % 17, createdAt: now - i * H / 4 }));
const t0 = Date.now(); rankPosts(many, ctx()); t("400 posts rank in under 100 ms", Date.now() - t0 < 100);
t("same input = same order", JSON.stringify(rankPosts(many, ctx()).map((p) => p.id)) === JSON.stringify(rankPosts(many, ctx()).map((p) => p.id)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);