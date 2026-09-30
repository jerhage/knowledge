---
title: The Continuous Strip (Webtoon Mode)
description: "How `ContinuousViewer` virtualizes a long strip, rounds slice tops to device pixels, keeps a fling alive while slices load, and owns its pinch."
tags: [dokseo, scrolling, virtualization, images, svelte, svelte-5, mobile]
sidebar:
  order: 41
---

In Dokseo, my manga and book reader, webtoon mode shows an image book as one long vertical strip that you scroll, instead of pages you turn. A webtoon is drawn as one tall picture cut into slices, so the slices are stacked with no gap and the artwork continues across each cut. The component is `ContinuousViewer`, one vertical scroller over the column of slices. A book can have dozens of tall slices, so the strip is virtualized: only the slices near the viewport are mounted. The general techniques are in [virtualizing a long strip](/scrolling/virtualized-image-strips/) and [writing `scrollTop`](/scrolling/scroll-writes/).

## Layout and hairline gaps

Each slice is scaled to the width of the column. That scale is almost never a round number: an 800 px slice in a 943 px column is scaled by 1.17875, so its height lands on a fractional pixel. The browser rounds each box's edges to device pixels separately, and when two neighbors round apart, the page background shows through the artwork as a hairline. In a webtoon that looks like a damaged scan.

So the strip rounds each slice's cumulative top to device pixels and makes each height the difference between two rounded tops. Then each slice's bottom is exactly the next one's top, and the total never drifts from the layout that scroll positions are measured against. The reasoning, and the two-line `snap`, are in [why device pixels matter for a strip](/scrolling/virtualized-image-strips/#why-device-pixels-matter-for-a-strip-and-not-for-pages). The paged viewer doesn't need this, because pages have a gutter between them that already hides any sub-pixel gap.

The mounted slices come from `spacersFor`, which turns the layout into `PlacedSlice` objects for the current window. The markup is a keyed each over them, and each slice is drawn by `PageFrame`, the same component the paged viewer uses:

```svelte
{#each spacers.slices as slice (slice.index)}
```

## The ten extra decodes

The first sign of trouble was a "Loading…" label appearing over a slice I was already looking at, every time I scrolled.

This was back when the strip drew its slices on canvases, so every load decoded a bitmap. `spacersFor` builds new `PlacedSlice` objects every time it runs, and the strip reruns it on every scroll event. In a keyed each, `slice` is one reactive value holding the whole object, so anything that reads `slice.index` depends on the object, not on the number. `PageFrame` got `index={slice.index}`, and its load effect read `index`. So on every scroll event the effect ran again, even though the index hadn't changed. It reset its `phase` to `'loading'`, which showed the label, and decoded the bitmap again.

I put a temporary probe on `imageAt`, the prop `PageFrame` loaded through at the time. With two mounted canvases, five scroll events made ten extra decodes before the fix and none after. The fix in `PageFrame` is a `$derived` on the field, which only counts as changed when the number changes:

```ts
const asked = $derived(index);
```

