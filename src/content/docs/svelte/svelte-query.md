---
title: "svelte-query v6: What the Cache Does"
description: How createQuery and createMutation behave in Svelte 5, which defaults matter for an app that only stores data locally, and the cache operations behind optimistic writes.
tags: [svelte, svelte-5, tanstack-query]
sidebar:
  order: 9
---

`@tanstack/svelte-query` is the Svelte binding for TanStack Query: a cache of async reads keyed by arrays, plus mutations for writes. I use it under [data components](/svelte/data-components/), where one component owns each read and a view model owns each write. Two small adapters sit between the library and the app: `readQuery` turns a query's result into a `ReadState` union (`loading`, `failed`, `ready`), and `writeQuery` turns a mutation's result into a `WriteState` union and offers `submit` (fire and forget) and `run` (returns a promise) for the write.

Everything below was checked on `@tanstack/svelte-query` 6.3.0 over query-core 5.104, against the installed package source.

## The API in Svelte 5

`createQuery(() => options, () => client)` and `createMutation(() => options, () => client)` both take accessors, not values. The first accessor runs inside a `$derived`, so anything reactive it reads (a prop, a `$state` field) feeds into the options. When the options change, svelte-query calls the observer's `setOptions` in a pre-effect. If the key changed, the observer moves to the other cache entry and fetches it if that entry is stale. The second accessor is optional. When it's given, svelte-query uses that client and never looks in Svelte context.

Both register effects (`$effect.pre`), so they need an effect owner: a component's script, or a `$effect.root`. `createQuery` also calls `onDestroy` to unsubscribe, but inside a `try`, so it doesn't throw in a `$effect.root` outside a component.

The two return different things:

- `createQuery` returns a proxy whose fields are lazy `$state.raw` values. Reading `query.status` inside a `$derived` tracks that field, so a pure mapping such as `readStateOf(query)` in a `$derived` re-runs when the query changes.
- `createMutation` returns a proxy over a `$state` object that it updates with `Object.assign` whenever the mutation changes. Its `mutate` catches the promise's rejection and drops it (`.catch(noop)`); `mutateAsync` returns the promise.

`QueryClientProvider` takes `client` and `children`. It puts the client into Svelte context, calls `client.mount()` on mount and `client.unmount()` on destroy. `setQueryClientContext(client)` sets the context and nothing else. The context key is a private `Symbol('QueryClient')`, so code outside the package can only set the client through those two.

A query's result separates a failed first read from a failed refetch. A load error has `isLoadingError: true` and no data. A refetch error has `isRefetchError: true`, `isLoadingError: false`, and still has the previous `data`. That's what lets a read adapter keep showing the value when a background refetch fails. The pure mapping can take a small structural type that names only the fields it reads; `QueryObserverResult` is assignable to it without a cast, so the mapping can be unit-tested with plain objects.

## The defaults an offline app overrides

A `new QueryClient()` with no options behaves like this in a browser (from the query-core source):

| Option | Default | What it does |
| --- | --- | --- |
| `staleTime` | `0` | cached data counts as stale at once, so a new mount refetches behind it |
| `gcTime` | 5 minutes | an entry with no observers is dropped after this long |
| `retry` (queries) | `3` | a rejected read is tried three more times before it fails |
| `retry` (mutations) | `0` | a rejected write fails at once |
| `retryOnMount` | `true` | a query in the error state with no data is fetched again when a component mounts it |
| `refetchOnWindowFocus`, `refetchOnReconnect` | `true` | a stale query refetches when the tab regains focus or the browser comes back online |
| `structuralSharing` | on | a new result that deep-equals parts of the old one keeps the old objects, so unchanged rows keep their identity |
| `networkMode` | `'online'` | a fetch or mutation waits while the browser reports it's offline |

The last one matters for an app whose reads and writes all go to IndexedDB, OPFS or the Cache API. After a window `offline` event, query-core's `onlineManager.isOnline()` returns `false`, and a new fetch or mutation pauses until the `online` event, before it ever calls its function. Someone reading in airplane mode would turn pages and the app would stop saving their place, though nothing it does needs the network. So I set `networkMode: 'always'` in the client's defaults for both queries and mutations, and would use `'online'` only on a call that really goes over the network.

