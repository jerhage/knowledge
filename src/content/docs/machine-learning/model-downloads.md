---
title: "Model Downloads: Progress, Cache Keys and Resuming"
description: "Telling a cached load from a download, finding a model's files in the Cache API, resuming via a ranged `env.fetch`, and the statuses a replacement fetch must pass through."
tags: [machine-learning, transformers-js, cache-api, opfs, storage]
sidebar:
  order: 5
---

A model for in-browser inference is a large download (the manga-ocr export I made for my reader is 123 MB). transformers.js downloads a model's files from the Hub the first time, stores them in the browser's Cache API, and reads them from there on later loads. Around that, an app wants three things: honest progress while it loads, a way to delete a model's files, and a way to resume a download that got stopped. I read everything here out of `@huggingface/transformers` 4.3.0. Stopping a download (there's no abort) is in [Long-Lived Model Workers](/machine-learning/worker-lifecycle/). What the stored files cost on disk, and why the weights are fetched with `no-store`, is in [Storage Persistence, Quota and What It Counts](/storage/persistence-and-quota/).

## Nothing in the progress union distinguishes a cached load from a downloaded one

While a model loads, transformers.js reports progress through a callback you pass in. I want the screen to show "Downloading" only when bytes are really coming over the network, and something neutral when the model is just being read back from the cache. The callback receives a `ProgressInfo`. In `@huggingface/transformers` that type has six members, and the whole union is in `types/utils/core.d.ts`:

| `status` | documented meaning | fields |
| --- | --- | --- |
| `initiate` | A file load is about to start | `name`, `file` |
| `download` | A file download has started | `name`, `file` |
| `progress` | A file download has reported byte progress | `+ progress`, `loaded`, `total` |
| `progress_total` | Aggregate progress across all files | `+ files` map, no `file` |
| `done` | A file has finished loading | `name`, `file` |
| `ready` | The requested pipeline is ready | `task`, `model` |

The names make it look like you can tell a download from a cache hit, and you can't. In 4.3.0, `loadResourceFile` dispatches `'download'` *after* the `if (cacheHit) … else …` block closes, with no condition. So it fires for a file served from the Cache API exactly like it does for one fetched over the network. `'progress'` is no better. On a cache hit outside Firefox, the cached `Response` gets streamed through `readResponse` and reports byte progress per chunk like any download. `progress_total` is computed from `'progress'` by `DefaultProgressCallback`, so it has the same problem. What you see: a reload with the weights already cached shows "Downloading the model, 37 percent".

**`env.fetch` is what distinguishes them, and it's a supported hook.** `env` exposes `fetch: (input, init?) => Promise<any>`, documented as "The fetch function to use. Defaults to `fetch`", and every network request goes through it. Where the library calls it:

