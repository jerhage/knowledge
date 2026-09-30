---
title: "pdf.js: Choosing the Modern or Legacy Build at Runtime"
description: Feature-detecting the APIs the modern build needs and loading the matching library and worker pair.
tags: [pdfjs, bundling, vite, safari, web-workers]
sidebar:
  order: 4
---

## Two builds, one API

`pdfjs-dist` ships two builds. The bare `'pdfjs-dist'` entry and `pdfjs-dist/build/*` are the *modern* build. It only targets the newest browsers and calls very new APIs without checking that they exist. `pdfjs-dist/legacy/build/pdf.mjs` and `pdfjs-dist/legacy/build/pdf.worker.min.mjs` are the *legacy* build. That's the same code with core-js polyfills bundled in, and each polyfill is only installed when the browser lacks the method. The legacy type file is one line, `export * from "pdfjs-dist"`, so both builds share one API and one set of types.

## How it shows up

On iOS Safari, every PDF open failed with `this._requestsByChunk.getOrInsertComputed is not a function`, thrown in the worker's `ChunkedStreamManager._requestChunks`. Desktop Chrome has that method, so it was fine there. When pdf.js [reads by byte range](/files/pdfjs-range-loading/) and gets the first chunk as initial data, any PDF bigger than one chunk makes a range request, and the first range request calls the missing method. A tiny PDF never gets that far. A real book always does.

## How to choose

Keep a list of dotted paths the modern build needs. Write a chooser that returns `'modern'` only when every path resolves to a function on `globalThis`, and `'legacy'` otherwise. Use feature detection, never the user agent string. Run it once, on the first PDF open. Then have one function return the dynamic `import()` of that build's library *together* with that build's worker URL, so the two can't drift apart (the worker side of this is in [bundling workers with Vite](/tooling/vite-workers/)). Cache that promise for as long as the page lives, and clear it if the import rejects.

In my reader, the code that opens PDFs through pdf.js is an adapter (the concrete code behind a port). That adapter imports only *types* from `'pdfjs-dist'` statically. A value import would pull the modern build into the adapter's chunk for every browser (the general rule is in [keeping the bundle small](/tooling/code-splitting/)).

## What goes in the list

I built the list from the core-js headers ("// `Map.prototype.getOrInsertComputed` method") of `legacy/build/pdf.mjs` and `legacy/build/pdf.worker.mjs` (read from pdfjs-dist 6.3.289), minus whatever chrome123, firefox120 and safari17.5 all have:

- `Map`/`WeakMap` `getOrInsert` and `getOrInsertComputed`
- `Promise.try`
- `Math.sumPrecise`
- `URL.parse`
- the seven `Set` methods
- the `Iterator` global and its ten prototype helpers (`drop` and `take` appear only in the library's headers)
- `Uint8Array.fromBase64` with `setFromBase64`, `setFromHex`, `toBase64` and `toHex`

I left some out because they've been around for a long time or pdf.js doesn't use them that way: `%TypedArray%.prototype.with`, `Array.prototype.includes`/`push`, `Math.trunc`, the `Object.*` statics, `JSON.stringify`, `self`, the `DOMException` stack patch, and `JSON.parse` (core-js forces it for the parse-with-source proposal, but pdf.js calls it without a reviver). When pdfjs-dist gets upgraded, read those headers again. A new header means a new line in the list.

Two APIs aren't in either build's polyfills, so there's no point listing them: `Promise.withResolvers` (the modern build calls it a lot, and Firefox 120 is one version short of having it) and `ArrayBuffer.prototype.transferToFixedLength` (the worker calls it). The legacy build would fail on them too, so checking for them would change nothing.

The worker is a separate global, but it runs in the same browser as the page. So the one check on the main thread covers both. You don't need to polyfill anything yourself, in either global.

## What the bundle ends up with

The build emits both library chunks and both worker assets (roughly 430 kB modern and 490 kB legacy for the library, about 1.3 MB for each worker, and a few kB for the chooser). Vite's preload list for each dynamic import names only that build's chunk plus the shared preload helper. Nothing in `index.html` or any entry chunk names a pdf.js chunk. So a browser only fetches the build the chooser returned.

## Reproducing it in Chromium

Chromium has every method natively. To fake an older browser, delete the listed APIs in an init script *and* in the worker, by routing `pdf.worker*.mjs` and prepending the same deletes to its body. With the deletes, the network log shows only the legacy chunk and legacy worker, and the PDF opens. Without them, it shows only the modern pair. With only the Map methods deleted and the modern build forced, you get the exact Safari error message. This is a stand-in, not a Safari run.

## Tests worth having

- The chooser against every requirement, with one missing at a time.
- A source scan that fails if any other file names a pdf.js entry, if the adapter imports a pdf.js value statically, or if a library build isn't paired with the worker from the same build.
- That the chosen build's `getDocument` and worker are the ones actually used, and that the choice happens once.
