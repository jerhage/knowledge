---
title: "Data Components in Svelte: Snippets over svelte-query"
description: The Svelte 5 mechanics of a data component, from the queries module and the read adapter to the exhaustive branch chain, flattened answers, bind:this owners and writes held by a view model.
tags: [svelte, svelte-5, tanstack-query, components, architecture]
sidebar:
  order: 8
---

A [data component](/architecture/data-components/) is a component whose whole job is one read: it starts the read, draws the waiting and the failure, and passes its children only the resolved value. Why I split a screen's state that way, and what a view model still holds, is on that page. Below is the Svelte 5 version, over [`@tanstack/svelte-query`](/svelte/svelte-query/). The React version, with render props over TanStack Query, is on [data components in React](/react/render-props-and-tanstack-query/).

The examples use the [card catalog](/architecture/overview/#the-running-example): a `cards` domain that stores cards, and an `annotations` domain that stores notes on them.

## The pieces under a data component

A read passes through several layers before a component draws anything.

**The query client.** One `QueryClient` holds the cache, built in `query-client.ts` beside the composition root with the app's global policy. The root layout puts it into context with `QueryClientProvider`; the layout code is on [applying it in SvelteKit](/architecture/sveltekit/#the-context-passes-the-container-to-the-component-tree).

**The use cases.** Each one is a plain async function that returns its own named union. The composition root binds each to its ports and exposes them in groups, one per domain: `container.cards` holds `readCard`, `listCards` and the rest.

**The queries module.** Each domain has a `queries/` folder with a key factory and the option factories. A factory takes the use cases it calls as a parameter, typed structurally in the queries module itself, so it never imports the composition root and a spec can pass it a plain object:

```ts
const cardsKeys = {
  all: () => ['cards'] as const,
  list: () => [...cardsKeys.all(), 'list'] as const,
  card: (id: CardId | null) => [...cardsKeys.all(), 'card', id] as const,
};

type CardReads = { readonly readCard: (id: CardId) => Promise<ReadCardResult> };

function cardQuery(cards: Pick<CardReads, 'readCard'>, id: CardId | null) {
  return queryOptions({
    queryKey: cardsKeys.card(id),
    queryFn: id === null ? skipToken : () => cards.readCard(id),
    staleTime: 0,
  });
}
```

Every key starts with the domain's `all()`, so one `invalidateQueries({ queryKey: cardsKeys.all() })` reaches every read in the domain. `skipToken` covers the moment with no card open; what it does is on [the svelte-query page](/svelte/svelte-query/#skiptoken-keeps-a-key-with-no-subject-from-reading).

**The read adapter.** TanStack's query result has a `status`, `data`, `error` and a dozen flags, and a component that read them directly would have to handle every combination. So a shared adapter in the kernel, `readQuery`, maps the result into one union:

```ts
type ReadState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly value: T };

function readQuery<T, K extends QueryKey>(
  options: Accessor<CreateQueryOptions<T, DefaultError, T, K>>,
): ReadQuery<T> {
  const query = createQuery(options);
  const state = $derived(readStateOf(query));
  return {
    get state() {
      return state;
    },
    reload() {
      void query.refetch();
    },
  };
}
```

The mapping itself, `readStateOf`, is a pure function beside the union. It takes a small structural type naming only the fields it reads, so its spec passes plain objects and never builds a query:

```ts
type ReadSnapshot<T> =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly isLoadingError: true; readonly error: unknown }
  | { readonly status: 'error'; readonly isLoadingError: false; readonly data: T }
  | { readonly status: 'success'; readonly data: T };

function readStateOf<T>(snapshot: ReadSnapshot<T>): ReadState<T> {
  return match(snapshot)
    .with({ status: 'pending' }, (): ReadState<T> => ({ kind: 'loading' }))
    .with({ status: 'error', isLoadingError: true }, ({ error }): ReadState<T> => ({
      kind: 'failed',
      message: failureText(error),
    }))
    .with({ status: 'error', isLoadingError: false }, ({ data }): ReadState<T> => ({ kind: 'ready', value: data }))
    .with({ status: 'success' }, ({ data }): ReadState<T> => ({ kind: 'ready', value: data }))
    .exhaustive();
}
```

A write has a matching adapter, `writeQuery`, over `createMutation`, with a `WriteState` union (`idle`, `saving`, `failed`, `done`), a `submit` that fires the mutation and a `run` that returns its promise. Both adapters live in the kernel because every domain's data components use them and they contain no domain's words.

## A data component is a `<Thing>Data.svelte` with a `children` snippet

Each read boundary gets one component, named for what it reads. It takes the domain's use-case group and whatever identifies the subject, starts the read through `readQuery`, and draws the lifecycle. Its `children` prop is a [snippet](/svelte/state-and-props/#a-snippet-prop-is-the-svelte-5-slot) typed with the value it passes: `Snippet<[Card]>`.

```svelte
<!-- cards/ui/CardListData.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { readQuery } from '$lib/shared/read-query.svelte';
  import { unreachable } from '$lib/shared/unreachable';
  import { cardsQuery } from '../queries/cards-queries';
  import type { CardLists } from '../queries/cards-queries';

  let { cards, children }: { cards: CardLists; children: Snippet<[readonly Card[]]> } = $props();

  const listing = readQuery(() => cardsQuery(cards));
  const held = $derived(listing.state);
</script>

{#if held.kind === 'loading'}
  <EmptyState live message="Loading…" />
{:else if held.kind === 'failed'}
  <Alert variant="danger" title="The cards could not be read">{held.message}</Alert>
{:else if held.kind === 'ready'}
  {@render children(held.value)}
{:else}
  {unreachable(held)}
{/if}
```

The route renders it and passes a snippet that draws with the value:

```svelte
<CardListData cards={container.cards}>
  {#snippet children(cards)}
    <CardList {cards} />
  {/snippet}
</CardListData>
```

`CardList` gets `readonly Card[]` and nothing else about the read: no status, no error, no retry. It draws the same thing for the same props, and its tests pass it a fixture.

The local is called `held`, not `state`. In a `.svelte` script, `$name` is the auto-subscription of a store called `name`, so a local named `state` collides with the `$state` rune. With a plain `const state = { … }`, the Svelte 5.57 compiler really does turn every `$state(...)` in that script into a store read (and warns `store_rune_conflict`). With `const state = $derived(...)`, the compiler still compiles the rune, but svelte-check reads `$state` as the store and fails with "Block-scoped variable '$state' used before its declaration". A getter named `state` on an object, like `listing.state`, is fine.

## The `{#if}` chain ends in `unreachable`, so a new variant fails to compile

In React the data component's match is ts-pattern's `match(state)…exhaustive()`, which returns JSX and fails the type check when a variant has no branch. In Svelte the markup is a block chain, and nothing about `{#if}` forces it to cover every variant. If someone adds a `refreshing` variant to `ReadState`, a chain that only tests `loading`, `failed` and `ready` still compiles and draws nothing for it.

svelte-check type-checks the code the compiler generates from the template, with ordinary control-flow narrowing. So inside `{:else if held.kind === 'failed'}`, `held` is narrowed to the `failed` variant, and in the final `{:else}` it's narrowed to whatever no branch tested. The chain ends with `{:else}{unreachable(held)}`, where `unreachable` sits in the kernel:

```ts
function unreachable(value: never): never {
  throw new Error(`No branch handles ${JSON.stringify(value)}`);
}
```

While every variant has a branch, `held` is `never` at that point and the call compiles. When a variant is added, the call fails to compile at that line ("Argument of type '{ kind: "refreshing"; … }' is not assignable to parameter of type 'never'"), which is the same guarantee `.exhaustive()` gives.

A `match()` would compile in the markup too. I keep `match()` calls in the script, in a `$derived` or a pure function, for the reasons on [a `match()` goes in a `$derived`](/svelte/state-and-props/#a-match-goes-in-a-derived-not-in-markup), and use the `{#if}` chain where the branches draw components.

## A reload keeps the value and shows no spinner

When a query refetches behind cached data (someone invalidated it, or a component mounted it again), TanStack keeps `status: 'success'` and the old `data` while the refetch runs. `readStateOf` maps that to `ready` with the cached value. A refetch that fails has `isLoadingError: false` and still has the data, and `readStateOf` maps that to `ready` too.

So `ready` holds only its value, and there's no nested "refreshing" state for a child to check. The screen keeps showing what it had, and a reload never replaces it with a spinner. The cost is that a failed refetch shows no failure; I accept that because the cached value is still the last thing the store returned.

## A use case's answers are flattened beside the read

A use case can have expected outcomes besides success. Reading a card can find no such card, or find the store blocked (a private window that blocks storage, say):

```ts
type StorageUnavailable = { readonly kind: 'storage-unavailable' };

type ReadCardResult =
  | { readonly kind: 'success'; readonly card: Card }
  | { readonly kind: 'not-found' }
  | StorageUnavailable;
```

The query resolves those outcomes as data and rejects only when no answer was produced, for the reasons on [the svelte-query page](/svelte/svelte-query/#an-expected-answer-resolves-and-only-a-missing-answer-rejects). `ReadState<T>` stays generic, so the answer arrives inside `ready.value`: the read's state is `ReadState<ReadCardResult>`.

Drawing that directly would mean a `not-found` check inside the `ready` branch of the markup, a failure matched inside a success. Instead the data component flattens it into its own union, with `loading`, `failed` and each answer as peers:

```ts
type CardRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly card: Card };

function cardReadOf(state: ReadState<ReadCardResult>): CardRead {
  return match(state)
    .with({ kind: 'loading' }, (): CardRead => ({ kind: 'loading' }))
    .with({ kind: 'failed' }, ({ message }): CardRead => ({ kind: 'failed', message }))
    .with({ kind: 'ready', value: { kind: 'not-found' } }, (): CardRead => ({ kind: 'missing' }))
    .with({ kind: 'ready', value: { kind: 'storage-unavailable' } }, (): CardRead => ({
      kind: 'failed',
      message: 'This browser does not allow storage here.',
    }))
    .with({ kind: 'ready', value: { kind: 'success' } }, ({ value }): CardRead => ({
      kind: 'ready',
      card: value.card,
    }))
    .exhaustive();
}
```

The flattener is pure, so it gets unit tests of its own, and the template matches `CardRead` with the same `{#if}` chain ending in `unreachable`. A use case whose union has only a success variant has nothing to flatten, so its options factory resolves what the success holds and the data component draws `ReadState<T>` directly.

This is the nested form of the read state. The React version on [match one flat union](/react/render-props-and-tanstack-query/#match-one-flat-union-not-tanstack-querys-result-object) spreads the use case's union into the read state instead, so `notFound` sits beside `loading` with no flattener. The trade-off is on [flat or nested read state](/architecture/data-components/#flat-or-nested-read-state).

## Draw in place of the children only when they need the value

A data component replaces its children with the loading and failure states, so anything inside it disappears while the read is pending. That's right for what can't be drawn without the value, and wrong for the rest. A header, a list of links or an upload strip that works without the cards sits outside the data component, so it stays on screen while the list loads. The general rule is [a boundary draws in place of its children only when it has nothing to pass them](/architecture/data-components/#a-boundary-draws-in-place-of-its-children-only-when-it-has-nothing-to-pass-them).

A read the screen can draw without, such as a count shown on a badge, doesn't replace anything. Its data component passes down a described value instead: the counts if they're there, a failure string and a retry callback if they aren't.

## Forms beyond the default

The default is a data component that wraps its children and draws loading and failure itself. Other forms come up, and each is fine as long as the component's name and props make clear which one it is.

**An owner that passes a named union.** Sometimes the place that must draw the loading or failure isn't below the data component. The read might belong to a stage inside another component's frame, or the stage has to stay mounted when the read switches. Then the data component passes its children the whole flattened union (`CardRead`) and the child that owns the frame draws each state.

**A data component that swaps a stage sits inside the frame, not around it.** A reader screen has a frame (bars, a focus trap, a scroll position) and a stage that shows the current item. If the data component wrapped the frame, switching items would unmount and rebuild the frame with every load. Placed inside the frame, it swaps only the stage, and the frame keeps its bars, focus and scroll.

**An owner that draws nothing**, read through `bind:this`. That case has its own section next.

## A route-built view model reads a data component through `bind:this`

A view model that a route builds in its script has no access to a snippet argument: snippets run inside the markup, after the script has built the view model. When such a view model needs query data, such as a tag screen whose view model filters the cards by tag, the data component draws nothing and exports a method that returns its read state:

```svelte
<!-- cards/ui/CardShelfData.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { readQuery } from '$lib/shared/read-query.svelte';
  import type { ReadState } from '$lib/shared/read-state';
  import { cardsQuery } from '../queries/cards-queries';
  import type { CardLists } from '../queries/cards-queries';

  let { cards, children }: { cards: CardLists; children?: Snippet } = $props();

  const listing = readQuery(() => cardsQuery(cards));

  export function read(): ReadState<readonly Card[]> {
    return listing.state;
  }
</script>

{@render children?.()}
```

The route binds the component and passes the view model a closure that reads through the binding:

```svelte
<script lang="ts">
  const container = useContainer();
  let shelf = $state<ReturnType<typeof CardShelfData> | null>(null);
  let wanted = $state('');
  const view = new TagView(() => {
    const listing = shelf?.read();
    return { cards: listing?.kind === 'ready' ? listing.value : [], wanted };
  });
</script>

<CardShelfData bind:this={shelf} cards={container.cards} />
<TagScreen {view} />
```

The bound instance is `null` until the component mounts, so every closure that reads it writes a fallback. `shelf` is `$state`, and `read()` returns a `$derived` value, so a `$derived` in the view model that calls the closure updates when the component mounts and again whenever the read changes.

One component can serve both ways at once: one consumer through its `children` snippet, another through `bind:this`. Both read the same query.

## A branch inside a data component's snippet keeps its component mounted

A data component passes its value to its `children` snippet. Inside the snippet, a branch like this one picks a viewer by the item's kind:

```svelte
<ItemData items={container.items} {id}>
  {#snippet children(item)}
    {#if item.isText}
      <TextViewer {item} />
    {:else}
      <ImageViewer {item} />
    {/if}
  {/snippet}
</ItemData>
```

Svelte doesn't rebuild the snippet when its argument changes from one item to the next. The compiled `{@render children(value)}` passes the argument as a getter, so only the blocks that read it update: Svelte re-evaluates the `{#if}` condition, and if the same branch still holds it keeps the branch and updates the props. The viewer in it stays mounted with its focus and its own state. Only a change of branch (text to image) unmounts one viewer and mounts the other.

That's what makes the frame-and-stage layout above work, and it has a flip side. Switching between two cached items of the same kind goes from `ready` to `ready` and keeps the component. Anything that has to start over per item, such as a scroll position or an animation, needs a `{#key item.id}` around it.

## A write is a mutation owned by a view model

The options factory for a write holds only a `mutationFn`:

```ts
function archiveCardMutation(cards: Pick<CardWrites, 'archiveCard'>) {
  return mutationOptions({
    mutationFn: (id: CardId) => cards.archiveCard(id),
  });
}
```

Everything that depends on where the write is used goes on the owner: `onMutate` for an optimistic cache edit, `onSuccess` and `onError` for notices, `onSettled` for invalidation and callbacks into another domain. The order TanStack runs them in is on [the order of a mutation's callbacks](/svelte/svelte-query/#the-order-of-a-mutations-callbacks).

In React the owner is usually a write data component that passes its children a described action. In Svelte I make it a write view model: a class in a `.svelte.ts` file that builds the mutation through `writeQuery` and exposes getters for what the markup needs, such as whether an upload is busy or which item is being removed. A class's getters already reach markup, because markup that reads `view.busy` updates when the `$state` behind it changes, so a separate write component would add a layer and nothing else. The getters are derived from one stored state union per writer, so a combination that means nothing (removing one item while editing another, say) can't be stored. The rest of what a view model may hold is on [view models hold runes in a `.svelte.ts` file](/architecture/sveltekit/#view-models-hold-runes-in-a-sveltets-file).

## Svelte 5 and React, mechanism by mechanism

| Concern | React | Svelte 5 |
| --- | --- | --- |
| Pass children the value | render prop `children: (value) => ReactNode` | `children: Snippet<[T]>`, `{@render children(value)}` |
| Exhaustive match in markup | `match(state)…exhaustive()` returns JSX | an `{#if}` chain closed with `{:else}{unreachable(state)}` |
| UI state holder | a hook | a class in `.svelte.ts` with `$state`, `$derived` and getters |
| Reactivity out of the holder | return values each render | getters; destructuring takes a snapshot that goes stale |
| Effects in the holder | `useEffect` | `$effect` needs a component owner, or `$effect.root` plus disposal |
| Composing holders | a hook calls hooks and returns parts | a class builds parts in its constructor and exposes them readonly |
| A long-lived object needs query data | rare; usually rendered below the data component | the data component draws nothing and exports `read()`, read through `bind:this` |
| Adapter over the library | `useQuery` and `useMutation` in a hook | `createQuery(() => options)` and `createMutation(() => options)`, both taking accessors |
| Provide the client | `<QueryClientProvider>` | `<QueryClientProvider>` in the root layout |

## A file map to start from

| File | Job |
| --- | --- |
| `container.ts` | builds the adapters once and exposes use cases in groups |
| `query-client.ts` | the cache's global policy (`retry`, `gcTime`, refetch triggers, `networkMode`) |
| `<domain>/queries/<domain>-keys.ts` | `all()` and the keys that extend it |
| `<domain>/queries/<domain>-queries.ts` | query and mutation option factories, each query with its `staleTime` |
| `<domain>/ui/<Thing>Data.svelte` | owns one read, draws its lifecycle, passes children the value |
| `<domain>/ui/<thing>.svelte.ts` | a view model: UI state, a write, or a live resource; never a read |
| `<domain>/ui/<thing>.ts` | pure flatteners, labels and projections, unit-tested |
| `shared/read-query`, `write-query`, `read-state`, `write-state`, `unreachable` | the two adapters, their unions and mappings, and the exhaustiveness helper |
| routes | nest data components, pass snippets and callbacks, wire cross-domain refresh |

How each of these gets tested, given that a Node unit project compiles Svelte for the server and runs no `$effect`, is on [testing svelte-query code with Vitest](/testing/svelte-query-specs/).
