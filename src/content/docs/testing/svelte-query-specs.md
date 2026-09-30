---
title: Testing svelte-query Code with Vitest
description: Why svelte-query's adapters don't run in a server-compiled unit project, and how to test the observers, query factories, mutations and screens around them.
tags: [testing, vitest, svelte, svelte-5, tanstack-query]
sidebar:
  order: 6
---

My Svelte app reads and writes through TanStack Query's Svelte adapter, `@tanstack/svelte-query` (checked on 6.3.0 over query-core 5.104). Every read sits in a [data component](/svelte/data-components/): a component that calls a small `readQuery` adapter, which wraps `createQuery` and maps TanStack's result to a `ReadState` union (`loading`, `failed`, `ready`) with a pure function, `readStateOf`. Every write sits in a view model, which calls a `writeQuery` adapter over `createMutation` and gets back a `WriteState` union and a `run` method. Query factories build the options both adapters take. What the cache does at runtime is on [svelte-query v6](/svelte/svelte-query/).

The tests run in Vitest with two projects: a `unit` project in Node and a `browser` project under Playwright (the split is in [Vitest projects](/testing/vitest-projects/)). Most specs live in the unit project, and it's also where svelte-query behaves least like it does in the app.

## The unit project compiles for the server, so the adapters don't run there

A Vitest project with `environment: 'node'` makes vite-plugin-svelte compile every `.svelte.ts` file, mine and the `.svelte.js` files in `node_modules`, with `generate: 'server'`. The `svelte` import also resolves to its server build. In that output, effects don't exist. I compiled `$effect.root(() => { … })` with `svelte/compiler` 5.57 for the server, and it came out as the literal `() => {}`: the function passed in never runs. `$effect` and `$effect.pre` disappear the same way. `$state` and `$derived` still work, which is why view models test fine in Node.

svelte-query's two adapters react to that differently, because of where each one subscribes to its observer:

- `createQuery` subscribes eagerly, in the function body, so that a query also works during server rendering. So a server-compiled `readQuery` does go from loading to ready in a spec. But that's the server path, and it proves nothing about how the component behaves in a browser.
- `createMutation` subscribes, and pushes new options into its observer, inside `$effect.pre`. On the server that never runs, so a server-compiled `writeQuery` stays `idle` forever after a write starts.

So in the unit project, neither the adapters nor the data components that call them run the way they do in the app. I don't restructure the code to make them testable there. I test one layer down.

## Test the read mapping over a real `QueryObserver`

`createQuery` is a thin wrapper over query-core's `QueryObserver`, and `createMutation` over `MutationObserver`. Both are plain classes that run in Node, and svelte-query re-exports them. So a spec can build one on a test client, `subscribe` it so it fetches, control when the query function answers, and map `getCurrentResult()` through the same `readStateOf` the adapter uses:

```ts
import { QueryClient, QueryObserver } from '@tanstack/svelte-query';
import { expect, it, vi } from 'vitest';
import { readStateOf } from './read-state';

function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

it('reads loading, then ready', async () => {
  const client = testClient();
  let answer: (items: readonly string[]) => void = () => {};
  const observer = new QueryObserver(client, {
    queryKey: ['shelf'],
    queryFn: () => new Promise<readonly string[]>((resolve) => { answer = resolve; }),
  });
  const unsubscribe = observer.subscribe(() => {});

  expect(readStateOf(observer.getCurrentResult())).toEqual({ kind: 'loading' });
  answer(['a']);
  await vi.waitFor(() =>
    expect(readStateOf(observer.getCurrentResult())).toEqual({ kind: 'ready', value: ['a'] }),
  );
  unsubscribe();
});
```

`retry: false` makes a failing query fail on the first try instead of after the default retries, and `gcTime: 0` drops a query from the cache as soon as nothing observes it, so specs don't leak cache entries into each other. Each query factory gets its own spec, with a hand-written fake of the use cases it calls, read through the helper in the next section. The flatteners, format modules and view models need no observer at all; they run in bare Node.

## A query factory's spec reads it the way a data component does