The global policy lives in one file beside the composition root, `query-client.ts`. Mine sets `retry: 0`, a longer `gcTime`, both refetch triggers off, and `networkMode: 'always'`; each query sets its own `staleTime` in its options factory.

## A query notifies its observers synchronously, so a cache write shows in the same tick

When a query's state changes (`setQueryData`, a resolved fetch), query-core's `Query.dispatch` calls each observer's `onQueryUpdate` inside `notifyManager.batch`. A `batch` runs its callback right away and only defers what was scheduled through it. The observer calls its listeners directly in that batch, and svelte-query's listener is `observer.subscribe(() => update(createResult()))`, which writes the new result into the `$state.raw` fields with nothing scheduled in between. So by the time `setQueryData` returns, a component's read state already holds the new value.

That makes these safe:

- A saved row can enter the cache and leave an "unsaved" overlay in one step (see [unsaved items are an overlay](/architecture/data-components/#unsaved-items-are-an-overlay-an-optimistic-write-puts-back-only-what-it-took)). There's no frame where the row is in neither list. That matters with a keyed `{#each}`, which would otherwise rebuild the row and drop the focus of an inline editor in it.
- When a data component calls its owner back because a read has settled (see [a command that runs before its read settles holds its request](#a-command-that-runs-before-its-read-settles-holds-its-request)), the owner can read the bound component's rows inside that callback and gets the rows that just settled.

Mutations are different. `createMutation` wraps its listener in `notifyManager.batchCalls`, and those calls go through the notify manager's scheduler, which by default is `setTimeout(callback, 0)`. So a write's state (`saving`, `failed`, `done`) reaches the component a macrotask after the mutation changed, not in the same tick.

## App code never reads the cache imperatively

Most reads end on screen: a data component calls `readQuery`, and its markup draws the state. Some values are needed by a command instead, a view-model method that runs when someone clicks or opens something. Before a long operation such as a large download starts, a gate checks whether consent for it is stored. A viewer that opens a document needs the stored display settings before it draws the first page. The query client has methods that read its cache from anywhere, given the same options a data component uses.[^imperative]

I don't call them in app code. Every read is a `createQuery` (behind `readQuery`) in a data component, and a command that needs a read's value gets it from a data component. A read awaited inside a command lives outside every component, so no screen shows its loading or its failure, and the command gets a resolved value or a rejection instead of the `ReadState` union the rest of the app works with. A `.catch` on that promise runs the same way for an expected refusal and a throw (see [an expected answer resolves](#an-expected-answer-resolves-and-only-a-missing-answer-rejects)). And the query factories would then be read one way by the app and another by the commands. The command gets the value in one of these ways.

**Through a source closure over a data component that draws nothing.** A view model built in a route's script reaches a data component through `bind:this` and a closure ([a route-built view model reads a data component through `bind:this`](/svelte/data-components/#a-route-built-view-model-reads-a-data-component-through-bindthis)). The closure returns the read's `ReadState`, and a pure function turns it into the command's next step. For the consent gate, the stored consent is a use-case answer, `success` with a decision or `storage-unavailable` when the browser blocks the store:

```ts
type ConsentRead =
  | { readonly kind: 'success'; readonly decision: 'granted' | 'undecided' }
  | { readonly kind: 'storage-unavailable' };

type ConsentStep =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'granted' }
  | { readonly kind: 'ask' };

function consentStep(consent: ReadState<ConsentRead>): ConsentStep {
  return match(consent)
    .returnType<ConsentStep>()
    .with({ kind: 'loading' }, () => ({ kind: 'waiting' }))
    .with({ kind: 'failed' }, ({ message }) => ({ kind: 'failed', message }))
    .with({ kind: 'ready', value: { kind: 'success', decision: 'granted' } }, () => ({
      kind: 'granted',
    }))
    .with({ kind: 'ready' }, () => ({ kind: 'ask' }))
    .exhaustive();
}
```

The command matches on the step: it starts the operation on `granted`, opens the consent dialog on `ask`, and shows a notice on `failed`. `consentStep` takes plain values, so its spec needs no cache. A query whose subject isn't known yet (no language chosen, no model picked) takes `null` and uses [`skipToken`](#skiptoken-keeps-a-key-with-no-subject-from-reading), so the closure returns `loading` until there's something to read.

**Through a data component that mounts its child once the read has settled.** The viewer's open can't wait on a reactive read, so a data component wraps the viewer and renders it only when the settings are known. A pure function defines what "known" means:

```ts
type OpeningSettings =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly settings: ViewerSettings };

function openingSettings(state: ReadState<ViewerSettings>): OpeningSettings {
  return match(state)
    .returnType<OpeningSettings>()
    .with({ kind: 'loading' }, () => ({ kind: 'reading' }))
    .with({ kind: 'failed' }, () => ({ kind: 'read', settings: DEFAULT_SETTINGS }))
    .with({ kind: 'ready' }, ({ value }) => ({ kind: 'read', settings: value }))
    .exhaustive();
}
```

```svelte
<script lang="ts">
  let { settings, children }: Props = $props();

  const stored = readQuery(() => viewerSettingsQuery(settings));
  const opening = $derived(openingSettings(stored.state));
</script>

{#if opening.kind === 'read'}
  {@render children(opening.settings)}
{/if}
```

The viewer gets the settings as a prop and passes them to its open as an argument, so the open reads nothing. A failed read opens the viewer with the defaults on purpose: a document in the default settings is better than no document. The cost is the first open with nothing cached, which draws nothing for the length of one read. After that the entry is in the cache, `readQuery` starts at `ready`, and the viewer mounts at once.

## A command that runs before its read settles holds its request

A source closure returns the read as it is right now, so a command can find it `loading`. Someone can start the operation in the moment after the subject becomes known, before the read for it has come back. Returning "not ready" would drop the request, and awaiting needs a promise that a reactive read doesn't have. So the command keeps the request together with a visit counter, returns, and runs it again when the read settles. A request from an earlier visit (the person has since opened something else) is dropped at that point, the same check an awaited read would make after its `await`.

That needs a call from the data component to its owner when the read settles. The same call serves a step that has to run once a list has loaded, such as jumping to a search match in an item someone just opened. I normally start a command from the event that causes it, a click handler or a mutation's `onSettled`, rather than from an effect that watches state. Here there's no such event. TanStack Query v5 removed the `onSuccess`, `onError` and `onSettled` callbacks from queries, svelte-query 6.3.0 offers no "settled" callback of its own, and nothing the app does starts the read: it starts when the data component mounts or its key changes. So, as a last resort, the data component tracks its own read in an effect and calls an `onread` prop:

```svelte
<script lang="ts">
  import { untrack } from 'svelte';

  let { items, id, onread }: Props = $props();

  const listed = readQuery(() => itemsQuery(items, id));
  const settled = $derived(id !== null && listed.state.kind !== 'loading' ? id : null);

  $effect(() => {
    const ready = settled;
    if (ready !== null) untrack(() => onread?.(ready));
  });
</script>
```

The effect reads `settled`, a `$derived` that holds a primitive (the id, or `null`), not the state object. Every cache write replaces the state object, and an effect that read it would run on each one ([a `$derived` that returns a new object wakes its readers every time](/svelte/effects/#a-derived-that-returns-a-new-object-wakes-its-readers-every-time)). The primitive changes only when the read goes into or out of settled, so the effect calls back once per settle, and again after a reload of a failed read. `untrack` keeps whatever the callback reads from becoming a dependency of the effect.

The receiver is a view-model method that makes a repeat call harmless. In the search case, the owner notes the item's id when it opens the item, and the method acts only for that id:

```ts
itemsRead(id: ItemId): void {
  if (this.#arriving !== id) return;
  this.#arriving = null;
  this.arrive(id);
}
```

The guard belongs in the view model because the effect never runs in a server-compiled unit project ([the unit project compiles for the server](/testing/svelte-query-specs/#the-unit-project-compiles-for-the-server-so-the-adapters-dont-run-there)), while the view model's method does, so the logic stays under unit test.

## `skipToken` keeps a key with no subject from reading

Some reads depend on a subject that can be absent: the notes of the open card, while no card is open. The key factory accepts `null` (`cardsKeys.card(null)`), and the options factory passes `skipToken` as the query function when there's no subject:

```ts
queryFn: id === null ? skipToken : () => cards.readCard(id),
```

The observer then stays `pending` and never calls a function. The alternative is an `enabled: false` flag beside a made-up id, which leaves a query function that can't be called with what it needs. With `skipToken`, `queryOptions` still infers the data type from the real function.

The catch is `refetch()`. TanStack documents that a query disabled through `skipToken` can't be triggered with `refetch`. In 5.104, calling it logs "Attempted to invoke queryFn when set to skipToken" in development, and the fetch fails with a "Missing queryFn" error. So a `reload` method on a data component has to skip that read while the subject is absent.

## A lazy read is a disabled query that a reload turns on

Some reads should only happen on demand. A search dialog, say, needs the whole list, but only once someone opens it. An observer with `enabled: false` reads nothing but still shows whatever the cache already holds for its key. It isn't refetched by `invalidateQueries` either: invalidation refetches only active queries by default (`refetchType: 'active'`), and a query whose observers are all disabled isn't active. Turning `enabled` on fetches the entry if it's stale.

So a lazy read is a data component with a `lazy` prop. Its `reload()` flips a `$state` flag the first time, which turns the query on, and refetches after that. An invalidation while nobody has asked for the list costs no read.

One lazy data component can serve two consumers: one reaches it through its `children` snippet, the other through `bind:this` (see [a route-built view model reads a data component through `bind:this`](/svelte/data-components/#a-route-built-view-model-reads-a-data-component-through-bindthis)). Whichever consumer calls `reload()` first turns it on. Two data components on the same key would share the cache entry too, but each would need its own lazy flag.

## `keepPreviousData` keeps a value on screen while its key changes

A query keyed by a list of ids, such as the covers for the books on a shelf (`keys.covers(ids)`), gets a new cache entry every time the list changes. A new entry starts `pending`, so with a plain query, adding one book would blank every cover until the new read lands.

With `placeholderData: keepPreviousData`, the observer returns the previous key's data while the new entry loads. The result's `status` is `success` (with `isPlaceholderData: true`), so a read adapter that maps `success` to `ready` keeps drawing the old covers, and the new ones replace them when the read lands.

## `cancelQueries` before `setQueryData` keeps an optimistic value

An optimistic write puts its expected result into the cache with `setQueryData` before the store has finished the write. Say a card list has `staleTime: 0` and someone returns to it: the list mounts, and the query refetches behind the cached rows. If they now archive a card, the write removes the row from the cache, but the refetch that started before the write still resolves with the stored list from before it, and the removed row comes back.

`await client.cancelQueries({ queryKey })` before `setQueryData` drops the fetch in flight, so its answer never reaches the cache. By default it also reverts the query to its state before that fetch started (`revert: true`). This does the job that a generation counter did when a view model held the read by hand.

## An optimistic put-back puts the row back, not the snapshot

TanStack's optimistic-update example takes a snapshot of the list in `onMutate`, and `onError` restores the whole snapshot. That's wrong as soon as two writes overlap. Say someone removes a card and, while that write is still running, renames another one. If the removal then fails, restoring the snapshot brings back the removed card and also undoes the rename, which succeeded.

So the put-back restores only what the failed write took out: the one removed row, or for a clear, the cleared rows ahead of any rows made since. Then `onSettled` invalidates the list, so the cache ends at what the store holds, whatever order the writes finished in.

## `setQueryData` with a union-typed literal needs a typed variable

With a cached value typed as a union, passing an object literal straight to `setQueryData` can fail to compile:

```ts
type SetupRead =
  | { readonly kind: 'success'; readonly setup: Setup }
  | { readonly kind: 'storage-unavailable' };

client.setQueryData<SetupRead>(key, { kind: 'success', setup });
// Type 'Setup' is not assignable to type 'undefined'.
```

The second parameter is an `Updater`, a union of the value and a function that computes it from the old value. TypeScript checks the literal against that union and reports it against the wrong member. Assigning it to a variable of the union type first makes it compile:

```ts
const held: SetupRead = { kind: 'success', setup };
client.setQueryData<SetupRead>(key, held);
```

I reproduced this with TypeScript 6.0.3 and query-core 5.104's types under `--strict`.

## An expected answer resolves, and only a missing answer rejects

A query function's promise can resolve or reject, and TanStack treats the two very differently: it retries a rejection, caches no data for a failed first read, and fetches it again on the next mount. So an outcome the use case expects, such as "the browser blocks this store", resolves as a variant beside the success (`{ kind: 'storage-unavailable' }`), and the query rejects only when no answer was produced. The resolved answer is cached like any other, and the data component flattens it into whatever the screen draws. A use case whose union has one variant has nothing to flatten, so its options factory resolves what the success holds. The general rule is on [resolve with an answer, reject only when there is none](/architecture/expected-and-unexpected-failure/#resolve-with-an-answer-reject-only-when-there-is-none).

Absence follows from that. A cover read with `staleTime: Infinity` keeps whatever resolved for as long as the entry lives. If the port signaled "this book has no cover" and "the store broke" with the same error, a passing failure would be cached as "no cover" until the next write. With the port returning `Blob | null` and throwing on a real failure, the query caches the `null` as an answer, rejects on the throw, and the next mount reads again because a failed first read leaves no data.

The same split matters for a command. If a command awaited a read and caught the rejection with `.catch(() => fallback)`, it would take one fallback for an expected refusal and a throw alike, because the catch runs on any rejection. A command that gets a `ReadState` from a data component (see [app code never reads the cache imperatively](#app-code-never-reads-the-cache-imperatively)) gets the two as different variants, as long as the factory resolves the expected one: the refusal arrives as `ready` with `{ kind: 'storage-unavailable' }` as its value, and the throw as `failed` with a message. In `consentStep`, a blocked consent store falls into the last `ready` branch and opens the consent dialog, and a read that threw becomes a `failed` step that the command shows as a danger notice before it reloads the read. Nothing branches on the rejection itself.

## A mutation resolves its answer, and `onError` reports only a throw

A write's options factory holds only a `mutationFn`, and that function returns the use case's answer union untouched. So `run()` (which returns `mutateAsync`'s promise) resolves with the answer and rejects only on a throw. The owner of the write reads the answer after `run` and shows the described refusal. The mutation's `onError` shows the same title with a generic "Something went wrong" message for anything that isn't a described failure. A `.catch(() => null)` after `run` then only stops a rejection that `onError` already reported from going unhandled.

What the owner never does is map a throw to a storage variant ("the store could not be reached"). A throw is a bug or a broken store, and describing it as a storage refusal hides the difference.

## The order of a mutation's callbacks

`Mutation.execute` in query-core runs the steps of a write in a fixed order, and awaits each one:

1. The mutation cache's `onMutate`, then the options' `onMutate`. This is where an optimistic write cancels the read and edits the cache.
2. The `mutationFn`, through the retryer.
3. On success: the cache's `onSuccess`, the options' `onSuccess`, the cache's `onSettled`, the options' `onSettled`. On a throw: the same with `onError` in place of `onSuccess`.
4. Only then does the mutation leave `pending`, and `mutateAsync` settles.

Because step 1 is awaited (even when there's no `onMutate`, the `await` still yields), the `mutationFn` never runs synchronously inside the `mutate` call; it starts a few microtasks later. Because step 3 is awaited, an `onSuccess` that returns `client.invalidateQueries(...)` holds the write in `pending` until the active queries have been read again, and `run()` resolves after that.

`onSuccess` doesn't run when the `mutationFn` throws. And a write whose refusal is data still succeeds as far as TanStack is concerned. So when a refresh has to follow every outcome (a `not-found` answer too, or a throw), the invalidation goes in `onSettled(data, error, variables)`, which runs in every case and can read the write's subject from `variables`.

## A progress callback rides into a mutation as a variable

A write that reports progress, such as downloading a model, has a stream of updates that doesn't belong in the cache. The callback goes into the mutation's variables (`{ language, onProgress }`), and the `mutationFn` passes it to the use case. The owner builds a new callback for each `run`, so it can drop a report that arrives after a later operation has started.

[^imperative]: The methods are `fetchQuery`, `ensureQueryData` and `prefetchQuery`. In query-core 5.104, `fetchQuery` is marked deprecated in favor of `client.query(options)`, which does the same thing (and also applies the options' `select`): it returns the cached data if it isn't stale by the options' `staleTime`, and fetches otherwise, with `retry` off unless the options set it.
