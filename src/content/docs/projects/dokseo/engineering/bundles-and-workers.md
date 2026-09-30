---
title: Dokseo's Bundle and Its Workers
description: What each screen downloads, how the container once leaked 592 kB into the library, the three worker entries, the 27 MB ONNX WASM, and the build that catches a moved worker.
tags: [dokseo, bundling, vite, web-workers, pdfjs, onnx]
sidebar:
  order: 71
---

The rule for Dokseo, my manga and book reader, is the one in [keeping the bundle small](/tooling/code-splitting/): the library screen doesn't download a PDF reader, and someone who only reads `.cbz` files never downloads pdf.js. The heavy parts sit behind dynamic imports and inside workers, as in [bundling web workers with Vite](/tooling/vite-workers/). The rule has broken twice.

## What each part costs

| Thing | Cost | When it may load |
| --- | --- | --- |
| pdf.js | 431 kB | First PDF opened |
| zip.js | 155 kB | First archive opened |
| Svelte runtime | ~47 kB | Always |
| `ts-pattern` | ~2 kB | Always |
| pdf.js worker | 1.27 MB | Separate asset, only with a PDF |
| transformers.js + ONNX runtime | 584 kB, in the worker | First recognition |
| ONNX runtime WASM | 27 MB, a separate asset | First recognition on WASM |
| Model weights | 117 MB for the default Japanese model, quantized throughout; 204 MB for the alternative with a q8 encoder and fp32 decoder | First recognition, then cached |

The model weights are a cache and persistence problem, outside the bundle (see [model lifecycle](/projects/dokseo/recognition/model-lifecycle/) and [what Dokseo stores](/projects/dokseo/library/storage/)).

pdf.js comes in two builds, and Dokseo picks one at runtime (see [browser support](/projects/dokseo/engineering/browser-support/#pdfjs-modern-or-legacy)). From `vite build`:

| Chunk | Size |
| --- | --- |
| Modern pdf.js library | 430.94 kB (129.04 kB gzip) |
| Legacy pdf.js library | 487.96 kB (148.27 kB gzip) |
| Modern pdf.js worker | 1,265.41 kB |
| Legacy pdf.js worker | 1,317.03 kB |
| The adapter chunk that chooses | 3.74 kB (1.62 kB gzip) |

Only the chosen build's chunk and worker get fetched ([what the bundle ends up with](/files/pdfjs-builds/#what-the-bundle-ends-up-with)).

## The container leaked 592 kB into the library

`container.ts` is imported by every route, so a static import in it is an entry-bundle import ([the general case](/tooling/code-splitting/#a-dependency-container-is-where-a-static-import-leaks)). That's how the library screen once pulled 592 kB of codecs before it painted a single cover. The fix was a dynamic import at the point of use:

```ts
if (sourceKind === 'pdf') {
  const { openPdfPageSource } = await import('./pdf-page-source');
  return openPdfPageSource(blob);
}
```

That took the library route from 592 kB to about 58 kB. It also means `pdf-page-source.ts`'s module-scope `GlobalWorkerOptions.workerSrc` assignment never runs on the library screen. How the container is built is in [wiring](/projects/dokseo/architecture/wiring/).

To check it, I run `deno task build` and read `.svelte-kit/output/client/.vite/manifest.json` for the route's node entry. Nothing else catches a dynamic import tidied back into a static one.

## Three worker entries

The workers live in `src/workers/`, outside `src/lib`, reached through the `$workers` alias:

| Worker | What it does |
| --- | --- |
| `ocr.worker.ts` | manga-ocr through transformers.js. |
| `paddle-ocr.worker.ts` | PaddleOCR for Korean. Decodes with `recognition/domain/engine/ctc-reading.ts`. |
| `opfs-writer.worker.ts` | Writes uploads into OPFS (see [importing a book](/projects/dokseo/library/importing-books/)). |

`ocr.worker.ts` is only reached by `new Worker(new URL('…', import.meta.url))` inside `manga-ocr.adapter.ts`, which the container imports dynamically. So transformers.js can't reach the app entry or either route chunk, however the container gets refactored. I checked `build/`: the string `@huggingface` occurs in exactly one output file, the worker.

The worker is bundled as an IIFE, so `await import('@huggingface/transformers')` inside it gets inlined into the worker's own 584 kB entry instead of becoming a second chunk. That inlining is Vite 8 behavior (Rolldown); on Vite 7 the same setup fails the build ([details](/tooling/vite-workers/#a-worker-is-a-bundle-boundary-the-container-cannot-leak-through)). The laziness survives anyway, because the worker isn't created until the first recognition. `worker: { format: 'es' }` would bring the split back and buy nothing today.

## The 27 MB ONNX WASM

The ONNX runtime's WASM goes into `build/` as `ort-wasm-simd-threaded.asyncify.wasm`, 27 MB. It took the build from about 1 MB to 28 MB. It's an asset fetched at runtime, not part of any JS bundle, and it has to be served as `application/wasm`. In the Cache API it holds about 27 MB even though its `content-length` is about 7 MB ([why](/storage/persistence-and-quota/#a-cached-responses-content-length-is-the-wire-size-not-the-disk-size)).

## Moving an adapter broke both recognizers with every test green

I moved `manga-ocr.adapter.ts` one folder deeper. That broke both recognizers, and 1050 tests, 1203 checked files and a clean dependency-cruiser run all stayed green. Only `vite build` failed:

```text
[UNRESOLVED_ENTRY] Cannot resolve entry module src/lib/workers/ocr.worker.ts
```

The worker URL is a string no static check reads ([the general case](/tooling/vite-workers/#a-worker-url-is-a-plain-string-that-no-static-check-resolves)). Dokseo needs both fixes: `npm run build` now ends `verify` (see [checks and tests](/projects/dokseo/engineering/checks-and-tests/)), and the path is the alias `$workers/ocr.worker.ts`, so moving the importing file can't change it.

The alias has one catch. `vite build` resolves it inside `new URL`, but Vitest doesn't: under the node project the URL comes out as `…/adapters/engine/$workers/ocr.worker.ts`. It was tempting to export the URL for a test:

```ts
export const OCR_WORKER_URL = new URL('$workers/ocr.worker.ts', import.meta.url);
```

That build succeeds and emits no worker chunk at all, because the worker plugin only matches `new URL` inside `new Worker(…)`. So the call stays inline, and no test asserts on the URL ([details](/tooling/vite-workers/#vite-resolves-an-alias-in-new-url-but-the-call-must-stay-inline)).

## Not built

Prefetching a chunk on intent, like warming the PDF chunk when a PDF book is hovered, isn't built.
