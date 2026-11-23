// FreeZone BD - grey shimmering placeholders shown while a page loads (instead of the word "Loading...").
// They have the shape of the real page, so it feels like the page is already open and only the details are arriving.
// The shimmer comes from the .skeleton style in theme.css (soft light sweep over the card colour).
const bar = (w, h = "h-3.5") => `<div class="skeleton ${h} ${w} rounded"></div>`;

// Profile page: same shape as the new profile (cover, round photo over the cover, buttons, name, chips, numbers card, tabs, grid)
export function profileSkeleton() {
  return `
    <div role="status" aria-label="Loading profile">
    <div class="skeleton w-full" style="aspect-ratio:2.2/1;border-radius:0;"></div>
    <div class="px-4 pb-3" style="margin-top:-46px;position:relative;">
      <div class="flex items-end justify-between">
        <div class="rounded-full flex-shrink-0" style="width:96px;height:96px;padding:3px;background:rgb(var(--c-background));"><div class="skeleton w-full h-full rounded-full"></div></div>
        <div class="flex gap-1.5 pb-1">
          <div class="skeleton h-10 w-28 rounded-full"></div>
          <div class="skeleton h-10 w-10" style="border-radius:14px;"></div>
        </div>
      </div>
      <div class="mt-3 space-y-2">${bar("w-44", "h-6")}${bar("w-28", "h-3.5")}</div>
      <div class="mt-3 space-y-2">${bar("w-full")}${bar("w-3/5")}</div>
      <div class="flex gap-2 mt-3">
        <div class="skeleton h-7 w-32 rounded-full"></div>
        <div class="skeleton h-7 w-28 rounded-full"></div>
      </div>
      <div class="skeleton mt-4 h-[66px] w-full" style="border-radius:18px;"></div>
    </div>
    <div class="flex border-b border-slate-border">
      ${[0, 1, 2].map(() => `<div class="flex-1 py-3 flex justify-center"><div class="skeleton h-5 w-5 rounded"></div></div>`).join("")}
    </div>
    <div class="grid grid-cols-3 gap-0.5 mt-0.5">
      ${Array.from({ length: 9 }).map(() => `<div class="skeleton aspect-square" style="border-radius:0;"></div>`).join("")}
    </div></div>`;
}

// Comments: a small round photo and two lines of text, a few times
export function commentSkeleton(count = 5) {
  return `<div class="px-4 py-3 space-y-5" role="status" aria-label="Loading comments">${Array.from({ length: count })
    .map((_, i) => `
      <div class="flex gap-3">
        <div class="skeleton w-9 h-9 rounded-full flex-shrink-0"></div>
        <div class="flex-1 space-y-2 pt-0.5">${bar("w-28", "h-3")}${bar(i % 2 ? "w-3/4" : "w-full")}</div>
      </div>`)
    .join("")}</div>`;
}

// Post cards (hashtag page, saved posts): same shape as the new feed placeholders
export function postSkeleton(count = 2) {
  return `<div role="status" aria-label="Loading posts">${Array.from({ length: count })
    .map((_, i) => `
      <div class="px-4 py-3 space-y-3" style="border-bottom:8px solid rgb(var(--c-background));background:rgb(var(--c-slate-surface));">
        <div class="flex items-center gap-3">
          <div class="skeleton rounded-full" style="width:42px;height:42px;"></div>
          <div class="space-y-2 flex-1">${bar("w-32")}${bar("w-20", "h-3")}</div>
        </div>
        ${bar("w-full", "h-4")}
        ${bar(i % 2 ? "w-3/5" : "w-4/5", "h-4")}
        ${i % 2 ? "" : `<div class="skeleton h-52 -mx-4" style="border-radius:0;"></div>`}
        <div class="flex items-center gap-2 pt-1"><div class="skeleton h-8 w-16 rounded-full"></div><div class="skeleton h-8 w-14 rounded-full"></div><div class="skeleton h-8 w-9 rounded-full"></div><div class="flex-1"></div><div class="skeleton h-8 w-9 rounded-full"></div></div>
      </div>`)
    .join("")}</div>`;
}

// A short list of people / items: round photo and two lines (blocked accounts, story viewers, music...)
export function rowSkeleton(count = 4) {
  return `<div class="px-3 py-2 space-y-4" role="status" aria-label="Loading">${Array.from({ length: count })
    .map((_, i) => `
      <div class="flex items-center gap-3">
        <div class="skeleton w-11 h-11 rounded-full flex-shrink-0"></div>
        <div class="flex-1 space-y-2">${bar(i % 2 ? "w-2/5" : "w-1/2")}${bar("w-1/3", "h-3")}</div>
      </div>`)
    .join("")}</div>`;
}

// A form: a round photo and a few fields (Edit profile, Boost post)
export function formSkeleton(fields = 3) {
  return `<div class="px-5 py-6 space-y-5" role="status" aria-label="Loading">
    <div class="flex justify-center"><div class="skeleton w-24 h-24 rounded-full"></div></div>
    ${Array.from({ length: fields }).map(() => `<div class="space-y-2">${bar("w-24", "h-3")}<div class="skeleton h-11 w-full rounded-xl"></div></div>`).join("")}
  </div>`;
}
