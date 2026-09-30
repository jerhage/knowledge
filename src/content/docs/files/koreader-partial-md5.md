---
title: "KOReader's Partial MD5: How the Book Hash Works"
description: How KOReader fingerprints a book from twelve small samples, and how to compute the same value from a Blob in TypeScript.
tags: [files, hashing, javascript, typescript, testing]
sidebar:
  order: 5
---

KOReader identifies a book by a partial MD5. It reads twelve samples of the file, at most 1024 bytes each, and puts all of them through one MD5. It never reads the whole file, so even a 1 GiB file costs at most 12 KiB of reads.

If I compute the same value in a browser app, a book there matches the same book on a KOReader device. My version is two small TypeScript modules: a streaming MD5 class, which I walk through in [MD5 step by step](/files/md5-step-by-step/), and the sampler on top of it.

## The loop in KOReader

This is `util.partialMD5` in `frontend/util.lua`, trimmed to the loop. `lshift` is LuaJIT's `bit.lshift`, and `md5()` comes from `ffi/sha2` in koreader-base.

```lua
local step, size = 1024, 1024
local update = md5()
for i = -1, 10 do
  file:seek("set", lshift(step, 2*i))
  local sample = file:read(size)
  if sample then update(sample) else break end
end
return update()
```

`update(sample)` feeds bytes in, and `update()` with no argument returns the digest as 32 lowercase hex characters.

Where the value goes: KOReader saves it in the book's settings as `partial_md5_checksum`, and the sync plugin (kosync) sends it as the `document` key when it pushes or pulls reading progress. The koreader-sync-server README describes the same thing from the server side: progress is stored per user under a 32-digit MD5 that identifies the document. I checked all of this against KOReader's current `master` (`frontend/util.lua`, `frontend/apps/reader/readerui.lua`, `plugins/kosync.koplugin/main.lua`).

## The twelve offsets

```ts
const PARTIAL_MD5_STEP = 1024;
const PARTIAL_MD5_SAMPLE_BYTES = 1024;
const FIRST_EXPONENT = -1;
const LAST_EXPONENT = 10;

function luajitLeftShift(value: number, count: number): number {
  return value << count;
}

function partialMd5Offsets(): readonly number[] {
  return Array.from({ length: LAST_EXPONENT - FIRST_EXPONENT + 1 }, (_, position) =>
    luajitLeftShift(PARTIAL_MD5_STEP, 2 * (FIRST_EXPONENT + position)),
  );
}

const PARTIAL_MD5_OFFSETS = partialMd5Offsets();
```

KOReader seeks to `lshift(1024, 2*i)` for `i = -1` to `10`, which gives twelve offsets.

### The first offset is 0, not 256

