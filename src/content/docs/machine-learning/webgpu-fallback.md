---
title: WebGPU Fallback for ONNX Models
description: Why an available GPU is not a working one, and falling back to WASM on a failed open or a failed or hung first run.
tags: [machine-learning, webgpu, onnx, web-workers]
sidebar:
  order: 2
---

An ONNX model in the browser can run on one of two devices: WASM on the CPU, or WebGPU on the GPU. My models run in a worker, and the app has a compute setting that sets which device the worker requests. Both problems below came up while running models that way, and both are about WebGPU looking available and then not working. The device choice in context is stage 9 of the [OCR pipeline](/machine-learning/browser-ocr-pipeline/).

## A WebGPU that exists is not a WebGPU that runs every model

I ran two models: a small single-graph ONNX model (PP-OCRv5) and an encoder-decoder model (manga-ocr, a ViT and a BERT driven by a hand-written greedy loop). In Firefox on macOS, PP-OCRv5 ran fine on WebGPU, but manga-ocr failed. Forcing the CPU made it work. Chrome ran both.

The cause is how new Firefox's WebGPU is. Firefox shipped WebGPU on Apple Silicon Macs in 145 for macOS Tahoe, and in 147 for older macOS versions (Intel Macs still don't have it). So "use the GPU when there's an adapter" now picks WebGPU there, on a young implementation. The two models don't push it equally hard. An encoder-decoder means far more operators and far more shader compilation.

This isn't just a Firefox thing. "Automatic" shouldn't mean "use the GPU if there is one", because a GPU that *exists* isn't necessarily a GPU that runs every model. `navigator.gpu.requestAdapter()` reports whether one is available. It doesn't report whether it can run your model, and the only real test is to open the model and see.

So wrap every model open. Run it on `webgpu`, and if that throws, run the same open again on `wasm`. The open returns a session, which the worker sends to the UI along with the device it ended up on. Put a `fellBackFrom` field on that session, because otherwise the UI has no way to distinguish the two cases. A machine with no adapter also reports `wasm`, and that isn't a failure, so the device alone doesn't show whether WebGPU was tried and failed.

The cost is one wasted WebGPU open per session on an affected browser, and nothing stores the failure. That's on purpose: a stored failure would outlive the browser version that caused it.

## Firefox can open a model on WebGPU and then hang on the first run

The fallback on open wasn't enough, because Firefox can *open* an encoder-decoder model on WebGPU without an error, then hang forever on the first inference. The first request never gets a reply. If someone tries again, the second attempt rejects from inside the inference:

```text
failed to call OrtRun(). ERROR_CODE: 1,
onnxruntime/core/providers/webgpu/buffer_manager.cc:643
BufferManager::Download ... map_async_result.status ==
wgpu::MapAsyncStatus::Success was false.
```

`OrtRun` is the inference, so a `catch` around the open can't catch this, and a `catch` around the read can't detect the hang either. So race the *first* run of a `webgpu` session against a deadline, and treat a rejection and a timeout as the same outcome. Throw away the memoized open, reopen the model forced onto `wasm`, retry that same input once, and reply to the *original* request with the retry's result. The caller gets a result, not an error.

Only time the first run. One inference that finishes proves the GPU works. If I timed every later run, eventually a slow input would trigger a fallback, not a broken driver. Pick the deadline to avoid a false fallback, not to keep the wait short. A first GPU run pays for WebGPU init, shader compilation for every graph, and maybe hundreds of decoder calls, and a slow integrated GPU can take a long time to get through that. A false fallback is worse than a slow read, because it takes the GPU away for the rest of the session and shows a wrong reason on screen.

A run that timed out is *abandoned*, not canceled (nothing can cancel an ORT run). It keeps going in the background and settles some time later. So it must not be able to do any harm when it finally settles:

- Attach both handlers to its promise the moment it's raced, so a late failure is never an unhandled rejection.
- Make sure it can't post a reply or settle the request, because the guard has already returned the retry's result.
- Keep the input alive for the retry by closing it in a `finally` that runs after the guard resolves.

One gap remains. A reader that draws from the input across awaits can still reach for a bitmap that's been closed since, when an abandoned run resumes. That throws into a handler nobody reads, which is only acceptable because the handler is attached.

The worker also has to report the switch to the UI. Report the reopen as a fresh "opened" message with `device: 'wasm'` and `fellBackFrom: 'webgpu'`. Have the main thread accept a session update on every one of those messages, not just the first, so the UI changes its device label without any special path. How the worker and its memoized adapter survive that reopen is in [Long-Lived Model Workers](/machine-learning/worker-lifecycle/).
