---
title: The Paged Image Viewer
description: "How `PagedViewer` and `PageFrame` show pages and spreads, keep loaded panes across a turn, zoom and pan, take touch, and mirror for right-to-left books."
tags: [reader, images, canvas, pointer-events, mobile, i18n, svelte, svelte-5]
sidebar:
  order: 40
---

The paged viewer is how the reader shows an image book (a comic archive or a PDF) one page or one two-page spread at a time. You turn pages, zoom and pan, and drag a box over part of a page to capture it for text recognition. Two components do the work: `PagedViewer` owns the frame, the page turn and the gestures, and `PageFrame` draws a single page. The general techniques behind them are in [bitmaps and canvas](/images/bitmaps-and-canvas/), the [keyed carousel](/svelte/keyed-carousel/) and [wheel, pinch and touch](/interaction/wheel-and-touch/). The APIs of the `Carousel`, `Gesture` and `PanZoom` components it's built on are in [reading components](/projects/reader/design-system/reading-components/).

## How a page is drawn

A page comes in one of two forms. A page from an archive is already an encoded image file, so `PageFrame.svelte` shows it as an `<img>` and lets the browser decode it. A PDF page is drawing instructions, so it gets rendered to an `ImageBitmap` and shown on a `<canvas>` with `transferFromImageBitmap`. Either way, `PageFrame` puts a `data-image-index` attribute on the element, so the selection code can find each page and read which image it is.

The canvas is declared `width={0} height={0}`, and `PageFrame` sets `canvas.width` and `canvas.height` from the bitmap right before the transfer. That one assignment does two jobs:

