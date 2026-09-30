---
title: An Image OCR Pipeline in the Browser, Stage by Stage
description: "From a drag over a page image to a line of text: cropping, preparing, transferring, and running an encoder-decoder model in a worker."
tags: [machine-learning, ocr, transformers-js, onnx, images, web-workers, canvas]
sidebar:
  order: 1
---

My example is Dokseo, my manga OCR reader. It shows manga pages as images, and when I drag a box over a speech bubble, the text in the bubble comes back as one line of text I can select. The model that reads it is manga-ocr, run through transformers.js and ONNX in a worker. Between the drag and the text, a single drag goes through ten stages: the selection is mapped onto the page images, cropped out, prepared for the model, sent to the worker, recognized and cleaned up.

Up to the model, the pipeline matches `manga_ocr/ocr.py` in `kha-white/manga-ocr` stage for stage. That repo is the upstream of every manga-ocr model on the Hub, so its code shows how the model's training images were prepared, and a model is most accurate when its input is prepared the same way. Keeping that stage-for-stage match is the thing to protect whenever I change any of this. After the model, my pipeline deliberately does something different: it only removes the whitespace the decoder put in.

A model with a different runtime (a PaddleOCR line recognizer, say) is read by its own worker, and stages 8 to 10 don't describe that one.

These names come up in every stage. The code that shows pages and handles the drag is one domain (the viewing side), and the code that turns a picture into text is another (the recognition side). On the recognition side, a cropper cuts the selection out of the page images. A recognizer takes the cropped picture and returns text. The rest of the app only calls the recognizer through a port (an interface with a `recognize(bitmap)` method), and a recognizer adapter implements that port by sending messages to the worker that runs the model. A use case, the code for one capture, calls the cropper and then the recognizer.

