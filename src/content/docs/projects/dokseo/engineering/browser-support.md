---
title: What Dokseo Needs from a Browser
description: The platform features Dokseo requires, the fallbacks and polyfills it ships, and the Safari, iOS and Firefox cases it works around.
tags: [dokseo, safari, mobile, javascript, opfs, pdfjs, webgpu]
sidebar:
  order: 72
---

Dokseo, my manga and book reader, leans on OPFS, workers, `OffscreenCanvas` and a few very new JavaScript APIs, and most of what it works around is Safari, on iOS in particular. Dokseo ships something to cover each gap, and each section links to the general page for the mechanism.

## `using` and `DisposableStack` need a polyfill

Dokseo uses `using` for disposers, and `DisposableStack` when a loop builds a list of them. `using` is syntax, so the build lowers it. `DisposableStack` is a runtime global, so it doesn't get lowered. It's in Chrome 134 and Firefox 141, and in Safari only in Technology Preview, so Dokseo needs a polyfill for it ([browser support](/javascript/explicit-resource-management/#browser-support)). Node has it natively, so no unit test fails when the polyfill is missing.

`hooks.client.ts` imports the shim and installs it with `ensureDispose(Symbol)`. The first version broke on Safari: the shim's class body computed `[Symbol.dispose]` when the module was evaluated, before `hooks.client.ts` got to install the symbol, so the method ended up under the key `"undefined"` ([the whole story](/javascript/gotchas/#a-polyfills-own-class-body-runs-before-the-polyfill-does)). The fix attaches the symbol-keyed method at install time.

The application code never had the problem, because every disposer in the app is built inside a function: `own()`, and the objects the two page sources return. None of them exists before the shim installs.

## OPFS writes go through a worker

`FileSystemFileHandle.createWritable()` only reached Safari in 26. On an older iPhone an upload died with `createWritable is not a function`. `createSyncAccessHandle()` has been in Safari since 15.2 and is in every engine, but only inside a dedicated worker ([browser support](/storage/origin-private-file-system/#browser-support)). So `blob-store.put` passes the `Blob` to `src/workers/opfs-writer.worker.ts` and awaits the reply. Only the write moved. Reading, totalling and removing (`getFile()`, `values()`, `removeEntry()`) stay on the main thread. The worker and its chunked write are on [importing a book](/projects/dokseo/library/importing-books/).

Nothing in Dokseo uses `createWritable()` now. Both OPFS writers, the blob store and the model part store, write through `createSyncAccessHandle`, which writes in place. That also sidesteps the swap file a writable may use while it runs. MDN says browsers typically write to one, which would need about double the file's size in quota, but that's an implementation detail.

## pdf.js: modern or legacy

On iOS Safari, every PDF upload failed with `this._requestsByChunk.getOrInsertComputed is not a function`, thrown in the pdf.js worker's `ChunkedStreamManager._requestChunks`. Desktop Chrome was fine. `BlobRangeTransport` passes pdf.js the first `RANGE_CHUNK_BYTES` (64 KB) as initial data, so any PDF over one chunk makes a range request, and the first range request calls the missing method (reading by range is on [page sources](/projects/dokseo/library/page-sources/)). An upload that seemed to work on the same phone was a ZIP, which never touches pdf.js.

The fix picks the build at runtime, as described in [pdf.js builds](/files/pdfjs-builds/). In Dokseo:

- `adapters/pdf-build.ts` holds `MODERN_BUILD_REQUIREMENTS`, a list of dotted paths read from the core-js headers of pdfjs-dist 6.3.289's legacy build.
- `choosePdfBuild(globals)` returns `'modern'` only when every path resolves to a function.
- `pdf-page-source.ts` calls it once with `globalThis` on the first PDF open. `pdfJsBuildFiles(build)` returns the library import and the worker URL of the same build together. The promise is cached for the page's lifetime and cleared if the import rejects.

Specs guard it. `pdf-build.spec.ts` checks the chooser against every requirement, one missing at a time. `pdf-build-entries.spec.ts` fails if any script under `src/` other than the adapter, its spec and itself names a pdf.js entry, if the adapter imports a pdf.js value statically, if it doesn't load exactly one modern and one legacy library and worker, or if a library isn't followed by the worker from the same build. `pdf-page-source.spec.ts` checks that the chosen build's `getDocument` and worker are the ones used, and that the choice happens once.

I reproduced it in Chromium by deleting the listed APIs in the page and the worker. WebKit wasn't installed, so that's a stand-in, not a Safari run. Chunk sizes for both builds are on [the bundle page](/projects/dokseo/engineering/bundles-and-workers/).

## `Element.role`

The ebook reader's `FlowViewer.svelte` handles events whose target can be an element on the page or inside a chapter iframe, and some of its rules depend on the target's ARIA role. Its `controlRole` reads `target.role` on a raw `EventTarget` with `'role' in target`, which works for an element from a chapter iframe too ([why](/html/iframes/#role-is-a-reflected-idl-property-so-role-in-target-reads-it-across-a-realm)). Reflected `role` has been in Safari since 12.1, Chromium since 103 and Firefox since 119, so every engine Dokseo runs on has it. It's the attribute, not the implicit role: a `<button>`'s `role` is `null`.

## iOS: the 16 px focus zoom

iOS Safari zooms in when a text control with a computed font size under 16 px takes focus, and doesn't zoom back out ([details](/html/touch-devices/#ios-safari-zooms-on-focus-below-16-px)). `control.css` sets `.input`, `.select` and `.textarea` to `var(--text-base)` (1 rem) under `@media (pointer: coarse)`, in the `components` layer. It stays out of the `overrides` layer on purpose. The capture editor's field is made larger than 1 rem by a `text-lg` utility, and a rule in `overrides` would beat that utility and flatten the field back to 1 rem. What the rule means is "at least 16 px", and a plain declaration can't express "at least". A probe can only check the focused control's computed `font-size`. The zoom itself can only be confirmed on a real iPhone.

## iOS: full-screen dialogs and the search field

The phone rules for a full-screen dialog (`dvh` and the keyboard, scroll-through, safe-area insets) are on [touch devices](/html/touch-devices/#a-full-screen-dialog-on-a-phone-dvh-the-keyboard-scroll-through). In Dokseo, the document never scrolls on either screen: the library is a fixed shell and the reader locks it. So the root has nothing to scroll through.

`control.css`'s `.input-clearable`, which `SearchField clearable` applies, hides the native search cancel button and shows a drawn one on a coarse pointer only. As far as I can tell iOS Safari draws no native one, while Chromium on Android does, so without hiding it Android would show two ([details](/html/forms-and-labels/#a-drawn-clear-button-and-the-native-search-cancel-button)).

## WebKit: dialog focus goes back to `<body>`

WebKit doesn't focus a `<button>` when it's clicked or tapped, so a dialog opened from a button returns focus to `<body>` when it closes ([details](/html/dialog-focus/#webkits-dialog-focus-restore-lands-on-body-after-a-tap)). The capture palette works around it (see [captures](/projects/dokseo/recognition/captures/)). Dokseo's other modals still have the WebKit behavior.

## Safari: an IME's Enter

Safari fires the Enter that confirms an IME conversion with `isComposing` false and `keyCode` 229 ([details](/interaction/keyboard/#an-imes-confirming-enter-reaches-keydown)). `isComposingKey` in `src/lib/shared/composing-key.ts` checks both, and every key handler on a text field calls it, in its pure classifier if it has one. Without it, the confirming Enter opened a palette result. `key-relay.ts` copies `isComposing` and `keyCode` onto the events it relays out of a chapter frame, so the Safari case survives the hop.

## Also worked around elsewhere

- The phone capture sheet kept its open height on iOS Safari after hiding. The fix is on [reading components](/projects/dokseo/design-system/reading-components/). The WebKit cause is a deduction; I couldn't reproduce it.
- With the GPU chosen, Firefox on macOS runs the Korean model on WebGPU but not the Japanese one. OCR runs on the CPU by default, so only someone who opts into the GPU meets this. The device fallback is on [engines](/projects/dokseo/recognition/engines/).
