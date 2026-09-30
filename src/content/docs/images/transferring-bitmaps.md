---
title: Transferring ImageBitmaps and Who Owns Them
description: "Transfer moves and neuters a bitmap; an owning wrapper with `release()`, and `DisposableStack` for loops."
tags: [images, web-workers, javascript]
sidebar:
  order: 2
---

My reader recognizes text in a region of a page someone selects. The page is an `ImageBitmap` on the main thread, and the recognition runs in a worker, so the bitmap (or a prepared copy of it) has to be sent to that worker. The general mechanism (transfer vs clone, the transfer list, neutering) is in [Transferable Objects and Structured Clone](/javascript/transferable-objects/). The ownership table for a whole image pipeline is at the end of the [OCR pipeline](/machine-learning/browser-ocr-pipeline/) page.

## An `ImageBitmap` is transferable

An `ImageBitmap` can cross a `postMessage` boundary without being copied. That makes it the right thing to send a worker, not a blob or an `ImageData`.

## A transfer neuters the sender, so copy the bitmap before you post it

`worker.postMessage(message, [bitmap])` doesn't copy the bitmap. It *moves* it. The receiver gets the pixels and the sender is left with a husk whose `width` and `height` read 0. **The post throws nothing**, on either side. The husk only throws (`InvalidStateError`) when something finally passes it to `drawImage` or `createImageBitmap`, which can be far away from the post. Code that reads its size first just gets 0 by 0. So the mistake shows up later as an empty image, or as an error that looks unrelated to the cause.

That bites in the recognition adapter. The code that sends an image to the recognition worker is an adapter (the concrete code behind a port) that takes a bitmap from its caller. The caller may still need that bitmap afterwards. If the adapter transfers the caller's bitmap, the caller is left holding a husk and gets no error. So an adapter that has to leave its caller's bitmap intact transfers a copy:

```ts
const canvas = new OffscreenCanvas(image.width, image.height);
canvas.getContext('2d')?.drawImage(image, 0, 0);
const copy = canvas.transferToImageBitmap();
worker.postMessage({ kind: 'recognize', id, image: copy }, [copy]);
```

`drawImage` plus `transferToImageBitmap` is a *synchronous* copy. There's no `createImageBitmap` and no await, so nothing can close or neuter the source between the two steps. The caller's bitmap comes out of the call untouched. If the adapter already makes a new bitmap while preparing the image (scaling, grayscale), that one is its own to transfer, and it doesn't need an extra copy.

Then ownership splits cleanly in one place: the worker owns whatever arrives, because it arrived by transfer, and closes it when it's done.

## Transfer takes ownership, so a disposable wrapper needs a way to disarm

Every `ImageBitmap` holds decoded pixels until something closes it, so each one needs exactly one owner that closes it. Wrap a bitmap in a small owning object whose `[Symbol.dispose]` closes it and is safe to call more than once. Say an image pipeline holds a source page, a crop per region, a stitched sheet, a scaled copy and a grayscale copy all at once, with an early return between each step. It then needs one `using` per step instead of a `try`/`finally` per bitmap. (`using` itself is covered in [`using`, `await using` and `DisposableStack`](/javascript/explicit-resource-management/).)

**Two operations take ownership and neuter the bitmap:** `transferFromImageBitmap` on a canvas, and `postMessage` with the bitmap in the transfer list. Closing after either one is redundant at best, and at worst a double-free bug waiting to happen. The wrapper can't detect either one, so it would still close the bitmap when its block ends. So give the wrapper a `release()` that returns the bitmap and disarms the dispose. That value leaves the block alive, and every *other* bitmap in the block still gets closed on the way out. Call `release()` at exactly the point where ownership passes on, never "just in case". A released bitmap that nothing takes is a leak the wrapper can no longer catch.

`OffscreenCanvas.transferToImageBitmap()` is the other side of the same coin. It's synchronous, it empties the canvas, and the caller owns the bitmap it returns. Using it lets every pixel helper (crop, stitch, scale, grayscale) stay synchronous. `createImageBitmap(canvas)` would make them all async.

## A `DisposableStack` is how `using` covers a loop

Sometimes the number of bitmaps comes from a loop, like one crop per selected region. `using` binds one name to one lifetime, so it can't own a list built in a loop. `using held = new DisposableStack()` can. `held.use(x)` returns `x` and registers it, and the stack disposes everything in reverse order when the block ends, including on an early return in the middle of the loop. Without it, you're writing a `try`/`finally` chain.

It's a runtime global, not syntax, so a bundler doesn't downlevel it. It needs Chrome 134 or Firefox 141. Safari only has it in Technology Preview so far, so you need a polyfill there. Loading a polyfill has its own ordering gotcha, covered in [JavaScript Gotchas](/javascript/gotchas/).