The mechanism is in [a keyed each item is one signal holding the whole object](/svelte/effects/#a-keyed-each-item-is-one-signal-holding-the-whole-object). The paged viewer never showed this, because its each is keyed on the item itself (`{#each pages as index (index)}`), and then Svelte doesn't create the item signal at all.

The load call itself is untracked too. The prop was passed as `imageAt={(index) => view.imageAt(index)}`, and `await imageAt(wanted)` inside the effect would otherwise make the effect depend on whatever the call reads before its first `await`. See [an effect tracks a prop it merely calls](/svelte/effects/#an-effect-tracks-a-prop-it-merely-calls).

## Forty reads at open

Mounting a slice isn't free. Each mount calls `pictureAt`, and for an archive, `picture()` reads the entry from the archive and creates an object url.

On the strip's first render the scroller hasn't been measured yet. The frame is 0 × 0, so every slice is laid out at height 0 at top 0, and a zero-height viewport at top 0 overlaps all of them. So for one frame the window mounted the whole book: on a 40-slice book, 40 entry reads at open. Counting DOM nodes with a `MutationObserver` only showed 6, because the rest were unmounted before the callback ran. Counting `URL.createObjectURL` calls for untyped blobs showed the real 40. A window over a frame with no size now mounts nothing. General version: [a frame of zero height puts every item in the window](/scrolling/virtualized-image-strips/#a-frame-of-zero-height-puts-every-item-in-the-window).

## Keeping a fling alive

The strip keeps your reading position as a slice index plus a fraction into that slice. When the layout changes (a slice finishes loading and gets its real height, or the zoom changes), it writes `scrollTop` to put that position back where it was.

The browser's own [scroll anchoring](/scrolling/scroll-writes/#the-browser-anchors-scrolling-too-and-it-conflicts-with-a-restore), in Chromium, Firefox and recently Safari, conflicts with that, because it also adjusts `scrollTop` when content above the viewport changes size. Two corrections for one change land in the wrong place, and `overflow-anchor: none` on the scroller turns the browser's off. And [assigning `scrollTop` during a fling kills the fling](/scrolling/scroll-writes/#assigning-scrolltop-during-a-fling-kills-the-fling): you flick the strip, and it stops dead. So the strip skips any write that wouldn't change anything.

The write I didn't see coming was the slice under the top of the viewport loading. Until it loads, it's laid out at an assumed height. When it loads, keeping the same fraction means a new offset: 0.3 of 585 px becomes 0.3 of 1170 px, a 175 px jump, written in the middle of the fling. It happens exactly when loading falls behind a fast scroll. So you'd flick through a chapter, loading would lag, and the strip would stop each time a slice caught up.

In that case the right thing to keep is pixels, not the fraction: you were looking at an empty box, and if its top edge stays still, nothing on screen moves. So after a scroll you made, `relayoutFor` compares the anchor slice's top edge (and the width) with what they were, and only requests a write if they moved. A slice above the anchor that changes height still needs a write. Details in [an item measured as the anchor is a write the reader never asked for](/scrolling/scroll-writes/#an-item-measured-as-the-anchor-is-a-write-the-reader-never-asked-for).

None of this shows on a desktop, where Chromium loads a slice in about 10 ms. It only showed up in a probe that ran a real touch fling in Chromium with the CPU throttled 6× and 10×, counting `scrollTop` writes. The setup is in [a throttled Chromium fling stands in for a phone's slow decode](/scrolling/scroll-writes/#a-throttled-chromium-fling-stands-in-for-a-phones-slow-decode).

## Taking the window where the scroll is going

The window of mounted slices is computed from a scroll position. Normally that's the scroller's reported `scrollTop` from the last scroll event. But when the strip is about to write a new `scrollTop` (the opening place, a follow after a slice above the anchor gets measured, a zoom), the reported value is about to be wrong. A window computed from it mounts slices at the old position for one render, and each of those mounts is an archive read.

So `windowScrollTop` in `strip.ts` switches between the two. When `relayoutFor` returns that a write is due, it uses the position the strip is holding. Only while the anchor holds still does it use the reported scroll. See [a virtual window must be taken where the scroller is about to be](/scrolling/virtualized-image-strips/#a-virtual-window-must-be-taken-where-the-scroller-is-about-to-be).

## Opening mid-book: 14625 clamped to 3869

Opening a book in the middle should scroll the strip straight to your saved place. Instead it landed far short.

`ContinuousViewer` read the frame's size in one `$effect` and wrote the opening `scrollTop` in a later one. The first effect changed state, which marked the second one to run in the same flush, so it ran before the template had redrawn with the new size. The strip was still drawn at width 0, with a scroll height of 4680 px, so the browser clamped the write of 14625 down to 3869. The window then loaded slices at 3869.

Moving the size read to `$effect.pre` fixed it, because pre-effects update the DOM before any user effect runs. I found it with a probe that logs the scroller's `scrollHeight` at each `scrollTop` write. The rule is in [a user effect that sets state runs the next user effect before the DOM catches up](/svelte/effects/#a-user-effect-that-sets-state-runs-the-next-user-effect-before-the-dom-catches-up).

## The `start` prop

The parent passes `ContinuousViewer` its starting place in a `start` prop. The viewer read it once, inside `untrack`, to set its scroll anchor, and from then on only followed its own `onscroll`. So when the parent set a new position later, every number on screen changed, and the strip didn't move.

The fix is an effect that tracks `start` and nothing else. My first version also had the layout in its dependencies, and then it fired in the middle of a zoom, where the anchor is deliberately ahead of the reported position, and dragged the view back. See [an untracked prop is a one-way door](/svelte/state-and-props/#an-untracked-prop-is-a-one-way-door-until-something-re-reads-it).

## Selecting over the strip

Capture works in the strip too: you drag a box over the slices. The box is drawn in screen coordinates, but the content under it can scroll during the drag, for example when the drag auto-scrolls at the edge. So the base marquee keeps the pressed point and adds up scroll deltas through `followScroll(by)`. The strip only passes deltas for scrolls you made, not for its own relayout writes, because a relayout write keeps the content still under the anchor.

The slice where the drag started can also scroll out of the window and be unmounted, taking its measurements with it. So while a drag lasts, `windowReaching` stretches the mounted window to keep that slice in the DOM. The pattern is [a marquee over a scroller](/interaction/selection-marquee/#a-marquee-over-a-scroller-anchor-by-scroll-delta-and-pin-the-window).

## The strip owns its pinch

On a phone, a pinch on the strip should zoom the strip, and a pinch anywhere else shouldn't zoom the app. At first the strip used the browser's native pinch-zoom. That's why `.reader-screen`, the screen root, couldn't be `touch-action: pan-x pan-y`: that value turns off pinch-zoom for everything inside, the strip included. Now the strip handles its own pinch, `.reader-screen` is `pan-x pan-y`, and a pinch on the header no longer zooms the app. The paged side of this is in [the paged viewer](/projects/dokseo/image-reader/paged-viewer/#touch).

Handling it has one constraint. The strip is a scroller, so it has to keep a `touch-action` that allows panning, and `touch-action` is read once, when the finger goes down. It can't be changed when a long press fires 400 ms later, or when a second finger arrives. What still works is canceling the `touchmove` events before the browser starts a scroll. So the strip adds a `touchmove` listener with `addEventListener(..., { passive: false })` (Svelte's `ontouchmove` is passive, and a passive listener can't cancel). It cancels the move once a long press has started, and when `touches.length > 1`, so two fingers pinch instead of panning. The details are in [a long press on a scroller holds the scroll](/interaction/wheel-and-touch/#a-long-press-on-a-scroller-holds-the-scroll-from-a-non-passive-touchmove).

To check it, a probe pinches with Playwright's CDP two-finger touch and reads `visualViewport.scale`. The same pinch on the library screen took the scale to 5, so the emulated pinch does zoom a normal page, and a scale of 1 on the reader is real evidence.

## Overscroll

When you pan a zoomed page and hit its edge, continuing past the edge can turn the page. Computing that from an "at the edge" flag goes wrong, so Dokseo uses the travel the clamp threw away: pan the viewport from where the gesture started, clamp it, and whatever part of the finger's movement didn't happen is the overscroll. A related surprise: a clamp that centers content narrower than the frame makes the point under your fingers slide sideways at the start of a pinch-out from a fit-height page. That's the clamp working as designed. Both are in [overscroll is the travel the clamp threw away](/interaction/wheel-and-touch/#overscroll-is-the-travel-the-clamp-threw-away).

## Where the logic lives

The strip's zoom and its reading position used to be state in `ContinuousViewer`'s script. Now they're in `StripZoom` (`viewing/ui/strip-zoom.svelte.ts`), a view model, which is a small class with runes. It holds the zoom, the hold (the reading position plus the offsets the strip keeps still through a relayout) and the reading anchor, and it lays out the slices at the zoomed width. The arithmetic of the hold is pure, in `strip-hold.ts`: where the hold lands after a scroll or a pinch about a point, and which scroll position puts it back. `StripZoom` takes a function for the slice sizes and the frame width instead of an element, so its spec runs in bare Node.

The capture drag has a loop of its own. While you drag a box near the top or bottom edge of the strip, the strip scrolls by itself, faster the closer the pointer gets to the edge. That loop is `EdgeScroll` in `edge-scroll-loop.ts`, with the speed math pure in `edge-scroll.ts`. It gets its animation frames from a `FrameClock` (`shared/frame-clock.ts`), an object with `request` and `cancel` whose default wraps `requestAnimationFrame`. Its spec passes a fake clock and steps the frames by hand. The general split is on [what a view model still holds](/projects/dokseo/architecture/data-components-and-view-models/#what-a-view-model-still-holds).