- File bodies come in through `getFile`, and `loadResourceFile` only reaches it on the cache-miss branch.
- `loadAndCacheFile` (used for the ONNX runtime's own `.wasm` and `.mjs`) calls `cache.match(url)` first, and only calls `env.fetch(url)` when that misses.
- The one other caller is `get_file_metadata`. It checks the cache first, and only for a file that isn't there, it sends a `Range: bytes=0-0` probe (with `cache: 'no-store'`) to get the file's size. `from_pretrained` runs it over the expected files when you give it a progress callback.

So if `env.fetch` is never called during a load, every byte came from the Cache API. Wrap it, set a flag on any request without a `Range` header (which skips the size probes), and the flag is exact. A small module in the worker that installs the wrapper can be unit tested against a fake `env`. Make sure nothing else in the worker touches `fetch`, or the flag misses it.

This depends on the version. Read `loadResourceFile` again before trusting `'download'` in a later one. And keep a neutral word ("Loading") as the default, so that if I'm wrong, the screen shows a vague word rather than a false one.

## The Cache API key is the remote Hub url, so a model's files are matched by its id

To delete a model and free its space, I need to find every file that belongs to it in the cache.

transformers.js opens `caches.open(env.cacheKey)`, which is `'transformers-cache'`. `buildResourcePaths` uses `remoteURL` as the key, which is `https://huggingface.co/<model>/resolve/<revision>/<file>`. So you can find every file a model owns with nothing but `cache.keys()` and a substring test on the id, and you don't have to keep an index. Test for `'/' + modelId + '/'`, *with* both slashes. `DigitalLarynx/manga-ocr-onnx` without the trailing slash also matches `DigitalLarynx/manga-ocr-onnx-large`, and deleting one model would take the other with it.

Not everything in that cache has a model id in its key. The ONNX runtime's `.wasm` and `.mjs` go through `loadAndCacheFile`, keyed on a CDN url. And `experimental_transformers-hash-cache` is a second cache, only used when `env.experimental_useCrossOriginStorage` is on. When removing a model, sweep both cache names, and leave alone anything that doesn't match a model. The runtime is shared, and downloading it again gets you nothing.

`ModelRegistry.clear_cache(modelId)` is exported and looks like the right answer. For an offline app it isn't. It calls `get_files`, which works out the file list from the config and calls `get_file_metadata` to check whether the tokenizer and processor files exist. Each of those checks the cache first. But anything that isn't cached (a file the repository never had, or one already removed) turns into a network probe, and a transport failure there throws. So someone offline who tries to free up disk space gets an error instead. It also only covers the files the current config and dtype would load, not what's actually in the cache.

## A resumable download is a ranged fetch behind `env.fetch`, streamed back

On its own, transformers.js only caches a file once it has read the whole body. If a load stops partway through a large file (for example, someone cancels it), everything received for that file is thrown away, and the next load starts it again from zero.

Resuming is possible because the Hub serves ranges (`accept-ranges: bytes`, a `206` with `content-range: bytes 0-1023/86967767`, and CORS exposing both headers), and `env.fetch` is a function you can replace. That's the whole mechanism. A resumable fetch requests `bytes=<have>-<have+8MiB-1>`, appends each network read to a file in [OPFS](/storage/origin-private-file-system/), and returns a `Response` that the library caches as usual.

**The returned body is a `ReadableStream`, not a buffer.** The library measures progress by reading the body you give it. So a `Response` built from a finished buffer reports nothing for a minute and then everything at once. The stream sends the bytes already on disk first, then each chunk as it arrives, with `Content-Length` set to the full size. That way `readResponse` and `progress_total` work without changes, and nothing above `env.fetch` can detect that a resume happened. It also keeps peak memory at one chunk instead of 117 MB.

**`pull` has to loop until it enqueues or closes.** A stream calls its `pull` function when its queue has room for more data. If a pull returns without enqueuing anything, it only gets called again if a read came in while it was running. `ReadableStreamDefaultControllerCallPullIfNeeded` calls itself again from the fulfillment handler only when `pullAgain` was set. So ending a chunk without enqueuing deadlocks the stream, and it does it silently. What you see is a test that times out, not an error.

**Append with `createSyncAccessHandle()`, never with `createWritable()`.** Chrome backs a writable with a swap file, and `keepExistingData: true` copies the existing content into it first. So appending to a large file N times costs O(N²) bytes of copying. A sync access handle writes in place. It only exists in a dedicated worker, and you have to declare it locally when compiling against `lib.dom`, because TypeScript puts it in `lib.webworker.d.ts`.

The handle takes an exclusive lock, and that has a cost. `getFile()` from the main thread (which is how a settings screen would measure part-files) can't read a locked entry. So open the handle for each chunk and close it at the end of that chunk. The last chunk's handle is the easy one to forget, and then the part-file can't be deleted: see [Writing Large Files to OPFS](/storage/opfs/).

**Resume starts from the file's size, and that's safe because each `write()` finishes before the next one starts.** A later load reads how big the part-file is and requests the rest from there. A terminated worker can't leave a half-finished write. Opening the append at a given offset should also truncate to that offset before writing anything, so a leftover tail from an OS-level crash can't be counted as progress.

Name a part-file `encodeURIComponent(url)`. That's flat, reversible, and includes the model id. So the same whole-segment id test that finds a model's cache entries also finds its part-files, and you don't have to keep an index.

## transformers.js reads the status of what `env.fetch` returns

A replacement `env.fetch`, like the resumable one above, gets called for every file the library loads, not only the weights. Some of those files are optional: when a model loads, the library also requests files a repository may not have (some configs are loaded with `fatal` set to `false`), and a missing one just means the model doesn't use it.

What counts as missing comes from the response's status, which the library reads after `env.fetch` returns. In 4.3.0, `loadResourceFile` calls `getFile`, which calls `env.fetch`, and then passes any status other than 200 to `handleError`. For an optional file, `handleError` returns `null`, so a 404 there means the file is absent and loading goes on. For a required file it throws a `ModelFileNotFoundError` (for 401, 403 and 404) or a plain `Error`.

So a replacement fetch should pass every non-weight file through untouched and return its response with the status it came with. If it threw on a 404 instead, a missing optional file would fail the whole load. Only the path for files that are never optional (the resumable weights fetch) may throw on a bad status. A rejection for a network failure is fine everywhere, because the built-in `fetch` rejects in that case too, and the library lets either rejection propagate the same way.

