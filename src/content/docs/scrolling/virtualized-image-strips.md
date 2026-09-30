---
title: Virtualizing a Long Strip of Images
description: Why a continuous strip must virtualize, sizing items before they decode, round-trip arithmetic, and gap-free device-pixel rounding.
tags: [scrolling, virtualization, images]
sidebar:
  order: 1
---

By strip I mean a webtoon-style continuous column of images: one tall picture cut into slices, scrolled vertically. Writing the scroll position from code is covered in [writing `scrollTop`](/scrolling/scroll-writes/).

## A continuous strip has to be virtualized

A webtoon slice of 800 by 10000 is normal, and a chapter has dozens of them. So a continuous renderer has to mount only what's visible. Browsers also cap canvas and texture sizes, so a single tall slice might not decode in one piece.

## Assume, then refine, and keep the anchor independent of both

When the real value is too expensive to get up front (an image's height before it decodes), assume a safe default and recompute as the real values come in. Never decode everything just to get one value for each item.

In my case, the paged viewer can show two pages side by side as a spread, and how it pairs pages into spreads depends on each image's orientation. Measuring every image to decide how to pair pages would mean decoding 182 images before drawing a single one. Instead, *assume* an image I haven't measured is portrait, record sizes as pages get *shown* (the display reports what it loaded), and recompute the grouping. Even better, read the real sizes from the [image headers](/images/image-formats/) at open. That costs a few kilobytes per image instead of a decode, so the guess only lasts until the headers arrive.

The recompute moves everything. So whatever the reader is anchored to can't be expressed in the units that moved. Keep the reader's position as an image index so it survives the recompute. An image index survives. A scroll offset doesn't.

The general pattern: assume a safe default, refine as real data comes in, and make the thing that has to survive independent of the refining.

## A frame of zero height puts every item in the window

On a virtualized list's first render, the scroller hasn't been measured yet. So the frame is 0 × 0, the width is 0, and every item lays out at height 0 at top 0. A range test of `top + height >= scrollTop` over a viewport of zero height then matches *all* of them, and the window mounts the whole list for one frame.

If each mount starts a load (reading an archive entry and creating an object URL), a 40-item list does 40 reads at open. Those extra items are gone before a `MutationObserver` callback receives them, so counting DOM nodes only shows the ones that stayed. Counting the loads (for example `URL.createObjectURL` calls) shows what really happened. A window over a frame with no size has to be empty, not everything.

Mounted items can also reload for no reason. In Svelte, a keyed each whose layout builds fresh objects on every scroll re-runs each item's load effect and decodes its bitmap again. That's in [Svelte 5 effects](/svelte/effects/).

## A virtual window must be taken where the scroller is about to be

A virtualization window computed from the last scroll event lags behind any scroll the code is about to write: an opening position, a correction after an item above the anchor gets measured, a zoom. For one render it mounts items at the old scroll position, and each mount may do real work (read an archive entry, decode an image). When a scroll write is coming, compute the window from the position you're about to write. Only use the reported scroll when no write is pending.

A drag that has to keep its anchor row mounted pins the window the other way; see [a marquee over a scroller](/interaction/selection-marquee/).

## Pick one representative on a boundary

The strip keeps its reading position as a slice index plus a fraction into that slice, and converts it to a scroll offset and back all the time. A scroll offset exactly on the join between two slices is both "the end of this one" and "the start of the next one". Picking one of the two (the later slice at fraction zero) is what makes a position convert to an offset and back exactly, not approximately. Without a fixed choice, the two directions differ by one slice at every boundary.

## Return an empty range as `first: 0, last: -1`

The virtual window is a range of item indices, from a first index to a last index, both inclusive. Sometimes it has to be empty (over a frame with no size, for example). Give the empty range the same form as any other, with a last index one below the first. Then an inclusive `for` loop runs zero times, and `slice(first, last + 1)` is empty. Returning null forces every caller to branch first. That branch only ever runs in the edge case, which is exactly where it'll be wrong.

## Why device pixels matter for a strip, and not for pages

A strip is *one* tall picture cut into slices. The artwork continues across each cut, so the join has to be invisible. That's the whole difference from paged content, where pages are separated by a gutter and a shadow on purpose. There, when two boxes differ by less than a pixel, the gap hides it, and that gap was going to be there anyway.

**Where the gap comes from.** A slice is scaled to the container width, and that scale is almost never a round number. An 800-pixel-wide slice in a 943-pixel column is scaled by 1.17875. So every slice's height ends up on a fractional CSS pixel. When the browser rasterizes two stacked boxes, it rounds each edge to the device pixel grid separately. Depending on which way each edge rounds, the boundary can fall one device pixel short, and the page background shows through the artwork as a hairline.

**Why a reader cannot forgive it.** The gap is a real artifact, and it doesn't look like a rendering bug. It looks like a damaged scan, repeated at every cut, dozens of times per chapter. The reader blames the file. So a continuous renderer has to round to device pixels.

**Why CSS pixels are not enough.** On a 2x display, half a CSS pixel *is* a device pixel, and that's a visible line. And on a display with fractional scaling, 1.25 or 1.5, a whole CSS pixel isn't on a device pixel boundary at all. The grid that matters is the device's.

**Round the cumulative tops, not the individual heights.** If you round each height separately, each slice can be off by up to half a device pixel. Those errors *add up* down a long strip, so the rendered total drifts away from the computed layout, and the computed layout is what a scroll position is measured against.

Round each offset instead, and take the difference:

```ts
const snap = (v: number) => Math.round(v * devicePixelRatio) / devicePixelRatio;
const height = snap(layout[i + 1].top) - snap(layout[i].top);
```

Then the sum collapses exactly to `snap(lastTop) - snap(firstTop)`, so nothing drifts. And each slice's bottom *is* the next slice's top, so a gap is arithmetically impossible.
