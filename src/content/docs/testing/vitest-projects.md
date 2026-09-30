---
title: Testing a Svelte App with Vitest Projects
description: "Unit vs browser projects by filename, `$derived` under the server compile, Deno's persistent localStorage, server rendering in Node, mocking context, compile time inside timeouts, and runs under load."
tags: [testing, vitest, svelte, svelte-5, sveltekit]
sidebar:
  order: 1
---

## A rune-holding view model is tested from a plain `.spec.ts`, never a `.svelte.spec.ts`

In my app, view models that hold runes like `$state` live in `.svelte.ts` files. The question is which kind of spec should test them.

A common Vitest setup has two projects, split by *filename*, not by what the file imports. `unit` includes `src/**/*.spec.ts` and excludes `src/**/*.svelte.spec.ts`. `browser` includes exactly the excluded set and runs it under Playwright and Chromium. So naming a spec `thing.svelte.spec.ts` doesn't "test a `.svelte.ts` file". It moves that spec into the browser project.

That move isn't needed, because runes don't need a browser. The Svelte plugin compiles `*.svelte.ts` for the unit project too. `$state`, `$state.raw` and `$derived` all work in bare Node, outside any component or effect root. They just don't track anything, which is fine for a spec. Keep `.svelte.spec.ts` for specs that mount components.

The rule: `<name>.svelte.ts` is tested by `<name>.spec.ts`. Drop the `.svelte` from the spec name.

