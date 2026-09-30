---
title: "Large Files: Lazy Blobs, Slices and Sampled Hashes"
description: Why a Blob is a reference, how `slice()` keeps reads lazy, and fingerprinting a large file by sampling it.
tags: [files, javascript, hashing]
sidebar:
  order: 1
---

A book, an archive or a video can be hundreds of megabytes. A browser app that handles files this size should never hold a whole file in memory. Keep a *handle* to the file and read one piece at a time, when you need it.

## The chain that keeps it lazy

```text
OPFS file handle  →  File (a Blob)  →  blob.slice(a, b)  →  bytes
```

Every step is lazy. `getFile()` doesn't read anything (see [OPFS](/storage/origin-private-file-system/) for where the handle comes from). A `Blob` is a reference with a size, not a buffer. `slice()` returns another reference over a byte range and reads nothing. Only an explicit `arrayBuffer()`, `text()`, or a stream read touches disk.

So the thing to watch for is `await blob.arrayBuffer()` on anything file-sized. That one call undoes the whole chain.

The same chain is what lets me read [zip archives](/files/zip-archives/) one entry at a time and [PDFs by byte range](/files/pdfjs-range-loading/).

## An object URL pins its blob until revoked

To show an image from a blob, you give an `<img>` a URL made with `URL.createObjectURL(blob)`. That URL keeps the blob alive for as long as the document lives, whether or not anything still shows it. In a reader that shows each page of a book as an image this way, forgotten URLs are a leak measured in hundreds of megabytes. So keep track of every URL you create, and revoke it when you replace it and when you dispose of whatever showed it. When several elements show the same blob, give each mount its own URL, as in [an encoded page belongs in an `<img>`](/images/bitmaps-and-canvas/).

## WebCrypto has no streaming digest, so a big file is sampled, not hashed

When someone adds a file, I want a fingerprint of it, so the app can check whether it has already imported that file. The obvious tool is a hash from WebCrypto, and that's where size becomes a problem.

`crypto.subtle.digest(algorithm, data)` takes *one* `BufferSource`. There's no `update`/`final` pair. The streaming digests that do exist are runtime extensions, not WebCrypto: Cloudflare Workers' non-standard `crypto.DigestStream`, and Deno's `@std/crypto`, whose `digest` also takes an async iterable. None of them is in a browser. So hashing a 500 MB upload in a browser means holding 500 MB in memory. `Blob.stream()` doesn't help, because something still has to join the chunks before the one call.

What I do instead: digest `size ‖ first 1 MiB ‖ last 1 MiB`, read with `blob.slice()`, so only the sampled ranges are ever in memory. The `slice` is lazy. A `Blob` slice is a view with an offset and a length, and the bytes only arrive when `arrayBuffer()` is awaited. (Typing the size header for `digest` has its own gotcha: [`Uint8Array` versus `BufferSource`](/typescript/type-checking-techniques/).)

This has a real cost, and it's the trade I'm choosing. Two files with the same length and the same bytes at both ends get the same fingerprint, whatever is in the middle. That's fine for "is this the file I already imported". It wouldn't be fine for "are these bytes identical".

## KOReader's first sample is at offset 0, because `bit.lshift` wraps

KOReader fingerprints a book the same sampled way. Its `partialMD5` reads twelve samples of the file, at most 1024 bytes each, and puts all of them through one MD5. If my app computes the same value, a book in the app matches the same book on a KOReader device, so the sample offsets have to match KOReader's exactly.

KOReader's loop seeks to `lshift(1024, 2*i)` for `i = -1 .. 10`. If you read that as plain arithmetic, `i = -1` gives 1024 · 4⁻¹ = 256. It doesn't. LuaJIT's `bit.lshift` is a 32-bit operation that masks the shift count to five bits. So -2 becomes 30, and `1024 << 30` is 2⁴⁰, which wraps to 0. The offsets are 0, 1024, 4096, … 1073741824. An implementation that computes `1024 * 4 ** i`, or uses a shift that turns a negative count into a right shift (Lua 5.3's native `<<`, or JavaScript's `BigInt` `<<`), starts at 256. Then it matches KOReader only on an empty file, where both hash nothing, and on the rare file of at least 1280 bytes whose bytes 256 to 1279 repeat bytes 0 to 1023, like a file that's one byte value all the way through. Every other file gets a different hash, including every non-empty file under 1280 bytes.

JavaScript's `<<` follows the same two rules: the count is taken mod 32, and the result is a 32-bit integer. So `1024 << -2 === 0`, and a LuaJIT-compatible left shift is just a bare `<<`. Every offset KOReader uses fits below 2³¹, so no result goes negative.

To sample a `Blob`: `blob.slice(offset, offset + 1024)` makes a view without reading, and `arrayBuffer()` reads only those bytes, including from an OPFS `File`. A slice that starts at or past `size` is empty, and an empty update leaves an MD5 unchanged. So "stop when a read returns nothing" and "skip the empty slices" give the same digest. The stop only changes how much gets read. KOReader's loop stops: in Lua, `file:read(n)` at the end of the file returns `nil`, and the loop's `break` runs on that.

To get expected values for tests, run KOReader's Lua loop itself under LuaJIT, not a re-implementation of it. A file of 300000 bytes and one of 1048576 bytes with the same pattern share a digest, since neither reaches offset 1048576.

The whole hash, with the offsets table and conformance values, is in [KOReader's partial MD5](/files/koreader-partial-md5/), and the MD5 under it in [MD5 step by step](/files/md5-step-by-step/).
