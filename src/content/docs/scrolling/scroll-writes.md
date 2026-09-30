---
title: "Writing scrollTop: Echoes, Anchoring and Flings"
description: Telling your own scroll events apart, turning off browser anchoring, and not killing a fling with a no-op write.
tags: [scrolling, virtualization, mobile]
sidebar:
  order: 2
---

All of these came up in a [virtualized strip](/scrolling/virtualized-image-strips/) that keeps its position as an item index and writes `scrollTop` to hold it there.

## A programmatic scroll is told apart by the value it wrote

The strip's scroll handler updates the kept position when the reader scrolls. But the strip also writes `scrollTop` itself, and a scroll event caused by its own write must not be treated as the reader moving.

Writing `scrollTop` fires the same event a finger does. So record the value the write ended up at (read it *back* off the element, so any clamping is included) and compare against it in the handler.

Don't use a boolean flag. A write that changes nothing fires no event, so the flag stays set and eats the next real scroll. A recorded value can't get stuck like that, because the next event with a different value can't have come from your write.

## The browser anchors scrolling too, and it conflicts with a restore

Chromium adjusts `scrollTop` on its own when content above the viewport changes size. That's scroll anchoring. Firefox does it too, and Safari only shipped it recently. It kicks in exactly when a virtualized list is restoring the position it holds. Now there are two corrections for one event, and the scroll lands in the wrong place. `overflow-anchor: none` on the scroller turns the browser's anchoring off.

## Assigning `scrollTop` during a fling kills the fling

A fling is the momentum scroll that keeps going after a finger lifts. Assigning `scrollTop` while one is running kills it, even when the value is the one the scroller already has. So skip the assignment when the target is already where the scroller is. For a virtualized strip, that's most writes. The strip writes to keep its anchor (the item its position is kept against) in place. An item that finishes decoding *below* the reader doesn't move anything above it, so the anchor's offset stays the same. The write would have changed nothing and still killed the momentum.

## An item measured as the anchor is a write the reader never asked for

Say a scroll position is kept as an item index plus a *fraction* into that item. If the item at the top of the viewport hasn't loaded yet, it's laid out at an assumed height. When it loads, keeping the fraction means a new scroll offset: 0.3 of 585 px becomes 0.3 of 1170 px. That's a jump of 175 px, written in the middle of a fling. It happens exactly when loading falls behind a fast scroll, so slow loading turns into stopped momentum.

In that case, the pixel position is the right thing to keep. The reader was looking at an empty box, and keeping the item's top edge still means nothing on screen moves. So after a scroll by the reader, a relayout compares the anchor item's *top* edge (and the width) with what it was before, and only writes if it moved. An item *above* the anchor that changes height still needs the write. The only way to avoid that one is knowing the size in advance.

When the write happens matters too. An opening `scrollTop` written from a Svelte `$effect` that runs before the template has redrawn gets clamped short of its target. The fix, `$effect.pre` for the size read, is in [Svelte 5 effects](/svelte/effects/).

## A throttled Chromium fling stands in for a phone's slow decode

The fling problems above show up on a phone, where reading and decoding an image is slow, and a probe on a desktop has to recreate that. Through the DevTools protocol, `Input.synthesizeScrollGesture` with `gestureSourceType: 'touch'` and `preventFling: false` gives you a real compositor fling. `Emulation.setCPUThrottlingRate` slows down the main thread's file reads and image decodes without slowing the fling.

Desktop Chromium loads an image in about 10 ms, so a probe without throttling shows no problem at all. At 6× and 10× you see what the phone shows. Chromium only slows a fling on a `scrollTop` write, where WebKit stops it, so count the writes instead of judging by how far the scroll went.
