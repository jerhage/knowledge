---
title: Keeping the Bundle Small with Dynamic Imports
description: What is heavy, how a composition root leaks static imports into every route, and checking the Vite manifest.
tags: [bundling, vite, sveltekit, architecture]
sidebar:
  order: 1
---

**The principle.** Everything in the bundle a page loads is something a person pays for before they've done anything on that page. So for each heavy piece of code, ask when someone first needs it. A list screen shouldn't download a PDF reader. Someone who only opens `.cbz` files should never download pdf.js at all.

## Know what is actually heavy

Deciding what to load late starts with knowing what's big. These are sizes I measured in one browser app that reads comics and PDFs and runs OCR. The last column says when each piece could load, given what it's for:

| Thing | Cost | When it may load |
| --- | --- | --- |
| pdf.js | 431 kB | First PDF opened |
| zip.js | 155 kB | First archive opened |
| Svelte runtime | ~47 kB | Always |
| `ts-pattern` | ~2 kB | Always |
| pdf.js worker | 1.27 MB | Separate asset, only with a PDF |
| transformers.js + ONNX runtime | 584 kB, in the worker | First inference |
| ONNX runtime WASM | 27 MB, a separate asset | First inference on WASM |
| Model weights | 100-200 MB | First inference, then cached |

The model weights are the biggest item, but they aren't a bundle problem. They're downloaded once and then read from a cache, so the question for them is caching and persistence, and transformers.js already handles the caching.

## A dependency container is where a static import leaks

The app has a composition root: a "container" module that builds the adapters (the code that calls pdf.js, zip.js and so on) and passes them to the rest of the app. Every route imports the container, because every route uses something from it.

That makes the container's own imports special. A static import at the top of the container is loaded by everything that imports the container, which is every route, so **a static import in the container ends up in the entry bundle**. That's how a list screen can pull in 592 kB of codecs before it paints anything, even though it never opens a file. (Where the container sits in the layers: [the composition root](/architecture/dependency-injection/#the-composition-root-builds-everything-once).)

The fix is to import the heavy module with a dynamic import at the point where it's used, not at the top of the module:

```ts
if (sourceKind === 'pdf') {
  const { openPdfSource } = await import('./pdf-source');
  return openPdfSource(blob);
}
```

The bundler turns a dynamic import into a separate chunk that's only fetched when that line runs. In that case, it took the route from 592 kB down to about 58 kB.

A worker is a second, sturdier boundary: see [bundling web workers with Vite](/tooling/vite-workers/). An adapter that loads lazily and then gets memoized by the container has its own rules, in [long-lived model workers](/machine-learning/worker-lifecycle/).

## A dynamic import also defers a module's side effects

A module can do work when it loads, not only when something calls it. A pdf.js adapter usually does: it sets `GlobalWorkerOptions.workerSrc` at module scope, so the line runs as soon as the module is imported. Behind a dynamic import, that line never runs on a screen that doesn't open a PDF. A static import would run it on every page load. (Picking which pdf.js build to load at that point is in [pdf.js builds](/files/pdfjs-builds/).)

## Route splitting is already done for you

SvelteKit emits a chunk per route, so code used by only one route already stays out of the others. What crosses routes is whatever you put in shared modules, and the container is the shared module every route imports.

## Measure, never assume

The build output shows what actually got pulled in. Build, then open `.svelte-kit/output/client/.vite/manifest.json`, find the route's node entry, and check what it imports. The chunk sizes the build prints show how big each chunk is. The manifest shows which modules pull it in.

## This is fragile in exactly one way

Everything above depends on the heavy modules staying behind dynamic imports. Someone refactoring the container sees a dynamic import in the middle of a function, "tidies" it into a static import at the top, and the heavy module is back in every route. It happens silently: no test fails, and no lint rule catches it. Only a build shows it. So if you touch the container or a lazily loaded adapter, check the manifest.
