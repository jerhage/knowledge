---
title: Storage Persistence, Quota and What It Counts
description: Eviction and `persist()`, what `estimate()` covers, measuring a cached response's real size, and the HTTP cache duplicating it.
tags: [storage, cache-api, indexeddb, opfs]
sidebar:
  order: 1
---

## Caching is not durability

My reader keeps books and downloaded models in the browser's own storage. That storage isn't guaranteed to stay. Every browser store (Cache API, IndexedDB, OPFS) is evictable, meaning the browser can delete that data on its own. Eviction skips an origin (a scheme, host and port) that holds a persistence grant.

```ts
await navigator.storage.persist();    // request
await navigator.storage.persisted();  // do we hold it?
await navigator.storage.estimate();   // usage and quota
```

**Ask at a moment that makes sense.** Firefox shows a prompt. Chromium and Safari grant or deny it silently, based on engagement history (how much the site has been used). So a request on first paint gets denied, because there's no history yet. Chromium re-runs the same checks on every call, so asking again later can succeed. But in Firefox, a prompt on first paint shows a question nobody has any context for. I ask at a meaningful action instead, like a first upload.

## IndexedDB and OPFS are for different things

[IndexedDB](/storage/indexeddb/) is for small, structured records that you query. [OPFS](/storage/origin-private-file-system/) is for large opaque blobs, with real file handles and sliced reads. If you use one for both jobs, one of them gets worse.

## `navigator.storage.estimate()` reports an origin, and nothing reports IndexedDB

The reader's settings screen shows how much space the app is using. The obvious source for that is `navigator.storage.estimate()`, which returns a `usage` and a quota. `usage` counts every store the origin has: Cache API, OPFS, IndexedDB, service worker registrations, plus padding the browser adds on purpose so nobody can use the number to probe for cross-origin state. (The quota next to it is the most the browser will let the origin store.) There's no standard way to ask how much space one IndexedDB database takes. Chromium has a non-standard `usageDetails`, but it splits by backend, not by content, and no other browser has it. So I can always show an origin total, and never a per-database figure. The screen should show that gap, so someone reading it doesn't have to guess what the total covers.

## A cached response's `content-length` is the wire size, not the disk size

The settings screen also shows how much space the cached model files take. A cached response has a `content-length` header, and it's tempting to read the size from there. But that header gives the wire size: how many bytes came over the network. The Cache API stores a response's decoded body, after decompression. So a file served with `content-encoding: gzip` takes up more on disk than its header states. The ONNX runtime WASM, which the app caches to run models, declares about 7 MB and holds about 27 MB. To measure what a cache costs the origin, read the body, not the header:

```ts
const held = (await response.blob()).size;   // bytes on disk
response.headers.get('content-length');      // bytes on the wire
```

How cheap that is depends on the engine, because the spec gives `blob()` no shortcut. It's defined as "consume body", which reads the whole stream. Chromium takes a shortcut anyway. There, a `Response` from `cache.match()` has a blob-backed body, and `blob()` just returns that existing blob handle without reading a byte. So it's cheap even over hundreds of megabytes. Firefox has no such path for Cache API responses. `blob()` pumps the whole body into a new blob, and past a small in-memory threshold that blob spills to a temporary file (outside private browsing). So in Firefox it costs a full read and a disk copy, though it doesn't hold the whole body in RAM. I haven't checked Safari. I still measure cached files with `blob().size`; it's just only free in Chromium.

## `Content-Length` is the fallback, and a missing one means "unknown"

`cache.match(request)` returns a `Response` with the stored headers, so `Content-Length` comes for free, as long as the server sent one. I only use it when the body can't be read. It's normally the wire size, so for a compressed response it undercounts. transformers.js is an exception for the model files it caches itself: it sets `content-length` to the decoded byte count before `cache.put`. The ONNX runtime's `.wasm` and `.mjs` get cached as they arrived, so they keep the wire size.

The other ways to get a size are worse than `blob()`. `arrayBuffer()` (and `bytes()` and `text()`) load the whole body into memory. For a 117 MB decoder, that costs more than the number is worth. Reading `response.body` and adding up the chunk lengths also reads every byte, but it only holds one chunk at a time. So it costs I/O, not memory.

If neither the body nor the header gives a size, it's unknown, and the screen should show "unknown". Averaging a guess across the entries puts a made-up number next to measured ones.

## Large files I store myself are fetched with `no-store`, because the HTTP cache would be a second copy

A plain `fetch` lets the browser keep the response in its HTTP disk cache, separate from anything the page stores. For large files the page already keeps itself, that's a duplicate. I hit this with model weights. transformers.js already puts every completed file in the Cache API and reads it from there first, and a partial download sits in OPFS (see [Model Downloads](/machine-learning/model-downloads/)). So a 200 MB model can cost 400 MB, and nothing ever reads the HTTP copy. An iPhone showed about 949 MB of "other browser storage" against about 603 MB listed per site.

`cache: 'no-store'` makes the browser skip its HTTP cache for that request, for both reads and writes. It doesn't touch the Cache API: `cache.put` stores whatever `Response` it's given, no matter what cache mode the request used. For the model case, set it in the resumable fetch's requests and in the installed `env.fetch`, for any path ending in `.onnx`, `.wasm` or `.mjs`. Add the mode to the existing init instead of replacing the init. That way a size probe's `Range` header survives, and the pass-through still reads the header when it determines whether the load was cached or downloaded.

You can't measure the difference in a test browser. No API reports the HTTP cache's size, and `estimate()` doesn't count it. Only the device's own storage screen shows it.
