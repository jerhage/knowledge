---
title: OCR Engines, Models and Devices in the Reader
description: The two runtimes (manga-ocr for Japanese, PaddleOCR for Korean), what each is fed, the model catalog and precisions, and the device choice with its WebGPU fallback.
tags: [reader, ocr, machine-learning, onnx, transformers-js, webgpu, i18n]
sidebar:
  order: 61
---

The reader recognizes text in two languages, and each uses a different kind of model. Japanese goes through manga-ocr, which is a ViT image encoder plus a small BERT text decoder. Korean goes through PaddleOCR's PP-OCRv5 line recognizer, which is a single model graph. Both run in the browser, in a worker, through transformers.js and ONNX. This page covers what each model is fed, which models the reader offers, and how it chooses between the CPU and the GPU. The general pieces are [Loading Hub Models](/machine-learning/loading-hub-models/), [Decoding Model Output](/machine-learning/decoding-model-output/) and [WebGPU Fallback](/machine-learning/webgpu-fallback/). The stage-by-stage path through the reader's files is on [the pipeline page](/projects/reader/recognition/pipeline/).

## Two runtimes, two workers

Every model the reader knows has a `ModelRuntime`, either `manga-ocr` or `paddle-ocr`. The runtime decides which worker runs the model and which adapter talks to that worker:

| Runtime | Worker | Adapter |
| --- | --- | --- |
| `manga-ocr` | `src/workers/ocr.worker.ts` | `manga-ocr.adapter.ts` |
| `paddle-ocr` | `src/workers/paddle-ocr.worker.ts` | `paddle-ocr.adapter.ts` |

