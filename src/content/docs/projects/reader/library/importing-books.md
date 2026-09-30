---
title: Importing a Book
description: "From a dropped file or folder to a stored book: reading the selection, deciding what kind of book it is, the partial MD5 and its match outcomes, zip-bomb census, the OPFS write with progress, and the cover."
tags: [reader, files, hashing, zip, opfs, storage, unicode]
sidebar:
  order: 30
---

An import in the reader goes from a file picker or a drop to a book row with a hash, a page list, a blob in OPFS and a cover. Each step leans on a general note: [file inputs and drops](/html/forms-and-labels/), [KOReader's partial MD5](/files/koreader-partial-md5/), [zip archives](/files/zip-archives/), [writing large files to OPFS](/storage/opfs/) and [image formats](/images/image-formats/). This page is the order they run in, with the reader's own module names.

## Reading the selection

The library screen takes books from a file picker (a file input) or a drop. One bug in the import path was in the picker. Picking a file did nothing, and there was no error anywhere. The input's handler read `input.files`, then cleared `input.value`, and by the time it used the list it held, the list was empty. In Chromium and WebKit the clear empties that same `FileList` in place (Firefox returns a new one), so I copy the files out before touching the value. See [`input.files` is live](/html/forms-and-labels/#inputfiles-is-live-and-clearing-the-value-empties-it). The old upload tile's component spec went away with the tile. The bug is now guarded by two unit tests, `chosen-files` and `drop-reading`.

Someone can also drop a whole folder of images on the page. A dropped folder arrives as one zero-byte entry in `dataTransfer.files`, so the drop path walks `webkitGetAsEntry()` to reach the images inside ([dropping a folder](/html/forms-and-labels/#dropping-a-folder-gives-you-a-directory-entry-not-its-contents)).

`Dropzone` is the component that takes drops, and it has a `directory` option that adds a hidden folder picker next to the file input. Both inputs sit inside the zone's `label`, so a click anywhere on the zone reaches a picker. But a label only names its first labelable descendant. So clicking the zone opens the file picker, never the folder one, and the folder picker is opened from script with `click()` ([a second file input inside a label](/html/forms-and-labels/#a-second-file-input-inside-a-label-is-not-the-labels-control)).

## Names are composed to NFC on the way in

The same text can be stored composed (one code point for a character) or decomposed (the same character as several code points), and a file name from macOS is often decomposed while typed text is composed. `file-entry.ts` is where a `File` becomes the reader's own vocabulary, and it runs the name through `normalize('NFC')` there. So a title is stored in one canonical form whatever the filesystem handed over. NFKC stays out of storage: it belongs to the search fold. A test asserts that a title keeps `①`, `ﬁ` and `Ａ` exactly. Why NFC is safe (with one CJK exception) and NFKC isn't is on [search folding](/text/search-folding/#nfc-at-the-boundary-nfkc-only-for-matching).

## Detecting what kind of book it is

An import can be an archive, a folder of loose images, a PDF or an EPUB, and an archive or folder often contains files that aren't pages. One function defines what counts as a page: `isPageImage` in `domain/ingest/image-entries.ts`. An entry is a page if it's not a directory, not `isJunk` (any path segment `__MACOSX` or starting with a dot, or the names `Thumbs.db` and `desktop.ini`, case ignored), and has an image extension. Every place that lists pages or books uses it:

- the ZIP listing
- `packImagesIntoArchive`
- `detectSourceKind`
- `splitUpload`
- `fingerprintedFiles`, the files an images book is hashed from

Because the hash uses the same rule, a folder that picked up a `.DS_Store` or a `._` fork still matches the book it was stored as.

An image book's page list is the ordered list of entry names the reader shows as pages. It's computed once, when the book is added. `listStoredPageNames` calls `listArchivePageNames` in `file-source-builder.ts`, which then opens the archive by that same list. The list goes into the `page-lists` store of the `reader` IndexedDB database as `{ id, names }`. It sits beside the `books` store rather than inside a book row, so the library grid's `list()` never reads it. A book stored before the lists existed gets its list on first open: `pageListFromStored` answers `unlisted`, and `openForReading` saves one through the `savePageList` use case. A PDF or EPUB has an `intrinsic` page order and no stored list. Why the list is frozen is on [zip archives](/files/zip-archives/#a-page-list-derived-from-an-archive-is-fixed-when-the-book-is-added), and how the reader opens by it is on [page sources](/projects/reader/library/page-sources/).

## The census before anything is inflated

A zip bomb is an archive whose entries inflate to far more than the file's size. So an archive goes through a census, a count of what its entries claim, before the reader inflates anything. The census is `archive-census.ts`, and it does one thing: open, `getEntries()`, `archiveBreach(entries)`, close. `archiveBreach` checks the declared sizes against caps, so a zip bomb is refused after one directory parse ([a zip entry declares its size](/files/zip-archives/#a-zip-entry-declares-its-size-before-anything-is-decompressed)).

The declared size can be false, so the census isn't the only bound:

- `parseXml` rejects a source longer than `MAX_MARKUP_BYTES` before it scans a character, which bounds the parser even when an entry's declared size is false.
- `MAX_UPLOAD_BYTES` bounds `getEntries()` itself, since every central directory record costs at least 46 bytes of the file.

What stays unbounded is the inflate of one entry. A counting `WritableStream` passed to `getData` would close that gap, and zip.js accepts one, but I haven't wired it up. The per-entry census already keeps a well-formed book's worst entry under the cap, and an archive with false sizes still has to stream its payload off disk as a `Blob`.

## The partial MD5 and the four match outcomes

A book is identified by KOReader's partial MD5, so the same book matches on a KOReader device. The two modules are `src/lib/platform/crypto/md5.ts` (the streaming MD5, walked through in [MD5 step by step](/files/md5-step-by-step/)) and `src/lib/platform/crypto/partial-md5.ts` (the sampler). They're in `platform/` because they import no domain.

When a file is imported, the reader has to decide whether it's a book already in the library. `open-file.ts` hashes the file and looks for a stored book through the pure function `joinUpload`, which has four outcomes:

| Outcome | Meaning |
| --- | --- |
| by content | a stored book has the same partial MD5 |
| by legacy content | a stored book has the same old SHA-256 fingerprint |
| by name | a stored book has the same file name |
| new | nothing matched, so this is a new book |

The rest of the setup follows [where the hash fits](/files/koreader-partial-md5/#where-the-hash-fits):

- A book stores its `fileName` beside the hash.
- `hashForm` distinguishes the two hash kinds by length: a partial MD5 is 32 hex characters, the legacy fingerprint 64.
- The "Match books by" setting in Settings › Library picks content (the default, the partial MD5) or file name. It's stored in localStorage under `reader.library.matching`. File-name matching is kosync's filename mode, which keys a book by `md5(file_name)`, so the same `Md5` class computes it.

### The legacy fingerprint

Before the partial MD5, `src/lib/platform/crypto/fingerprint.ts` identified a book by SHA-256 over `size ‖ first 1 MiB ‖ last 1 MiB`, read through `blob.slice()` so only those ranges were ever in memory. It had to be sampled because WebCrypto has no streaming digest ([large files](/files/large-files/#webcrypto-has-no-streaming-digest-so-a-big-file-is-sampled-not-hashed)). Two files with the same length and the same bytes at both ends got one fingerprint. That was fine for "is this the file I already imported".

It's kept for one job now. When an old book is imported again, the legacy fingerprint finds its row, and that row then gets the partial MD5.

### When the file can't be hashed

Hashing reads the file, and reading a `Blob` can fail. I don't want that `try` in the use case: a use case holds the rules of an import, and catching a browser call's failure is an adapter's job, where the call happens. So `open-file.ts` receives each hash as a `ContentHasher`, a function that resolves `success` with a digest or `unreadable` with a cause. The adapter `library/adapters/blob-digest-hasher.ts` builds one from a digest function, and its `try` around that call is the only catch on the path. The container wraps both `partialMd5` and the legacy `fingerprintOf` with it. `open-file.ts` turns `unreadable` into its own `fingerprint` variant, and the upload shows "This page cannot check uploads for duplicates here:" followed by the cause.

## Writing the blob to OPFS

The book file itself is stored in OPFS, the browser's private file system for the origin, and the write runs in a worker: `blob-store.put` hands the `Blob` to `src/workers/opfs-writer.worker.ts` and waits for the reply ([a blob is written to OPFS from a worker](/storage/opfs/#a-blob-is-written-to-opfs-from-a-worker-because-safari); the Safari side is on [browser support](/projects/reader/engineering/browser-support/)). Posting a 400 MB archive reads nothing on the main thread, because structured clone carries a `Blob` by reference.

The worker writes in 4 MiB ranges from `chunkRanges(size, WRITE_CHUNK_BYTES)` in `src/workers/blob-chunks.ts`, and posts a `written` reply after each range. That's what lets the upload show a real byte fraction ([a chunked OPFS write](/storage/opfs/#a-chunked-opfs-write-is-what-makes-the-byte-fraction-exist)). The time left comes from `uploadRemainingSeconds`, which returns nothing under 600 ms of measurements or under 2% of the file. Below that floor the screen shows the percentage and no time.

The first upload is also where the reader calls `navigator.storage.persist()`. Asking on first paint gets refused silently in Chromium and Safari, and in Firefox it's a prompt with no context. A refusal isn't final: Chromium re-runs its checks on every call, so a later ask can still succeed. See [caching is not durability](/storage/persistence-and-quota/#caching-is-not-durability). What the reader stores where is on [storage](/projects/reader/library/storage/).

## The cover

The library shows each book as a card with its cover. The cover is stored as its own OPFS file whose name ends in `.cover`. `renderThumbnail` writes it as a 400 px WebP. The image-book path always did, and EPUB covers now go through it too.

An EPUB cover is often an SVG, and storing it as one would break. OPFS keeps no media type, so `blob-store.get` returns the blob with `type` `''` (measured in Chromium over four stored covers). The library shows a cover through an object URL made from that blob, so the `<img>` sniffs the bytes, and sniffing never detects SVG ([OPFS returns a stored blob with an empty type](/images/image-formats/#opfs-returns-a-stored-blob-with-an-empty-type-and-img-sniffs-every-raster-format-but-never-svg)). So the EPUB cover is rasterized through `renderThumbnail` before it's stored. I checked by reading the four stored blobs back in the browser: all four begin `52 49 46 46 … 57 45 42 50` (`RIFF….WEBP`), including the book whose cover in the archive is an SVG.

Rasterizing goes through `decodeAnyImage` (see [page sources](/projects/reader/library/page-sources/)), which sends an SVG through an `<img>` because `createImageBitmap` won't decode one. An SVG in an `<img>` loads nothing external, and that shows on real covers ([`createImageBitmap` will not decode an SVG blob](/images/image-formats/#createimagebitmap-will-not-decode-an-svg-blob-and-an-img-that-will-loads-nothing-external)):

| SVG cover | Stored WebP |
| --- | --- |
| self-contained (shapes plus text) | 3 070 bytes, draws correctly on the card |
| wraps a sibling PNG with `<image xlink:href>` | 1 010 bytes, fully transparent, looks exactly like the empty cover frame behind it |

Since the stored cover is always a WebP, no SVG ever reaches the DOM or the store, so its scripts never needed any CSP reasoning.

### Reading covers through the query cache

The library reads every cover in one query, `coversQuery` in `library/queries/library-queries.ts`, keyed by the list of book ids (`libraryKeys.covers(ids)`). One query rather than one per book means the covers land together. A new upload changes the list of ids, and a new key would start empty, so every cover would blank until the read finished. The query sets `placeholderData: keepPreviousData`, which keeps the previous key's covers on show until the new read lands.

The query holds `Blob`s, not URLs. An object URL keeps its blob in memory until it's revoked. A query function only produces a value, and nothing in a query's options runs when the cache later drops that value, so a URL made inside the query would never be revoked. `CoverUrls` (`library/ui/cover-urls.ts`), used by the `LibraryShelfData` component that owns the shelf's reads, makes a URL for each new blob, keeps the ones still shown, and revokes the rest.

The covers query uses `staleTime: Infinity`, so whatever it resolves stays until a write invalidates it. That makes the difference between "no cover" and "the read failed" matter. The repository returns a book without a cover as `null` inside its success, and the query leaves that book out of the map. A read that throws isn't turned into "no cover": it rejects the whole query, nothing is cached, and the next mount reads again ([svelte-query](/svelte/svelte-query/)).
