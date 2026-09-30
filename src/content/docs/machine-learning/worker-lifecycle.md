---
title: "Long-Lived Model Workers: Memoizing, Progress and Closing"
description: Fanning progress out to callers, stopping by terminating, memoizing an adapter that reopens itself, and closing only idle ones.
tags: [machine-learning, web-workers, architecture, transformers-js]
sidebar:
  order: 6
---

The setup for all of these: a model runs in a worker behind an adapter, an object the rest of the app calls instead of messaging the worker directly. The adapter starts the worker, which downloads and opens the model, and then passes requests to it. A composition root (the dependency container, see [dependency injection](/architecture/dependency-injection/) and [Keeping the Bundle Small](/tooling/code-splitting/)) builds that adapter once per model and memoizes it, because a second instance means a second worker and a second large download.

## A per-call callback cannot reach a memoized adapter through its constructor

While the model downloads, the screen that started the download shows a progress bar. An adapter factory like `createAdapter({ onProgress })` takes its listener when it's built. But the composition root builds it once per key on purpose, because a second instance means a second worker and a second 200 MB download. So the listener passed at build time belongs to whichever caller came first, and a screen that calls later has no way to get its own callback in.

The bridge is a registry in the composition root that the adapter's own callback fans out to, `Map<Key, Set<(fraction: number) => void>>`. The adapter reports each update once, and the registry passes it to every callback in the set for that key. The caller's callback gets added before the `await` and removed in a `finally`. The same pattern works for any long-lived adapter that reports progress to every caller. (In my case it was an OCR recognizer memoized per language.)

Register *before* awaiting the adapter. The download starts inside that await, so a listener added afterwards misses the first half of the progress bar.

If you put an async gate (reading a permission or consent) in front of the call, the call happens a microtask later. That breaks tests that assert it happens synchronously: see [Fakes, Stubs and Async Ticks](/testing/fakes-and-async/).

## transformers.js has no pause and no abort, so a stop is a worker terminate

A model load can take a while, and someone may want to stop it partway. transformers.js gives no way to do that from inside. `getFile` calls `env.fetch(url)` with no `AbortSignal`, `from_pretrained` doesn't accept one, and no loader has a point where it can be suspended. So stopping a load means terminating the worker.

The loss is smaller than it sounds. The library works a whole *file* at a time: `loadResourceFile` only calls `cache.put` after it has read a response body in full. Every completed file stays cached, and only the one in flight is lost.

**That's only a limit of the library.** If you own `env.fetch`, you can keep the file in flight: see the ranged resume in [Model Downloads](/machine-learning/model-downloads/). This is no reason to leave out a Pause button.

Terminating has one side effect to handle. A terminated worker's replies that were already queued can still arrive. So the state machine in front of the download has to ignore progress, and even an `opened`, that lands after a cancel. Otherwise someone presses stop, and the progress bar keeps climbing anyway.

## The adapter reopens itself, which is the only reason the composition root may memoize it

A composition root keeps `recognizers: Map<Language, Promise<Recognizer>>` so a second request can't start a second worker and a second download. Now say the worker gets terminated when someone leaves a screen. The memo outlives the worker it was built around. If the memoized adapter still pointed at the dead worker, the next request would hang forever. And a memo holding a dead adapter looks like recognition hanging, not like a lifecycle bug.

It's safe for exactly one reason, inside the adapter:

```ts
function prepare(): Promise<Opening> {
  starting ??= begin();
  return starting;
}
```

plus `forget()`, which every cancel path runs, and which sets both `worker` and `starting` back to `null`. So the next `prepare()` misses the `??=` and starts a fresh worker. **The adapter is reusable; the worker isn't.**

Nothing else in the adapter may hold on to `starting` past a `forget`. A refactor that moves the promise up a level or makes `begin()` run only once breaks the second use, with no type error. Cover it with a spec on the adapter ("opens a fresh worker after a canceled load") and one on the path a person actually takes ("opens the engine again after the previous screen closed it").

If the adapter keeps a replay cache of its session (for late subscribers), that has to be cleared on the same close. Otherwise a later subscriber receives a session describing a worker that doesn't exist anymore.

## Closing a worker-backed resource cancels it, so close only an idle one

Say the app switches from one cached recognizer to another (in my case, from one language to another), and closes the old one. And say closing a cached recognizer (or any service backed by a worker) terminates its worker and fails every pending request. Then closing it while a request is in flight fails that request. Someone who started a reading just before the switch gets an error instead of their text.

So never close one while requests are in flight. When switching, park the old one in a "retiring" set. Count the requests in flight, and close the parked ones from the request path's `finally` once the in-flight count reaches zero.

A global count (not one per key) is fine. A parked resource might also wait for a request on the new one, which delays the close but never cuts a request short.
