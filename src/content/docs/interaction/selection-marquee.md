---
title: A Selection Marquee over Zoomable Pages
description: Measuring after transforms, drawing rects as page fractions, classifying the end of a drag, and anchoring over a scroller.
tags: [pointer-events, css, testing, virtualization]
sidebar:
  order: 3
---

By marquee I mean a rectangle you drag over page images that are zoomed and panned with a CSS transform. What happens to the selected region once it's committed (crop, stitch, recognize) is in [the OCR pipeline, stages 1 and 2](/machine-learning/browser-ocr-pipeline/). Keeping the zoom surface and its math in a base component is one of the [options a system adds beyond the baseline](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline).

## Put the identity on the element, not in a parallel array

The viewer shows each page as its own element. A page whose bytes are already an image (a JPEG or PNG) is an `<img>`, and a page that has to be drawn, like a PDF page, is a `<canvas>`. When a selection is committed, the code measures the page elements under the marquee and has to read which page image each one shows, so it crops the right page.

So write the page's index on the element itself, `<img data-image-index={index}>` or `<canvas data-image-index={index}>`, and read it back when you measure. An index kept in a separate array can fall out of sync with the DOM through a keyed reorder, a re-render, or a `bind:this` that runs out of order. In an image viewer, that sends a crop to the wrong page.

## Transform, then measure

To turn the marquee into a region of the page image, the code compares the page element's box on screen with the page's natural size (its size in image pixels). That's `naturalWidth` and `naturalHeight` on an `<img>`, and the `width` and `height` attributes on a `<canvas>`. Read the wrong pair and nothing errors. A canvas has no `naturalWidth` or `naturalHeight`, so they read `undefined`, the math turns into `NaN`, and no page makes it into the selection. An `<img>`'s `width` and `height` are its *rendered* size, so the mapping comes out as 1:1 and the region lands in the wrong place on the page. The viewer's zoom and pan are a CSS `transform` on the pages, and that sounds like a scale factor the code has to track.

It doesn't. `getBoundingClientRect()` returns the box *after* transforms. So a zoomed page reports its zoomed box, and a ratio against its natural size already has the zoom baked in. Measure where the thing actually is, and the scale factors cancel out on their own.

The zoom itself is anchored: the point under the cursor or fingers stays put while the page scales around it. `transform-origin` has to be `0 0` for the anchored zoom math. The CSS default is the center, which adds a shift the math doesn't account for. If the pan-zoom math and an origin-0 transform class (reading `--pan-x`, `--pan-y` and `--zoom`) live in a shared base, treat them as a pair. A caller that draws a viewport some other way has to keep the origin at `0 0` itself.

## A rectangle drawn as a percentage of the page follows every transform for free

A rect from image space can go on screen in viewport coordinates or as percentages of the page, and you can't swap one for the other.

Mapping it into *viewport* coordinates needs a measured `getBoundingClientRect()` for the page element. So anything drawn from it has to measure again on every zoom, pan, page turn, resize and scroll, and the overlay lives outside the page element, chasing it.

The other way: state the same rect as percentages of the page's own natural size, and render it inside the page element's `position: relative` wrapper. Now the page element lays the box out itself, and the page element is exactly what the viewer's `transform` already scales. Zoom, pan and fit move the box with no observer and no measuring, and every viewer that renders the same page component gets it straight away.

```ts
function toPageFraction(natural: Size, rect: ImageRect) {
  return {
    left: (rect.x / natural.width) * 100,
    top: (rect.y / natural.height) * 100,
    width: (rect.width / natural.width) * 100,
    height: (rect.height / natural.height) * 100,
  };
}
```

Use viewport coordinates when you need the answer in viewport space (hit testing a pointer against a page). Use page fractions when you're drawing *on* the page. There, viewport coordinates would get you a resize observer for nothing.

