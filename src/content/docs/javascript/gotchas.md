---
title: "JavaScript Gotchas: Receivers, Sort Orders and Module Order"
description: "`queueMicrotask` passed bare, comparators that are not orders, `Intl.Collator` ties, polyfill ordering, field initializer order, and floats in URLs."
tags: [javascript]
sidebar:
  order: 1
---

## `queueMicrotask` passed as a value loses its receiver

Say an object needs to put off some work until the current task is done. Instead of scheduling it directly, it takes the scheduling function as a value and keeps it in a field, so it calls `this.defer(read)`. Tests can then pass it a fake scheduler, and the app passes the real one in the browser. The obvious real one is `queueMicrotask`, so the first version said `defer: Defer = queueMicrotask`.

That line compiles, type-checks and passes every unit test. Then it throws `TypeError: Illegal invocation` the first time the browser calls it.

The reason is that `queueMicrotask` is a `Window` method, and it checks its receiver (the object it's called on). Calling it with no receiver at all is fine: Web IDL substitutes the global object for an `undefined` or `null` `this`. The failure comes from where the bare function ends up. If it's stored in a field or an options object and called as `this.defer(read)` or `options.defer(read)`, its receiver is that object. That object isn't a `Window`, so the browser throws.

Wrapping it fixes that. Inside the wrapper the function is called by name with no receiver, so the receiver is `window` again:

```ts
const NEXT_MICROTASK: Defer = (read) => queueMicrotask(read);
```

The unit tests passed because they ran in Node, and Node's version does *not* check its receiver, so a Node unit test can't reproduce this failure at all. The same goes for `setTimeout`, `fetch`, `requestAnimationFrame` and the other `Window` methods: pass a wrapper, never the bare name.

## `Intl.Collator` sorts naturally but is not a total order

A book stored as a zip of images needs its pages in the order a person would read the file names. A collator with `{ numeric: true }` does that: it reads runs of digits as numbers, so it puts `page2` before `page10`.

The catch is that a collator can compare two different names as equal. With `sensitivity: 'base'` it treats `A.jpg` and `a.jpg` as equal, and numeric collation treats `page02` and `page2` as equal. A zip can hold both names of such a pair. When the comparator returns 0 for two names, nothing about the names determines which one comes first.

That matters when the order assigns indices to anything, such as a bookmark that stores a page number. In that case, add a codepoint tiebreak: when the collator returns 0, compare them by code point, so every pair of different names has one fixed order.

(Matching text loosely for search is a different job from sorting it: see [folding text for search](/text/search-folding/).)

## A comparator that returns 0 for one kind against everything is not an order

Say a list holds items of two kinds, such as saved places that are either a region on an image page or a position in an ebook's text. One comparator sorts the whole list with `toSorted`. My first version returned 0 whenever either side was the text kind, meaning "unordered".

`toSorted` needs a consistent comparator: if a < b and b ~ c (a comparison that returns 0), then a < c. Returning 0 whenever either side is of some kind breaks that as soon as a list mixes kinds. Take two regions A and B with A < B, and one text item T. T "equals" both: B ~ T, so the rule requires A < T, but the comparator returns A ~ T. Where A and B end up then depends on where T sits and on the engine's sort. It only looks safe as long as the real data is never mixed.

Instead, give every pair of kinds a fixed result (one kind before the other). Within each kind, rank its "no position" values last, and never pass them to the inner comparer, which only handles real positions.

Reading positions in an ebook are one case of this. A CFI doesn't sort as a string: see [foliate-js reading positions](/ebooks/foliate-positions/).

## A polyfill's own class body runs before the polyfill does

Safari is missing `Symbol.dispose` and `DisposableStack`, so I shipped a shim for them (see [explicit resource management](/javascript/explicit-resource-management/)). A client hooks file, which runs early when the app starts in the browser, imported the shim and then called it to install the missing symbol. The shim declared its disposer as a computed class member:

```ts
class StackShim {
  [Symbol.dispose]() { this.dispose(); }
}
```

A class body is evaluated when its *module* is evaluated, and ES modules evaluate their imports before the importing module's body. So when the hooks file imported the shim, the class was defined and its key computed first, and only after that did the hooks file run the code that installs `Symbol.dispose`. On Safari, where the symbol is missing, that key was `undefined`, so the method ended up under the string key `"undefined"`. The lowered `using` helper looked up `Symbol.for('Symbol.dispose')` and found no method. The fix reproduced the bug it was written to fix.

Application code gets away with this if every disposer is built *inside* a function (a factory that returns an object with `[Symbol.dispose]`). A function body only runs when it's called, so none of those disposers exists before the shim installs. A class body isn't inside a function.

So a polyfill should attach anything symbol-keyed at *install* time, not when it's defined:

```ts
function ensureDisposableStack(owner, dispose: symbol) {
  StackShim.prototype[dispose] ??= function () { this.dispose(); };
  owner.DisposableStack ??= StackShim;
}
```

No unit test can catch this. Node has both features natively, so the ordering problem never shows up there. Only a browser that lacks them shows it.

## A class field initializer runs before the constructor body

Some of my view models are split into parts: smaller objects the view model builds and holds, each handling one job. I built the parts in field initializers, `#panel = $state.raw(this.#buildPanel())`, and `#buildPanel` passed one of the view model's other fields, `this.#counting`, into the part. That field was assigned in the constructor from an argument.

The part got `undefined`. A class's field initializers run, in the order they're written, before the constructor body starts (in a subclass, right after `super()` returns). So when `#panel`'s initializer ran, the constructor hadn't assigned `#counting` yet. Because `#counting` was declared above `#panel`, it existed and held `undefined`. Had it been declared below, reading it would have thrown a `TypeError` ("Cannot read private member #counting from an object whose class did not declare it"). I checked both orders in Node 24.

The fix is to pass the part a closure that reads the field when it's called, not the field's value: `{ counts: () => this.#counting.counts() }`. The part calls it only after construction has finished, by which time the field is assigned.

## A float rectangle in a URL: round to a hundredth, match by distance

Say someone selects a rectangle on an image, and the app saves it in the image's own pixels. It gets there by scaling the selection on screen to the image's size, so the stored numbers are floats and rarely whole: `100.12345678…`. A link to that saved rectangle has to include it in the url and find the stored one again when it's opened.

To put it in the url as `region=x,y,w,h`, round each number to two decimals and drop trailing zeros (`String(Number(n.toFixed(2)))`). `URLSearchParams.set` escapes the commas to `%2C`, and both forms read back the same. The code that reads the parameter should accept exactly four non-negative decimals and nothing else (no sign, no exponent), and return `null` otherwise.

The rounded url can't equal the stored float, so an equality check would never find the saved rectangle. Match by distance instead: take the largest of the four absolute differences, with a tolerance of 0.01. That's twice the worst rounding error, so float noise in `toFixed` can't push a true match out. If several are within the tolerance, the nearest wins, then a stable order.

The stored side doesn't add error of its own. Structured clone (IndexedDB) and JSON both keep a double exactly, so a stored rect never drifts between devices.