The adapters share their plumbing: both are built on `recognition/adapters/engine/worker-recognizer.ts`, and each passes its runtime to `createWorkerRecognizer`. The container, which builds every adapter in the app, picks the adapter for a language with `match(runtime).exhaustive()`. Because the match is exhaustive, adding a third runtime fails to compile there until it's handled, and again in the recognizer's input preparation until it picks one ([below](#what-each-engine-is-fed)) (see [wiring](/projects/reader/architecture/wiring/) and [exhaustiveness without a library](/typescript/type-checking-techniques/#exhaustiveness-without-a-library)).

## The numbers

These are the numbers that define the Japanese path, and where each lives:

| Number | What it is | Where |
| --- | --- | --- |
| 224 by 224 | manga-ocr's input size, squashed, mean and std 0.5 | `preprocessor_config.json`, applied by the processor in the worker |
| 6144 | the decoder's vocabulary, and the count a tokenizer must match | `config.json` |
| 2 layers, hidden 768 | the decoder, a small BERT; the encoder is the expensive half | `config.json` |
| 300 | `MAX_TOKENS`, the greedy loop's ceiling | `src/workers/ocr.worker.ts` |
| 12 px | `MIN_SELECTION_PX`, below which a drag is a misclick | `viewing/domain/selection.ts` |
| 2048 px | `MAX_MODEL_INPUT_EDGE`, the long edge a crop is reduced to | `recognition/domain/engine/model-input.ts` |
| 123 MB | the default Japanese model's one-time download, 144 MB on disk; the fp32-decoder model is 211 MB and 231 MB | `downloadMb` and `onDiskMb` over `recognition/domain/model/model-footprint.ts` |

## What each engine is fed

A model expects its input prepared the way its reference code prepares it. A difference raises no error; it just changes what the model sees. The two references prepare a crop differently, so the reader does too. `inputPreparationFor(runtime)` in `recognition/domain/engine/input-preparation.ts` answers an `InputPreparation` for the model's runtime:

- `manga-ocr` gets `pillow-grey`: the 2048 cap, then Pillow's integer gray value written back over all three channels. That matches the reference's `img.convert("L").convert("RGB")`, which uses Rec. 601 weights (details in [grayscale](/machine-learning/browser-ocr-pipeline/#4-grayscale) and on [the pipeline page](/projects/reader/recognition/pipeline/#4-grayscale-for-manga-ocr-only)).
- `paddle-ocr` gets `colour`: the cap and nothing else, because PaddleOCR's reference recognizer never converts to gray.

The PaddleOCR reference does depend on channel order, though. PP-OCRv5's recognizer, as its own `inference.yml` configures it, decodes with `DecodeImage: img_mode: BGR` and resizes with `RecResizeImg: image_shape: [3, 48, 320]`. PaddleX's `OCRReisizeNormImg.resize_norm_img` (and `tools/infer/predict_rec.py` in PaddleOCR, for `SVTR_LCNet`) then resizes the color image to height 48, keeps the BGR order through `transpose((2, 0, 1))`, divides by 255, subtracts 0.5, divides by 0.5, and pads with zeros to the width.

`lineTensorData` in `recognition/domain/engine/line-tensor.ts` builds exactly that tensor from a canvas's RGBA pixels: the blue plane first, then green, then red, each `(level / 255 - 0.5) / 0.5`, zero padded. Before the Paddle path switched to color, every crop arrived gray, so all three channels held the same value and their order couldn't matter. Now it does, and `line-tensor.spec.ts` pins it.

The switch to color broke one other thing. `paddle-ocr.worker.ts` has its own `textLineBands` step, which has no counterpart in the reference and needs one value per pixel. It read channel 0, the red channel. That had been the gray value only because every channel used to be written gray. Once color arrived, it would have read red instead. So `lumaPlane` in `pixels.ts` now computes the Pillow gray value from the color pixels.

## The model catalog

For Japanese, the reader offers two models: `kimchireader/manga-ocr-onnx-q8`, the default, which I made for the reader, and `DigitalLarynx/manga-ocr-onnx` beside it. Both are ONNX exports of `kha-white/manga-ocr-base`, a vision encoder-decoder (a ViT encoder and a BERT decoder), made to run through transformers.js in the browser. Several other manga-ocr exports on the Hub can't be used at all; both of these passed the [four checks](/machine-learning/loading-hub-models/#four-checks-before-a-model-id-goes-in-the-worker-and-a-tag-is-not-one-of-them) that the other three repositories in that table failed.

`AutoModel.from_pretrained` opens each as two sessions, `model` (the encoder) and `decoder_model_merged`. Each half can be stored at a different precision: q8 is 8-bit quantized and smaller, and fp32 is full precision. The reader looks the precision up from the model's footprint, `knownModel(modelId)?.precision`, and falls back to `QUANTIZED_THROUGHOUT` for a model it doesn't know:

| Model | Encoder | Decoder |
| --- | --- | --- |
| `kimchireader/manga-ocr-onnx-q8` (default) | q8 | q8 |
| `DigitalLarynx/manga-ocr-onnx` | q8 | fp32 |

I made my export because of the decoder's precision. transformers.js only loads an encoder-decoder's decoder from a file named `decoder_model_merged` (the first of the four checks), and before my export, no repository had a quantized decoder under that name. `DigitalLarynx/manga-ocr-onnx` pairs its q8 encoder with an fp32 decoder, 204 MB of weights. In mine, both halves are q8: `onnx/encoder_model_quantized.onnx` is 87.0 MB and `onnx/decoder_model_merged_quantized.onnx` is 29.6 MB, 117 MB of weights in all. The tokenizer, with its 6,144 entries, comes from `DigitalLarynx/manga-ocr-onnx`. So the one-time download went from 211 MB to 123 MB, a little over 40% smaller, and the model takes 144 MB on the device instead of 231 MB.

My decoder isn't really merged either. A real merged decoder has a key-value cache, and Optimum doesn't export a cached decoder when the decoder is BERT, so like every manga-ocr export on the Hub, mine is the plain decoder saved under the name transformers.js loads ([what that name implies](/machine-learning/decoding-model-output/)). That's why the smaller decoder doesn't change the speed: recognition isn't slower, and it isn't faster either, because without a cache the worker still runs its own greedy decode loop (see [Decoding](#decoding)). I haven't compared the quantized decoder formally with the full-precision one. In use on real pages, I've seen no difference.

The precision goes to transformers.js as a `dtype` record, and that record is keyed by file name (`encoder_model` and `decoder_model_merged`), not by session name. A key that matches no file is only logged at info level, and that half gets the device default: q8 on WASM, fp32 everywhere else. So a misspelled key doesn't fail; it just loads a different file than intended ([dtype is keyed by file name](/machine-learning/loading-hub-models/#dtype-is-keyed-by-file-name-not-by-session-name)). That's why the precision lives next to the model id, spelled with the file names.

The Korean model is a single bare ONNX graph. It loads through `PreTrainedModel` with a custom config and an empty `subfolder` ([how that works](/machine-learning/loading-hub-models/#a-bare-onnx-graph-loads-through-pretrainedmodel-with-no-onnxruntime-import)). Passing a transformers `Tensor` straight to `session.run()` works, because ORT accepts it; `ocr.worker.ts` already relied on that.

## Decoding

For manga-ocr, `ocr.worker.ts` runs the encoder once per crop and then drives the decoder itself. It starts at token 2, feeds the whole prefix to the decoder at every step, and stops at token 3 or after 300 tokens. The obvious shortcut, `pipeline('image-to-text')`, returns confident nonsense here: every published `decoder_model_merged.onnx`, my own export's included, is a plain decoder under a merged name, and the pipeline treats the file as merged because of the name ([the whole story](/machine-learning/decoding-model-output/#pipeline-feeds-a-merged-decoder-one-token-at-a-time-based-on-the-file-name)). The same missing merge is why there's no beam search.

The decoded text comes back with a space between every character ([why](/machine-learning/decoding-model-output/#a-character-level-wordpiece-decode-puts-a-space-between-every-character)). `japaneseOcrText` in `recognition/domain/engine/japanese-ocr-text.ts` strips it. The reference's post-processing has four transforms, and this is the first of them and the only one the reader applies.

For PaddleOCR, the line recognizer's output is CTC: a score for every character at every horizontal step, including a blank. It's decoded in `recognition/domain/engine/ctc-reading.ts`, with `previous` assigned on every step, blanks included, so two identical characters separated by a blank stay two characters ([the collapse order](/machine-learning/decoding-model-output/#ctc-decoding-and-the-collapse-that-looks-right-and-is-not)).

## Choosing a device

The reader has a Compute setting with three choices: `cpu`, `gpu` and `auto`. `chosenDevice` turns that setting into the device the worker asks for. `cpu` and `auto` give WASM, which runs on the CPU. `gpu` gives WebGPU, but only when `navigator.gpu.requestAdapter()` yields an adapter, since otherwise there's no GPU to use. The engine pill in the reader shows which device the model ended up on.

So by default, OCR runs on the CPU through WASM. I chose that because every device supports WASM, and in my testing it's plenty fast. The GPU option is there for enthusiasts who want it.

That default isn't how the Firefox bug below came about. When it happened, `auto` resolved to WebGPU whenever there was an adapter. That bug is also how the device choice got its fallbacks, which still protect anyone who picks `gpu`.

## Firefox ran the Korean model and not the Japanese one

On a deployed build, in Firefox on macOS, Korean recognition worked and Japanese failed. Setting Compute to CPU made Japanese work. Chrome was fine with both.

Firefox had just shipped WebGPU on Apple Silicon Macs (145 on macOS Tahoe, 147 on older macOS; Intel Macs don't have it), and at that point `chosenDevice('auto', true)` resolved to `webgpu` there. So both models ran on a young WebGPU implementation, and they don't push it equally hard. PP-OCRv5 is a single graph. manga-ocr is a ViT and a BERT driven by my own greedy loop, which means far more operators and far more shader compilation. The GPU existed, but it couldn't run the bigger model ([a WebGPU that exists is not a WebGPU that runs every model](/machine-learning/webgpu-fallback/#a-webgpu-that-exists-is-not-a-webgpu-that-runs-every-model)).

The failure was total, not a slowdown, because nothing fell back to the CPU when the GPU let the reader down. So now both workers build their model through `openOnDevice` in `src/workers/device-fallback.ts`. It runs the open on `webgpu`, and if that throws, it runs the same open again on `wasm`. The resulting session carries `fellBackFrom`, because the UI can't tell a refusal apart otherwise: `gpu` on a machine with no adapter also reports `wasm`, and that isn't a refusal.

The cost is one wasted WebGPU open per book open on an affected browser. Nothing stores the failure. That's on purpose, because a stored failure would outlive the browser version that caused it.

## The first run is the probe

The fallback on open wasn't enough, because Firefox didn't fail the open. It opens manga-ocr on WebGPU without an error, and the engine pill reads GPU. Then I drag over a bubble, and the first `session.read` sits on "Reading the selection." forever. If I try again, the second attempt rejects from inside the inference, with the `OrtRun()` `BufferManager::Download` error quoted on [the general page](/machine-learning/webgpu-fallback/#firefox-can-open-a-model-on-webgpu-and-then-hang-on-the-first-run). A `catch` around the open can't catch either of those.

So `guardFirstGpuRun` in `device-fallback.ts` races the first run of a `webgpu` session against a deadline, `FIRST_GPU_RUN_DEADLINE_MS`, and treats a rejection and a timeout the same way. It discards the memoized `opening`, reopens the model on `wasm` through `reopenOnCpu`, retries the same crop once, and resolves the original request with the retry's result. I get my text instead of an error.

The deadline is 15 seconds, and it's set to avoid a false fallback, not to keep the wait short. A first GPU run pays for WebGPU startup, shader compilation for a ViT encoder and a BERT decoder, and up to 300 decoder calls, which a slow integrated GPU can take a long time to finish. A false fallback would take the GPU away for the rest of the session and show a wrong reason. The price is that on an affected browser, the first crop can take up to 15 seconds, once per worker lifetime. Only the first run is timed, since one finished run proves the GPU works.

The run that timed out is abandoned, not canceled, because nothing can cancel an ONNX Runtime run. So it has to be harmless when it finally settles. Its promise gets both handlers as soon as it's raced, so a late failure isn't an unhandled rejection, and it can't post a reply. The crop survives for the retry because `recognize` closes the bitmap in a `finally` that runs after the guard resolves. There's one gap I know about: the Paddle worker's `read` draws from the bitmap inside its band loop, across awaits, so an abandoned run there can reach for a bitmap that's been closed since. That throws into the handler nobody reads.

The reopen posts a fresh `{ kind: 'opened' }` reply with `device: 'wasm'` and `fellBackFrom: 'webgpu'`, under the original open request's id. `worker-recognizer` calls `onSession` on every `opened` reply, not only the first. So the engine pill flips to CPU and shows the reason with the sentence it already had, and the UI needed no change. Reusing the open id is safe because `finishOpening` has already released its resolver by then.

So the device rule the reader follows now: the GPU is only proven by a model that opens and finishes its first run on it. `openOnDevice` falls back to WASM when the WebGPU open throws, and `guardFirstGpuRun` falls back when the first WebGPU run fails or takes longer than 15 seconds.
