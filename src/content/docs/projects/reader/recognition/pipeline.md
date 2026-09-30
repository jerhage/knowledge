---
title: The Reader's Recognition Pipeline, Module by Module
description: "Each stage of the OCR path in the reader's own files: the guards and their trace names, the cropper, the per-engine preparation, the worker, and who owns each bitmap."
tags: [reader, ocr, machine-learning, images, canvas, web-workers, transformers-js]
sidebar:
  order: 60
---

In the reader, I drag a box over a speech bubble on a manga page, and a moment later the text in that bubble shows up as a card in the captures panel beside the page. Between the drag and the card, the selection is cropped out of the page image, prepared for a model, sent to a worker, recognized, cleaned up and rendered. The general page, [An Image OCR Pipeline in the Browser](/machine-learning/browser-ocr-pipeline/), explains each of those stages and why it works the way it does. This page follows the same stages through the reader's own modules, with the trace names and the bugs I hit.

The walkthrough follows the Japanese path, where the model is manga-ocr. A Korean model uses the `paddle-ocr` runtime and is read by a different worker, `src/workers/paddle-ocr.worker.ts`, so stages 8 to 10 don't describe it. The two runtimes side by side are on [OCR Engines, Models and Devices](/projects/reader/recognition/engines/).

## 1. The drag and its guards

The drag starts in a base component, `MarqueeSelection`, which draws the selection box. When the pointer comes up, it reports the drag in one of two ways: `onrefuse` when something went wrong with the gesture itself, or `onend` with a `click`, a `too-small` drag or a real `selection`. The component that hosts it over the page is `viewing/ui/SelectionLayer.svelte`, which turns a selection into regions of page images. A drag counts as too small when either edge is under `MIN_SELECTION_PX`, 12 px, set in `viewing/domain/selection.ts`, because a box that small is almost always a misclick.

