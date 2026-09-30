---
title: "TypeScript: Brands, Strict Flags and Typed Arrays"
description: Invariant phantom brands, what strict index and optional flags catch, exhaustive matches, and `Uint8Array<ArrayBuffer>`.
tags: [typescript]
sidebar:
  order: 1
---

## A phantom brand must be invariant, or it has a hole

Dokseo, my manga and book reader, works with rectangles in more than one coordinate space. Some are measured in an image's own pixels and some on the screen, and at runtime both are the same plain object with four numbers. Passing a screen rect where an image rect belongs gives a wrong answer and no error.

A phantom brand is a tag that exists only in the types, so the compiler can distinguish values that look the same at runtime. Here the tag is the rect's space. The obvious way to write one is covariant, meaning a rect branded with a narrower space type also counts as one branded with a wider type:

```ts
type Rect<S> = { …; readonly [space]: S };
```

Now take a function that clamps one rect to another and requires both in the same space. When it's called with an image rect and a screen rect, the compiler looks for one space type that fits both arguments, and with a covariant brand the union fits. So `clampTo(imageRect(...), screenRect(...))` infers `S = 'image' | 'screen'` and compiles. The exact mix-up the brand is there to stop gets through, and nothing reports an error.

Making the parameter invariant closes the hole. Then a narrower or wider space type doesn't count, in either direction:

```ts
type Rect<in out S extends string> = { …; readonly [space]: (s: S) => S };
```

It's still purely type-level, so it still costs nothing at runtime. Prove it works with a probe that has to fail to compile.

## `noUncheckedIndexedAccess` finds guards the compiler cannot check

With this flag on, reading an array element by index gives a type that includes `undefined`, so the code has to handle a missing element before using it.

Say you read `images[index]` after checking the range against a separate `count`. That's only safe as long as the two agree, and no checker can verify that. If they ever drift apart, the read returns `undefined` and the code continues as if it had an image. The flag makes you put the guard on the value you actually use, so the access is safe for every index.

## An `as const` array makes a modulo index safe without a cast

Say code picks an entry from a fixed array of strings with an index `i` that is `n % LINES.length`. `noUncheckedIndexedAccess` types `LINES[i]` as `string | undefined`, even though `i` can't be out of range. `at()` has the same problem, and a cast just hides it.

Declare the array `as const` and it becomes a readonly tuple. Then `LINES[0]` is a known literal, and `LINES[i] ?? LINES[0]` type checks with no cast and no throw. The fallback never runs. That's the price of an expression that always produces a value.

## `exactOptionalPropertyTypes` makes absence mean something

A partial update is an object that holds only the fields to change. Without this flag, an optional field like the one in `{ title?: string }` also accepts an explicit `undefined`, so the type checker treats a missing key and a key set to undefined the same. With the flag, `{ title?: string }` stops accepting an explicit `undefined`, and the two become different things. That's what lets a partial update express "leave this alone" precisely: a missing key means leave it alone.

## `exactOptionalPropertyTypes` makes a new field on a stored record `?: T | null`

When you add a field to a record type, it has to be optional, because rows written by the older version don't have it. The obvious code for a new row is `{ modelId: footprint?.modelId }`, which is `string | undefined`. `exactOptionalPropertyTypes: true` makes assigning `undefined` to `?: string` a type error.

Declare the field `?: string | null` and write `?? null`. Now a missing field means an old row, and `null` means a new row with nothing to put there. You can still tell the two apart in the database.

The load normalizer then collapses both to `null` (or to a default), so only one function ever handles the optional field. Checking stored values on load in general is in [IndexedDB](/storage/indexeddb/).

## Exhaustiveness without a library

Say a function handles each variant of a union with a `switch`, and every branch returns. When someone adds a variant to the union, the function should stop compiling until it handles the new one. Under `noImplicitReturns`, a `switch` with no `default` where every branch returns does exactly that: it fails to compile when you add a new variant, because the new variant falls out of the switch without a return. ts-pattern's `match().exhaustive()` gives the same guarantee, and it names the missing variant. The switch's error only points at the function signature. (In a Svelte component, I put a `match()` in a `$derived`, not in markup: see [Svelte 5 state](/svelte/state-and-props/#a-match-goes-in-a-derived-not-in-markup).) Which unions deserve this check, and how to keep a set of variants closed, is on [closed unions](/typescript/closed-unions/).

## ts-pattern infers a match's output from its handlers, so a string literal widens

Say a function returns an object whose `tone` is a union of string literals, and it builds that object with a ts-pattern match. `match(value).with(..., () => ({ tone: 'pending' }))` doesn't use the return type of the function around it. Each handler's result gets inferred on its own, and a string property in an object literal widens to `string`. So the result won't assign to a type whose `tone` is a union of literals: `Type 'string' is not assignable to type 'Status'`. It's tempting to write `'pending' as Status` in every handler.

The real fix is to name the output: `match<Input, Output>(value)`. Then the handlers are checked against `Output`, the literals stay literals, and a missing or misspelled field fails in the handler that has it. Putting `as const` on the one field also compiles, but you lose the per-handler check against the output type.

## `Uint8Array` does not fit `BufferSource` since TypeScript 5.9

TypeScript 5.7 made the typed arrays generic in their buffer, so a bare `Uint8Array` is `Uint8Array<ArrayBufferLike>`. Since the `lib.d.ts` changes in 5.9, `BufferSource` and `BlobPart` require `ArrayBufferView<ArrayBuffer>` (on 5.7 and 5.8 the same code still type-checked). And `ArrayBufferLike` includes `SharedArrayBuffer`. The error is purely at the type level, and you get it whether or not the app is cross-origin isolated. The stricter types are correct, though. An app that sets COOP and COEP headers (so `SharedArrayBuffer` exists for WASM threads) really can have a shared buffer.

So a helper written like this

```ts
function sizeHeader(size: number): Uint8Array { ... }
```

fails at every call site with `SharedArrayBuffer is missing the following properties from type ArrayBuffer`. That happens even though the value is `new Uint8Array(8)` and its buffer is obviously not shared. It only shows up in the type checker. The code runs fine.

**The fix is the annotation, not a cast.** Write the return type as `Uint8Array<ArrayBuffer>`, and the type matches what the construction always was. `as ArrayBuffer` and `as BlobPart` both make the error go away, but both hide a claim that nothing checks.

Same for a function's parameter. If you need to pass it on to `digest` or a `Blob`, ask for `Uint8Array<ArrayBuffer>`, instead of accepting the wide type and asserting it back. (Hashing a large file with `digest` is in [large files](/files/large-files/).)
