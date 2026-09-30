---
title: Fakes, Stubs and Async Ticks in Unit Tests
description: Hand-written container fakes, waiting for a call without counting microtasks, stubbing DOM constructors for `instanceof`, and an `EventTarget` fixture without a cast.
tags: [testing, vitest, typescript, architecture]
sidebar:
  order: 2
---

## Widening a composition-root type breaks every hand-written fake, and only the type check reports it

My app has a dependency container: one object, built at the composition root, that holds everything the UI calls into (see [dependency injection](/architecture/dependency-injection/) and [code splitting](/tooling/code-splitting/#a-dependency-container-is-where-a-static-import-leaks)). Its type is a structural type, so any object with the right members counts as one.

Several specs build a whole container by hand: `const container: Container = { ... }`, with every member spelled out. The members a spec doesn't use are stubbed as `() => Promise.reject(new Error('not used'))`. That means adding one member to the container type means changing every one of those specs. It's not a one-file change.

The trouble is that no error appears when you run the tests. The specs still *run*, because nothing at runtime reads a missing key. So the test command passes. It's the type check (svelte-check) that fails, with "is missing the following properties from type". In practice, I add a member, run a targeted `vitest --run`, see green, and then the full verify fails at its first step.

It's tempting to avoid the extra edits with a fake that spreads a partial object and casts it `as Container`. But then a spec could call a member nobody wired up and get `undefined` instead of a type error. The full stubs are on purpose, and editing the extra files is worth it.

## An async gate in front of a trigger makes its first tick async

A view model in my app has a trigger method that starts a pipeline: it adds a pending item and calls into the composition root. The tests' fakes record each call made into them. Right after calling the method, a test grabbed the first recorded call, `world.calls[0]`, synchronously and checked it. (The same kind of long-lived adapter behind that call shows up in [model workers](/machine-learning/worker-lifecycle/).)

Then I put an async permission or consent read in front of the trigger method. The method now awaits that read before doing anything else, which moved the whole pipeline one microtask later. On the tick where the method was called, the pending item and the call into the composition root didn't exist yet.

Every test that grabbed `world.calls[0]` synchronously broke. The fix is *not* to count `await Promise.resolve()` ticks until the call appears. The count is a guess, and it changes every time someone adds an `await` to the path. Instead, spin until the call shows up, with a limit:

```ts
async function started(world: Fakes, index: number): Promise<Call> {
  for (let tick = 0; tick < 50 && world.calls.length <= index; tick += 1) {
    await Promise.resolve();
  }
  return at(world.calls, index);
}
```

The test still controls when the call *settles*, and that's the part that matters. It just stops asserting on when the call was made.

## A unit spec reaches an `instanceof` DOM check by stubbing the constructor

Some code narrows a value with `instanceof`, for example checking whether it's an image or a canvas. Unit specs run in a Node test environment, and Node has no `HTMLImageElement`, `HTMLCanvasElement` or `HTMLElement`. So that code throws a `ReferenceError` there, and the spec can't reach the branch under test.

The fix is to give Node a stand-in constructor under the DOM's name. Put `vi.stubGlobal('HTMLImageElement', FakeImage)` in a `beforeEach` (with `vi.unstubAllGlobals()` after), and the check becomes real. A fixture built with `new FakeImage(…)` passes it, and a fixture of some other fake class fails it.

Copy the DOM's inheritance in the fakes (`FakeImage extends FakeHtmlElement`). Then an `instanceof HTMLElement` check passes for an image, just as it would in a browser. The same works for `OffscreenCanvas`.

## An `EventTarget` fixture without a cast

Some code takes an event's target and narrows it before using it, checking its fields with `in` and `typeof` (`'tagName' in target && target.tagName === 'INPUT'`) instead of `instanceof`. A spec for that code needs a target with the right fields, and in Node there's no DOM element to make one from.

`Object.assign(new EventTarget(), { tagName: 'INPUT', type: 'range' })` builds one. Node has `EventTarget`, and the result is typed `EventTarget & { tagName: string; type: string }`, so it passes wherever an `EventTarget` is expected without a cast, and the narrowing in the code under test runs for real.
