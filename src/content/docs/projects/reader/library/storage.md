---
title: What the Reader Stores, and Where
description: OPFS blobs, the IndexedDB databases and their shared connection module, model weights in the Cache API, what the storage screen can measure, and removing a book with its captures.
tags: [reader, storage, opfs, indexeddb, cache-api]
sidebar:
  order: 33
---

Everything the reader keeps lives in the browser: book files in OPFS, records in IndexedDB, and model weights in the Cache API. The split follows [IndexedDB and OPFS are for different things](/storage/persistence-and-quota/#indexeddb-and-opfs-are-for-different-things). This page is the reader's layout and the bugs it hit. The general pages are [IndexedDB](/storage/indexeddb/), [the OPFS API](/storage/origin-private-file-system/), [writing large files to OPFS](/storage/opfs/) and [persistence and quota](/storage/persistence-and-quota/).

## OPFS: book blobs and model part-files

A book's files sit in OPFS under `blobs/`. The book itself is the `.src` blob, and its cover is a `.cover` blob from the same blob store. Both readers read the book on the main thread with `getFile()`, which takes a few milliseconds. If the `.src` blob is gone, the image reader treats the book as missing and sends you back to the library ([the missing-book arrival](/projects/reader/library/reading-place/#a-missing-book-goes-back-to-the-library)).

There are two OPFS writers: the blob store, for uploads, and the part store, for resumable model downloads. Both write through `createSyncAccessHandle` from a worker, never `createWritable()`. So neither needs Safari 26, and neither needs spare quota for a swap file ([why a worker](/storage/opfs/#a-blob-is-written-to-opfs-from-a-worker-because-safari)). How an upload gets there, with progress, is on [Importing a Book](/projects/reader/library/importing-books/).

### The part-file that outlived its download

Model weights download in chunks so a download can resume: `fetchResumable` appends each chunk to a part-file in OPFS, and once the download completes, the part-file is deleted, because the finished file is in the Cache API. It opened one sync handle per chunk and closed it on the chunk's `done` read. The final chunk never got a `done` read, because the loop returns as soon as the last byte reaches the total. So deleting the finished part-file ran while that handle was still open, threw `NoModificationAllowedError`, and a `.catch(() => undefined)` meant for "already missing" swallowed it. A 117 MB weight file stayed in OPFS while the same bytes sat in the Cache API. The completion path now closes the append, cancels the chunk reader and closes the stream in one place, reached from the last byte ([the general rule](/storage/opfs/#an-open-sync-access-handle-makes-removeentry-fail-silently-if-you-let-it)).

### A private window is an expected outcome, not a failure

Some browsers block OPFS in a private window: `navigator.storage.getDirectory()` throws a `SecurityError`. That isn't a bug. Someone opened Dokseo in a private window, and they can fix it by opening a normal one. So `platform/opfs/directory.ts` turns that one refusal into an error with a fixed message, `PRIVATE_WINDOW`, and lets every other error through unchanged. The OPFS writer worker reports the same text.

An adapter that writes or reads OPFS keeps a `try` only around that call and checks `isPrivateWindowRefusal(cause)`, which compares the message with `PRIVATE_WINDOW`. The library adapter returns `storage-unavailable` (from `shared/storage-unavailable.ts`), and the library's text for it ends with the advice from the same module: "A private window does not save files, so open the library in a normal window to add a book." The adapter for model part-files returns `partials-unavailable`. Anything else rethrows, so a real storage bug isn't reported as a private window. The general reasoning is on [expected and unexpected failure](/architecture/expected-and-unexpected-failure/).

## IndexedDB: three databases, one connection module

IndexedDB backs three databases. The ones the code names:

- The `reader` database holds the `books` store and the `page-lists` store. A page list is `{ id, names }`, kept out of `books` so the library grid's `list()` never reads it (the list itself is explained on [Importing a Book](/projects/reader/library/importing-books/)).
- `flowing` has `flowing/adapters/flowing-database.ts`, which `indexeddb-reading-settings.ts` imports as a sibling adapter.
- Recognition's upgrade creates a consent store keyed by `language` and a capture store keyed by `id`, with a `bookId` index:

```ts
function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(CONSENT_STORE)) {
    db.createObjectStore(CONSENT_STORE, { keyPath: 'language' });
  }
  if (!db.objectStoreNames.contains(CAPTURE_STORE)) {
    const captures = db.createObjectStore(CAPTURE_STORE, { keyPath: 'id' });
    captures.createIndex('bookId', 'bookId', { unique: false });
  }
}
```

Each database has one module that owns its name, version, store names and upgrade, and every adapter on it calls that module ([one module per database](/storage/indexeddb/#adding-a-store-to-a-live-database-is-a-version-bump-and-every-adapter-on-that-database-has-to-move-together)). The architecture rule `only-the-container-builds-adapters` exempts an adapter importing a sibling adapter in its own domain, which is what makes that module legal. What's shared across domains is the capability, not an adapter: `platform/idb/connection.ts` owns connection handling, and each domain keeps an adapter in its own vocabulary.

`connection.ts` handles the cross-tab cases: closing on `versionchange`, bounding how long an open waits, and the browser closing a connection itself. A caller that cached an `IDBDatabase` still works, because `transact` swaps a retired connection for the live one ([upgrades across tabs](/storage/indexeddb/#an-upgrade-waits-on-every-other-tabs-open-connection)).

### Stored values are checked on load

A tag color was renamed from `ember` to `copper`. Tags stored before the rename came back as `ember`, missed every lookup keyed on the union, and drew no color. Nothing threw. The stored record type now declares the field `unknown`, and `tagFromStored` narrows it with `isTagColour` and falls back to the default. A rename needs no migration, only the fallback ([stored enums](/storage/indexeddb/#a-stored-enum-value-is-unknown-until-a-load-checks-it)).

Every other enum on a stored book or capture now gets the same check. A field whose type comes from a union of string literals is declared `unknown` on the stored record, and for each field I chose in the load function what an unknown value means:

- Where a default is safe, the load falls back. `bookFromStored` does this for `language` (Japanese), `direction` (right to left), `pagePairing` and `pageFit`, and `captureFromStored` for a capture's `origin`.
- Where no default is safe, the load throws `CorruptRow` from `shared/corrupt-row.ts`. A book's `layoutKind` selects the reader that opens it and its `sourceKind` how its file is read, and a guess at either would open the book wrong. A capture whose anchor names an unknown `kind` throws too.

The throwing case goes through `knownStoredValue(row, field, value, guard)`, which returns the narrowed value or throws. The guards compare with `some((known) => known === value)`, because `.includes` on a typed array doesn't accept an `unknown` argument, and `some` with `===` needs no cast. For a capture's anchor, `anchorFromStored` destructures `const { kind } = anchor` first: TypeScript narrows `anchor` through the destructured `kind`, so the two known kinds return, and the `throw` after them receives the real stored value. Nothing catches a `CorruptRow` on the way up, because the repositories map rows outside their `try`. The read that loaded the row rejects, the screen shows "Something went wrong" with the error's text, and `failureMessage` logs it as unexpected ([boundaries and logging](/projects/dokseo/architecture/use-cases-and-failure/#boundaries-and-logging)).

New fields follow the same idea. A field added to a stored record is `?: T | null`, because older rows lack it, and one load function collapses absent and `null` to a default. `bookFromStored` does that for `lastReadAt` and `finishedAt` ([the typing side](/typescript/type-checking-techniques/#exactoptionalpropertytypes-makes-a-new-field-on-a-stored-record--t--null)).

## Cache API: model weights

transformers.js puts every completed model file in the Cache API and reads it from there first. A download in progress sits in OPFS as a part-file. Model files (`.onnx`, `.wasm`, `.mjs`) are fetched with `cache: 'no-store'`, so the HTTP cache doesn't hold a third copy ([why no-store](/storage/persistence-and-quota/#large-files-i-store-myself-are-fetched-with-no-store-because-the-http-cache-would-be-a-second-copy)). Where that's set, and the rest of the download path, is on [Downloading, Caching and Closing Models](/projects/reader/recognition/model-lifecycle/).

## What the storage screen can measure

The storage screen is the `storage` domain. `storage/use-cases/read-storage-account.ts` imports `recognition/domain/model/model-cache.ts` and `model-footprint.ts` to separate a model's cached files from the runtime's and to label each model. The classification stays in the use case, and only the arithmetic is in `storage/domain/storage-parts.ts`.

- The origin total comes from `navigator.storage.estimate()`. There's no per-database figure to show next to it, so the screen shows that there isn't one ([what estimate covers](/storage/persistence-and-quota/#navigatorstorageestimate-reports-an-origin-and-nothing-reports-indexeddb)).
- A cached file's real size is its body, `(await response.blob()).size`, not its `content-length`. The ONNX runtime WASM declares about 7 MB and holds about 27 MB. transformers.js writes the decoded length for the model files it caches itself, but the runtime's `.wasm` and `.mjs` keep the wire size. `blob()` is only a cheap handle in Chromium. In Firefox it's a full read and a temporary copy ([wire size versus disk size](/storage/persistence-and-quota/#a-cached-responses-content-length-is-the-wire-size-not-the-disk-size)).
- The header is only the fallback, and with neither the size is "unknown" ([the fallback](/storage/persistence-and-quota/#content-length-is-the-fallback-and-a-missing-one-means-unknown)).

The reader asks for `persist()` at the first upload, not on first paint ([when to ask](/storage/persistence-and-quota/#caching-is-not-durability)). That's on [Importing a Book](/projects/reader/library/importing-books/).

## Removing a book removes its captures

A book lives in `library` and its captures live in `recognition`, and neither leaf may import the other. So `storage/use-cases/remove-book-and-captures.ts` composes `recognition/use-cases/capture/clear-captures.ts` and `library/use-cases/remove-book.ts`. It imports the two use cases, not the two repositories, and its deps are the two use cases' deps objects. Clearing a book's captures goes through the `bookId` index, which has no delete of its own ([delete by index](/storage/indexeddb/#deleting-by-index-means-collecting-keys-and-deleting-inside-the-same-transaction)).

Removing a single capture has an Undo too. How the panel takes the card out, puts it back on a failure and restores it on Undo is on [Captures, Tags and Search](/projects/dokseo/recognition/captures/#saving-removing-and-undo).
