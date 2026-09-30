---
title: Bundling Web Workers with Vite
description: A worker as a bundle boundary, worker format and WASM assets, aliases in `new URL`, and why the call must stay inline.
tags: [vite, web-workers, bundling, sveltekit]
sidebar:
  order: 2
---

## A worker is a bundle boundary the container cannot leak through

The setup: an app has a "container" module that builds adapters, and every route imports it. A static import in the container therefore ends up in every route's bundle (that leak is covered in [keeping the bundle small](/tooling/code-splitting/)). One of the adapters runs a heavy library, transformers.js, inside a web worker.

Say the worker is only reached through `new Worker(new URL('…', import.meta.url))`, inside an adapter the container loads with a dynamic import. Vite emits that worker as its own entry, with its own module graph. So a library that only the worker imports can't show up in the entry bundle or in any route chunk, however the container gets refactored later. A dynamic import can be undone by a careless refactor. This boundary can't.

Check it in the build output: the library's package name should appear in exactly one output file, the worker.

**A module worker is still bundled as an IIFE, so the dynamic import inside it is inlined.** An IIFE is an immediately invoked function expression: the whole worker becomes one self-contained script. `worker.format` defaults to `'iife'`, and an IIFE can't be split into chunks. So `await import('@huggingface/transformers')` inside the worker gets folded into the worker's own entry instead of becoming a second chunk.

That's Vite 8, which bundles with Rolldown and inlines the dynamic import by itself. Vite 7 and earlier bundle with Rollup, which fails the build instead, with `Invalid value "iife" for option "worker.format" - UMD and IIFE output formats are not supported for code-splitting builds`.

You still keep the laziness if the worker itself isn't created until first use, because then the worker's code isn't downloaded until first use either. Setting `worker: { format: 'es' }` in the Vite config brings the split back.

**The ONNX runtime WASM is emitted into the build output,** 27 MB of `ort-wasm-simd-threaded.asyncify.wasm`. It's an asset fetched at runtime, not part of any JS bundle, and it has to be served as `application/wasm`.

Some libraries start their own workers from a `blob:` URL. That matters for the page's CSP (Content Security Policy): see [CSP for blob documents and workers](/security/csp-blobs-and-workers/).

## A worker URL is a plain string that no static check resolves

An adapter creates the OCR worker with `new Worker(new URL('$workers/ocr.worker.ts', import.meta.url))`. That call contains a path to the worker's source file, and *nothing* that runs before the build reads it as a path. TypeScript treats it as a string. svelte-check treats it as a string. dependency-cruiser's `no-unresolvable` only walks import and require edges. And a spec that injects a `startWorker` function never runs the real one.

The path was relative when this bit me. I moved the adapter that creates the worker one folder deeper, so the relative path no longer led to the worker file. Every test, the type check and the dependency rules all stayed green. Only `vite build` failed, and its error named exactly what was wrong:

```text
[UNRESOLVED_ENTRY] Cannot resolve entry module src/lib/workers/ocr.worker.ts
```

I need both fixes: the build is part of the pre-commit checks, because it's the only tool that resolves these paths, and the path is written as an *alias* (`$workers/…`), so moving the importing file can't change it. For anything a bundler resolves from a string, use an alias over `../../../..`.

## Vite resolves an alias in `new URL`, but the call must stay inline

The alias fix depends on the build tools resolving the alias inside that string. Two things I found by building, not by reading docs:

1. `vite build` *does* resolve a SvelteKit alias inside `new URL('$workers/ocr.worker.ts', import.meta.url)`. The proof: the emitted chunk keeps its content hash, so it's the same module the relative path produced.
2. Vitest does *not*. Under a node test project the literal string survives, and the URL comes out as `…/adapters/$workers/ocr.worker.ts`. So a unit test can never assert on one of these URLs. It would be testing the test runner.

There's also a constraint on where the `new URL` call sits. The worker plugin finds the worker by matching `new Worker(new URL(…))` in the source. So the `new URL` call has to sit *inside* the `new Worker` call.

It's tempting to pull the URL out into a module const, for example so a test can import it. That's worse than a plain mistake:

```ts
export const WORKER_URL = new URL('$workers/ocr.worker.ts', import.meta.url);
```

The build then *succeeds*, and emits no worker chunk at all. Keep it inline, even when it's tempting to export it for a test.

In dev, a worker's dependencies get optimized late: Vite doesn't crawl a worker file at start, so it only pre-bundles a worker's dependency when the worker is first served.
