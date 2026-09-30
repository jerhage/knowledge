---
title: "Browser Probes: Holding States and Driving Touch"
description: Holding a loading screen by stalling OPFS or IndexedDB reads, and driving touch swipes in Playwright WebKit.
tags: [testing, playwright, opfs, indexeddb, pointer-events]
sidebar:
  order: 3
---

By "probe" I mean a throwaway Playwright script that opens the real page and reads or screenshots something. Other probes I use: a [throttled Chromium fling](/scrolling/scroll-writes/) that stands in for a slow phone, and [opening foliate's closed shadow roots](/ebooks/foliate-chapters/).

## Holding a loading state on screen by stalling a read

Many screens show a loading state while a storage read is in progress. In Dokseo, my manga and book reader, opening a book shows an "Opening…" screen while the book's file is read from OPFS, and the library shows a loading line while IndexedDB opens. Each of those states often lasts only as long as one storage read, a few milliseconds. That's too short to catch by waiting for it, and too short to screenshot.

The way around that is an init script, a script Playwright runs in the page before the page's own scripts. The init script wraps the storage call so it waits on a flag the probe controls. While the flag is set, the read doesn't finish, so the page stays in its loading state for as long as the flag stays set. The page's own code doesn't change at all.

**Stalling an OPFS read.** A file in OPFS is read through `FileSystemFileHandle.prototype.getFile`. The init script wraps that method in a loop that keeps waiting while a `window` flag is set, so every read is held until the probe clears the flag.

The probe usually sets the flag and then clicks something that navigates to the screen to hold. That still works in an SPA, because client-side navigation keeps the same window, so the flag set before the click is still there when the read starts.

This only works while the read happens on the main thread. The wrapper patches the main thread's `window`, and a worker has its own globals, so a read done in a worker gets past the wrapper.

A probe sometimes needs the load to fail instead of stall. To make that happen, overwrite the stored blob with garbage instead of deleting it. Deleting it can send the page down a different path, the one for a missing file, which isn't the failure you wanted to see.

**Stalling an IndexedDB open.** Opening a database goes through `IDBFactory.prototype.open`, which returns a request. The page puts its handler on that request's `onsuccess` and waits for it to run.

The init script wraps that method. On the request it returns, it redefines `onsuccess` as an own accessor, meaning a getter and setter on the request itself. When the page assigns its handler, the setter stores it instead of letting the request call it. Then the init script adds its own `success` listener. When the database opens, that listener calls the page's handler if a `sessionStorage` flag is off, and queues the handler if the flag is on. With the handler queued, the page keeps waiting and stays in its loading state. Because the flag lives in `sessionStorage`, it survives a reload, so setting it and then reloading picks which visits get held.

This only works if the code sets `request.onsuccess`, because that assignment is what the accessor catches. If the code calls `addEventListener` instead, the handler never goes through the accessor.

## Driving a touch swipe in Playwright WebKit

Sometimes a probe has to swipe a component with touch (for example, to slide between pages) in WebKit. The usual way to send touch input is `Input.dispatchTouchEvent`, a command in CDP (Chrome DevTools Protocol). WebKit has no CDP, so that isn't available, and `page.touchscreen` can only tap, not swipe.

If the component listens to pointer events, though, the probe doesn't need real touch input. It can drive the component with synthetic pointer events dispatched on its element:

```ts
new PointerEvent(type, {
  pointerId,
  pointerType: 'touch',
  isPrimary: true,
  clientX,
  clientY,
  bubbles: true,
  cancelable: true,
  buttons,
});
```

A swipe is a `down`, twenty `move`s 16 ms apart, and an `up`. If the probe waits before sending the `up`, the slide pauses partway, and the probe can read the elements' rects at that point.

What breaks if you're not careful:

- A component that tracks a drag may call `setPointerCapture` on the down event. It throws `NotFoundError` for a pointer the engine never registered, and the engine never registers a synthetic pointer. So the probe wraps it (and `hasPointerCapture`) in an init script.
- The probe has to upload a file so the page has something to show. A plain `webkit.launch()` context couldn't store a file upload in origin storage. `webkit.launchPersistentContext(tmpdir, …)` could.

`isMobile` and `hasTouch` are accepted. The phone-specific behavior I'm usually checking with this is in [touch devices](/html/touch-devices/).
