---
title: "Page Sources: Archives, PDFs and EPUBs"
description: "The `PageSource` port both readers and the recognizer read from, and how each of its three adapters opens a book without holding it in memory."
tags: [dokseo, files, pdfjs, zip, images, canvas, foliate-js]
sidebar:
  order: 31
---

A `PageSource` is how Dokseo, my manga and book reader, gets at a book's pages. It's a port in the kernel, `shared/page-source.ts`. The `library` domain produces it with three adapters (PDF, archive, EPUB), and `viewing` and `recognition` consume it. Every adapter follows the same rule from [large files](/files/large-files/#the-chain-that-keeps-it-lazy): hold a handle to the book and read one unit when it's requested. Nothing in Dokseo should ever have a whole book in memory. Where the port sits in the domain graph is on [Dokseo's domains](/projects/dokseo/architecture/domains/).

## One page at a time

`PageSource.image(index)` decodes one page and returns a bitmap. Who owns that bitmap, and when it gets closed, follows [one bitmap at a time](/images/bitmaps-and-canvas/#one-bitmap-at-a-time-and-mind-who-owns-it). A 2000 by 3000 scan is 24 MB of decoded pixels, so a leaked bitmap per page adds up fast.

What the viewers show is a different path from what the recognizer crops:

- An archive page is already an encoded image, so the viewer shows it as an `<img>` over a fresh object URL per mount, and the browser owns, decodes and evicts the pixels.
- A PDF page is drawing instructions, so it's rendered and stays on a canvas.

That split is [an encoded page belongs in an `<img>`](/images/bitmaps-and-canvas/#an-encoded-page-belongs-in-an-img-not-a-canvas). How the viewers use it is on [the paged viewer](/projects/dokseo/image-reader/paged-viewer/).

Anything that has to decode an arbitrary image goes through `decodeAnyImage` in `platform/image/decode.ts`. It decodes with `imageOrientation: 'from-image'`, and it sends `image/svg+xml` the long way round (object URL, `element.decode()`, then `createImageBitmap(element)`, URL revoked in a `finally`), because Chromium's `createImageBitmap` doesn't accept an SVG blob. See [image formats](/images/image-formats/#createimagebitmap-will-not-decode-an-svg-blob-and-an-img-that-will-loads-nothing-external). The cover path on [importing a book](/projects/dokseo/library/importing-books/#the-cover) is where that matters.

## Archives

`openArchivePageSource(blob, names)` opens a CBZ or ZIP by the page list stored when the book was added, and opens exactly those entries in that order. A listed name missing from the archive is `source-unreadable`, not a silent skip. Why the list is frozen is on [importing a book](/projects/dokseo/library/importing-books/#detecting-what-kind-of-book-it-is).

Underneath it's zip.js over the OPFS blob. `new ZipReader(new BlobReader(blob))` reads nothing yet, `getEntries()` parses the central directory, and `entry.getData(writer)` inflates one entry. So a 400 MB `.cbz` never enters memory whole, and page 140 costs the same as page 1 ([reading an archive](/files/zip-archives/#reading-an-archive)).

### Sizes from the headers, not from a decode

The paged viewer pairs pages into spreads, and to do that it needs every page's proportions: which images are landscape. Decoding 182 images to get that would cost more than showing the first one. So Dokseo started out treating an unmeasured page as portrait, recorded real sizes as pages were shown, and recomputed the pairing. The reading position is an image index so it survives that recompute.

Now the real sizes come from the image headers at open, which costs a few kilobytes per image instead of a decode. The portrait default only lasts until they arrive. The header reader is `platform/image/image-header.ts`. It returns `size`, `short` (more bytes needed) or `unknown`, and Dokseo reads more bytes only while the result is `short`. The format details, including the EXIF and `irot` turn, are on [image formats](/images/image-formats/#an-images-size-is-in-its-first-bytes-and-so-is-its-turn). I checked it against Chromium's `naturalWidth` on 14 files, in both a stored and a deflated archive. A browser is the only place the two can be compared, since a Node test has no decoder.

Reading a header through zip.js costs far more than the header: its pipeline pulls about four 64 KB chunks before an abort lands (262 KB for a first write of 64 KB). So a stored entry is sliced straight out of the blob instead, past its local file header ([zip.js cannot stop early](/files/zip-archives/#zipjs-cannot-stop-early-but-a-stored-entry-can-be-sliced)). An image CBZ is almost always stored, because a JPEG doesn't compress.

A Node test can't detect the difference with a plain `Blob`, because Node streams an in-memory blob as one chunk. The spec uses `CountedPart`, a test double that streams its slices in 64 KB pulls the way a disk-backed file does, and counts them.

## PDFs

`pdf-page-source.ts` used to be the one place that loaded a book whole: `getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })`. Now it passes `range: new BlobRangeTransport(blob, head)`, and pdf.js requests byte ranges ([reading a PDF by byte range](/files/pdfjs-range-loading/#reading-a-pdf-by-byte-range)).

Dokseo's side of the contract:

- `BlobRangeTransport` subclasses `PDFDataRangeTransport` and serves each range from a blob slice.
- The prefix is `RANGE_CHUNK_BYTES`, 65536 bytes, which is also pdf.js's default chunk size. Matching the two means the prefix fills whole chunks. pdf.js only marks the chunks strictly below `floor(position / chunkSize)` as loaded, so a prefix ending mid-chunk would get that chunk fetched again.
- `clampRange` in `pdf-ranges.ts` clamps each range to the file. pdf.js already sends aligned, clamped ranges, so this is extra safety, not a fix.
- `close()` calls `task.destroy()`, which ends pdf.js's worker and drops the chunk buffer it keeps. The viewer calls `close()` when the reader leaves the book, and the memory comes back then and not before ([what releases it](/files/pdfjs-range-loading/#what-releases-it)).

What it fetched on two real files is in the table on [what a 400 MB PDF costs](/files/pdfjs-range-loading/#what-a-400-mb-pdf-costs): 10 to 13% of the file to open, 18% after page 1. That footprint only grows while the book is open, since pdf.js never evicts a chunk.

A PDF page's size comes from `pdf.getPage(n)` and `page.getViewport({ scale })`, which only needs the page dictionary ([pdf.js sizes a page without rendering it](/files/pdfjs-range-loading/#pdfjs-sizes-a-page-without-rendering-it)). Over five real files that cost from none to 39 range requests, and 47% of one file whose page objects are spread through it. The viewport is ceiled through the same function the render uses, so the size and the bitmap can't differ by a pixel.

### Showing and cropping the same pixels

In `pdf-page-source.ts`, `picture()` (what the viewer shows) and `image()` (what the recognizer crops) are the same `render`, at the constant `RENDER_SCALE = 2`. If that scale followed the viewport, the two would drift apart without any error: the crop loses resolution, and furigana goes first. `pdf-page-source.spec.ts` guards it over two page geometries, because a scale derived from the viewport width matches a constant on exactly one aspect ratio, so one geometry proves nothing.

Which pdf.js build gets loaded (modern or legacy) is chosen at runtime. That's on [browser support](/projects/dokseo/engineering/browser-support/) and [choosing the build](/files/pdfjs-builds/).

## EPUBs

An EPUB is an archive too, but it isn't read as a list of page images. The library reads its contents with `library/adapters/zip-epub-inspector.ts`, and the container loads that module only when an EPUB arrives, the same way it loads a recognizer per runtime ([wiring](/projects/dokseo/architecture/wiring/)). A refactor that turns it into a static import still compiles and passes the dependency rules. Only the bundle grows. How chapters are shown is on [the ebook reader](/projects/dokseo/ebook-reader/chapters/).
