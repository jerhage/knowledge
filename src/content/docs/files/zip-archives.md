---
title: "Zip Archives: Random Access, Stored Entries and Size Caps"
description: Reading and writing zips one entry at a time with zip.js, slicing stored entries directly, and bounding zip bombs.
tags: [files, zip, security]
sidebar:
  order: 2
---

All of this builds on the lazy `File` → `slice()` chain in [large files](/files/large-files/).

## Reading an archive

With zip.js, `new ZipReader(new BlobReader(blob))` doesn't read anything yet. `getEntries()` parses only the central directory (the index at the end of a zip with each entry's name, size and offset) and lists the entries. `entry.getData(writer)` decompresses exactly *one* entry. A 400 MB `.cbz` never enters memory whole, and entry 140 costs the same as entry 1.

What makes this work is random access, and that comes from the zip *format*, not from the library.

zip.js starts its decompression worker from a blob URL. That matters if the page has a Content Security Policy: see [CSP for blob documents and workers](/security/csp-blobs-and-workers/).

## Writing an archive

`ZipWriter` with a `BlobReader` per entry streams each file in turn. Packing 182 loose images never holds more than one of them in memory. Use `level: 0` for images that are already compressed. That makes the zip a container rather than a compressor, which is faster and the file isn't any larger.

## Why `.tar.gz` cannot be lazy, and `.zip` can

Gzip is a stream with no index. To get to an entry, you have to inflate everything before it. `DecompressionStream('gzip')` is native and costs nothing to use, so a `.tar.gz` reader looks cheap. The format is what makes it expensive.

A `.zip` stores a central directory with an offset for each entry, so you can jump straight to any entry. That's the whole difference.

## zip.js cannot stop early, but a stored entry can be sliced

Sometimes only the start of an entry matters. When a comic archive opens, I read each page image's pixel size from its header, which sits in the image's first bytes, so the pages can be laid out without decoding any of them. That needs a way to read a few bytes of an entry and stop.

`entry.getData(writable, { signal })` streams an entry. Aborting the signal or throwing from `write` rejects it, but by then zip.js's pipeline has already pulled about four 64 KB chunks from the archive. I measured it with a counting blob: 262 KB read for a first write of 64 KB. For a header (like [an image's size header](/images/image-formats/)), that's ten times what I need, for every entry.

A *stored* entry (`compressionMethod === 0`, not `encrypted`) doesn't need zip.js at all. The central directory's `offset` points at the local file header. That header is 30 bytes, with signature `0x04034b50`, the file name length at 26 and the extra field length at 28, both little-endian. The data starts right after the header, the name and the extra field. The local lengths can differ from the central directory's, so read them from the local header. Then `blob.slice(start, start + n).arrayBuffer()` reads exactly `n` bytes. An image CBZ is almost always stored, because a JPEG doesn't compress.

A Node test can't show the difference between the two paths with a plain `Blob`. Node's `Blob.stream()` delivers an in-memory blob as *one* chunk, however large, so the whole entry gets pulled either way. A test double can show it: one that streams its slices in 64 KB pulls (the way a disk-backed file does) and counts them.

## A zip entry declares its size before anything is decompressed

zip.js's `reader.getEntries()` returns `uncompressedSize` for every entry, read from the central directory. Nothing has been inflated yet at that point. So a pass over the entry list costs one directory parse, and it catches a zip bomb before the bomb can cost any memory: open, `getEntries()`, check the entries against caps, close.

But the declared size is only a header *value*. A hostile archive can declare 1 kB and deliver 4 GB. zip.js only detects it once the entry is inflated into whatever writer it was given, and `TextWriter` and `BlobWriter` both keep accumulating with no cap. So checking the list is only a cheap first gate. A second gate belongs on the decoded value. For example, an XML parser that rejects a source longer than some maximum before it scans a single character stays bounded even when the declared size was false.

That still leaves the read itself unbounded. To really bound it, you need `entry.getData({ writable })` with a counting `WritableStream` that errors once it passes the cap. zip.js accepts a `WritableWriter`, so the mechanism is there.

`getEntries()` itself is the other unbounded step. It turns the whole central directory into objects before you can check `entries.length`. What bounds it is a maximum upload size, since each central directory record takes at least 46 bytes of the file.

## A page list derived from an archive is fixed when the book is added

When a book is an archive of images, its pages are the archive's image entries in some order. Call that ordered list of entry names the book's page list. A record that stores an image index (a bookmark, an annotation) points at a position in that list. Say the list gets rebuilt at every open by filtering and naturally sorting the archive's entries (the natural sort being [`Intl.Collator` with a tiebreak](/javascript/gotchas/)). Then any change to the filter or the sort moves those indices. A wider junk rule that drops `.cover.jpg` shifts every index after it.

So I keep each archive book's list in storage (`{ id, names }`, in its own store so a grid listing books never reads it) and open exactly those entries in that order. The rule only runs when a book is added, and on the first open of a book stored before lists existed (which then saves the list). The rule can change freely for new books, but a book's list never gets recomputed. Fixing a stored book needs its own migration. A listed name that's missing from the archive is an error. Skipping it would shift the indices again. A format with its own built-in order (PDF, EPUB) doesn't need a stored list.

A good page-image rule: not a directory, not junk (any path segment that is `__MACOSX` or starts with a dot, or the names `Thumbs.db` and `desktop.ini`, ignoring case), and an image extension. Use the same rule everywhere you compute a list of pages or a book fingerprint. Then a folder that picked up a `.DS_Store` or a `._` fork still matches its stored book.