The other pages in this folder go deeper on single stages: [loading the model](/machine-learning/loading-hub-models/), [downloading it](/machine-learning/model-downloads/), [the decoder](/machine-learning/decoding-model-output/), [WebGPU fallback](/machine-learning/webgpu-fallback/) and [the worker's lifecycle](/machine-learning/worker-lifecycle/).

## The numbers that constrain the design

These numbers come up in the stages below, and each one is set by the model, by the pipeline, or by a measurement:

| Number | What it is | Where it comes from |
| --- | --- | --- |
| 224 by 224 | the model's input size, squashed, mean and std 0.5 | `preprocessor_config.json` on the Hub, applied by the processor inside the worker |
| 6144 | the decoder's vocabulary, and the count a tokenizer must match | `config.json`, checked before a model id is trusted |
| 2 layers, hidden 768 | the decoder, a small BERT; the encoder is the expensive half | `config.json` |
| 300 | the greedy loop's token ceiling | a constant in the worker |
| 12 px | the minimum selection edge, below which a drag is a misclick | the selection domain |
| 2048 px | the long edge a crop is reduced to before transfer | the recognition domain |
| 123 MB | my q8 manga-ocr export's one-time download (with the ONNX runtime), 144 MB on disk; the fp32-decoder model is 211 MB and 231 MB | measured file sizes |

## 1. The drag, and the guards that can discard it

A base marquee component draws the selection box (the component itself is in [A Selection Marquee over Zoomable Pages](/interaction/selection-marquee/)). It classifies the gesture at `pointerdown`, and captures the pointer so a drag keeps working after it leaves the element. At `pointerup` it settles the drag as either a refusal (something went wrong with the gesture itself) or an end (a click, a drag that's too small, or a selection). A component in the viewing domain hosts the marquee over the pages and turns a selection into regions.

On the way from the drag to the model, several checks (I call them guards) can end the whole thing with nothing on screen: the released pointer isn't the one being held; there's no surface or no anchor; either edge is under the minimum; the rect doesn't cover any page; nothing is open to read from; the model download was already declined. From the outside, every one of these looks the same. I drag, let go, and no text appears, which looks exactly like a broken feature.

So **each guard writes its own name into a trace** (`pointer-mismatch`, `below-minimum`, `no-regions`…), a named debug log that the pipeline writes as it runs. A silent discard leaves no record. A named one records what happened in one line.

A consent gate for the model download sits next to the last guard, and it doesn't discard anything. The model is a large download, so the first capture that needs it shows a prompt before downloading. The gate pauses the capture until there's an answer. It lets the capture straight through when nothing needs downloading, when consent was given this session, or when consent is stored.

## 2. Map one screen rect into a region per page

The selection is a rectangle in screen coordinates, but the crop has to be cut from the page images, in their own pixels. And a box can cover more than one page image. So the first step maps the one screen rectangle onto each image it touches.

Collect every `[data-image-index]` element under the viewer as a placed image: the image index, the on-screen rect from `getBoundingClientRect()`, and the *natural* size. That's `naturalWidth` and `naturalHeight` for an `<img>`, and `width` and `height` for a `<canvas>`. A page component that shows an encoded page as an `<img>` and a drawn one as a `<canvas>` puts the attribute on both. Intersect the selection with each placement, and map the overlap into image pixels with `natural.width / frame.width`. Drop any page the box doesn't touch.

So a box dragged across a two-page spread becomes two image regions, each with its own image index and its own rect, in page order.

A placement whose natural size isn't positive gives no region at all, because the mapping divides by that size. That's correct, and it's why the page component has to set `canvas.width` before it transfers a bitmap into the canvas: the transfer doesn't set the size by itself. If the canvas stays at 0, every drag over that page ends at the `no-regions` guard, and recognition looks broken while every piece of code in the path is right. See [ImageBitmap and Canvas](/images/bitmaps-and-canvas/).

## 3. The crop per region, and the stitch onto an opaque white ground

With the regions known, the cropper cuts each one out of its page image and joins the parts into one picture. The cropper is an adapter over a small pixel module, which holds the actual pixel operations.

An empty region gets dropped, and if no regions are left, that's a `nothing-selected` error. For each region that's left, the cropper reads that image out of the page source (the object that supplies a book's page images), clamps the rect to the bitmap, and rounds it outwards to whole pixels. Then `createImageBitmap(bitmap, x, y, width, height)` copies that source rectangle out. There's no canvas, so the crop is `async`, and the cropper awaits it under the `using page` that holds the full-page bitmap.

**The browser doesn't clamp the rect, so I have to, and if the clamp is removed nothing reports an error.** `drawImage` clips a source rectangle to the image. `createImageBitmap` does *not*: it pads the overhang with transparent black. If a region's rect reached past the bitmap and there were no clamp, the padding would reach the grayscale step (stage 4), which writes luma into RGB and leaves alpha alone. So the pad arrives at the recognizer as a black band that the model recognizes as ink, and nothing fails anywhere. A spec that stubs `createImageBitmap` and asserts that the source rectangle stays inside the bitmap on all four edges locks this down.

Don't pass any `imageOrientation` to the crop. Its source is an `ImageBitmap` that's already decoded, so the default `from-image` does nothing there (and `flipY` would flip it). EXIF orientation belongs to the decode step, which calls `createImageBitmap(blob, { imageOrientation: 'from-image' })`.

**A page source shows and crops the same pixels.** A PDF page is rendered by pdf.js, and a pdf.js page source renders it twice: a picture for display, and an image for a crop. These should be the same render at a constant scale. If that scale follows the viewport, the two drift apart and nothing reports it: the crop loses resolution, and small text (furigana) goes first. Test it on *two* page geometries. A scale based on the viewport width matches a constant on exactly one aspect ratio, so one geometry proves nothing.

When a selection covers two pages, the stitch joins the parts. It lays them out along one axis (widths for a `row`, heights for a `column`) and centers each one across the other axis, rounded to a whole pixel. The arrangement type (`row` or `column`) is used by both the viewer and the recognizer. If those are separate domains that may not import each other, keep the arrangement type in a shared kernel.

**Fill the cross-axis margin with `#ffffff` before anything is drawn.** Centering leaves a margin beside the narrower part. This is the one place where the pixel module writes a value of its own instead of copying. A transparent margin reaches the recognizer as whatever it gets composited onto.

**The cropper returns the stitched bitmap.** It fetches, cuts and stitches, and that's where it stops. Preparing an image for a model is the recognizer's job, because the model's input requirements live in the recognizer and nowhere else. Stages 4 and 5 run in the recognizer adapter, not here.

## 4. Grayscale

Each engine gets its input prepared the way its own reference prepares it. manga-ocr's reference turns every crop gray before it reaches the model, so the model was trained on gray pictures. PaddleOCR's recognizer reads color. So the preparation is chosen per engine, in pure code, from the model's runtime: a named union of `pillow-grey` and `colour`, each variant with its own size cap (stage 5). The code that builds the input matches it exhaustively, so adding a runtime doesn't compile until I choose a preparation for it.

**For manga-ocr, match Pillow's gray to the integer.** The recognizer adapter's input preparation computes a gray value per pixel and writes it back over all three channels. That's `img.convert("L").convert("RGB")` from the reference. The model is a three-channel ViT, so the image stays RGB with equal channels instead of becoming one channel. Run this after the cap in stage 5, so it reads a long edge of 2048 at most.

Pillow's `convert("L")` uses the ITU-R 601-2 weights (0.299, 0.587, 0.114), but not as floats. It's the `L24` macro in `libImaging/Convert.c`, in 16-bit fixed point:

```c
#define L24(rgb) ((rgb)[0] * 19595 + (rgb)[1] * 38470 + (rgb)[2] * 7471 + 0x8000)
// gray = L24(pixel) >> 16
```

The three weights sum to 65536, so a pixel that's already gray keeps its exact level, and adding `0x8000` (half of 65536) before the shift rounds to the nearest level, with halves going up. Writing the same integer arithmetic gives the same gray values as the reference, not values that are off by one here and there.

Rec. 709 weights (0.2126, 0.7152, 0.0722) would break the stage-for-stage match. Nothing would fail; the model would just get colors at different grays than its training images had. Pure red comes out 54 under Rec. 709, where the model was trained on 76, and pure green comes out 182 instead of 150. Converting RGBA to "L" goes through the same routine as RGB, so Pillow drops alpha without compositing it onto anything.

**For PaddleOCR, keep the color and order it BGR.** A PP-OCRv5 recognizer's own `inference.yml` says `DecodeImage: img_mode: BGR` and `RecResizeImg: image_shape: [3, 48, 320]`. PaddleX's `resize_norm_img` resizes the color image to a height of 48, keeps the BGR order through its `transpose((2, 0, 1))` (which only moves the channel axis first), maps each level to `(level / 255 - 0.5) / 0.5`, and pads the rest of the width with zeros. So the adapter builds the tensor from the RGBA pixels with blue first.

Test that channel order. While the input was gray, all three channels were equal and the order couldn't matter, so nothing would have caught a mistake. If an engine also needs one value per pixel (for line banding of my own, say), compute a luma from the color pixels rather than reading one channel, which is the luma only when the image is already gray.

## 5. No upscale, and a cap that can only reduce

The model reads 224 by 224, whatever size the crop is. So the only size change the pipeline itself makes is a cap that protects memory.

**There's no upscale.** The processor resizes whatever it gets to 224 by 224. An enlargement in front of it would mean two resamplings where the reference does one, over many times the pixels, and the second would throw away what the first made up.

**The cap can only shrink.** `downscaleFor(size)` returns `min(1, 2048 / longest edge)`. It's never above 1, and it's 1 for a degenerate size. A `scaleBy` that draws with `imageSmoothingQuality = 'high'` applies it.

The only reason for the cap is memory. The adapter prepares a second bitmap and transfers it (stage 7), so an uncapped drag over a full page at a high device pixel ratio allocates tens of megabytes twice per capture. Reducing to a 2048 long edge doesn't cost any quality, because the input is 224 either way.

## 6. No inversion

Some speech bubbles are white text on black. It's tempting to detect those and flip them to dark on light before the model reads them. **There's no auto-invert.** The crop goes to the model in whatever polarity the page has (dark text on light, or light on dark), exactly like the reference.

I measured a mean-luminance threshold of 0.35 on real pages and rejected it:

| Bubble | Mean luminance | Would fire |
| --- | --- | --- |
| White text on black | 0.3479 | yes, by 0.0021 |
| Black text on white | 0.6431 | no, by 0.2931 |

A bubble that really was inverted came within 0.6% of not triggering the rule written for it. Two pixels of difference in where the drag stopped would flip the branch.

The structural argument is even stronger. A crop can hold *both* polarities, for example a bubble and the dark panel next to it. One global flip can't help that crop. The flip makes one half readable and the other unreadable. All it changes is which half gets damaged.

## 7. The preparation, and the transfer to the worker

This happens in the recognizer adapter, which every worker-backed engine shares. It takes the stitched bitmap from the use case, prepares it (stages 4 and 5), and sends the result to the worker.

Sending is where ownership matters. `postMessage(message, [bitmap])` *moves* a bitmap and leaves the sender with an empty shell, with no error on either side (details in [Transferring ImageBitmaps](/images/transferring-bitmaps/)). That clashes with a guarantee the recognizer port needs. Make it part of the port's contract that `recognize(bitmap)` never closes or neuters the bitmap it receives. That way a fallback decorator (a wrapper around a recognizer that retries with a second one) can pass the same bitmap to a second recognizer.

**Stages 4 and 5 already pay for that contract, so no extra copy is needed.** The scale and the grayscale each return a *new* bitmap that the caller owns. So the bitmap the adapter transfers is one it made and owns, and the one it received never gets touched. A color preparation transfers the scaled bitmap itself, which is new even at a factor of 1.

Hold the prepared bitmap under `using` until `release()` at the point of transfer. If preparing throws, that closes it. A successful transfer disarms the close, so nothing gets freed twice.

## 8. `RawImage.fromCanvas`, and the processor's resize to 224

This runs in the worker. The worker owns whatever arrives, because it arrived by transfer, and it closes it in a `finally` no matter what happens.

transformers.js doesn't accept an `ImageBitmap`. So draw it onto an `OffscreenCanvas` the size of the crop and wrap that with `RawImage.fromCanvas`. The processor (the part of transformers.js that turns an image into the model's input) then resizes to 224 by 224, rescales to 0..1, and normalizes with mean and standard deviation 0.5 on each channel.

**The processor's resize is a low-quality one.** The web branch of `RawImage.resize` is a bare `ctx.drawImage(canvas, 0, 0, w, h)` that never sets `imageSmoothingQuality`, so the browser default `'low'` applies. That samples too few neighbors for a ninefold reduction, which can alias fine strokes into noise. (Firefox doesn't implement `imageSmoothingQuality` at all, so there `'high'` in stage 5 or below doesn't change anything either.) The web branch also *ignores* `resample`, which is only used in the Node/sharp path. So the config's `resample: 2` never means bilinear in a browser.

**A reduction to 224 on the worker side is possible, but compare first.** If I draw the crop into a 224 square canvas with `imageSmoothingQuality = 'high'`, the worker's resize becomes the only one, because `RawImage.resize` returns early when the image already has the requested size. That's only safe if the geometry matches exactly, so check it instead of assuming. `ViTImageProcessor` is an empty subclass of `ImageProcessor`. `size` is `{height: 224, width: 224}` with no `shortest_edge`, so `get_resize_output_image_size` returns `[224, 224]` outright and *squashes* the image. `keep_aspect_ratio`, `ensure_multiple_of`, `do_center_crop`, `size_divisibility`, `do_pad` and `do_thumbnail` are all absent. Nothing after the resize reads the original dimensions except `original_size`. If the model or the repository changes, run that check again. Measure the reading before and after on real crops before shipping it.

**The 2048 cap and the 224 input are separate concerns** on either side of the `postMessage`. The cap limits what gets copied and transferred (stage 5). The input size belongs to the model and gets applied inside the worker. 224 doesn't belong in a generic pixel module. Neither number belongs in the cropper, which returns a faithful picture of what was selected and nothing specific to a model.

One cost to know about: `preprocess` calls `image.rgb()` *before* the resize, and `resize` goes through a canvas again. So a crop at the 2048 cap allocates a 16 MB `getImageData`, a 12 MB RGB copy and a second canvas at that size before a single tensor exists.

## 9. The encoder, the decoder, and a greedy loop

This is the same worker. manga-ocr is an encoder-decoder model: the encoder reads the image once, and the decoder then produces the text one token at a time. The worker has no trace of its own, so do the tracing on the main thread instead: the adapter's preparation can record the picture the model reads, and the use case can record the crop's size, the result and the elapsed time.

`AutoModel.from_pretrained` opens a manga-ocr export as two sessions, `model` (the encoder) and `decoder_model_merged`. Each half can be stored at a different precision, and transformers.js takes the precision as a dtype record. That record is keyed by *file* name, not by session name (`encoder_model` and `decoder_model_merged`). So keep each model's precision next to its id: q8 for both halves in `kimchireader/manga-ocr-onnx-q8`, and a q8 encoder with an fp32 decoder in `DigitalLarynx/manga-ocr-onnx`. (More in [Loading Hub Models](/machine-learning/loading-hub-models/).)

Pick the device from the chosen compute setting. Use WASM for CPU (and for an automatic default, if WebGPU hasn't worked yet). Use WebGPU only when `navigator.gpu.requestAdapter()` returns an adapter, and fall back to WASM if the open fails, or if the first run fails or hangs (15 seconds here). The reasons are in [WebGPU Fallback for ONNX Models](/machine-learning/webgpu-fallback/).

The encoder runs *once* per crop. Then the worker does the decoding itself. Start at token 2, feed the *whole* prefix to the decoder on every step, and take the argmax at the last position (the token with the highest score). Stop at token 3 or at 300 tokens. That's a greedy loop: each step keeps only the single most likely token.

```ts
const encoded = await encoder.run({ pixel_values: inputs.pixel_values });
const tokens = [DECODER_START_TOKEN];
while (tokens.length < MAX_TOKENS) {
  const step = await decoder.run({
    input_ids: new Tensor('int64', BigInt64Array.from(tokens, BigInt), [1, tokens.length]),
    encoder_hidden_states: encoded.last_hidden_state,
  });
  const next = mostLikelyToken(step.logits);
  if (next === END_OF_TEXT_TOKEN) break;
  tokens.push(next);
}
```

**Feeding the whole prefix isn't an oversight.** A really merged decoder could take one new token per step and keep the rest in a cache. No published manga-ocr export, my own included, has a decoder that's really merged, because Optimum can't export a BERT decoder with a cache, and `pipeline('image-to-text')` goes by the file name and returns fluent-looking rubbish: see [Decoding Model Output](/machine-learning/decoding-model-output/). That's also why there's no beam search.

## 10. The post-processing: whitespace only

The tokenizer turns the tokens back into a string, and that string needs one fix before it's shown. This is a pure function applied to the tokenizer's output before the worker posts it back. It removes every run of whitespace (`\s+`) and does nothing else.

The fix is needed because the decode is character-level WordPiece with no `##` marking, so it comes back as `こ ん に ち は`. Japanese has no spaces, so the strip undoes damage done between the model and the page. It doesn't change what the model output.

**The reference's other three transforms can be left out on purpose.** `post_process` in manga-ocr also turns `…` into `...`, turns a run of 2+ of `・` or `.` into that many `.`, and widens ASCII and digits to full width (`jaconv.h2z(text, ascii=True, digit=True)`). So an ellipsis ends up as `．．．`. Those change the style of what the model read. The reference is a desktop tool whose output gets pasted somewhere else, where normalized width matters. Text read on screen doesn't need it. Skipping them means my output differs from manga-ocr's on any line with an ellipsis, a run of dots, or half-width punctuation or digits. Pin each of those cases in a spec as left untouched. If a feature ever needs normalized width (an export, a search), it normalizes at its own boundary.

If you port all four, the order matters. The whitespace strip has to come before the run rule, or `. .` isn't a run. The widening has to come after it, or a widened `．` no longer matches `[・.]`. The widening is a +0xFEE0 shift: `[!-~]` is 0x21 to 0x7E, and the full-width block runs from 0xFF01 in the same order.

**Keep it out of a language-neutral value object.** Say the app also reads another language, like Korean, and holds every reading in one recognized-text value object. That object should only trim the ends, since a Korean line keeps its interior spaces. Put the Japanese strip in a pure, unit-tested module in the recognition domain, next to the worker that calls it (a worker can't be unit tested itself). Logic that depends on what a model's output means belongs to the domain, wherever the file that calls it runs.

And render the result as *text* in the DOM, never drawn into a canvas, with `lang` set so the right font face gets picked (why `lang` matters for CJK is in [Selections and Ranges](/text/selection-and-ranges/)). Dictionary browser extensions read ordinary selectable text, so a reading drawn into a canvas would be invisible to them.

## Who owns the bitmap at each hand-off

Every bitmap in this pipeline has to be closed exactly once, with `close()`, by whoever owns it at that moment. No mistake in this column raises an error. A neutered bitmap reads 0 by 0 and only throws once something tries to draw it, often far away from the mistake. A second `close()` silently does nothing.

A small `OwnedBitmap` wrapper handles it: `using` closes it on the way out (safely, even if it's already closed), and `release()` disarms that at exactly the point ownership moves on. The table follows one crop from the page to the worker:

| Hand-off | Who owns it afterwards |
| --- | --- |
| `source.image(index)` | the cropper, under `using page`; closed before the next region is read |
| the crop per region | the cropper's `DisposableStack`, because `using` cannot bind a list built in a loop |
| stitch, scale, grayscale | each returns a new owned bitmap; the input is untouched, so the caller's `using` still governs it |
| the cropper's return | the caller, via `stitched.release()`; the only bitmap that leaves the block alive |
| the use case | wraps it straight back in `using crop`, so it dies when the use case ends whatever the recognizer did |
| `recognizer.recognize(bitmap)` | still the use case. The port never closes or transfers what it receives, so a fallback decorator can pass the same bitmap on |
| the adapter's prepared bitmap | held under `using`, then transferred to the worker and neutered here via `release()`; the original is untouched |
| the worker's arrival | the worker, which closes it in a `finally` |
| a debug trace's `image(name, bitmap)` | nobody. It copies synchronously and returns; a unit test should fail if it ever closes or transfers |
| `transferFromImageBitmap` on a canvas | the canvas. Do not close it afterwards, and read its dimensions before the transfer |