- `transferFromImageBitmap` puts the picture on screen at full size but doesn't update `canvas.width` or `canvas.height` at all (see [the general page](/images/bitmaps-and-canvas/#transferfromimagebitmap-does-not-update-canvaswidth)). Without the assignment, the numbers stay at 0. The size has to be set first, because the transfer empties the bitmap and after it `bitmap.width` reads 0 too.
- It turns the zero size into a [free "not drawn yet" flag](/images/bitmaps-and-canvas/#a-zero-sized-canvas-is-a-free-not-drawn-yet-flag). A page that failed or hasn't drawn yet still measures 0 × 0, and the selection geometry already rejects a zero size. So `PageFrame` doesn't need to pass a separate "loaded" flag to the selection code.

### The bug, as it happened

Capturing works like this. `SelectionLayer` collects every `[data-image-index]` element and reads each page's natural size (its size in image pixels). Then `regionsIn` in `viewing/domain/placement.ts` maps the dragged box into image pixels with `natural.width / frame.width`. It rejects any page whose natural size isn't positive, because dividing by zero would give nonsense coordinates.

This bug was on the canvas path, which today only PDF pages take. Before `PageFrame` set the canvas size, `SelectionLayer` read the natural size off `canvas.width`, which was 0 even though the page was on screen at full resolution. So I'd drag a box over a speech bubble, every page got rejected, `regionsIn` returned an empty array, and the capture was thrown away with no error. The geometry was right and the check was right. The number passed to it was wrong.

## Spreads and the reading position

To pair pages into spreads, the viewer needs to detect which images are landscape, and that requires each image's size. Measuring every image up front would mean decoding all 182 images of a book before drawing one. So the viewer treats an image it hasn't measured yet as portrait, and recomputes the pairing when real sizes arrive. Now the sizes come from the image headers at open, which costs a few kilobytes per image instead of a decode, so the portrait default only lasts until the headers are read.

Recomputing the pairing changes which spread a page is in. So the reading position is kept as an image index, not a spread number, and it stays correct through the recompute. The general version is [assume, then refine](/scrolling/virtualized-image-strips/#assume-then-refine-and-keep-the-anchor-independent-of-both).

## The frame's height is `100cqb`

A spread is laid out as a flex row of page boxes. Each page box keeps the page's proportions with `aspect-ratio` and takes its height from the frame. When that height was `100%`, WebKit sized the row by the image file instead of by the ratio: a page shown 541 px wide made the row 1000 px wide, the image's own width, so every size measured from the row was wrong. Chromium keeps the ratio correctly, so I never saw it there. The mechanism is in [WebKit sizes an aspect-ratio box by its content](/css/layout-quirks/#webkit-sizes-an-aspect-ratio-box-with-a-percentage-height-by-its-content).

The fix takes two changes, and neither works alone. Each pane is a `container-type: size` box, and the page box inside it takes `100cqb` as its height, which is the same value as `100%` but counts as a length. And the picture is taken out of flow with `position: absolute; inset: 0`.

## Keyed panes

A page turn shouldn't flash an empty page while the next one loads. So `PagedViewer` keeps the neighboring pages mounted next to the current one, and a turn just moves them into place. It renders its pages through the base `Carousel`'s `slide` snippet. The `Carousel` keys its `.carousel-slot`s by each slide's `key`, which here is the first image of the page group. Because of the key, Svelte moves the neighbor's existing DOM node into the current slot on a turn, and the canvas keeps its bitmap and the `<img>` keeps its decoded image and object url. The general rules are on [the keyed carousel page](/svelte/keyed-carousel/#a-keyed-pane-keeps-a-loaded-page-across-a-turn). Here's how each one shows up in the reader:

- **Neighbors leave out `data-image-index`.** `SelectionLayer` finds pages with `querySelectorAll('[data-image-index]')`. The off-screen neighbors are `inert`, but `inert` doesn't hide an element from `querySelectorAll`. If they had the attribute, a capture could be measured against a page you can't see.
- **`arrivalViewport`.** A neighbor is drawn at the zoom and position the viewer will use once it becomes the current page. At first I drew neighbors at the current zoom. That looked right until the turn, when fit width recomputed the zoom for the new page and the page jumped 234 px. The function is pure, in `viewing/domain/viewport.ts`, and the viewport's view model calls it for each neighbor (see [where the logic lives](#where-the-logic-lives)).
- **`holdStrip`.** An attachment called `holdStrip` moves the `strip` reference to whichever element is now current. It runs in its own effect, and nothing makes it run before the `pages` effect that uses the size. So each pane reports its size under its key while it's still a neighbor (`PagedViewport.measured`), and the turn reads the new current page's size from there.
- **An in-flow current pane.** The `viewer-drag` browser spec mounts the viewer without the app's stylesheet. When every pane was absolutely positioned, the frame collapsed to 0 × 0 there. So the current pane stays in flow (`flex: 0 0 100%`) and only the neighbors are absolute. Now every pane is a `container-type: size` box, which gives no size from its content either, so the spec loads the global stylesheet, which sizes the frame from its flex parent the way the app does.
- **Reduced motion.** `overrides.css` sets `transition-duration: 0s` and `transition-delay: 0s` when reduced motion is on. A 0 s transition never starts, so `transitionend` never fires. The `Carousel` checks the computed duration and ends the turn at once when it's zero (`SETTLES_AT_ONCE`), instead of waiting for its fallback timer.

## Wheel and pinch

Both image viewers take wheel input, through the pan-and-zoom code in `components/pan-zoom.ts`. A wheel event's delta isn't always in pixels: its `deltaMode` can be lines or pages, and a real mouse in Firefox reports lines. So both viewers convert with `wheelPixels(delta, mode, extent)` in `components/pan-zoom.ts`. It compares the mode with its own constants, `WHEEL_DELTA_LINE` (1) and `WHEEL_DELTA_PAGE` (2), instead of `WheelEvent.DOM_DELTA_*`, because its unit spec runs in Node, which has no `WheelEvent`. The details, including the Firefox catch that `deltaMode` only reports lines if you read it before the deltas, are in [`deltaMode` is not always pixels](/interaction/wheel-and-touch/#deltamode-is-not-always-pixels).

On ctrl+wheel the browser zooms the whole app, and the viewer has to stop that. Svelte's `onwheel` isn't passive, so `preventDefault()` there works. In Chromium and Firefox, a trackpad pinch arrives as the same ctrl+wheel event, so handling one handles both. I haven't confirmed whether Safari sends a pinch that way (see [ctrl plus wheel](/interaction/wheel-and-touch/#ctrl-plus-wheel-is-also-a-trackpad-pinch)).

## Touch

On a phone, a pinch on the page should zoom the page, not the whole app. The CSS property `touch-action` decides which gestures the browser handles itself, and the value that applies is what every ancestor allows. The paged frame has `touch-action: none`, so the browser handles no gestures there. The screen root, `.reader-screen`, first had `manipulation`, which only turns off double-tap zoom and [doesn't stop a pinch](/interaction/wheel-and-touch/#touch-action-manipulation-does-not-stop-a-pinch). Inside the frame that didn't matter, but a pinch on the header still zoomed the whole app. `pan-x pan-y` on the screen root fixes that, but it would also have taken away the continuous strip's native pinch. So `.reader-screen` only became `pan-x pan-y` once the strip handled its own pinch (see [the continuous strip](/projects/reader/image-reader/continuous-strip/#the-strip-owns-its-pinch)).

Touch also drives capture, but by a different route from the mouse. A mouse drag goes straight to `SelectionLayer`'s pointer handlers. Touch never reaches `SelectionLayer.pointerdown`. Instead, `PagedViewer` passes each touch event to `GestureFeed`, which runs it through `gestureStep` in `components/gesture.ts`, a pure reducer that classifies the touch (a tap, a long press, a drag). `PagedViewer` turns its results into calls on the marquee: `beginAt`, `extendTo`, `endAt` and `abandon`. Those are methods of the base `MarqueeSelection`, which `SelectionLayer` forwards. `MarqueeSelection` passes them to its drag view model, `MarqueeDrag`, where they end in the same private conclude step as the mouse's `pointerup`, so a region is measured and saved by one path. `endAt` concludes with the touch slop and never calls `onclick`, because the reducer has already reported every tap (its `onend` still reports the `click` for the trace).

The reducer has timeouts, like a long press, but no timers of its own. `gestureDeadline` names the next moment something could change, and `GestureFeed` (`components/gesture-feed.ts`) arms one timer for it after every `step`. `GestureFeed` takes a `Clock`, so its spec advances a fake one instead of waiting. The reducer also calls `waitsForDoubleTap(at)` instead of holding the tap zones itself. The general pattern is [a gesture classifier drives the marquee by calls](/interaction/selection-marquee/#a-gesture-classifier-drives-the-marquee-by-calls-not-by-events).

### The touch guide

On a touch screen the reader shows a first-use guide to the touch controls, a scrim over the page. That's `LessonScrim` in `src/lib/shared/`, which all three viewers use. In `PagedViewer` it shows the tap zones or a `SwipeLine`, and it sits inside the `.frame`, whose pointer handlers are Svelte delegated events.

Dismissing it on `pointerdown` alone wasn't enough. The rest of the touch (`pointermove`, `pointerup`) would then land on the frame and turn the page. So the scrim takes pointer capture on `pointerdown`, dismisses itself on `pointerup` or `pointercancel`, and stops each of those events, so the whole touch stays on it. One listener has to receive every press anyway: the tracker for which kind of input is in use. It listens on `<svelte:window onpointerdowncapture>`, which runs before any child can stop the event. More in [an overlay inside a delegated parent](/interaction/pointer-drags/#an-overlay-inside-a-delegated-parent-swallows-a-whole-touch).

## Right to left

Manga reads right to left, so "next page" is to the left. A new image book opens right to left, and you can switch it. The controls follow the direction with one rule, mirrored (the pattern is in [mirroring controls](/ui-patterns/reader-layout/#mirroring-controls-with-the-reading-direction)):

- the page slider has `dir={direction}`, so its start is on the right in a right-to-left book;
- `turnsSide` puts the turn buttons at the slider's forward end, `before` for rtl and `after` for ltr, so "next" is always the outermost button, on the side its arrow points to;
- `moveOrder` maps the physical arrow keys to next and previous.

`turnsSide` and `moveOrder` are pure functions with unit tests, and the markup only reads them.

The right-to-left default also affects probes, the Playwright scripts I use to check behavior in a real browser. A probe that taps the right side of a new book to go forward turns the page back, which is correct for a right-to-left book. So a probe for a left-to-right book has to set the direction first. Driving a swipe in WebKit is in [browser probes](/testing/browser-probes/#driving-a-touch-swipe-in-playwright-webkit).

## Where the logic lives

`PagedViewer` used to keep all of this state in its component script. Now the parts with logic are view models, small classes in `.svelte.ts` files that hold runes:

- `PagedViewport` (`viewing/ui/paged-viewport.svelte.ts`) holds the viewport (zoom and pan), the fit mode, pinch and double-tap zoom, the neighbors' arrival viewports, and what the overscroll check needs: where the pan started and the page and frame sizes.
- `GrabPan` (`grab-pan.svelte.ts`) handles panning with the space bar held or the middle mouse button.
- `HintLines` (`hint-lines.svelte.ts`) holds the gesture hint lines. The continuous strip builds one too.

None of them holds an element. `PagedViewport` takes a `ViewportFrame`, an object of two functions the component supplies: `boxes` returns the sizes of the frame and the current page box, and `offset` returns where the frame sits on screen. `GrabPan` takes a function that returns the element to capture the pointer on. Because the DOM only comes in through those functions, `paged-viewport.spec.ts` and `grab-pan.spec.ts` run the geometry in bare Node with plain objects in place of elements. The component keeps what needs the real DOM: the elements, the resize observers, `preventDefault` and pointer capture. Why a view model is split this way is on [what a view model still holds](/projects/dokseo/architecture/data-components-and-view-models/#what-a-view-model-still-holds).
