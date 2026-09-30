---
title: "MD5 Step by Step in TypeScript"
description: A streaming MD5 in about 100 lines of TypeScript, with every constant, bitwise operation and padding rule explained.
tags: [hashing, typescript, javascript, testing]
sidebar:
  order: 6
---

I needed a streaming MD5 for [KOReader's partial MD5](/files/koreader-partial-md5/), and Web Crypto doesn't have one. MD5 is specified in RFC 1321. It keeps a state of four 32-bit words and works through the message in 64-byte blocks. Each block scrambles the state, and the digest is the final state written out as 16 bytes.

This is my implementation, piece by piece, with what each bitwise operation actually does.

## Two facts about JavaScript numbers

Every bitwise trick below depends on these.

1. A JavaScript `number` is a 64-bit float. A bitwise operator first converts each operand to a 32-bit integer, then operates, then gives a 32-bit result.
2. The conversion is modular. `ToInt32(x)` drops any fraction, takes the result modulo 2³², and reads those 32 bits as a signed two's-complement value. `ToUint32(x)` takes the same 32 bits and reads them as unsigned.

Both readings are the same 32 bits. `0xefcdab89` is 4023233417 unsigned and -271733879 signed. The bits are identical, so a bitwise operator gives the same bits whichever form goes in.

| operator | operand conversion | result |
|---|---|---|
| `&` `\|` `^` `~` | ToInt32 | signed 32-bit |
| `a << n` | ToInt32(a), n → ToUint32(n) & 31 | signed 32-bit |
| `a >>> n` | ToUint32(a), n → ToUint32(n) & 31 | unsigned 32-bit |
| `x \| 0` | ToInt32 | signed 32-bit (x modulo 2³²) |
| `x >>> 0` | ToUint32 | unsigned 32-bit (x modulo 2³²) |
| store into `Uint32Array` | ToUint32 | unsigned 32-bit |

MD5 is defined on unsigned 32-bit words, with addition modulo 2³². The code lets values be signed or unsigned between steps, because only the 32 bits matter. A float holds every integer below 2⁵³ exactly, so a sum of a few 32-bit values is exact too, and the next bitwise operator or `Uint32Array` store reduces it modulo 2³².

## Constants

```ts
const BLOCK_BYTES = 64;
const LENGTH_BYTES = 8;
const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476] as const;
```

The RFC fixes the initial state. Written as little-endian bytes (lowest byte first), the four words are `01 23 45 67`, `89 ab cd ef`, `fe dc ba 98`, `76 54 32 10`.

```ts
const SINE_CONSTANTS: readonly number[] = Array.from(
  { length: 64 },
  (_, step) => Math.floor(Math.abs(Math.sin(step + 1)) * 2 ** 32) >>> 0,
);
```

The RFC defines the 64 additive constants `K[i]` as the integer part of `|sin(i + 1)| · 2³²`, with `i + 1` in radians.

- `Math.abs(Math.sin(...))` is at most 1, and for the whole numbers 1 to 64 it's always below 1, so the product stays below 2³².
- `Math.floor` drops the fraction.
- `>>> 0` makes it an unsigned 32-bit integer. The value is already in range, so this changes no constant. It just makes the type exact.

A float `sin` is precise enough for all 64 values. I checked: the float table matches the same formula computed with 60 digits in `bc`, and it matches the RFC's table (first four `d76aa478 e8c7b756 242070db c1bdceee`, last `eb86d391`). A wrong constant would break the RFC test suite anyway.

```ts
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const sineConstant = (step: number): number => SINE_CONSTANTS[step] ?? 0;
const shift = (step: number): number => SHIFTS[step] ?? 0;
```

Each of the 64 steps rotates by an amount from this table. Each round of 16 steps repeats its four amounts four times.

## The four round functions

```ts
interface RoundMix {
  mix: (b: number, c: number, d: number) => number;
  word: (step: number) => number;
}

const ROUNDS: readonly RoundMix[] = [
  { mix: (b, c, d) => (b & c) | (~b & d), word: (step) => step },
  { mix: (b, c, d) => (d & b) | (~d & c), word: (step) => (5 * step + 1) % 16 },
  { mix: (b, c, d) => b ^ c ^ d, word: (step) => (3 * step + 5) % 16 },
  { mix: (b, c, d) => c ^ (b | ~d), word: (step) => (7 * step) % 16 },
];
```

Each `mix` takes three 32-bit words and returns one. Each works on every bit position on its own: bit `k` of the result depends only on bit `k` of `b`, `c` and `d`. So each function is really an eight-row truth table.

### F, round 1: `(b & c) | (~b & d)`, "if b then c, else d"

- `~b` flips every bit of `b`.
- Where `b` has a 1, `b & c` keeps the bit of `c`, and `~b & d` gives 0.
- Where `b` has a 0, `b & c` gives 0, and `~b & d` keeps the bit of `d`.
- `|` joins the two halves. They never both have a 1 in the same position.

| b | c | d | F |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 1 |
| 0 | 1 | 0 | 0 |
| 0 | 1 | 1 | 1 |
| 1 | 0 | 0 | 0 |
| 1 | 0 | 1 | 0 |
| 1 | 1 | 0 | 1 |
| 1 | 1 | 1 | 1 |

### G, round 2: `(d & b) | (~d & c)`, "if d then b, else c"

Same selector as F, with `d` as the control word.

### H, round 3: `b ^ c ^ d`, parity

A result bit is 1 when an odd number of the three input bits are 1.

### I, round 4: `c ^ (b | ~d)`

- `~d` flips `d`.
- `b | ~d` is 1 unless `b` is 0 and `d` is 1.
- `c ^ (...)` flips `c` at every position where `b | ~d` is 1.

| b | c | d | b \| ~d | I |
|---|---|---|---|---|
| 0 | 0 | 0 | 1 | 1 |
| 0 | 0 | 1 | 0 | 0 |
| 0 | 1 | 0 | 1 | 0 |
| 0 | 1 | 1 | 0 | 1 |
| 1 | 0 | 0 | 1 | 1 |
| 1 | 0 | 1 | 1 | 1 |
| 1 | 1 | 0 | 1 | 0 |
| 1 | 1 | 1 | 1 | 0 |

`~` gives a negative number in JavaScript (`~0 === -1`). That's fine: `-1` is the 32 bits `1111...1111`, and the next `&`, `|` or `^` only uses those bits.

## The message word order

A block holds 16 words, `M[0]` to `M[15]`. Each round reads all 16 once, in its own order. `step` is the global step number, 0 to 63.

| round | word index | order |
|---|---|---|
| 1 | `step` | 0 1 2 … 15 |
| 2 | `(5·step + 1) % 16` | 1 6 11 0 5 10 15 4 9 14 3 8 13 2 7 12 |
| 3 | `(3·step + 5) % 16` | 5 8 11 14 1 4 7 10 13 0 3 6 9 12 15 2 |
| 4 | `(7·step) % 16` | 0 7 14 5 12 3 10 1 8 15 6 13 4 11 2 9 |

5, 3 and 7 share no factor with 16, so each formula hits every index exactly once in 16 steps. The formulas use the global step (16 to 63 for rounds 2 to 4), not the step inside the round. That still gives the RFC's orders, because the global step differs from the local one by a multiple of 16, and a multiple of 16 disappears under `% 16`.

## The rotation

```ts
function rotateLeft(value: number, count: number): number {
  return (value << count) | (value >>> (32 - count));
}
```

A rotation moves every bit `count` places to the left. Bits that fall off the top come back in at the bottom.

- `value << count` moves the bits up. The top `count` bits fall off, and the bottom `count` bits become 0.
- `value >>> (32 - count)` moves those same top `count` bits down to the bottom. Everything else falls off.
- `|` joins the two parts. They don't overlap.

With `count = 4` and `value = 0xf0000001`:

```text
value                 1111 0000 0000 0000 0000 0000 0000 0001
value << 4            0000 0000 0000 0000 0000 0000 0001 0000
value >>> 28          0000 0000 0000 0000 0000 0000 0000 1111
OR                    0000 0000 0000 0000 0000 0000 0001 1111   = 0x0000001f
```

The right shift has to be `>>>`, not `>>`. `>>` copies the sign bit into every new top bit. For `0xf0000001`, `value >> 28` gives `0xffffffff`, and the `|` then sets every bit of the result. `>>>` fills with 0.

Every count in `SHIFTS` is between 4 and 23, so `32 - count` is between 9 and 28. No shift amount is 0 or 32. The result is a signed 32-bit value with the right bits.

## One block: `compress`

```ts
function compress(state: Uint32Array, block: Uint8Array<ArrayBuffer>): void {
  const view = new DataView(block.buffer, block.byteOffset, BLOCK_BYTES);
  const words = Array.from({ length: 16 }, (_, index) => view.getUint32(index * 4, true));
  let [a = 0, b = 0, c = 0, d = 0] = state;

  for (const [round, { mix, word }] of ROUNDS.entries()) {
    for (let within = 0; within < 16; within += 1) {
      const step = round * 16 + within;
      const sum = (a + mix(b, c, d) + sineConstant(step) + (words[word(step)] ?? 0)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, shift(step))) | 0;
    }
  }

  state[0] = (state[0] ?? 0) + a;
  state[1] = (state[1] ?? 0) + b;
  state[2] = (state[2] ?? 0) + c;
  state[3] = (state[3] ?? 0) + d;
}
```

### Reading the words

MD5 is little-endian. `getUint32(index * 4, true)` reads bytes `4i` to `4i+3` with the first byte as the lowest. The bytes `61 62 63 80` give the word `0x80636261`. The `DataView` starts at `block.byteOffset`, so a `subarray` of a bigger buffer still reads the right 64 bytes.

### One step

Each of the 64 steps does this, with every addition modulo 2³²:

```text
sum = a + mix(b, c, d) + K[step] + M[word(step)]
a, b, c, d = d, b + rotl(sum, s[step]), b, c
```

The four assignments shift the words along by one: `d` goes to `a`, `c` goes to `d`, `b` goes to `c`, and the new value goes to `b`. The order in the code matters, because the new `b` uses the old `b`. `c = b` runs before `b` changes.

### The two `| 0`

The first `| 0` is addition modulo 2³², done once for all four operands. Each operand is below 2³² in magnitude, so the float sum stays under 2³⁴ and is exact. `| 0` takes it modulo 2³². The second `| 0` does the same for `b + rotateLeft(...)`.

They look like they're needed for a correct hash, but they aren't. I removed both and ran the whole test suite, and every digest still matched. Every place that consumes these values reduces modulo 2³² on its own: `mix` and `rotateLeft` are bitwise, and the final store is into a `Uint32Array`. The unreduced values only grow by at most 2³¹ per step, so they stay far below 2⁵³, where floats would start losing integers. I keep the `| 0` anyway so every variable is a plain 32-bit integer at every point, which is easier to reason about. I haven't measured whether it's faster.

### Adding the block into the state

The last four lines add the working words to the state. `state` is a `Uint32Array`, and storing into one applies `ToUint32`, which is modulo 2³². So there's no `| 0` or `>>> 0` there. `a` can be negative, and that's fine too: `0xffffffff + (-1)` is 4294967294, which is `0xfffffffe`, the same as the unsigned sum `0xffffffff + 0xffffffff` modulo 2³².

The `?? 0` fallbacks only exist for the compiler. With `noUncheckedIndexedAccess`, reading an array index has the type `number | undefined`. The indices are always in range, so the fallbacks never run.

## Streaming input: `update`

```ts
export class Md5 {
  #state = Uint32Array.from(INITIAL_STATE);
  #pending = new Uint8Array(BLOCK_BYTES);
  #pendingLength = 0;
  #byteCount = 0;

  update(bytes: Uint8Array): void {
    this.#byteCount += bytes.byteLength;
    let read = 0;
    while (read < bytes.byteLength) {
      const taken = Math.min(BLOCK_BYTES - this.#pendingLength, bytes.byteLength - read);
      this.#pending.set(bytes.subarray(read, read + taken), this.#pendingLength);
      this.#pendingLength += taken;
      read += taken;
      if (this.#pendingLength === BLOCK_BYTES) {
        compress(this.#state, this.#pending);
        this.#pendingLength = 0;
      }
    }
  }

  // digest() and hexDigest() below
}
```

`#pending` holds a partial block of 0 to 63 bytes between calls. Each pass of the loop copies as many bytes as fit into the block. When the block is full, it gets compressed and a new one starts.

Where the calls split the input has no effect on the result. 1024-byte samples, a million bytes in uneven pieces, and a message fed one byte at a time all give the digest of the joined bytes. The tests pin all three.

`#byteCount` is the total message length. A `number` counts bytes exactly up to 2⁵³, far more than any file.

## Padding and the length: `digest`

```ts
digest(): Uint8Array<ArrayBuffer> {
  const state = Uint32Array.from(this.#state);
  const paddedLength =
    this.#pendingLength < BLOCK_BYTES - LENGTH_BYTES ? BLOCK_BYTES : BLOCK_BYTES * 2;
  const tail = new Uint8Array(paddedLength);
  tail.set(this.#pending.subarray(0, this.#pendingLength));
  tail[this.#pendingLength] = 0x80;
  const bitCount = BigInt(this.#byteCount) * 8n;
  new DataView(tail.buffer).setBigUint64(paddedLength - LENGTH_BYTES, bitCount, true);
  for (let offset = 0; offset < paddedLength; offset += BLOCK_BYTES) {
    compress(state, tail.subarray(offset, offset + BLOCK_BYTES));
  }
  // write out state, see "Output" below
}
```

The RFC pads the message so its length is a multiple of 64 bytes:

1. Append one `1` bit. Since the input is whole bytes, that's the byte `0x80`, which is `1000 0000`.
2. Append `0` bits until the length is 56 modulo 64. `new Uint8Array` is already all zeros, so the code writes nothing for this step.
3. Append the message length in bits as a 64-bit little-endian integer, in the last 8 bytes.

### One block or two

The pending bytes, the `0x80` byte and the 8 length bytes all have to fit in the tail.

| pending bytes | pending + 1 + 8 | tail |
|---|---|---|
| 0 to 55 | 9 to 64 | one block (64 bytes) |
| 56 to 63 | 65 to 72 | two blocks (128 bytes) |

`pendingLength < 56` picks one block. With 55 pending bytes, `0x80` lands on byte 55 and the length fills bytes 56 to 63, with no zero bytes in between. With 56 pending bytes, `0x80` lands on byte 56, and the length no longer fits in the same block. The tests pin messages of 55, 56, 63, 64 and 65 bytes, the lengths around where this rule flips.

### The bit length

`BigInt(byteCount) * 8n` multiplies by 8 as a `bigint`. `setBigUint64` needs a `bigint`, and the product is exact at any size. `setBigUint64` stores the value modulo 2⁶⁴, which is what the RFC says to do with longer messages. The `true` argument writes the low byte first. `abc` is 24 bits long, so its last 8 bytes are `18 00 00 00 00 00 00 00`.

`tail` is a fresh buffer, so `tail.buffer` starts at the tail's first byte, and the `DataView` offset `paddedLength - 8` is right.

### `digest` leaves the hash object alone

It copies `#state` into a new `Uint32Array` and builds the padding in a new `tail`. `#pending`, `#pendingLength` and `#byteCount` stay as they were. So you can read a digest, call `update` again, and the next digest covers all the bytes. A test pins this.

## Output

The end of `digest`:

```ts
const digest = new Uint8Array(16);
const view = new DataView(digest.buffer);
for (const [index, word] of state.entries()) view.setUint32(index * 4, word, true);
return digest;
```

The digest is the four state words, each written little-endian: the low byte of the first word is the first byte of the digest. For the empty message the first word is `0xd98c1dd4`, which gives the bytes `d4 1d 8c d9`, and the hex starts `d41d8cd9`.

```ts
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// in Md5
hexDigest(): string {
  return hex(this.digest());
}
```

`toString(16)` gives lowercase hex. `padStart(2, '0')` keeps the leading zero of a byte below `0x10`, so every byte is two characters and the result is always 32.

## Tests

The RFC 1321 test suite, all seven messages:

| message | MD5 |
|---|---|
| `""` | `d41d8cd98f00b204e9800998ecf8427e` |
| `"a"` | `0cc175b9c0f1b6a831c399e269772661` |
| `"abc"` | `900150983cd24fb0d6963f7d28e17f72` |
| `"message digest"` | `f96b697d7cb7938d525a2f31aaf161d0` |
| `"abcdefghijklmnopqrstuvwxyz"` | `c3fcd3d76192e4007dfb496cca67e13b` |
| `"A...Za...z0...9"` (62 characters) | `d174ab98d277d9f5a5611c2c9f419d9f` |
| `"1234567890"` eight times (80 characters) | `57edf4a22be3c955ac49da2e2107b67a` |

The padding edges, `'x'` repeated n times, with values from Python's `hashlib`:

| n | MD5 |
|---|---|
| 55 | `04364420e25c512fd958a70738aa8f72` |
| 56 | `668a72d5ba17f08e62dabcafad6db14b` |
| 63 | `7dc2ca208106a2f703567bdff99d8981` |
| 64 | `c1bb4f81d892b2d57947682aeb252456` |
| 65 | `1bc932052302d074bdec39795fe00cf6` |

And the behavior tests:

- A million bytes fed in uneven pieces, and a message fed one byte at a time, each equal to the digest of the joined bytes.
- Reading a digest in the middle doesn't change the digest at the end.

I ran all of these against Node's `crypto.createHash('md5')` too, and it returns the same digest for every one.