Between the drag and the model there are six checks, and each can end the whole thing with nothing on screen. From my side it looks the same every time: I drag, let go, and no card appears. So each check writes its own name into a trace, and the name shows which one stopped it (the general reasoning is in [stage 1](/machine-learning/browser-ocr-pipeline/#1-the-drag-and-the-guards-that-can-discard-it)):

| Where | Check | Trace name |
| --- | --- | --- |
| `MarqueeSelection`, through `onrefuse` | the released pointer is not the held one | `pointer-mismatch` |
| `MarqueeSelection`, through `onrefuse` | no `within` element, or no anchor | `no-drag-origin` |
| `MarqueeSelection`'s `too-small` end | either edge under 12 px | `below-minimum` |
| `SelectionLayer`'s `selection` end | `regionsIn` returned nothing | `no-regions` |
| `CaptureView.capture()` in `capture-view.svelte.ts` | no open source, or no language | `no-open-book` |
| `ConsentGate.#admits` in `recognition/ui/engine/consent-gate.svelte.ts` | no regions, the language was declined this session, or a read the gate needs failed | `no-regions`, `declined-this-session`, `engine-reads-failed` |

`SelectionLayer` writes the first four into the `selection` trace. The last two write into the `capture` and `capture-gate` traces.

`RecognizerView.#admits` also holds the consent gate. The first time a language needs a model that isn't on the device yet, the reader asks before downloading it. That isn't a discard. `consent-dialog` holds the capture until I answer the question. `nothing-to-download`, `agreed-this-session` and `consent-stored` let it straight through. The dialog itself is on [Downloading, Caching and Closing Models](/projects/reader/recognition/model-lifecycle/).

`ConsentGate.#admits` is also where consent is checked. The first time a language needs a model that isn't on the device yet, Dokseo shows a consent dialog before downloading it. The gate doesn't discard the capture there: `consent-dialog` holds it until I answer the question. `nothing-to-download`, `agreed-this-session` and `consent-stored` let it straight through. A capture made before the gate's reads have come back is held too, under `waiting`, and runs once they have. The dialog itself is on [Downloading, Caching and Closing Models](/projects/dokseo/recognition/model-lifecycle/).

One naming fix came out of this layer. `SelectionLayer` had a `Point` called `origin` (its own top-left corner, used to place the box), and then gained a prop also called `origin` that set what the drag creates. With two meanings on one word in one component, the change read like a deleted coordinate prop. So the prop became `makes` and the point became the corner, which `MarqueeSelection` now measures with `cornerOf`.

## 2. `regionsIn`: one screen rect into a region per page

A selection is a rectangle in screen coordinates, but the crop has to be made from the page images, in their own pixels. And a box dragged across a two-page spread covers two images. `regionsIn` in `viewing/domain/placement.ts` does that mapping ([stage 2](/machine-learning/browser-ocr-pipeline/#2-map-one-screen-rect-into-a-region-per-page) has the general method).

Its input comes from `viewing/ui/page-placements.ts`, which collects every `[data-image-index]` element under the viewer as a `PlacedImage`: the image index, where it sits on screen, and its natural size in pixels. `PageFrame.svelte` is the component that shows a page. A page whose bytes are already an image (every archive entry) is an `<img>`, and the natural size is its `naturalWidth` and `naturalHeight`. Only a PDF page is drawn, so only a PDF page is a `<canvas>`, and its natural size is `canvas.width` and `canvas.height`. `PageFrame` puts the attribute on both.

`regionsIn` gives no region for a page whose natural size isn't positive, because it divides by that size and a zero would produce nonsense. That's correct, and on the PDF path it's why `PageFrame.svelte` sets `canvas.width` before it transfers a bitmap into the canvas. The transfer doesn't set the size by itself ([why](/images/bitmaps-and-canvas/#transferfromimagebitmap-does-not-update-canvaswidth)). If it's left at 0, every drag over that page comes back as `no-regions`, and recognition looks completely broken while every piece of code in the path is right.

`placement.ts` also has the reverse direction, for drawing a rect from image space back onto the page. It has two functions for it. `toScreenRect(placed, rect)` gives viewport coordinates, which need a fresh measurement after every zoom, pan or scroll. `toPageFraction(natural, rect)` gives percentages of the page's own size, and a box drawn that way inside `PageFrame`'s `position: relative` wrapper moves with the page by itself. The glow that marks a search result on the page uses `toPageFraction`, so zoom, pan and fit move it with no observer, and both viewers get it because both render `PageFrame`. The reasoning is in [A Selection Marquee over Zoomable Pages](/interaction/selection-marquee/#a-rectangle-drawn-as-a-percentage-of-the-page-follows-every-transform-for-free).

## 3. The crop and the stitch

With the regions known, `recognition/adapters/engine/canvas-cropper.ts` cuts them out of the page images and joins them into one picture. It uses the pixel helpers in `platform/image/pixels.ts` and runs inside a `crop` trace. The general version is [stage 3](/machine-learning/browser-ocr-pipeline/#3-the-crop-per-region-and-the-stitch-onto-an-opaque-white-ground).

- An empty region is dropped. If none are left, the result is `nothing-selected`.
- For each region, the cropper requests that image from the book's page source, and `cropFrom` copies the rectangle out with `createImageBitmap(bitmap, x, y, width, height)`. That call doesn't clip a rectangle that hangs over the edge of the image; it fills the overhang with transparent black, which later turns into a black band the model reads as ink. So `cropFrom` clamps the rect to the bitmap itself and rounds it out to whole pixels, and `pixels.spec.ts` stubs `createImageBitmap` and checks the rectangle stays inside the bitmap on all four edges. `cropFrom` is `async`, and the cropper awaits it under the `using page` that holds the full-page bitmap.
- `cropFrom` passes no `imageOrientation`. Its source is an `ImageBitmap` that's already decoded, so the default `from-image` does nothing there (`flipY` would still flip it). EXIF orientation is handled once, in `decode.ts`, when the page is first decoded.
- `stitch(parts, arrangement)` lays the parts out side by side or top to bottom, and fills the margin `#ffffff` first so no transparent pixels reach the model. The `Arrangement` type comes from `shared/arrangement.ts`, not from `viewing`, because the recognition domain and the viewing domain are both leaves and may never import each other.

For a PDF page, the render scale has to stay fixed. `pdf-page-source.ts` renders a page for the screen with `picture()` and for a crop with `image()`. Both are the same `render` at the constant `RENDER_SCALE = 2`. If the scale followed the viewport instead, the crop would silently get a lower resolution than the page on screen, and small text like furigana would be the first to go. `pdf-page-source.spec.ts` guards it over two page geometries, because a scale from the viewport width matches a constant on exactly one aspect ratio.

The cropper returns the stitched bitmap and stops there. Preparing a picture for a model is the recognizer's job, because only the recognizer has its model's input requirements. So stages 4 and 5 run in `worker-recognizer.ts`.

## 4. Grayscale, for manga-ocr only

The two engines want different pictures. manga-ocr's reference code turns every crop gray before the model sees it, and PaddleOCR's reference recognizer never does. So the preparation is chosen per engine: `inputPreparationFor(runtime)` in `recognition/domain/engine/input-preparation.ts` answers `pillow-grey` or `colour`, each with its size cap, from the model's `ModelRuntime`. `preparedFor` in the recognizer matches that answer with `.exhaustive()`, so adding a third runtime fails to compile until it picks a preparation. What PaddleOCR gets is on [engines](/projects/reader/recognition/engines/#what-each-engine-is-fed).

For manga-ocr, `toGrayscale` in `platform/image/pixels.ts` runs under a `prepare-input` trace, after the size cap in stage 5, and writes the gray value back over all three channels. The model's reference code does `img.convert("L").convert("RGB")` with Pillow, and the reader has to produce the same grays the model saw in training ([stage 4](/machine-learning/browser-ocr-pipeline/#4-grayscale)). So `pillowLuma` in `pixels.ts` is Pillow's own formula, the `L24` macro from `libImaging/Convert.c`: ITU-R 601-2 weights in 16-bit fixed point.

```ts
(r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16
```

The weights sum to 65536, so a gray pixel keeps its level exactly, and `0x8000` rounds half up.

This stage didn't start out that way. It first used the HDTV luma weights (0.2126, 0.7152, 0.0722), which the reference never uses. With those, pure red came out 54 where the model was trained on 76, and pure green came out 182 where it was trained on 150. Nothing failed; the model just got colors at different grays than it was trained on. Matching Pillow to the integer fixed it.

## 5. The cap

A drag over a whole page on a high-density screen can produce a very large crop, and the recognizer makes a second bitmap from it and transfers that to the worker. The model only reads 224 by 224 anyway. So before anything else, the crop is reduced so its long edge is at most `MAX_MODEL_INPUT_EDGE`, 2048 px. `downscaleFor(size)` in `recognition/domain/engine/model-input.ts` computes the factor, which is never above 1, and `preparedFor` passes it to `scaleBy` in `pixels.ts`. `scaleBy` draws with `imageSmoothingQuality = 'high'`, but Firefox doesn't implement that property, so there the line changes nothing. The general reasoning is in [stage 5](/machine-learning/browser-ocr-pipeline/#5-no-upscale-and-a-cap-that-can-only-reduce).

## 6. No inversion

Some bubbles are white text on black. The reader sends the crop in whatever polarity the page has, like the reference does. I measured a mean-luminance threshold in the reader, on real bubbles, and a truly inverted bubble came within 0.0021 of not triggering it. Those numbers, and the stronger argument against a global flip, are in [stage 6](/machine-learning/browser-ocr-pipeline/#6-no-inversion).

## 7. The preparation and the transfer

`recognition/adapters/engine/worker-recognizer.ts` is the part every worker-backed engine shares. It gets the stitched bitmap from the use case, prepares it, and sends it to the worker with `postMessage`. Sending an `ImageBitmap` in the transfer list moves it: the worker gets the pixels, and the sender keeps an empty husk.

That collides with the recognizer port's contract, which requires that `recognize(bitmap)` never closes or neuters the bitmap passed to it. The contract exists so a fallback decorator can pass the same bitmap to a second recognizer. So the adapter never transfers the bitmap it receives. `preparedFor` draws it into a new, capped (and for manga-ocr, grayscale) bitmap, and that new one is what gets sent:

```ts
using prepared = preparedFor(beginTrace, image);
const sent = prepared.bitmap;
target.postMessage({ kind: 'recognize', id, image: sent }, [sent]);
prepared.release();
```

`prepared` is an `OwnedBitmap` from `platform/image/bitmap.ts`, a wrapper that closes its bitmap at the end of the `using` block. If preparing throws, the new bitmap is closed. After a successful post, `release()` disarms that close, because the worker owns the bitmap now ([how the wrapper works](/images/transferring-bitmaps/#transfer-takes-ownership-so-a-disposable-wrapper-needs-a-way-to-disarm)). A `colour` preparation transfers the scaled bitmap, which is also new: `scaleBy` draws a new one even at a factor of 1.

Getting this wrong wouldn't show up at the post. The post throws nothing, and the husk reads 0 by 0. It only throws `InvalidStateError` later, when something tries to draw it, far from the cause ([a transfer neuters the sender](/images/transferring-bitmaps/#a-transfer-neuters-the-sender-so-copy-the-bitmap-before-you-post-it)). So the rule is that a sender only transfers a bitmap it made itself and won't read again.

## 8. The worker's canvas and the 224 resize

On the other side, `src/workers/ocr.worker.ts` owns the bitmap that arrived, because it arrived by transfer, and closes it in a `finally`. transformers.js doesn't accept an `ImageBitmap`, so `canvasOf` draws it onto an `OffscreenCanvas` of the crop's size, and the worker wraps that with `RawImage.fromCanvas`. The processor then resizes it to 224 by 224 ([stage 8](/machine-learning/browser-ocr-pipeline/#8-rawimagefromcanvas-and-the-processors-resize-to-224)).

That resize is a low-quality one in the browser. Doing the reduction to 224 in the worker first, with `imageSmoothingQuality = 'high'`, would replace it. That change is parked until I've compared readings before and after on real crops. The check that the geometry matches exactly is on the general page.

## 9. The encoder, the decoder and the loop

Still in `ocr.worker.ts`, the encoder runs once per crop, and then the worker runs the decoder in its own loop, one token at a time. At each step, `mostLikelyToken` in `recognition/domain/engine/most-likely-token.ts` picks the highest-scoring token at the last position. The loop stops at token 3, the end token, or at `MAX_TOKENS`, 300. Why the reader drives the decoder itself instead of using `pipeline()` is in [stage 9](/machine-learning/browser-ocr-pipeline/#9-the-encoder-the-decoder-and-a-greedy-loop). The model ids, precisions and device choice are on [engines](/projects/reader/recognition/engines/).

## 10. Whitespace only

manga-ocr's tokenizer decodes to one character at a time with spaces between them, so `こんにちは` comes back as `こ ん に ち は`. Before the worker posts the text back, `japaneseOcrText` in `recognition/domain/engine/japanese-ocr-text.ts` removes every run of `\s+` and does nothing else. The reference applies three more transforms that restyle the text, and the reader leaves them out on purpose ([stage 10](/machine-learning/browser-ocr-pipeline/#10-the-post-processing-whitespace-only)). The spec for `japaneseOcrText` pins an ellipsis, a run of dots, and half-width punctuation and digits as left untouched.

The strip could have gone in `recognized-text.ts`, the value object that holds a reading. It doesn't, because Korean is read too, and a Korean line keeps its interior spaces. The value object only trims the ends. The rule is that no Japanese-specific logic goes in a port, a use case or a value object. So the strip lives in `recognition/domain/engine/` as a pure, unit-tested module, beside the worker that calls it, like `most-likely-token.ts`. The worker itself can't be unit tested, and logic that decodes a model's output belongs to the domain wherever the file that calls it runs.

## 11. The text node

The general page stops at the model. The reader has one more stage, where the text reaches the screen. `recognition/ui/CapturePanel.svelte` renders each reading as

```svelte
<p class="m-0 text-lg" lang={language}>{card.text}</p>
```

That's plain selectable text, with `lang` taken from the book so the browser picks the right face for the characters ([why `lang` matters for CJK](/text/selection-and-ranges/#han-characters-are-unified-in-unicode)).

The reader ships no dictionary, because most readers already run one as a browser extension, and those extensions read ordinary selectable text on the page. If the reading were drawn into a canvas, none of them could see it. So the rule for this stage is that recognized text is text, and it's never drawn into a canvas. The card around the text, and the editor that replaces it, are on [Captures, Tags and Search](/projects/reader/recognition/captures/).

## The traces

On the recognition path, the stages above write into six named traces: `selection`, `capture`, `capture-gate`, `crop`, `prepare-input` and `recognize`. The worker has no trace of its own. Instead, `prepare-input` in the adapter records the picture the model is about to read, and `recognize` in `recognition/use-cases/engine/recognize-region.ts` records the crop's size, the result and the elapsed time on the main thread.

When a reading comes back wrong, either the crop was taken from the wrong place (a coordinate bug), or the model misread a correct crop. The crop's dimensions look the same in both cases. The only way to tell is to look at the crop. So `platform/trace/pipeline-trace.ts` prints the finished crop as an image in the console, with the `%c` trick from [ImageBitmap and Canvas](/images/bitmaps-and-canvas/#an-image-can-be-printed-into-the-console-with-c-and-a-padded-background).

## Who owns the bitmap, by name

A crop passes through several bitmaps on its way to the worker, and each one has to be closed exactly once by whoever owns it at that point. The general table explains each step ([who owns the bitmap](/machine-learning/browser-ocr-pipeline/#who-owns-the-bitmap-at-each-hand-off)). This is the same table with the reader's names:

| Hand-off | Who owns it afterwards |
| --- | --- |
| `source.image(index)` | `canvas-cropper.ts`, under `using page`; closed before the next region is read |
| `cropFrom` per region | the cropper's `DisposableStack` |
| `stitch`, `scaleBy`, `toGrayscale` | each returns a new `OwnedBitmap`; the input is untouched |
| the cropper's return | the caller, via `stitched.release()` |
| `recognizeRegion` | wraps it straight back in `using crop`, so it's closed when the use case ends |
| `recognizer.recognize(bitmap)` | still the use case; the port never closes or transfers the bitmap passed to it |
| the prepared bitmap in `worker-recognizer.ts` | held under `using`, transferred, then `release()`d; the original is untouched |
| the arrival in `ocr.worker.ts` | the worker, which closes it in a `finally` |
| `trace.image(name, bitmap)` | nobody; it copies synchronously, and a unit test fails if it ever closes or transfers |
| `transferFromImageBitmap` in `PageFrame` (PDF pages) | the canvas; read the dimensions before the transfer |