There's another half to this. The unit project compiles for the server, so the bodies of `$effect`, `$effect.pre` and `$effect.root` never run there. Anything that only happens inside an effect, including svelte-query's mutation subscription, has to be tested some other way: see [testing svelte-query code](/testing/svelte-query-specs/#the-unit-project-compiles-for-the-server-so-the-adapters-dont-run-there).

## In the unit project a `$derived` runs again on every read

Some of my view models take their inputs as getters, for example `() => url`, and compute from them with `$derived`. In a unit spec, the test changes `url` between two reads and expects the view model to follow, and it does, even though `url` is a plain variable with no `$state` behind it.

That works because of the server compile. On the server, a `$derived` created outside a component render is just its function: every read calls it again, with no cache. I checked this on Svelte 5.57 by compiling a class with `svelte/compiler` both ways. Server output: a `$derived` over a plain getter ran once per read and followed the getter. Client output: it ran once, kept its first value, and never changed again, because it read no reactive source, so nothing could mark it as out of date.

So a unit spec passes for a view model whose `$derived` reads only a plain getter, and the same view model goes stale in the browser. In the app, the input has to be reactive: SvelteKit's `page.url`, or in a spec that should behave like the app, `SvelteURL` from `svelte/reactivity` (a `URL` whose fields are `$state`).

## Under `deno task`, the unit tests share Deno's persistent `localStorage`

I run the tests both with `npx vitest` and with `deno task test`, which runs Vitest inside Deno. Some code stores a choice (like a sort order) through a small helper whose default store is `localStorage`.

The two runners see different globals. Under Node 24, `localStorage` is undefined. Under Deno, `localStorage` exists and, as in a browser, it persists on disk from one run to the next ([Deno's docs](https://docs.deno.com/runtime/reference/web_platform_apis/) key it by the config file's path, or the main module's path without one). So a test that writes through the helper leaves a value behind, and the next `deno task` run reads it. A sort-order test passed under `npx` and failed under `deno task`, because a stale "newest" value from an earlier run was still in Deno's store.

I fixed it two ways and kept both. A spec over a remembered choice passes its own store to the helper instead of using the default. And the unit project's setup file stubs a fresh in-memory `localStorage` before every spec, so the default store starts empty under both runners. A spec's own stub in `beforeEach` runs after the setup file's, so it still wins.

## Rendering a component in a unit test

Some decisions live in a component's markup: which element it renders, which classes, which attributes. A pure module can't hold those, so a unit test of a pure module can't check them. They need the component itself rendered.

`svelte/server`'s `render` does that in plain Node, with no browser, and returns the component's HTML. A spec can assert on that HTML.

If a component's props are a union, you may need to cast it to `Component<Record<string, unknown>>` for `render`'s generic. It's a test fixture, so a cast is acceptable there.

Some components take a snippet prop that they call with a value, like a list that renders each row through a `row` snippet. A spec can pass one built with `createRawSnippet` from `svelte`. Its function receives each argument as a getter, so it's typed `createRawSnippet((value: () => T) => ({ render: () => … }))`, and calling `value()` inside `render` lets the spec record what the component passed to its child.

A component that holds a [data component](/svelte/data-components/) needs a query client in context before it can render at all, in a unit spec or a browser spec. How I handle that (a mocked read adapter in the unit project, a `WithQueryClient` wrapper in the browser) is in [testing svelte-query code](/testing/svelte-query-specs/).

## A server-render spec that matches attribute order breaks on a refactor

A spec that asserts on server-rendered HTML can match it with a regex. The gotcha is attribute order.

`svelte/server` prints a component's attributes in the order the markup spreads them: `{...rest}` first, then the ones written after it. Say a component renders a raw `<input class type name>`, and a refactor replaces it with the same input rendered through a wrapper component that spreads `{...rest}`. The two print the same attributes in a different order. So a spec regex like `type="radio" name="…"` fails even though the DOM is identical.

To make the spec survive that, match each element first (`<input [^>]*name="…"[^>]*>`) and then test its attributes one at a time.

## Browser specs need the design-system stylesheet

A component built only from library classes has no `<style>` block (that's the approach in [Svelte with a global CSS design system](/design-systems/svelte/)). All of its styling comes from the design system's stylesheet, which the app loads. A browser spec mounts the component without the app around it, so it has no layout (a stage with no size) unless the spec imports the design system's root stylesheet.

## A browser spec mounts a route by mocking the context module

Say a component gets its dependency container through a helper that reads a context key, and the module doesn't export that key. Normally a test supplies context values through `render(…, { context })`, but that needs the key, so the test can't provide the container that way.

What works in a Vitest browser project is mocking the whole context module, so the helper returns a fake container. Any counters the fake writes have to be created by `vi.hoisted`:

```ts
vi.mock('$lib/context', () => ({
  useContainer: () => fakeContainer,
  provideContainer: …
}));
```

Other context values, whose keys are exported, go in through `context: new Map([[KEY, value]])` as usual. The fake only needs the operations the route's view model calls. Keeping hand-written fakes like this in sync with the container type is a separate problem: see [fakes and async ticks](/testing/fakes-and-async/).

## A spec's first dynamic import of a `.svelte.ts` compiles inside a test's timeout

Some specs load a fresh copy of a module in every test. Say a spec calls `vi.resetModules()` in `beforeEach` and then `await import('./x.svelte')` in each test.

That spec pays for the Svelte compile in the *first* test only. `resetModules` drops the evaluated module instances, but not Vite's transform cache. So later imports re-evaluate cached code in a few milliseconds: about 200 ms for the first test, 3 to 8 ms for the rest.

On its own that's harmless. But under a loaded full run, the compile can stretch past the 5 s test timeout, and the first test fails for a reason unrelated to what it checks. The fix is to move the compile out of the tests. Import the module once in a `beforeAll` with its own hook timeout, stubbing any globals the module reads at load, then unstub. The compile happens in the hook, every test still gets a fresh instance from `resetModules`, and no assertion changes.

## A full test run can time out under load while every file passes alone

I had a dev server and other browser work running, and a parallel Vitest run of a unit project and a browser project timed out specs in files I hadn't touched, and never finished. The unit project alone passed. The browser project with `--no-file-parallelism` passed. On a quiet machine, the same full run passed in seconds. Suspect load before you suspect the code.

A run that hangs like that needs a time limit, but wrapping it in `timeout` doesn't clean up reliably. GNU `timeout` sends `TERM` to the command's process group. But a process can survive `TERM`, and Playwright launches the browser detached, in its own process group, so the signal never reaches it. Use `timeout -k 5` so a `KILL` follows, and check `ps` for `vitest` and `chrome-headless-shell` afterwards.
