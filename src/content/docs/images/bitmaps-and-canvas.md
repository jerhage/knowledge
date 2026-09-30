---
title: "ImageBitmap and Canvas: Drawing, Sizing and Encoding"
description: "`bitmaprenderer` transfer and its canvas.width gotcha, `<img>` vs canvas for pages, encoding off-DOM, and printing a bitmap to the console."
tags: [images, canvas]
sidebar:
  order: 1
---

Dokseo, my manga and book reader, shows comic and manga pages that come out of archives and PDFs. A page can be decoded into an `ImageBitmap` and drawn on a canvas, or shown as an image element, and either way it has to end up on screen at the right size. Someone can also drag a rectangle over a page (say, over a speech bubble) to have the text in it recognized, which means the app has to read the page's real size.

## Hand a bitmap straight to a canvas, and let CSS do the scaling

The simplest way to show an `ImageBitmap` is a canvas with a `bitmaprenderer` context:

```ts
const context = canvas.getContext('bitmaprenderer');
context.transferFromImageBitmap(bitmap);
```

`transferFromImageBitmap` is a **zero-copy transfer**. There's no `drawImage` and no pixel work on the main thread. It also **takes ownership**: the bitmap is neutered afterwards, so don't `close()` it. (More on ownership in [Transferring ImageBitmaps](/images/transferring-bitmaps/).)

The canvas then holds the image at its *natural* resolution, and CSS sizes the element down. The browser does that downscale at device resolution.

**Why this matters.** It removes device pixel ratio math from the code entirely. The usual approach is to size a canvas to `cssWidth * devicePixelRatio`, scale the context, then draw. That's three chances to get it wrong, and if any of them is wrong you get a blurry page on a retina display. Hand over the full-resolution bitmap and the browser takes care of it, and it's better at it.

## `transferFromImageBitmap` does not update `canvas.width`

The technique above has a gotcha, and it can break a whole feature without any error. Say a canvas is declared `<canvas width={0} height={0}>`, and a 1200 by 1800 page is transferred into it. The canvas still reads `canvas.width === 0`. The picture is on screen at full resolution, and every number that describes its size is zero. Measured in Chromium:

| | `canvas.width` | `getBoundingClientRect().width` |
| --- | --- | --- |
| declared `width="0"`, after transfer | `0` | the CSS width |
| `canvas.width = bitmap.width` first, then transfer | the bitmap's width | the CSS width |

That table comes out that way because the `width` and `height` IDL attributes (the JavaScript properties) reflect the *content* attributes (the ones on the element). But a `bitmaprenderer` canvas *renders* at the size of its output bitmap. Those two sizes are independent, and JavaScript can only read one of them. So a canvas can show a page and report no page.

**The rule: set the intrinsic size from the bitmap before you transfer it.**

```ts
const natural = { width: bitmap.width, height: bitmap.height };
canvas.width = natural.width;
canvas.height = natural.height;
context.transferFromImageBitmap(bitmap);
```

Read `bitmap.width` into a local *first*. The transfer neuters the bitmap, so after it the bitmap reports zero too.

Order also matters because of the `blank` mode. If you assign `width` or `height` to a canvas whose bitmap mode is still `blank`, it replaces its output bitmap with a transparent one of that size. Assigning after a valid transfer leaves the pixels alone, because the spec only resets the output bitmap when the mode is `blank`. But then the result depends on which mode the context happens to be in at that moment (a `transferFromImageBitmap(null)` puts it back to `blank`). Size first, transfer second, and you never have to think about it.

**Why anyone cares.** When someone drags a rectangle over a page, code has to map that screen rectangle to image pixels. It does that by dividing the natural size by the on-screen size (`natural.width / frame.width`). It should reject a placement whose natural size isn't positive, because a zero there divides by zero. Now say that natural size comes from `canvas.width`, and the canvas is stuck at zero. Every placement gets rejected, and someone's selection over the image is thrown away without any error. The geometry is right, the check is right, and the input is wrong. (That mapping is stage 2 of the [OCR pipeline](/machine-learning/browser-ocr-pipeline/), and the marquee side of it is in [A Selection Marquee over Zoomable Pages](/interaction/selection-marquee/).)

## A zero-sized canvas is a free "not drawn yet" flag

