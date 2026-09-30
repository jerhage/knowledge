---
title: Data Components in Rifty
description: "`DecksData` and its route, the read, paged and write state hooks, the end-to-end data flow, React Query factories, and `DeckSaveData`'s history."
tags: [rifty, react, tanstack-query, ui-patterns, error-handling, components]
sidebar:
  order: 80
---

Rifty, my Riftbound card app, gives every query and every write an owner in the component tree: a [data component](/architecture/data-components/). It's a React component named `<Thing>Data` (`CardsData`, `CardDetailData`, `KeywordsData`, `DeckDetailData`, `SectionPoolData`), it lives in a feature's `presentation/data/` folder, and it passes resolved data to its children through a render prop. In Svelte the same pattern would be a [snippet prop](/svelte/state-and-props/#a-snippet-prop-is-the-svelte-5-slot); in React it's [a render prop](/react/render-props-and-tanstack-query/#a-render-prop-is-the-react-slot). Rifty uses them instead of hooks.

## `DecksData` and its route

The Decks tab lists the saved decks. The Decks tab is built from the route file, which only wires, and `DecksData`, which owns the query.

`features/deck/presentation/data/decks-data.tsx`:

```tsx
function DecksData({ children, deckLister }: DecksDataProps) {
  const { reload, state } = useReadState(listDecksQuery({ deckLister }));

  return match(state)
    .with({ type: "loading" }, () => <LoadingState />)
    .with({ type: "failed" }, () => (
      <ErrorState action={<Button label="Try again" onPress={reload} … />} … />
    ))
    .with({ type: "success" }, ({ decks }) => children({ decks, reload }))
    .exhaustive();
}
```

The children only run on the resolved branch. The children receive `decks` and a `reload` callback. It never receives a loading flag, an error, or the lifecycle union, so it can be written and tested as if the decks always exist.

`DecksData` calls a use case (`listDecks`, through the query factory), never a port directly. The port reaches it as a prop, `deckLister`, and it builds the capabilities object the use case takes where it calls it.

The route file, `app/(tabs)/decks.tsx`, has two functions. `DecksRoute`, its default export, renders the list either alone or in a split layout beside the open deck (see [phone and tablet layout](/projects/rifty/presentation/phone-and-tablet/)). Both arrangements draw `DeckList`, which is where `DecksData` is used. Trimmed:

```tsx
function DeckList({ onOpenDeck }: { readonly onOpenDeck: (deck: Deck) => void }) {
  const { clock, decks } = useAppDependencies();
  const router = useRouter();

  return (
    <DecksData deckLister={decks.deckRepository}>
      {({ decks: savedDecks }) => (
        <DeckListScreen decks={savedDecks} now={clock.now()} onOpenDeck={onOpenDeck} … />
      )}
    </DecksData>
  );
}
```

A route holds no query lifecycle and no business rule, and its only layout branch is between one pane and two. It takes dependencies from the context and passes them to a data component.

## The data flow, end to end

Reading the deck list, from the route down to the database:

```text
app/(tabs)/decks.tsx              route: pulls deckRepository from context
  └─ DecksData                    data component: owns loading / failed / success
       └─ listDecksQuery(…)       query options: key + queryFn + staleTime
            └─ listDecks(caps)    use case: returns { type: "success", decks }
                 └─ DeckLister    capability: the narrow interface
                      └─ SqliteDeckRepository   adapter
                           └─ Drizzle → SQLite
```

A write runs the same path the other way, through `useWriteState` and a React Query mutation. Its data component draws only its children; why is in [why the save boundary draws nothing](#why-the-save-boundary-draws-nothing) below.

## Query factories live beside the feature

The middle row of that tree, `listDecksQuery`, is a query options factory. It lives in `features/deck/queries/`, beside the feature and not inside `presentation/`; why is on [a query options factory holds the key, the query function and the stale time](/react/render-props-and-tanstack-query/#a-query-options-factory-holds-the-key-the-query-function-and-the-stale-time).

`features/deck/queries/deck-queries.ts`, trimmed:

```ts
function listDecksQuery(capabilities: ListDecksCapabilities) {
  return queryOptions({
    queryKey: deckKeys.list(),
    queryFn: ({ signal }) => listDecks(capabilities, { signal }),
    staleTime: DECK_STALE_TIME_MS,
  });
}
```

The factories are named for what they fetch: `listDecksQuery`, `getCardQuery`, `listKeywordsQuery`. Each factory takes the [`AbortSignal` TanStack Query passes to the query function](/react/render-props-and-tanstack-query/#tanstack-query-calls-the-query-function-with-an-abortsignal-pass-it-to-the-port), and the factory passes it on to the use case, which passes it to the capability. That's how [every request gets a cancellation signal](/architecture/data-components/#every-request-gets-a-cancellation-signal) here without a data component making its own controller.

## The three state hooks

The data components don't use React Query's result objects directly. Three shared hooks in `src/hooks/` turn a query or a mutation into one flat union, and a data component matches on that.

`useReadState` for a single read:

```ts
type ReadState<Result> =
  | { readonly type: "loading" }
  | { readonly type: "failed"; readonly error: unknown }
  | Result;
```

`Result` is the use case's own union, spread in beside `loading` and `failed`. So `CardDetailData` matches `loading`, `failed`, `notFound` and `success` as peers. Why `notFound` resolves rather than rejects is on [use cases, results and failure](/projects/rifty/architecture/use-cases-and-failure/#two-channels).

`usePagedReadState` for a paged read, like the card grid. Its success variant holds the loaded items, the total, whether there's more, whether a refresh is running, and a nested paging state of `idle | loadingMore | failed`. That's [nested lifecycles stay nested](/architecture/data-components/#nested-lifecycles-stay-nested): loading more can only exist once something has loaded. The hook also announces a loaded page, or a failed one, to the screen reader.

`useWriteState` for a write:

```ts
type WriteState<Result> =
  | { readonly type: "idle" }
  | { readonly type: "saving" }
  | { readonly type: "failed"; readonly error: unknown }
  | Result;
```

Again, `Result` is the use case's union, so a save's rule failures (`nameTaken`, `copyLimitExceeded`) sit beside `saving` and `failed`.

These hooks are UI mechanics, and they're only called inside data components. That's the line in the next section.

## Why data components and not hooks

Most of the React ecosystem went the other way, with a `useDecks()` hook; I didn't, because [a hook at the query boundary passes its lifecycle to every caller](/react/render-props-and-tanstack-query/#a-hook-at-the-query-boundary-passes-its-lifecycle-to-every-caller). With `DecksData`, the deck list takes `decks: Deck[]` and nothing else.

I still use hooks, for UI mechanics and shared behavior: `useCatalogQuery` (the catalog's search and filter state), `useDeckBuild` (the builder's steps, draft and pool), `useDraftSheet` (a bottom sheet's pending and applied values). The line between the two is side-effect ownership, not preference.

The save shows what happens when that line is crossed. It was first written as a hook, `useDeckSave`, that returned its `state`. That state traveled five components down, into a leaf that matched `idle | saving | failed` to draw the footer. Every component in between passed along a lifecycle it never read. The hook became `DeckSaveData` for exactly that reason.

## The cost: nesting

Data components nest, and that's the cost. The deck builder's route needs the keywords and, when editing, the saved deck, so `app/decks/build.tsx` nests `KeywordsData` and `DeckDetailData`, each a render prop inside the other.

I pay it because the alternative isn't flatter, only arranged differently. With hooks, the lifecycle still exists: it moves into the screen, where it mixes with layout. Three levels of explicit data components beat one level of implicit orchestration.

The other cost is that a data component isn't automatically more reusable than a hook. Its contract, what it passes its children, has to be designed as carefully as any component's props.

## Why the save boundary draws nothing

`DecksData` draws a spinner while it loads. `DeckSaveData`, the write data component for saving a deck, draws nothing of its own: it only calls its children. That looks like an inconsistency, and reading it as one is how the wrong rule gets written down. The real rule has nothing to do with reads against writes: [a data component draws in place of its children only when it has no data for them](/architecture/data-components/#a-boundary-draws-in-place-of-its-children-only-when-it-has-nothing-to-pass-them).

A read holds no data while it's pending or failed, so it can't call `children(data)` and draws the other arms of its match. A write can always call `children(controls)`: its states decorate a control the caller already draws, and never stop the screen from existing.

`DeckSaveData` is the case that made the difference visible. Until 2026-09-16 it drew `BuildFooter`, the builder's save footer, unconditionally. It was a data component with no rendering match at all, holding markup only because the markup needed its state. The rule I wrote down that day: "the only components being rendered should be through the match conditions." Now its save action travels down the render prop as a [described action](/architecture/data-components/#a-write-boundary-passes-down-a-described-action): its label, its availability (`busy` while a save is in flight, `ready` otherwise), the message to show beside it, and the `save` callback. `SectionsPane`, the pane that holds the builder's third step, draws the footer from it.

The shorter rule, "writes draw their children, reads draw their states", gives the same answer for every case the app has today. It goes wrong the moment a case differs, in two directions:

- **A read the screen doesn't depend on should draw its children too.** The core rules screen shows a count of notes on each rule. `SubjectNoteCountsData` computes an empty set of counts for the states it can't resolve, then discards it and draws `LoadingState`. So all 1364 rules go behind a spinner while a count loads. `BookmarkedSubjectsData` wraps the same route the same way. Both are open questions, not settled design. The annotation feature they read from is on [bookmarks, notes and the Saved screen](/projects/rifty/rules-and-notes/bookmarks-and-notes/).
- **A write that gates the screen should match and draw.** A migration on first run owns the screen. Until it finishes there's nothing for the children to be about.

A data component that only forwards isn't an exception. `SectionPoolData`, `ChampionPoolData` and `LegendPoolData` return their children directly, because they delegate to `CardsData`, which owns the match.

What `DeckSaveData` does with the save itself, from the request it receives to the announcement, is on [the deck builder](/projects/rifty/decks/deck-builder/#the-save-a-described-action).
