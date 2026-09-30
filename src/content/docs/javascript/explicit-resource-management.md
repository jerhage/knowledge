---
title: using, await using and DisposableStack
description: How `using` ties cleanup to a scope, the order disposers run in, what DisposableStack adds, and what a compiler can and cannot lower.
tags: [javascript, typescript]
sidebar:
  order: 2
---

`using` declares a variable whose value gets cleaned up when the scope ends, however it ends: normal exit, `return`, `break` or a throw. It saves writing a `try`/`finally` for every resource. I use it a lot for anything that holds memory outside the JS heap, mainly `ImageBitmap`s: see [transferring bitmaps](/images/transferring-bitmaps/) and the ownership table in the [browser OCR pipeline](/machine-learning/browser-ocr-pipeline/).

## The protocol: `Symbol.dispose` and `Symbol.asyncDispose`

A value is disposable if it has a `[Symbol.dispose]()` method. `using` calls it when the variable goes out of scope:

```ts
function ownedBitmap(bitmap: ImageBitmap) {
  let live = true;
  return {
    bitmap,
    [Symbol.dispose]() {
      if (live) { live = false; bitmap.close(); }
    },
  };
}

{
  using page = ownedBitmap(await createImageBitmap(blob));
  draw(page.bitmap);
} // page.bitmap.close() runs here
```

Details from MDN:

- Like `const`, the variable has to be initialized and can't be reassigned. It also can't be a destructuring pattern.
- The value can be `null` or `undefined`, so an optional resource doesn't need an `if`. Any other value without a `[Symbol.dispose]` function throws a `TypeError` right at the declaration, not at the end of the scope.
- The disposer is looked up when the variable is declared, not when it's disposed.
- It works in blocks, function bodies, class static blocks, module top level and `for`, `for...of` and `for await...of` initializers. In `for...of`, each iteration's value is disposed at the end of that iteration. In a plain `for (using x = …; …; …)`, the value is created once and disposed once, when the loop ends (I checked this in Node 24). It doesn't work at the top level of a classic script, directly in a `switch`, or in `for...in`.

`await using` is the async version. It looks up `[Symbol.asyncDispose]` first and falls back to `[Symbol.dispose]`. The `await` happens when the scope exits, not at the declaration. At least one `await` happens on exit, even if the value was `null`. And when it falls back to `[Symbol.dispose]`, it doesn't await a promise that method returns.

## Disposal order and errors

All the disposers in a scope run in reverse declaration order, with `using` and `await using` mixed together. Something declared later might depend on something declared earlier, so the later one goes first.

Every disposer runs, even if one throws. The errors get chained into a `SuppressedError`: the later error goes in `.error`, the earlier one in `.suppressed`. Say `resource1` and then `resource2` are declared, both disposers throw, and the block itself throws first:

```text
SuppressedError
  error: Error: can't dispose resource1
  suppressed: SuppressedError
    error: Error: can't dispose resource2
    suppressed: Error: body threw
```

`resource2` gets disposed first, so its error wraps the body's error, and `resource1`'s error wraps that. I checked this in Node 24. MDN's `using` page prints the two disposer errors the other way round, which doesn't match the spec's reverse order.

So a `catch` around the block gets a `SuppressedError`, not my original error. The original is at the bottom of the `.suppressed` chain.

## Tied to a scope, so it can leak a disposed value

`using` ties the resource to the variable's scope, not to the value. A closure, a returned object or an export can keep the value around after it's been disposed:

```ts
function make() {
  using res = open();
  return () => res.read(); // res is already disposed when this runs
}
```

It's also why [a disposable wrapper needs a way to disarm](/images/transferring-bitmaps/) when ownership moves somewhere else, for example when it's transferred to a worker. Without that, the scope closes a bitmap that someone else owns now.

## `DisposableStack`

Say a function crops several regions out of a page bitmap, and each crop is a new bitmap that has to be closed. The number of crops isn't known until the loop runs, and the loop may stop early. `using` binds one name to one lifetime, so it can't own a list you build in a loop. A `DisposableStack` can. It's one disposable that holds many: each crop is registered on it as it's made, and when the stack's scope ends, it disposes all of them.