Other code sometimes has to check whether a page's canvas has been drawn yet. The zero size from the previous section is enough for that, without any extra state.

Declare `width={0} height={0}`. `transferFromImageBitmap` doesn't resize the canvas itself (see above), but the drawing code sets `canvas.width` and `canvas.height` from the bitmap right before the transfer. So a page that drew measures its real size, and a page that didn't draw or failed still measures zero. The geometry already rejects a zero natural size, so no separate "drawn" flag has to be passed from one component to another.

The flag only works because of that assignment. Drop it, and every page reads as "not drawn yet", drawn or not.

## An encoded page belongs in an `<img>`, not a canvas

A canvas has a cost. A canvas fed by `transferFromImageBitmap` holds decoded RGBA pixels that the browser can't evict. A page image doesn't need that. It's only ever displayed: selection reads the element's box, and any cropping re-reads the source. So if a page's bytes are already an image (every archive entry is), render it as an `<img>` over an object url. Then the browser owns, decodes and evicts the pixels. A PDF page is a different kind of thing. It's drawing instructions, so it gets rendered and stays on a canvas.

Details that go wrong:

- An object url pins its blob until it's revoked (see [Large Files](/files/large-files/)). So every mount owns a *fresh* url and revokes its own on unmount. If two elements share one url, revoking it blanks the other.
- Natural size is `naturalWidth`/`naturalHeight` on an `<img>` and `width`/`height` on a canvas. Read the wrong pair and nothing errors. A canvas has no `naturalWidth`, so it reads `undefined` and the positive-size check rejects every placement. An `<img>`'s `width` is its *rendered* width, so the mapping comes out as 1:1 and the crop lands in the wrong place.
- `loading="lazy"` conflicts with a virtualized list, which already controls what's mounted. `decoding="async"` is the one that helps.

## One bitmap at a time, and mind who owns it

A decoded page is big, so decode one page at a time. `transferFromImageBitmap` takes ownership, so don't close a bitmap you transferred. A bitmap you *didn't* transfer has to be closed, or it keeps holding its decoded pixels. That's width times height times four bytes, which for a 2000 by 3000 scan is 24 MB per page.

## `OffscreenCanvas` can encode

An `OffscreenCanvas` isn't attached to the page, and it can still turn what's drawn on it into an image file. `canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })` produces a blob without touching the DOM at all. Handy for thumbnails.

## Copy a bitmap to a canvas synchronously, then encode it asynchronously

Sometimes I want an `ImageBitmap` as a data URL, for example to print it in the console (next section). Getting there means drawing the bitmap onto an `OffscreenCanvas` and encoding that canvas, and the encoding step has to `await` `convertToBlob`. By the time that await resolves, the bitmap may have been closed, transferred or neutered by other code. So the `drawImage` that captures it has to have happened already.

```ts
function copyOf(bitmap: ImageBitmap): OffscreenCanvas   // sync: drawImage
async function dataUrlOf(canvas: OffscreenCanvas)       // async: convertToBlob
```

Splitting it into two functions isn't just for looks. One `async function` doing both is only correct while `drawImage` happens to sit before the first `await`. Say a later refactor adds an await above it. Now `drawImage` can run on a bitmap that was closed or transferred in the meantime, and it throws `InvalidStateError`. In a debug helper whose promise nobody awaits, that looks like a missing image, not an error.

`convertToBlob` gives you a blob. Running `btoa` over the bytes gives the data URL without a `FileReader`, which plain Node doesn't have, so a unit test couldn't stub it.

## An image can be printed into the console with `%c` and a padded background

`console.log` doesn't take an image. The only way to see a bitmap in DevTools is to style an empty string:

```ts
console.log(`%c %c ${label} ${width}×${height}`, style, '');
```

where `style` is

```text
padding: <h/2>px <w/2>px;
line-height: <h>px;
background-image: url(<data url>);
background-size: <w>px <h>px;
background-repeat: no-repeat;
```

The padding gives the single space a box, and the background fills it. Use half the intended size on each side, because padding applies on both sides. The second `%c` with an empty string resets the styling, so the label next to the image shows as plain text. An object URL works too, but a data URL survives a page reload while the console entry is still on screen.

In an image pipeline, a debug trace that prints the finished crop this way is the only thing that distinguishes a coordinate bug from a failure further down the pipeline. The dimensions look identical in both cases.