On a canvas page, you have to capture the natural size when the bitmap arrives. `canvas.width` gets set at that moment, and nothing else records it. An `<img>` reports its own natural size once it has loaded. (`transferFromImageBitmap` doesn't set it for you; see [ImageBitmap and canvas](/images/bitmaps-and-canvas/).)

## A finished drag must never be reported as a tap, and only a browser test can check it

In my reader, a press on the page can end two ways. A drag selects a region. A tap (a press that barely moves) shows or hides the reader's UI chrome, such as the header. One selection layer decides between the two, and the two outcomes can sit one `return` apart in `pointerup`. A selection below the minimum size on *both* axes, or one that covers no page, calls `tap()` instead of `select()`.

Because `tap` toggles the UI chrome, any bug in the admission path (the wrong pointer types, a lost anchor, a page whose natural size is still zero) doesn't show up as a missing capture. It shows up as "the header appeared when I finished dragging".

No unit test can reach this. The classification needs a real `getBoundingClientRect`, a real `data-image-index` element with a natural size, and real pointer events. A browser spec has to:

- mount the viewer;
- render a page that has a natural size (for a canvas page, draw it from an `ImageBitmap` so the size is read from the canvas attributes);
- size the mount container (a collapsed frame gives a zero rect, and then every drag becomes a tap);
- drag across the page.

`setPointerCapture` and friends throw on a synthetic `pointerId`, so I mock them to no-ops.

If `pointerup` reads the end point from the *event*, not from reactive pointer state, then breaking `pointermove` doesn't break the commit. It only stops the marquee following the cursor. So a regression test aimed at the commit has to break admission or geometry, not the live rect.

A cleaner structure: classify the end as a named union (`click`, `too-small`, `selection`) in a pure function. Let only a `selection` reach the region mapping, and let only a `click` tap. Then a mouse drag that ends too small, or catches no page, taps nothing.

## A gesture classifier drives the marquee by calls, not by events

On a touch screen, one finger on the page can mean a tap, a swipe, a long press or a selection, and the viewer has to classify it. So touch never reaches the selection layer's `pointerdown`. The viewer sends touch to a pure gesture reducer and turns its intents into `beginAt`, `extendTo`, `endAt` and `abandon` calls on the marquee. Those share one `conclude` path with the mouse's `pointerup`, so a region always gets measured and committed the same way. The one difference is a click: `endAt` taps nothing. The classifier has already reported every tap, and a long press that lifts without moving isn't a tap. The frame takes capture of the touch pointer itself at pointerdown, since the layer never receives it.

Some of those gestures depend on time. A long press is a press held long enough, and a tap can't be reported until it's clear that no second tap follows to make it a double tap. So the reducer has timeouts, and a pure reducer with timeouts needs its clock passed in from outside. A `gestureDeadline(state)` function gives the next moment a `tick` could change anything. After every step, the host arms one `setTimeout` for that moment, so no timer runs while nothing is pending. A tick that fires early does nothing, and the next step arms it again. Wrap the timer in a small feed object that takes a `Clock`, so its spec can advance a fake clock instead of waiting. And have the reducer call a function the caller passes in (`waitsForDoubleTap(at)`) instead of holding the tap zones itself.

One caution for probes: when a viewer's tap zones depend on reading direction, set the direction explicitly before testing. If the default is right to left, a right tap that "turns back" is the direction doing its thing, not a bug in the code.

## A marquee over a scroller: anchor by scroll delta, and pin the window

The marquee also works over a scrolling view, like a continuous strip of pages. A drag drawn in screen coordinates over a scrolling surface goes wrong as soon as the surface scrolls. The pressed point stays put on screen while the content moves away from it. Keep the pressed point and add up the scroll deltas since the press. The anchor on screen is the point minus that sum.

Only pass a delta for a scroll the reader made. When my code writes a scroll to hold content still through a relayout, the content under the anchor didn't move, and counting that write would push the anchor off by the size of the relayout. So a marquee component should take `followScroll(by)` rather than read `scrollTop`. (Telling your own writes apart is covered in [writing `scrollTop`](/scrolling/scroll-writes/).)

In a [virtualized list](/scrolling/virtualized-image-strips/), the anchor's row can also leave the DOM, and any geometry read from the DOM (`getBoundingClientRect` on the row) goes with it. For as long as the drag lasts, stretch the mounted window so it reaches the anchor, instead of recomputing the row's box from the layout.

To select past what's on screen, the view auto-scrolls while the pointer is held near its edge during a drag. A `requestAnimationFrame` loop for auto-scrolling at the edge doesn't need an effect. Start it from `pointermove` when one isn't already running. Let each frame stop the loop when the pointer leaves the edge zone or the drag ends, and cancel it from `pointerup`, `pointercancel` and `onDestroy`. Scale each step by the time since the last frame, with a cap, so a 120 Hz screen doesn't scroll twice as fast and a stalled tab doesn't jump.