```ts
using held = new DisposableStack();
for (const region of regions) {
  const crop = held.use(cropBitmap(page, region));
  if (!crop) return; // everything registered so far is still disposed
  crops.push(crop);
}
```

The methods:

| Method | What it registers | Returns |
| --- | --- | --- |
| `use(value)` | a value with `[Symbol.dispose]` (or `null`/`undefined`) | `value` |
| `adopt(value, onDispose)` | a value without the protocol, plus a function called with it | `value` |
| `defer(onDispose)` | a callback with no resource attached | `undefined` |
| `move()` | nothing; moves all disposers to a new stack and marks this one disposed without running them | the new stack |
| `dispose()` | disposes now, in reverse registration order (also `[Symbol.dispose]`) | `undefined` |

`disposed` reports whether it's been disposed. Registering on a disposed stack throws a `ReferenceError`.

For `use` and `adopt`, MDN's advice is to wrap the expression that acquires the resource directly, `held.use(acquire())`. That way no code can run between creating the resource and registering it.

Sometimes a function opens resources for its caller to keep. If it fails halfway, it should close what it already opened. If it succeeds, it must not close anything, because the caller owns the resources now. `move()` handles both cases:

```ts
function init() {
  using stack = new DisposableStack();
  const a = stack.use(openA());
  const b = stack.use(openB()); // if this throws, a is disposed
  return { a, b, stack: stack.move() }; // success: the caller owns them now
}
```

If the second open throws, the function's scope ends with the first resource still on the stack, so it's disposed. If the function gets as far as `move()`, both resources move to a new stack that goes back to the caller, and the old stack has nothing left to dispose. Make `move()` the last thing before the return, because nothing owns the resources in between. `AsyncDisposableStack` works the same way, with `disposeAsync()` and `[Symbol.asyncDispose]`.

## Syntax gets lowered, globals do not

A browser without explicit resource management can still run code that uses it, as long as the build fills the gaps. `using` is syntax, so TypeScript (since 5.2) and esbuild can rewrite it into `try`/`finally` with helper functions. But `Symbol.dispose`, `DisposableStack`, `AsyncDisposableStack` and `SuppressedError` are runtime globals, and no compiler adds those.

- The TypeScript 5.2 notes say to set `target` to `es2022` or lower and add `esnext.disposable` (or `esnext`) to `lib`. Then the types compile whether the browser has the globals or not.
- Both TypeScript's `tslib` helpers and esbuild's lowered `using` fall back to a home-made error object when `SuppressedError` is missing.
- esbuild's helper looks up `Symbol.dispose`, and when it's missing, uses `Symbol.for('Symbol.dispose')`. A polyfill has to install the same symbol the helper looks up.
- For `using` alone, the TypeScript notes say polyfilling the two symbols is usually enough: `Symbol.dispose ??= Symbol("Symbol.dispose")`. `DisposableStack` needs a real polyfill.

A polyfill for this has its own ordering gotcha: a class body with a computed `[Symbol.dispose]` key runs before the polyfill installs the symbol. See [JavaScript gotchas](/javascript/gotchas/).

## Browser support

MDN lists `using`, `await using`, `DisposableStack`, `AsyncDisposableStack` and `SuppressedError` in Chrome 134 and Firefox 141. For Safari, MDN only lists Safari Technology Preview; WebKit's release notes put the whole proposal in Technology Preview 250. `Symbol.dispose` came earlier in Chrome (125), and `Symbol.asyncDispose` in 127.

So without a polyfill, Safari has none of it. Node has it natively from 24, so a unit test that runs in Node won't catch a missing polyfill.

The proposal reached stage 4 at TC39 and is listed for ES2027.

## References

- [MDN: `using`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using)
- [MDN: `await using`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/await_using)
- [MDN: `DisposableStack`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DisposableStack)
- [MDN: `DisposableStack.prototype.move()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DisposableStack/move)
- [MDN: `SuppressedError`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SuppressedError)
- [TC39 proposal: Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
- [TC39 finished proposals](https://github.com/tc39/proposals/blob/main/finished-proposals.md)
- [TypeScript 5.2 release notes: `using` declarations](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html)
- [WebKit: Safari Technology Preview 250 release notes](https://webkit.org/blog/18191/release-notes-for-safari-technology-preview-250/)
