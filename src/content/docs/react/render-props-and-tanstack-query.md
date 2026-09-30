---
title: "Data Components in React: Render Props over TanStack Query"
description: "The render prop as React's slot, query options and key factories, passing TanStack Query's AbortSignal to the port, one flat union per query, and why expected outcomes resolve."
tags: [react, tanstack-query, components, error-handling]
sidebar:
  order: 2
---

A [data component](/architecture/data-components/) owns one read or one write: it runs the request, draws the loading and failure states, and hands its children resolved data. That page describes the pattern without a framework. This one is the React and TanStack Query mechanics behind it. The real components, from a React Native app, are on [data components in riftcards](/projects/riftcards/presentation/data-components/).

## A render prop is the React slot

A data component needs a way to pass its children data that hasn't loaded yet. In React that's a render prop: `children` is a function, and the data component calls it with the resolved data.

```tsx
function DecksData({ children, deckLister }: DecksDataProps) {
  const { reload, state } = useReadState(listDecksQuery({ deckLister }));

  return match(state)
    .with({ type: "loading" }, () => <LoadingState />)
    .with({ type: "failed" }, () => <ErrorState … />)
    .with({ type: "success" }, ({ decks }) => children({ decks, reload }))
    .exhaustive();
}
```

The function is called only on the resolved branch, with the data and any named callbacks (here `reload`). The caller writes `<DecksData …>{({ decks }) => <DeckListScreen decks={decks} />}</DecksData>`, and the screen never receives a loading flag or an error.

A slot can also be filled from outside. A `ReactNode` prop takes a finished element, for a slot that the route fills with another feature's UI. And a function prop such as `bookmarkFor: (id) => ReactNode` takes one element per row, for a list where a single node can't serve every row. Which side of a pair declares the slot is on [naming or slotting](/architecture/placing-a-concept/#naming-or-slotting-which-side-of-a-pair-holds-the-edge). Svelte's counterpart is [a snippet prop](/svelte/state-and-props/#a-snippet-prop-is-the-svelte-5-slot).

## A hook at the query boundary passes its lifecycle to every caller

The usual React approach is a hook, `useDecks()`, that returns `{ data, isLoading, error }`. Every screen that calls it gets that triple and has to define what it draws while loading, what it draws on failure, and when it retries. Every screen becomes an async orchestrator. With a data component, the screen takes the resolved list and nothing else.

Hooks stay right for mechanics: a debounced value, a sheet's draft, a workflow's steps. The line is which part owns the side effect, as in [hooks for mechanics, data components for side effects](/architecture/data-components/#hooks-for-mechanics-data-components-for-side-effects).

The trade-off is real. Render props nest, one inside another when a screen needs two reads, and they're less convenient than a hook when many consumers need the same query state.

## A query options factory holds the key, the query function and the stale time

TanStack Query's [`queryOptions`](https://tanstack.com/query/latest/docs/framework/react/guides/query-options) helper bundles a query's settings into one object that `useQuery`, `useSuspenseQuery` and the query client all accept. I wrap it in a function per read:

```ts
function listDecksQuery(capabilities: ListDecksCapabilities) {
  return queryOptions({
    queryKey: deckKeys.list(),
    queryFn: ({ signal }) => listDecks(capabilities, { signal }),
    staleTime: DECK_STALE_TIME_MS,
  });
}
```

The factories live in a `queries/` folder beside the feature, not inside its presentation folder, because a query key, a query function and a stale time aren't rendering concerns. The name says what comes back: one item is `get…Query`, many are `list…Query`, and a paged read is `list…PagedQuery`, so someone writing a caller can tell from the name that it needs the paged data component.

## A key factory per concept lets a write invalidate everything about it

Each concept gets one key factory, and every key starts with the same prefix:

```ts
const deckKeys = {
  all: () => ["deck"] as const,
  detail: (deckId: DeckId) => [...deckKeys.all(), "detail", deckId] as const,
  list: () => [...deckKeys.all(), "list"] as const,
};
```

`invalidateQueries` [matches by prefix](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation), so `invalidateQueries({ queryKey: deckKeys.all() })` marks the list and every deck's detail as stale in one call. The write data component owns that call: after a successful save, it invalidates, so the next read of any deck gets the saved version. When the refresh has to follow every outcome, including a refusal the use case returns as data or a throw, the invalidation goes in `onSettled` rather than `onSuccess`: TanStack skips `onSuccess` when the mutation function throws, and runs `onSettled` either way.

## TanStack Query calls the query function with an AbortSignal; pass it to the port

TanStack Query [gives every query function an `AbortSignal`](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation), and aborts it when the query becomes out of date or inactive. So the query function passes it on, `queryFn: ({ signal }) => useCase(caps, { signal })`, and the use case passes it to the port through its read options. No data component creates its own `AbortController`. Why [every request gets a cancellation signal](/architecture/data-components/#every-request-gets-a-cancellation-signal) is on the general page.

## Match one flat union, not TanStack Query's result object

`useQuery` returns an object with `status`, `data`, `error` and a dozen flags. A data component that reads those has to handle every combination that can happen. Instead, a small shared hook turns the query into one union:

```ts
type ReadState<Result> =
  | { readonly type: "loading" }
  | { readonly type: "failed"; readonly error: unknown }
  | Result;
```

`Result` is the use case's own union, spread in as peers, so a detail screen's data component matches `loading`, `failed`, `notFound` and `success` side by side. The match is exhaustive (ts-pattern's `.exhaustive()`), so a new variant fails the type check until it's drawn.

A paged read nests a second lifecycle, `idle | loadingMore | failed`, inside its success variant, because loading more can only exist once something has loaded. A write's hook gives `idle | saving | failed | …Result`. The riftcards hooks are on [the three state hooks](/projects/riftcards/presentation/data-components/#the-three-state-hooks).

## An expected outcome resolves, because TanStack Query's retry and cache act on rejections

A query function's promise has two channels: it resolves or it rejects. An expected outcome such as `notFound` ("no card has this id") is an answer, so it resolves beside `success`. Putting it on the rejection channel collides with three TanStack Query defaults, all of which act on rejections:

- A rejected query is retried three times on the client (the [`retry` default](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)), so the screen can't show "not found" until every retry has also failed.
- A query that rejected on its first fetch holds no data in the cache, only the error.
- `retryOnMount` defaults to `true`, so a query in that error state is fetched again whenever a component mounts it. A missing card would be looked up again every time its screen opened.

A retry predicate could tell the two apart, but only by recovering a classification the union already carried. The general rule is [resolve with an answer, reject only when there is none](/architecture/expected-and-unexpected-failure/#resolve-with-an-answer-reject-only-when-there-is-none). Riftcards turns retries off entirely; that choice is on [two channels](/projects/riftcards/architecture/use-cases-and-failure/#two-channels).
