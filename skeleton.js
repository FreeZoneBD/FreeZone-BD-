// FreeZone BD - grey shimmering placeholders shown while a page loads (instead of the word "Loading...").
// They have the shape of the real page, so it feels like the page is already open and only the details are arriving.
// The shimmer comes from the .skeleton style in feed.html.
const bar = (w, h = "h-3.5") => `<div class="skeleton ${h} ${w} rounded"></div>`;

// Profile page: photo, name, numbers, tabs and a grid of pictures
export function profileSkeleton() {
  return `
    <div class="px-5 pt-4 pb-3" role="status" aria-label="Loading profile">
      <div class="flex items-start gap-4">
        <div class="min-w-0 flex-1 pt-3 space-y-3">
          ${bar("w-44", "h-7")}
          ${bar("w-28", "h-4")}
          <div class="flex gap-7 pt-3">
            ${[0, 1, 2].map(() => `<div class="space-y-1.5">${bar("w-9", "h-5")}${bar("w-14", "h-3")}</div>`).join("")}
          </div>
        </div>
        <div class="skeleton w-[104px] h-[104px] rounded-full flex-shrink-0"></div>
      </div>
      <div class="mt-4 space-y-2">${bar("w-full")}${bar("w-4/5")}</div>
      <div class="flex gap-3 mt-4">
        <div class="skeleton h-10 flex-1 rounded-xl"></div>
        <div class="skeleton h-10 flex-1 rounded-xl"></div>
      </div>
    </div>
    <div class="flex border-b border-slate-border">
      ${[0, 1, 2].map(() => `<div class="flex-1 py-3 flex justify-center"><div class="skeleton h-4 w-14 rounded"></div></div>`).join("")}
    </div>
    <div class="grid grid-cols-3 gap-0.5 mt-0.5">
      ${Array.from({ length: 9 }).map(() => `<div class="skeleton aspect-square"></div>`).join("")}
    </div>`;
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

// Post cards (hashtag page, saved posts): same shape as the feed placeholders
export function postSkeleton(count = 2) {
  return `<div class="space-y-3" role="status" aria-label="Loading posts">${Array.from({ length: count })
    .map(() => `
      <div class="bg-slate-surface border-b border-slate-border px-4 py-3 space-y-3">
        <div class="flex items-center gap-3">
          <div class="skeleton w-11 h-11 rounded-full"></div>
          <div class="space-y-2 flex-1">${bar("w-32")}${bar("w-20", "h-3")}</div>
        </div>
        ${bar("w-full", "h-4")}
        ${bar("w-4/5", "h-4")}
        <div class="skeleton h-44 w-full rounded-xl"></div>
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