I wrote up why in [large files](/files/large-files/#koreaders-first-sample-is-at-offset-0-because-bitlshift-wraps). Short version: `bit.lshift` only uses the low five bits of the shift count and keeps only the low 32 bits of the result. The count -2 in two's complement (the usual way to store negative integers, where -2 is all ones except the last bit) is `...11111110`. Its low five bits are `11110`, which is 30. So `lshift(1024, -2)` is `1024 << 30`, which would be 2⁴⁰, and bit 40 doesn't survive:

```text
1024        = 0000 0000 0000 0000 0000 0100 0000 0000   (bit 10 set)
1024 << 30  → bit 40 set → outside bits 0..31 → 0000 ... 0000 = 0
```

JavaScript's `<<` follows the same two rules, so `1024 << -2 === 0` and `luajitLeftShift` is a bare `<<`. I still give it a name. That way a test can pin the behavior, and nobody "fixes" it into `1024 * 4 ** i`.

Both rules are in the [LuaJIT BitOp docs](https://bitop.luajit.org/api.html) ("Only the lower 5 bits of the shift count are used"; `bit.lshift(1, 40)` is 256). I also ran the loop under LuaJIT and printed the offsets.

### The other offsets

| i | shift | offset | hex |
|---|---|---|---|
| -1 | 30 (from -2) | 0 | `0x00000000` |
| 0 | 0 | 1024 | `0x00000400` |
| 1 | 2 | 4096 | `0x00001000` |
| 2 | 4 | 16384 | `0x00004000` |
| 3 | 6 | 65536 | `0x00010000` |
| 4 | 8 | 262144 | `0x00040000` |
| 5 | 10 | 1048576 (1 MiB) | `0x00100000` |
| 6 | 12 | 4194304 | `0x00400000` |
| 7 | 14 | 16777216 | `0x01000000` |
| 8 | 16 | 67108864 | `0x04000000` |
| 9 | 18 | 268435456 | `0x10000000` |
| 10 | 20 | 1073741824 (1 GiB) | `0x40000000` |

The last offset is 2³⁰, bit 30. Bit 31 is the sign bit of a signed 32-bit result, so 2³⁰ is the largest power of two that stays positive, and no offset is negative. One more step (`i = 11`, shift 22) would give 2³², which wraps to 0 again.

Each offset is four times the one before it, except the first. The samples at 0 and 1024 touch, so a file of 2048 bytes or fewer gets hashed in full.

## Reading the samples from a Blob

```ts
async function partialMd5(blob: Blob): Promise<string> {
  const md5 = new Md5();
  for (const offset of PARTIAL_MD5_OFFSETS) {
    if (offset >= blob.size) break;
    const sample = await blob.slice(offset, offset + PARTIAL_MD5_SAMPLE_BYTES).arrayBuffer();
    md5.update(new Uint8Array(sample));
  }
  return md5.hexDigest();
}
```

- `blob.slice(start, end)` makes a view and reads nothing. `arrayBuffer()` then reads only those bytes, from memory or from an OPFS `File`. That's the lazy chain from [large files](/files/large-files/).
- A slice that runs past the end gets cut at `size`, so the last sample can be shorter than 1024 bytes. Lua's `file:read(1024)` does the same near the end of a file.
- `offset >= blob.size` is the `break`. In Lua, a read at or past the end returns `nil`, and the loop stops. The offsets only go up, so no later sample could start inside the file anyway.
- All samples go into one MD5, in order. The hash is not twelve MD5 values joined together.
- The result is lowercase hex, same as KOReader's.

The hash doesn't include the file size. Bytes between samples don't change it, and neither do bytes after the last sample in the file. A file of 300000 bytes and a file of 1048576 bytes that have the same content for the first 263168 bytes get the same hash. That's KOReader's design, and the conformance table below shows it happening.

## Why not Web Crypto

`crypto.subtle.digest` supports SHA-1, SHA-256, SHA-384 and SHA-512, and no MD5. It also has no streaming form for any algorithm: it takes the whole input in one call (more on that in [large files](/files/large-files/#webcrypto-has-no-streaming-digest-so-a-big-file-is-sampled-not-hashed)). The partial MD5 needs MD5, and it's nicer to feed samples one at a time. So I wrote my own. It's about 100 lines, pure, with no dependencies. It has no book-specific code, so it lives in a low-level platform module, not inside a feature.

MD5 is broken against someone crafting collisions on purpose. Here it only identifies a book so it can be matched with KOReader, so that doesn't matter.

## Tests

What the partial-MD5 tests pin:

- `luajitLeftShift(1024, -2)` is 0, and a shift that fits stays unchanged.
- The twelve offsets, starting at 0.
- Only samples that start inside the blob get read, each at most 1024 bytes.
- An offset exactly at the end of the blob stops the loop.
- A byte between two samples doesn't change the hash. A byte inside a sample does.
- The result is 32 lowercase hex characters.
- The conformance table below.

The expected values come from KOReader's own Lua loop run under LuaJIT, with the samples hashed by Python's `hashlib`. They don't come from a second implementation written next to the first one, which could share its mistakes. Each test file has byte `i` equal to `(31·i + 7) mod 251`.

| size | partial MD5 | bytes sampled |
|---|---|---|
| 0 | `d41d8cd98f00b204e9800998ecf8427e` | 0 |
| 1 | `89e74e640b8c46257a29de0616794d5d` | 1 |
| 1023 | `184b34b08bbb6b06f914e59a579c2a7b` | 1023 |
| 1024 | `5121b74d11d0ad611a246b4137993844` | 1024 |
| 1025 | `35b02546e34868e7b75dab8c43d47c36` | 1025 |
| 5000 | `e9b23960f33568cd50442e8f305853c3` | 2952 |
| 70000 | `724b94d04f9ceeab34ab28718b86062d` | 5120 |
| 300000 | `3d87fe2dd28ddc7895ae5e290bfa539e` | 6144 |
| 1048576 | `3d87fe2dd28ddc7895ae5e290bfa539e` | 6144 |
| 1048577 | `786211a95054ac0cec32c0535d32846b` | 6145 |
| 1500000 | `951d6ad62a386c5d5e49f4c898e5c6c2` | 7168 |

How to read three of the rows:

- 0 bytes. No sample starts inside the file, so the hash is the MD5 of nothing, `d41d8cd9…`.
- 5000 bytes. The samples are `[0, 1024)`, `[1024, 2048)` and `[4096, 5000)`, so 1024 + 1024 + 904 = 2952 bytes. The offset 16384 is past the end.
- 300000 and 1048576 bytes. Both read the six samples at offsets 0 through 262144, 1024 bytes each. Neither file has a byte at offset 1048576. The pattern is the same, so the hash is the same. At 1048577 bytes the seventh sample reads one byte, and the hash changes.

## Where the hash fits

- Store the file name next to the hash. kosync has a second matching mode, "Filename", which keys a book by `md5(file_name)`: the MD5 of the name string (without the folder), not of the file's bytes. The same streaming MD5 class computes that too, so one implementation covers both modes. An app can offer both as a setting, with content matching ("Binary" in KOReader's menu) as the default, which is also KOReader's default.
- A partial MD5 is always 32 hex characters. If an app used to identify books some other way, the length distinguishes the two. For example, the SHA-256 over the size, the first 1 MiB and the last 1 MiB from [large files](/files/large-files/#webcrypto-has-no-streaming-digest-so-a-big-file-is-sampled-not-hashed) is 64 hex characters. Keep the old fingerprint only to find an old record when a book gets imported again, then give that record the partial MD5.
