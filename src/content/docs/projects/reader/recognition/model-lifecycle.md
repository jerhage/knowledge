---
title: Downloading, Caching and Closing Models in the Reader
description: The consent gate, honest download progress, ranged resume into OPFS part-files, no-store fetches, the per-language memo, and closing a recognizer only when idle.
tags: [reader, machine-learning, transformers-js, web-workers, storage, opfs, cache-api]
sidebar:
  order: 62
---

The recognition models are big (the default Japanese one, which I exported for the reader, is a 123 MB download), so the reader doesn't ship them. The first time I capture text in a language whose model isn't on the device, the reader asks, then downloads the model into the browser's Cache API through transformers.js. Each language's model runs in its own worker, which the reader opens when it's needed and closes when I leave the book. The general mechanisms are in [Model Downloads](/machine-learning/model-downloads/) and [Long-Lived Model Workers](/machine-learning/worker-lifecycle/). This page is the reader's modules and names, and the bugs as they happened. All of it is against `@huggingface/transformers` 4.3.0.

## A consent dialog before a download

The question comes from the consent gate in `RecognizerView.#admits`, the last of the checks a capture passes before it reaches the model (the gate's trace names are on [the pipeline page](/projects/reader/recognition/pipeline/#1-the-drag-and-its-guards)). The gate holds the capture and opens a `<dialog>` with `showModal()`.

The gate needs two stored values: the model chosen for the language, and whether I already agreed to its download. It doesn't read them itself. A data component on the read route, `EngineGateData` (`recognition/ui/engine/EngineGateData.svelte`), reads the language's recognizer setup and its stored consent through the query cache, plus what the chosen model occupies in storage, which `EngineWarmup` uses to check whether the weights are on disk. `CaptureView` passes the gate a source over it, so the gate gets the three reads as `ReadState`s (`loading`, `failed` or `ready`). `chosenFootprint` turns the setup read into the chosen model. Each query takes `null` and passes `skipToken` until the language or the model is known. How the route binds the data component is on [data components and view models](/projects/dokseo/architecture/data-components-and-view-models/#the-kinds-of-data-component).

A pure function in `recognition/ui/engine/engine-gate.ts`, `consentStep`, turns those reads into the gate's next step:

- the reads haven't come back yet: `waiting`. The gate holds the capture, and when `EngineGateData` calls its `onread`, `CaptureView.engineRead` runs it again, unless I've opened another book since.
- one of them failed: `failed`, with the read's message. The gate stops the capture and shows a danger notice, "Text recognition could not start", whose message is that read's message, and reloads the reads.
- the language needs no download: `nothing-to-download`, and the capture goes straight through.
- the consent is stored: `granted`, and the capture goes through.
- anything else: `undecided`. The gate holds the capture and sets `request`, so the consent dialog opens (unless I declined the dialog for that language earlier in the session).

A store the browser blocks isn't a failed read. The setup and consent use cases return it as `storage-unavailable`, and the queries resolve that answer as data, so it arrives as `ready`. A blocked setup store then gives the language's default model, and a blocked consent store counts as no consent, so the dialog opens. Only a read that threw becomes `failed`. Before this split, the gate read both values by awaiting the cache and catching the rejection, and that catch sent a throw down the same path as a blocked store, silently. The general version is on [an expected answer resolves](/svelte/svelte-query/#an-expected-answer-resolves-and-only-a-missing-answer-rejects).

Granting consent is a mutation, and when it settles it invalidates `recognitionKeys.consent(language)`, so `EngineGateData` reads the new consent. The reads also come again when the read route mounts, when the language or the chosen model changes, and after a change on the engine settings screen.

The dialog is a `<dialog>` opened with `showModal()` through the design system's `Modal`. `showModal()` puts it in the browser's top layer, above the rest of the page, so no layout or clipping in the reader's panels and toolbars can reach it ([the general version](/html/top-layer/#dialog-with-showmodal-is-free-accessibility)).

`showModal()` makes the page behind it inert, but it doesn't keep Tab inside the dialog. Pressing Tab on the last control moves focus out of the document. The design system's `Modal` has a `wrapFocus` for that ([a native modal does not keep Tab inside it](/html/dialog-focus/#a-native-modal-dialog-does-not-keep-tab-inside-it)).

The engine controls in the reader, `EnginePill` and `EngineTrade`, open small non-modal sheets with the `popover` attribute. A popover gets the top layer too, but no positioning. CSS anchor positioning only reached all three engines recently (Chromium 125, Safari 26, Firefox 147). So the base `Popover` still places each sheet itself, from the trigger's `getBoundingClientRect()` on the `toggle` event, using the rule it shares with `Dropdown` in `components/overlay-placement.ts`.

## The consent read made the first tick async

`CaptureView.recognize` is the method that starts a capture. Before the consent gate, it created the pending card and called into the container right away, on the same tick. The specs relied on that: they called the method and then read the fake container's first call from `world.calls[0]` straight away.

Then the gate started reading the stored consent first, and that read was async. So the pending card and the container call happened later, after the gate's reads settled, and every spec that read `world.calls[0]` synchronously broke. Adding a fixed number of `await Promise.resolve()` ticks would be a guess, and it would break again the next time I added an `await` to that path. So the specs wait until the call shows up, with a bound:

```ts
async function started(world: Fakes, index: number): Promise<Call> {
  for (let tick = 0; tick < 50 && world.calls.length <= index; tick += 1) {
    await Promise.resolve();
  }
  return at(world.calls, index);
}
```

The test still controls when the call settles, which is the part that matters. It only stops asserting on exactly which tick the call was made. `capture-view.spec.ts` and `engine-warmup.spec.ts` both have this helper.

The gate has since stopped reading anything itself. It gets its reads from `EngineGateData`, so once they've come back, its check runs on the same tick as the capture, and the pending card and the container call happen synchronously again. The specs kept the helper: when the call is already there, it returns without waiting. More in [Fakes, Stubs and Async Ticks](/testing/fakes-and-async/#an-async-gate-in-front-of-a-trigger-makes-its-first-tick-async).

## Progress for the screen that started the load

While the model downloads, the screen that started the download shows a progress bar. The Japanese adapter is built by `createMangaOcrRecognizer`, which takes its progress listener when it's built. But the container builds it only once per language, on purpose, because a second adapter would mean a second worker and a second download. So the listener passed at build time can't be the listener of whichever screen calls later.

`container.ts` bridges that with `progressNotices`, a `noticeBoard<Language, ModelLoad>` from `platform/events/notice-board.ts`, which keeps a set of listeners per language. The adapter's own listener posts each update to the board, and the board passes it to every listener for that language. A caller's callback is added (`watch`) before the container awaits the adapter and removed (`stop`) in a `finally`. The order matters: the download starts inside that await, so a callback added after it would miss the first half of the bar. The general version is in [Long-Lived Model Workers](/machine-learning/worker-lifecycle/#a-per-call-callback-cannot-reach-a-memoized-adapter-through-its-constructor).

On the engine settings screen (`EngineSettingsView`), the download is a mutation run by `ModelDownload`. The progress callback travels in the mutation's variables (`{ language, onProgress }`), and the mutation function passes it to the use case. `ModelDownload` builds that callback for each run, so it can drop a report that arrives after a later operation started. Nothing about progress goes through the query cache.

## Distinguishing a cached load from a download

While a model loads, the reader shows a status line with a percentage. I reloaded a book with the weights already on the device, and it said "Downloading the recognition model, 37 percent". transformers.js 4.3.0 fires `'download'` and byte-by-byte `'progress'` events for a file read from the cache too, so the events can't tell the two apart ([why](/machine-learning/model-downloads/#nothing-in-the-progress-union-tells-a-cached-load-from-a-downloaded-one)).

Every network request the library makes goes through `env.fetch`, a function the app can replace. `watchModelLoadSource` in `src/workers/model-load-source.ts` wraps it and latches a flag when a real download goes out. One call through it isn't a download: `get_file_metadata` sends a `Range: bytes=0-0` probe to get the size of a file that isn't cached. So the wrapper reads each request's headers to separate a size probe from a download. It's unit tested against a fake `env`, and nothing else in the worker touches `fetch`.

The default wording stays neutral. If a later version of the library changes and the check goes wrong, the screen shows too little rather than something false.

## Stopping a download

A load can be canceled partway, and leaving a book closes its worker too. transformers.js has no pause and no abort, so the only way to stop a load is to terminate the worker ([why](/machine-learning/worker-lifecycle/#transformersjs-has-no-pause-and-no-abort-so-a-stop-is-a-worker-terminate)).

A terminated worker's replies that were already queued can still arrive afterwards. If the download's state machine accepted them, the bar would keep climbing after the load was stopped. So it ignores progress, and even an `opened` reply, that lands after a cancel.

## Resuming into OPFS part-files

On its own, transformers.js only caches a file once it has read the whole body. Stopping a load partway through a large weight file (the default model's encoder alone is 87.0 MB) throws away everything received for that file. Because the reader owns `env.fetch`, it can keep that partial file.

`fetchResumable` requests the file from the Hub in ranges, `bytes=<have>-<have+8MiB-1>`, appends each network read to a part-file in OPFS (the origin private file system), and returns a streamed `Response` to the library, with `Content-Length` set to the full size. A later load starts from what's already on disk, and the library has no way to detect that a resume happened. The mechanism and its four gotchas are on [Model Downloads](/machine-learning/model-downloads/#a-resumable-download-is-a-ranged-fetch-behind-envfetch-streamed-back).

The reader's choices inside it:

- The append uses `createSyncAccessHandle()`, which writes in place. It exists only in a dedicated worker, and it's declared locally because the project compiles against `lib.dom`, where TypeScript doesn't include it. The other option, `createWritable()` with `keepExistingData: true`, copies the existing file first; in Chromium a writable is backed by a swap file (an implementation detail). Appending N chunks that way costs O(N²) bytes of copying.
- A sync access handle locks the file. The settings screen measures part-files by calling `getFile()` from the main thread, which can't read a locked file. So the handle is opened for each chunk and closed at the end of it.
- `openAppend(key, from)` truncates the file to the offset it receives before writing anything. A torn tail left by an OS-level crash is cut off instead of being counted as progress.
- A part-file is named `encodeURIComponent(url)`. The url contains the model id, so `belongsToModel` can find a model's part-files with the same test it uses on cache keys (next section), and no index has to be kept.

The last chunk's handle was the one that got left open, and then the completed part-file couldn't be deleted. That bug is on [storage](/projects/reader/library/storage/).

### Checking the status of each response

`fetch` resolves for any HTTP status. It only rejects when no response arrives at all. So code that reads a body without checking the status can treat a server's error page as the file it requested. `platform/http/http-error.ts` has the check Dokseo uses for that: `checkedResponse(response, method, url, expected)` returns the response when it's OK or its status is in `expected`, and otherwise throws an `HttpError` that holds the status, the method and the url.

`fetchResumable` checks every ranged request this way. A range request should come back 206 Partial Content. When the part-file already holds bytes, 416 Range Not Satisfiable is expected too: a server sends it when the requested range starts at or past the end of the file. Dokseo then discards the part-file and requests the file again from byte 0. A 200 means the server ignored the range and sent the whole file, and that response goes back to the library as is. Any other status throws, so the load fails with the status and url in its message. The PaddleOCR worker reads its character dictionary through the same check, so a failed dictionary request fails the load instead of its error page being read as the dictionary.

Every other request through Dokseo's `env.fetch` passes through untouched. transformers.js reads the status of what `env.fetch` returns and handles each status itself: a 404 for an optional file means the file doesn't exist. If Dokseo threw on that 404, a load that should succeed would fail. The weight files are never optional, so only the resumable path throws ([Model Downloads](/machine-learning/model-downloads/)).

## Finding and removing a model's files

The reader can remove a model's files to free space. transformers.js stores its files in a cache named `'transformers-cache'`, keyed on each file's remote Hub url, which contains the model id. So `belongsToModel` finds a model's files by testing each key for `'/' + modelId + '/'`. Both slashes matter: without the trailing one, `DigitalLarynx/manga-ocr-onnx` also matches `DigitalLarynx/manga-ocr-onnx-large`, and removing one model would remove the other. A removal also sweeps a second cache, `experimental_transformers-hash-cache`, and leaves the ONNX runtime's own files alone, because every model shares them ([the cache layout](/machine-learning/model-downloads/#the-cache-api-key-is-the-remote-hub-url-so-a-models-files-are-matched-by-its-id)).

transformers.js exports `ModelRegistry.clear_cache(modelId)`, which looks like it does this job. The reader doesn't use it. It checks the cache first, but any file that isn't cached turns into a network probe, and a network failure there throws. The reader works offline, and freeing disk space shouldn't need a connection. How the settings screen sizes these files is on [storage](/projects/reader/library/storage/).

## Weights are fetched with `no-store`

On an iPhone, the system's storage screen showed about 949 MB of "other browser storage", while the sites listed there added up to about 603 MB. The gap was the browser's HTTP cache. A plain `fetch` lets the browser keep its own copy of the response, separately from the Cache API copy transformers.js stores and the OPFS part-file. Nothing ever reads that copy ([why that happens](/storage/persistence-and-quota/#large-files-i-store-myself-are-fetched-with-no-store-because-the-http-cache-would-be-a-second-copy)).

So the reader fetches model files with `cache: 'no-store'`, which tells the browser to neither read nor write its HTTP cache for that request. It doesn't affect the Cache API. It's set in `fetchResumable`'s requests and in the `env.fetch` that `installModelFetch` installs, for any path ending in `.onnx`, `.wasm` or `.mjs`. The mode is added to the request's existing init, not swapped in for it, so a size probe keeps its `Range` header and the load watcher above can still see it. No test browser can measure the difference, because no API reports the HTTP cache's size. Only the device's own storage screen shows it.

## One recognizer per language, and a memo that survives its worker

`container.ts` keeps `recognizers: Map<Language, Promise<TextRecognizer>>`, one entry per language. That's what stops a second capture from starting a second worker and a second download. But the reader terminates a language's worker when I leave a book, and the memo stays. So the memo outlives the worker it was built around. If the memoized adapter still pointed at the dead worker, the next book's first capture would wait forever, which looks like recognition hanging.

It works because the adapter reopens itself. In `worker-recognizer.ts`, the part every worker-backed engine shares:

```ts
function prepare(): Promise<RecognizerOpening> {
  starting ??= begin();
  return starting;
}
```

`forget`, which every cancel path runs, sets both `worker` and `starting` back to `null`. So the next `prepare()` misses the `??=` and starts a fresh worker. Nothing else in the adapter may keep `starting` past a `forget`. A refactor that moved the promise up a level, or made `begin()` run only once, would break reading a second book with no type error. Two specs guard it: `manga-ocr.adapter.spec.ts` ("opens a fresh worker after a cancelled load") and `capture-view.spec.ts` ("opens the engine again for the next book after the previous one closed it").

The container also replays the latest session to screens that subscribe late. That's `sessionNotices`, a `noticeBoard<Language, RecognizerSession>` from `platform/events/notice-board.ts`. It has to be cleared on the same close, or a screen that subscribes later gets a session describing a worker that no longer exists. The rule, as it stands: the adapter is reusable, the worker isn't, and anything cached about the worker goes when the worker goes ([the adapter reopens itself](/machine-learning/worker-lifecycle/#the-adapter-reopens-itself-which-is-the-only-reason-the-composition-root-may-memoize-it)).

## Closing only an idle recognizer

When the reader switches from one language to another, it closes the old language's recognizer. `container.recognition.closeRecognizer(language)` drops the cached recognizer and calls its `cancel()`. In `worker-recognizer.ts`, that terminates the worker and settles every pending reading as `recognition-failed` with "The recognition model load was canceled". So closing a recognizer while a reading is in flight would fail that reading.

`EngineWarmup` (`recognition/ui/engine/engine-warmup.svelte.ts`), the view model that opens and switches the engine, counts readings in flight in `#activeRecognitions`. `#switchTo` doesn't close the old language straight away. It parks it in `#retiring`, and `read`'s `finally` closes the parked ones once the count reaches zero. The count is global, not per language, so a parked recognizer may also wait for a reading in the new language. That delays the close a little and never cuts a reading short. The rule: only close an idle recognizer ([the general version](/machine-learning/worker-lifecycle/#closing-a-worker-backed-resource-cancels-it-so-close-only-an-idle-one)).
