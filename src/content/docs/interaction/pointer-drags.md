---
title: "Pointer Drags: Capture, Gesture Modes and Clicks"
description: Pointer capture, fixing a gesture at pointerdown, spring-loaded modes, scrollbars, pointer types, and clicks after a drag.
tags: [pointer-events, svelte-5]
sidebar:
  order: 1
---

The selection rectangle I built on top of these is in [a selection marquee over zoomable pages](/interaction/selection-marquee/). Wheel, pinch and touch are in [wheel, pinch and touch on scrollers](/interaction/wheel-and-touch/).

## Capture the pointer or a drag dies at the edge

In my reader's page viewer, dragging with the mouse either draws a selection rectangle or pans the page. A drag starts with a `pointerdown` on the viewer, and the viewer follows the moves until the pointer comes up.

By default, the browser sends each move to whatever element is under the pointer. So when someone drags past the edge of the viewer, the moves and the final up event go somewhere else, and the drag just stops, with no error.

Calling `setPointerCapture(event.pointerId)` on pointerdown fixes that. It sends every later move, and the up event, to that element, even when the pointer is outside it or outside the window.

## Decide the gesture at pointerdown and do not change it

Whether a drag selects or pans depends on the keys held down. Say someone starts a selection and presses a modifier halfway through. If the move handler reads the live modifier state, the selection turns into a pan under their pointer.

So record what the gesture *is* when the pointer goes down, and read that for the rest of the drag, not the live modifier state. Pressing the modifier mid-drag then changes nothing, and releasing it cleanly ends the gesture it started, instead of changing the other one.

## A spring-loaded mode cannot strand you

The pan mode is spring-loaded: it lasts only while a key is held. Hold space to pan, let go to select. Whether the mode is on always matches whether the key is down, so there's no separate state to get out of sync, and no way to get stuck in the wrong mode. A persistent toggle (press once for pan, press again for select) adds exactly one such way.

The key handlers still need a guard, a check that makes them ignore some key events. Put it on the keydown that turns the mode on, never on the keyup that turns it off. A guarded keyup leaves someone stuck in the mode when they hold the key over the canvas, click into an input while still holding it, and let go. The keyup lands on the input, the guard ignores it, and the mode never clears. Clearing the mode on every keyup is safe, because it's a safety step that never calls `preventDefault`, so it can't break anything.

## A pointer type is the only reliable way to split a gesture on a scroller

A drag gesture on a scroller (such as a continuous strip of pages) has to share the pointer with the scroller itself. A finger dragging on it should scroll, as it does everywhere else.

To take over a primary drag safely, an element needs `touch-action: none`. That stops the browser from starting its own pan or zoom when a touch begins, so the page gets the whole gesture. A scroller can't use it, because it would stop touch scrolling. So split on `event.pointerType`: `mouse` and `pen` drag, and `touch` is left entirely to the browser. Don't try to tell them apart by timing or by a movement threshold. By then the scroll has already started.

## Clicking a scrollbar fires `pointerdown` on the scroller

A drag gesture on a scroller starts from a `pointerdown` handler on the scroller, and the scroller's own scrollbar is part of the element. So a click on the scrollbar reaches that handler too.

If the gesture handler calls `preventDefault()` on the pointerdown, that suppresses the compatibility `mousedown` (the mouse event a browser fires after the pointer event) that moves the scrollbar thumb. So a gesture that starts on pointerdown will break dragging the scrollbar. The handler has to leave presses on the scrollbar alone. To tell them apart, test the point against the *client* box:

```ts
event.clientX - box.left <= element.clientLeft + element.clientWidth
```

`getBoundingClientRect()` covers the border box, scrollbar included. `clientWidth` stops before the scrollbar and also leaves out the borders, which is why `clientLeft` (the left border's width) gets added back.

## A drag on a button with pointer capture still ends in a click

With `setPointerCapture` on the element that got `pointerdown`, the `pointerup` lands on that same element. So the browser fires `click` on it after every drag, however far the finger went. A button that's both a drag handle and something you press has to swallow that one click. Record whether the last release moved past the touch slop (the distance a pointer can move before it counts as a drag), and ignore the next click unless its `detail` is 0. A click made from the keyboard has a `detail` of 0, so Enter and Space never get eaten by a stale flag.

## A shared gesture layer exports handlers; it does not attach them

In my reader, the selection rectangle is drawn by a selection layer, a component that sits inside the viewer. The viewer (the host) has pointer handlers of its own, for panning. When a press could start either one, the pan has to win over a selection.

So the selection layer doesn't listen for pointer events itself. It exposes `pointerdown`/`pointermove`/`pointerup`/`pointercancel` as component exports, and the host calls them from its own handlers. If the layer attached them itself with `addEventListener`, they'd end up in a different queue from the host's. Svelte 5 *delegates* pointer events: it handles them with a listener at the root instead of listeners on each element. So a direct listener on the same element fires first, and whether the pan beats a selection would come down to mount order. Forwarding keeps the order of precedence visible in one function.

Later I moved the marquee itself into a base component. The selection layer (the domain layer) kept exporting the same names and now forwards each call to the base component, so the host's order of precedence didn't change.

How delegated handlers compare with plain window listeners is in [attachments and `<svelte:window>` listeners](/svelte/attachments-and-listeners/).

## An overlay inside a delegated parent swallows a whole touch

My reader shows a first-use touch guide: a scrim over the viewer that shows where to tap or swipe, and goes away when someone touches it. The guide sits inside the viewer's frame, and the frame's pointer handlers (the ones that turn pages) are Svelte 5 delegated events. A touch that dismisses the guide must not also reach the frame and turn a page.

`stopPropagation` still works with delegation: if a child's delegated handler stops the event, the parent's handler doesn't run. For a touch, that isn't enough by itself. If the overlay disappeared on `pointerdown`, the rest of the gesture (`move`, `up`) would land on the frame. So the overlay takes pointer capture on `pointerdown`, dismisses itself on `pointerup` / `pointercancel`, and stops each of those events. The whole touch stays on the overlay.

A listener that has to receive every press no matter what (like a tracker for the kind of input in use) goes on `<svelte:window onpointerdowncapture>`. That runs before any child can stop the event.

When the viewer shows an embedded document, such as an ebook chapter in an iframe, make the scrim a sibling of the stage, not a child. Then the iframe and the stage's listeners never receive the touch at all. It also means a swipe on the guide dismisses it without turning the page.
