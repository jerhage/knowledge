---
title: Wheel, Pinch and Touch on Scrollers
description: Normalizing `deltaMode`, preventing ctrl-wheel zoom, what `touch-action` stops, holding a scroll during a long press, and overscroll.
tags: [pointer-events, scrolling, mobile, svelte-5]
sidebar:
  order: 2
---

Mouse and pen drags are in [pointer drags](/interaction/pointer-drags/).

## `deltaMode` is not always pixels

My viewers handle `wheel` events themselves and move the content by the event's delta. That delta comes in a unit, and `deltaMode` gives which one: pixels, lines or pages. A handler that treats every delta as pixels breaks as soon as a browser uses one of the others.

A real mouse in Firefox reports `DOM_DELTA_LINE`, so one tick is 3, not 100. Multiply by a line height for lines and by the frame's size for pages. If you don't, a wheel gesture moves three pixels.

In Firefox this depends on the order you read the properties. If you read `deltaX`/`deltaY`/`deltaZ` before `deltaMode`, Firefox converts to pixels and `deltaMode` reads `DOM_DELTA_PIXEL`. You only get lines when you read `deltaMode` first. So read `deltaMode` first and handle lines, and don't trust a Firefox test that happened to read a delta first.

Shift plus wheel gets swapped into `deltaX` for you on some platforms and left in `deltaY` on others. Add both together.

Put the conversion in one pure function, `wheelPixels(delta, mode, extent)`, that every viewer calls. Compare the mode against your own constants for line (1) and page (2) instead of `WheelEvent.DOM_DELTA_*`, because a unit test running in Node has no `WheelEvent`.

## Svelte's `onwheel` is not passive

On ctrl-wheel, the browser zooms the whole page. A viewer that uses ctrl-wheel for its own zoom has to call `preventDefault()` in its wheel handler, and that only works if the listener isn't passive, because a passive listener can't cancel the event.

Svelte only marks `touchstart` and `touchmove` as passive. `addEventListener` defaults to non-passive on an ordinary element. The passive-by-default rule only applies to `window`, `document` and `document.body`. So `preventDefault()` in an `onwheel` works, and that's what stops the browser zooming the page on ctrl-wheel.

## Ctrl plus wheel is also a trackpad pinch

In Chromium and Firefox, both arrive as the same event (a `wheel` with `ctrlKey` set), so handling one handles both. Safari on macOS has its own `gesturestart`/`gesturechange`/`gestureend` events for a pinch, and sources disagree on whether it also sends the ctrl-wheel. I haven't confirmed that, so test a pinch in Safari separately.

## `touch-action: manipulation` does not stop a pinch

`touch-action` sets which touch gestures the browser may handle itself on an element. My viewers handle a pinch themselves, so the browser must not also zoom the page on one. `manipulation` looks like the value for that, and it isn't.

`manipulation` is `pan-x pan-y pinch-zoom`. It removes double-tap zoom (and the tap delay that comes with it) and nothing else. To stop a pinch from zooming the page, an element and its ancestors need a value without `pinch-zoom`: `pan-x pan-y` or `none`.

The value that applies is the intersection along the ancestor chain. In my reader, the screen root had `manipulation`, and the paged viewer's frame inside it had `none`. The frame's `none` still wins inside the root's `manipulation`, but a pinch on the header (outside the frame) still zooms the whole page. Putting `pan-x pan-y` on the screen root fixes the header, but it also takes away a scrolling strip's native pinch, so only do that once the strip has its own pinch.

## A long press on a scroller holds the scroll from a non-passive `touchmove`

On a scroller, a finger that presses and holds can fire a long press, and from then on the finger's movement belongs to the long press, not to scrolling. So the scroll has to be held still. The obvious tool doesn't work here.

A scroller has to keep a `touch-action` that allows panning. `touch-action` is read once, at `pointerdown`, so you can't switch it off when a long press fires 400 ms later. What still works is `preventDefault()` on the `touchmove` events. Until the browser has started a scroll, they're cancelable. If you prevent one, the scroll never starts, and the pointer events keep coming without a `pointercancel`.

For that to work:

- The listener has to be added with `addEventListener(..., { passive: false })` (Svelte's `ontouchmove` is passive).
- It has to read the state the pointer events already set, because Chromium dispatches `pointermove` before the `touchmove` of the same move.

Check `event.cancelable` first. A move during a scroll that has already started isn't cancelable. The same listener, when `touches.length > 1`, can stop a two-finger gesture from panning, so a pinch can be handled by the page itself. A mode toggle set before the gesture (a "select" mode) is the one case `touch-action: none` handles on its own.

A probe for this needs a control. Playwright's CDP two-finger touch *does* zoom an ordinary page (`visualViewport.scale` reached 5 on a plain page). So a scale of 1 on your viewer after the same pinch is real evidence, not a gap in the emulator. Driving touch in WebKit, which has no CDP, is covered in [browser probes](/testing/browser-probes/).

## Overscroll is the travel the clamp threw away

In the paged viewer, a zoomed-in page can be panned with a finger, and a swipe turns the page. The two meet at the page's edge: once someone has panned to the edge, pushing further should turn the page. To decide whether a pan that ended at a page edge should turn the page, don't track "was it at the edge" as state. Take the viewport at the start of the gesture, pan it by the finger's `dx`, clamp it, and subtract the distance it actually moved from `dx`. What's left is how far the finger traveled past the edge. Feed that to the ordinary swipe test, and it covers both the page that was already at the edge and the one that got there partway through. It also stays correct when the browser merges moves and a release arrives with no pan applied.

A clamp that *centers* content narrower than the frame breaks anchored zoom until the content overflows. The point under your fingers slides sideways during the first part of a pinch-out from a fit-height page. That's the clamp doing its job, not a pinch bug.

Writing the scroll position back from code has its own gotchas; see [writing `scrollTop`](/scrolling/scroll-writes/).
