---
title: "Image Formats: Header Sizes, Sniffing and SVG"
description: Reading pixel size and orientation from headers, why stored blobs lose their type, and why SVG needs the `<img>` path.
tags: [images, files, opfs, security]
sidebar:
  order: 3
---

## An image's size is in its first bytes, and so is its turn

Dokseo, my manga and book reader, shows the pages of a comic archive in one long scrolling strip. To lay the strip out, it needs each page's width and height, and decoding every image just to get its size would be slow. It doesn't have to. Every common raster format states its pixel size near the start of the file, so you can get the size without decoding anything. That's what lets me lay out a long strip of images before any of them is decoded (see [Virtualizing a Long Strip of Images](/scrolling/virtualized-image-strips/)). Inside a zip, a stored entry can be sliced to read just these bytes (see [Zip Archives](/files/zip-archives/)). Where each format keeps its size:

- PNG: IHDR is always the first chunk, with width and height big-endian at 16 and 20.
- GIF: the logical screen, little-endian at 6 and 8.
- BMP: at 18 and 22, little-endian and signed. A negative height means a top-down bitmap, so take the absolute value. A 12-byte DIB header uses 16-bit fields at 18 and 20 instead.
- WebP: the first chunk after `WEBP` at 12 sets the layout. `VP8 ` has 14-bit sizes at 26 and 28. `VP8L` packs width−1 and height−1 in 14 bits each from byte 21. `VP8X` has 24-bit width−1 and height−1 at 24 and 27.
- JPEG: walk the segments from byte 2 (`FF`, marker, big-endian length that counts itself) to the first SOF marker, which is `C0` to `CF` except `C4`, `C8` and `CC`. Height then width are at +5 and +7. Skip `FF` fill bytes and the length-less `01` and `D0` to `D7`. If you reach `DA` (the scan) first, there's no size.
- AVIF: an ISO box tree. `meta` holds `pitm` (the primary item), and `iprp` holds `ipco` (the properties, 1-based) and `ipma` (which properties each item has). The size is the *primary* item's `ispe`. The first `ispe` in the file may be a thumbnail or an alpha plane.

Some images are stored sideways and have a flag that records how to turn them. The browser rotates the image before it reports `naturalWidth`. So the header size has to be rotated the same way. Otherwise a page gets laid out at the unrotated size, and the strip jumps when the image loads and turns out to be the other orientation. A JPEG's EXIF orientation 5 to 8 (in the first `Exif` APP1, TIFF directory 0, tag `0x0112`) and an AVIF's `irot` with an odd angle swap width and height. Orientations 2 to 4 only flip, so they keep them.

Check a header reader against a real browser's `naturalWidth` in a probe (a throwaway Playwright script that opens the real page). A Node test has no decoder to compare with. A useful result type is `size`, `short` (need more bytes) or `unknown`, so the caller reads more bytes only while the result is `short`.

## OPFS returns a stored blob with an empty type, and `<img>` sniffs every raster format but never SVG

Dokseo's library shows a cover for each book. It stores each cover as a file in OPFS with the extension `.cover`, and shows it by pointing an `<img>` at an object URL for the stored file.

Reading from [OPFS](/storage/origin-private-file-system/) is `FileSystemDirectoryHandle.getFileHandle(name)` then `handle.getFile()`. OPFS stores bytes and a filename. It doesn't store a media type, and the `File` it returns takes its `type` from the *name*. With a non-standard extension like `.cover`, `type` is `''`. I measured that in Chromium.

`URL.createObjectURL(blob)` then serves those bytes with an empty `Content-Type` (a blob URL's type is the blob's `type`). So an `<img>` detects the format by sniffing, which means reading the first bytes and matching them against known signatures. The mimesniff image table covers PNG, JPEG, GIF, WebP, BMP and ICO. It does *not* cover SVG, because SVG is XML and sniffing it is unsafe. So a raster image survives the round trip with its type wiped, and an SVG stored as itself comes back as bytes no `<img>` will draw.

An EPUB's cover can be an SVG, so this isn't hypothetical. For anything stored as an image: *store a raster*. Rasterize an SVG (for example through a thumbnail renderer to WebP) before storing it. Check by reading the stored blobs back. A WebP begins `52 49 46 46 … 57 45 42 50`, which is `RIFF….WEBP`.

## `createImageBitmap` will not decode an SVG blob, and an `<img>` that will loads nothing external

Rasterizing an SVG cover means decoding it first, and the usual decode call doesn't take SVG. Chromium's `createImageBitmap(blob)` rejects `image/svg+xml`, because the bitmap source path has no SVG decoder. An `HTMLImageElement` does have one. So a decode helper can send just that one media type the long way round: object URL, `element.decode()`, then `createImageBitmap(element)`, with the URL revoked in a `finally`.

An SVG in an `<img>` renders in the SVG Integration spec's *secure animated mode*. Scripts don't run. Declarative animation does run (a canvas or bitmap made from it captures one frame). And *no external reference is fetched*. That last one is the one that costs something. A publisher's EPUB cover is often `<svg><image xlink:href="cover.jpg"/></svg>`, and that raster never loads. So what the canvas gets is the SVG's own paint and nothing else. I measured it: a self-contained SVG cover (shapes plus text) rasterizes to a 3 070 byte WebP that draws correctly, while an SVG wrapping a sibling PNG rasterizes to a 1 010 byte fully transparent WebP.

Storing the rasterized result also takes scripts out of the picture: no SVG ever reaches the DOM or the store.
