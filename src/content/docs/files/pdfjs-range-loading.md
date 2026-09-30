---
title: "pdf.js: Loading a PDF by Byte Range"
description: A `PDFDataRangeTransport` subclass over Blob slices, what it fetches and keeps, and sizing a page without rendering it.
tags: [pdfjs, files]
sidebar:
  order: 3
---

I checked all of this against pdf.js 6.3.289. File and line references point into that version's `build/pdf.mjs` and `build/pdf.worker.mjs`.

## Reading a PDF by byte range

`getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })` loads the whole file. If you pass `range: new BlobRangeTransport(blob, head)` instead (a subclass of pdf.js's range transport that serves ranges from blob slices), pdf.js requests byte ranges.

### Why a slice costs nothing

A `Blob` is a reference with a size, not a buffer, and `slice(a, b)` returns another reference over a byte range. It's O(1), allocates no bytes, and doesn't touch disk. Memory only gets spent when something *resolves* a slice (`arrayBuffer()`, `stream()`, `text()`), and then only for the bytes in that range. A blob from an OPFS file handle is backed by the file on disk. Resolving a slice reads that range from disk at that point, and nothing sits in memory in between. More on this in [large files](/files/large-files/).

### The pdf.js side of the contract

The class to subclass is `PDFDataRangeTransport` (`build/pdf.mjs:15604`), exported from the package root. You construct it with `(length, initialData, progressiveDone)` and override `requestDataRange(begin, end)`. pdf.js calls that, and the subclass delivers the bytes asynchronously by calling the inherited `onDataRange(begin, bytes)`. `abort()` arrives on `task.destroy()`. `getDocument({ range })` checks `src.range instanceof PDFDataRangeTransport`, so an object with the same methods gets *rejected*. It has to be a real subclass.

The ranges pdf.js requests are already aligned to chunks and already clamped to the length you gave (`ChunkedStreamManager._requestChunks`, `pdf.worker.mjs:3108`). `ChunkedStream.onReceiveData` throws `Bad begin offset` / `Bad end offset` if you pass anything else. Clamping on your side is extra safety, not a correction.

`initialData` is a *prefix*, written at offset 0. You can't hand pdf.js the cross-reference table at the end of the file as initial data. pdf.js range-requests the tail itself, and that's its first request every time. Make the prefix 65536 bytes (pdf.js's own default `rangeChunkSize`, `pdf.mjs:15433`) and pass the same number as `rangeChunkSize`. Matching the two is what makes the prefix fill whole chunks. `ChunkedStream.onReceiveProgressiveData` only marks the chunks *below* `floor(position / chunkSize)` as loaded (unless the data reaches the end of the file), so a prefix that ends partway through a chunk leaves that chunk to be fetched again.

That first range request is also where the modern build calls an API iOS Safari didn't have. See [choosing the modern or legacy build](/files/pdfjs-builds/).

### What a 400 MB PDF costs

Loaded whole, it's 400 MB on the main thread for the `arrayBuffer()`, transferred into the worker and held for as long as the file is open, plus the decoded bitmap while rendering. By range, it's 64 KB read at open, then 64 KB per chunk pdf.js requests.

I measured this with a throwaway Node probe over two real files, counting the bytes requested from its transport. It called `getOperatorList` rather than doing a full render, so these are bytes *fetched*, not pixels:

| File | Fetched to open | Fetched after page 1 |
| --- | --- | --- |
| 1.28 MB, 231 pages | 165 KB (13%) | 230 KB (18%) |
| 2.40 MB, 283 pages | 240 KB (10%) | 437 KB (18%) |

Rendering still costs one bitmap (width times height times four bytes, so 24 MB for a 2000 by 3000 page at scale 2), and that's the biggest cost of a single page turn. A PDF page is drawing instructions, so unlike an image page it gets rendered and [stays on a canvas](/images/bitmaps-and-canvas/).

### pdf.js keeps what it fetched

The numbers above are easy to read as "a PDF opened by range stays small". It doesn't. The worker allocates one `new Uint8Array(length)` for the whole file (`ChunkedStream`, `pdf.worker.mjs:2896`) and writes each fetched chunk into it. Nothing ever evicts a chunk. So the footprint is 64 KB times the number of distinct chunks touched, and it only grows. A fetch happens when pdf.js needs an object that isn't loaded yet: the trailer and cross-reference table at open, then the page dictionary, fonts and content stream of each page it renders. So the footprint tracks where in the *file* the reader has been, not how many pages they've looked at. `disableAutoFetch: true` is what stops pdf.js from prefetching the rest in the background. Without it, the whole file arrives anyway.

The only limit is the file size. Someone who reads a whole document in one sitting ends up with most of it in memory, which is the whole-file behavior, just reached slowly.

The full-length allocation itself isn't resident (it doesn't take up physical memory up front). I measured with `process.memoryUsage()` (V8, macOS): a 400 MB `Uint8Array` raised RSS by 2 MB, and RSS then rose by roughly the bytes written as ranges of it got touched. Large zeroed typed arrays are mapped lazily and commit memory one page at a time, so the allocation reserves address space, not memory.

### What releases it

`task.destroy()` terminates the pdf.js worker, and the chunk buffer goes with it. Call it when the reader leaves the document. The memory comes back at that moment and not before.

### How much is fetched depends on the document's own structure

I made a synthetic 200-page PDF with the page objects spread evenly through the file, and pdf.js touched every chunk during open. The same generator with the page objects at the front and the padding behind them fetched only the 64 KB prefix and the tail chunk, 77 KB of 405 KB. Real files behave like the second one, because a real page tree is nested. Keep this in mind before treating a byte count as a guarantee.

## pdf.js sizes a page without rendering it

`pdf.getPage(n)` followed by `page.getViewport({ scale })` needs only the page dictionary. So it costs the byte-range chunks that hold page objects, and nothing from the content streams, fonts or images. How many chunks that is depends on where the producer put the page objects. Over five real files it ranged from none to 39 requests, and it was 47% of one file whose page objects are spread through it.

A size taken this way is only useful if it matches the bitmap the page renders to later. The render rounds the viewport up (ceil) to whole pixels. If the size code rounds any other way, the two differ by a pixel. So round the viewport up exactly the way the render does, through one shared function that both call.