In the app, every query is read by a data component through `createQuery`; no code awaits the cache directly (see [app code never reads the cache imperatively](/svelte/svelte-query/#app-code-never-reads-the-cache-imperatively)). If a factory's spec awaited the cache instead, it would check a resolved value or a rejection, which is never the state the app draws. So the specs read the way the app does, through a small helper, `observedRead(client, options)`. It builds the same `QueryObserver` class that `createQuery` wraps, subscribes it so it fetches, and resolves with `readStateOf` of the first result that isn't fetching:

```ts
function observedRead<T, K extends QueryKey>(
  client: QueryClient,
  options: QueryObserverOptions<T, DefaultError, T, T, K>,
): Promise<ReadState<T>> {
  const observer = new QueryObserver(client, options);

  return new Promise((resolve) => {
    let unsubscribe = (): void => undefined;
    const settle = (result: QueryObserverResult<T>): void => {
      if (result.fetchStatus === 'fetching') return;
      unsubscribe();
      resolve(readStateOf(result));
    };
    unsubscribe = observer.subscribe(settle);
    settle(observer.getCurrentResult());
  });
}
```

The last line covers a result that is already settled when the observer subscribes. A query with `skipToken` as its query function never fetches, so the helper resolves it as `loading` right away, the same state a data component shows for it.

A spec then asserts the `ReadState` a data component would draw, `ready` with the value or `failed` with the message. This one reads a settings factory with a fake that resolves stored settings (`LARGE` is the default settings with a large text size):

```ts
it('readies the stored settings under the flowing settings key', async () => {
  const client = createTestQueryClient();
  const options = readingSettingsQuery({
    readReadingSettings: () => Promise.resolve({ kind: 'success', settings: LARGE }),
  });

  const read = await observedRead(client, options);

  expect(read).toEqual(readReady(LARGE));
  expect(options.queryKey).toEqual(flowingKeys.settings());
});
```

The spec names say "readies" and "fails" rather than "resolves" and "rejects", because that's what they check. A `failed` state holds only the message, so a spec that checks the thrown cause reads it from the cache entry after the read:

```ts
await observedRead(client, options);

const failure = client.getQueryState(options.queryKey)?.error;
expect(failure).toHaveProperty('cause', thrown);
```

Two `observedRead` calls on the same key in a row share one cache entry, even on a test client with `gcTime: 0`. query-core schedules the removal of an unobserved entry with `setTimeout`, and the second observer attaches before that timer runs. A spec that checks a factory keeps its value for the session relies on that.

## A mutation factory is tested through a `MutationObserver`

A mutation factory returns the options a write uses, and its `mutationFn` calls one use case and returns that use case's answer untouched. `createMutation` doesn't run in the unit project, but those options do. `new MutationObserver(client, options).mutate(variables)` runs the `mutationFn` on the test client and returns its promise. So a spec can check the two outcomes that matter: a refused answer resolves as data, and a throw rejects. Here `removeItemMutation` is the factory under test, and each fake's `remove` returns a `RemoveAnswer` union (`removed` or `not-found`) or throws:

```ts
it('resolves a refusal and rejects a throw', async () => {
  const client = testClient();
  const refusing = { remove: async (): Promise<RemoveAnswer> => ({ kind: 'not-found' }) };
  const throwing = { remove: async (): Promise<RemoveAnswer> => { throw new Error('broken'); } };

  await expect(new MutationObserver(client, removeItemMutation(refusing)).mutate('a'))
    .resolves.toEqual({ kind: 'not-found' });
  await expect(new MutationObserver(client, removeItemMutation(throwing)).mutate('a'))
    .rejects.toThrow('broken');
});
```

## A mutation calls its `mutationFn` a few microtasks after `mutate`

Some specs trigger a write synchronously and then check the use-case fake right away. In one of mine, disposing a view model flushes a save that was waiting, and the spec checked that the save reached the fake.

That check ran too early. Inside query-core, `Mutation.execute` awaits the mutation cache's `onMutate` and then the options' `onMutate` before it starts the `mutationFn`. Each `await` is at least one microtask, so the use case behind a mutation is never called synchronously inside the call that started it. The spec has to let microtasks run before it looks: under fake timers, `await vi.advanceTimersByTimeAsync(0)`.

## Count invalidations with a spy, not with the cache

A write usually ends by invalidating the queries it made stale, and I want a spec to check which ones and how often. The cache doesn't record that.

`invalidateQueries` on a key that no component observes only marks the query invalidated. Its default `refetchType` is `'active'`, and a query with no observers isn't active, so nothing gets fetched. And `Query.invalidate()` only dispatches when the query isn't invalidated already, so a second invalidation of the same key leaves no trace. So I spy on the call and read the keys from it:

```ts
const invalidate = vi.spyOn(client, 'invalidateQueries');
// … run the write …
expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['shelf'], ['shelf']]);
```

To check once that the invalidation really lands, seed the key with `setQueryData` first and then read `client.getQueryState(key)?.isInvalidated`.

## A screen around a data component is rendered with a mocked read adapter

Some unit specs render a whole screen with `svelte/server`'s `render`, to check markup that lives in the screen. If the screen holds a data component, the render throws "No QueryClient was found in Svelte context". svelte-query keeps its client in Svelte context under a private `Symbol('QueryClient')`, so `render(Component, { context: new Map(…) })` has no key to put it under. Only `QueryClientProvider` or `setQueryClientContext`, called inside a component, can set it.

So the spec mocks the read adapter instead, and the data component gets a fixed state without any query:

```ts
vi.mock('$lib/shared/read-query.svelte', () => ({
  readQuery: () => ({ state: { kind: 'loading' }, reload: () => {} }),
}));
```

When the screen holds several data components, the mock returns a state per key: `readQuery: (options) => ({ state: answers.get(String(options().queryKey[1])), reload })`, with `answers` created by `vi.hoisted` and filled per key before the render.

## A view model built outside a component mocks `writeQuery`

A view model that calls `writeQuery` in its constructor calls `createMutation`, which calls `useQueryClient()`, which reads Svelte context. Built in a spec's plain function, it throws `lifecycle_outside_component`. Browser specs that build the view model in the test body hit the same error.

The fix is a stand-in for the adapter, and I keep three, picked by what the spec observes:

- **Idle**: `state` is `idle` and `run` never settles. For a spec that never drives a write. A method that awaits its write never returns under it.
- **Refusing**: `run` rejects (the view model's `.catch(() => null)` absorbs it) and records the variables of each call. For a spec that checks the steps around a write and which write was started. The write's own `onSuccess` and `onError` never run.
- **Running**: builds TanStack's own `MutationObserver` over a test client, so `run` calls the factory's `mutationFn` and the view model's `onMutate`, `onSuccess`, `onError` and `onSettled` the same way `createMutation` would. For a spec about which write the view model makes and with what, checked through the use-case fake.

```ts
vi.mock('$lib/shared/write-query.svelte', () => import('$lib/shared/testing/idle-write-query'));
```

A view model that also calls `useQueryClient()` itself needs that mocked as well: `vi.mock('@tanstack/svelte-query', async (original) => ({ ...(await original<object>()), useQueryClient: () => ({}) }))`. Taking the client as a constructor argument instead removes that mock.

## What the unit project leaves untested

Testing one layer down covers the mapping, the factories, the flatteners and the view models. It leaves out the adapter glue, the data component's template and the view model's write callbacks as wired in the app. A wrong invalidation key there only shows up in a browser.

A browser spec can mount a route that holds a data component, but it needs a `QueryClient` in context, and the key is private there too. So I keep a test-only `WithQueryClient.svelte` that renders a `screen` component prop inside `QueryClientProvider` with a test client. `render`'s `context` map still holds anything else the route reads: `render(WithQueryClient, { props: { screen: SettingsPage }, context })`.

The first browser run after I added `@tanstack/svelte-query` failed with Svelte's `effect_orphan`. `QueryClientProvider`'s `onMount` ran on the raw Svelte runtime from `node_modules`, while the components ran on the copy Vite's optimizer had prebundled, so there were two Svelte instances. That was the run in which the optimizer discovered the new dependency, and the second run passed. So I run a browser spec a second time before chasing that error. If it persists, `optimizeDeps.exclude: ['@tanstack/svelte-query']` for the browser project is the usual cure.

In React the same split doesn't exist: a spec renders the data component inside a wrapper that builds a fresh client and asserts on the screen, so the plumbing, the mapping and the write's callbacks are all under test (see [render props and TanStack Query](/react/render-props-and-tanstack-query/)).
