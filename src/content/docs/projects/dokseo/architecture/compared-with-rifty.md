---
title: Dokseo and Rifty, Side by Side
description: Where each app wires a port to its use case, what a tool or the compiler checks, the read and write adapters, data components, view models against hooks, failure, testing, and refreshing another domain, with the costs of each.
tags: [dokseo, rifty, architecture, tanstack-query, svelte, react]
sidebar:
  order: 17
---

I have two apps built on the same [general architecture](/architecture/overview/). Dokseo, my manga and book reader, is a SvelteKit app that keeps books in the browser's storage. [Rifty](/projects/rifty/), my Riftbound card app, is an Expo app on React Native with a SQLite database. Both read and write through TanStack Query, both give every read to a data component, and both return a named union from every use case. Where they differ, each app's choice has its own cost.

## Where a port meets its use case

A use case needs ports, the interfaces its storage and other outside needs sit behind. Something has to put the two together.

**Rifty.** The composition root builds the ports and provides them through React context. A route takes the ports it needs and passes them to a data component as props, and the query factory calls the use case with them:

```tsx
// src/app/cards/[id].tsx
const { annotations, cards, clock, idGenerator } = useAppDependencies();
<CardDetailData cardFinder={cards.cardRepository} printingId={printingId}>

// src/features/card/presentation/data/card-detail-data.tsx
const { state } = useReadState(getCardQuery(printingId, { cardFinder }));

// src/features/card/queries/card-queries.ts
queryFn: ({ signal }) => findCard(printingId, capabilities, { signal }),
```

`AppDependencies`, in `src/composition/dependencies.ts`, holds repositories, the clock, the id generator and the random source: ports, not use cases. That's on [capabilities and the composition root](/projects/rifty/architecture/capabilities-and-composition/).

**Dokseo.** `container.ts` builds each adapter once, binds it into a deps object per use case, and exposes only the bound use-case functions. The UI never gets a port:

```ts
// src/lib/container.ts
const readBookDeps: ReadBookDeps = { repository };
…
readBook: (id: BookId) => readBook(readBookDeps, id),
```

```svelte
<!-- src/routes/read/[fileId]/+page.svelte -->
<BookData library={container.library} {id}>
```

The query factory takes the domain's use cases through a structural type declared in the queries module (`LibraryReads`), narrowed with `Pick`, so `queries/` never imports the container. That's on [Dokseo's data components](/projects/dokseo/architecture/data-components-and-view-models/).

| | Rifty | Dokseo |
| --- | --- | --- |
| What the composition root provides | ports (capabilities) | use-case functions, bound once |
| Where ports are put together for a use case | where it's called: the query factory or the write's owner | once, in `container.ts` |
| A data component's prop | the ports its use case needs (`cardFinder`) | the domain's use-case group (`library`), narrowed by `Pick` |
| Can the UI call a port | yes, by type; only review stops it | no; `Container` has no port member |

What Rifty's choice gives me: the dependencies of a use case are visible at every call site, a write's owner can pass the clock and id generator its use case takes (`DeckSaveData` builds a new deck's id and creation time from them), and there's no wiring file to keep in step. What it costs: anything that gets `AppDependencies` can call a repository directly, and a data component's prop list grows with its use case's dependencies.

What Dokseo's choice gives me: one file shows what every operation depends on, a component can't reach a port because the type has none, and a data component's props don't change when a use case gains a dependency. What it costs: `container.ts` is 601 lines of wiring, and a new use case touches it in four places (the imports, the type member, the deps object, the binding). The structural `LibraryReads` types repeat each use case's signature once more, and someone reading a data component can't see which ports its read touches without opening the container.

## What the compiler checks, what a tool checks, and what is convention

| Rule | Rifty | Dokseo |
| --- | --- | --- |
| The UI calls use cases, never ports | convention | the compiler: `Container` exposes no port |
| Import direction between features or domains | a tool: `check:deps`, a Deno script with a per-feature allowance list, rules such as "no feature imports infrastructure", and cycle checks at file and zone level | a tool: dependency-cruiser, 14 named rules, among them `domain-ring-is-pure`, `leaf-domains-are-independent`, `non-leaves-import-only-leaves` and `routes-are-thin` |
| Query factories call only what they're given | convention | dependency-cruiser: `queries-call-use-cases-they-are-handed`, `queries-know-no-ui-or-wiring`, `only-ui-reads-queries` |
| Every union matched exhaustively | the compiler: `match().exhaustive()`, in JSX too | the compiler: `match().exhaustive()` in TypeScript, and in markup an `{#if}` chain closed by `unreachable`, which svelte-check narrows to `never` |
| A data component owns its read; nothing else holds one | convention | convention |
| No TanStack type past the adapters | convention; the queries modules, `DeckSaveData`, the annotation hooks, the root layout and two routes import it | convention; the queries modules, the write view models, a few helpers beside them (`refreshLibrary`, `CaptureCache`, `readChosenFootprint`), `ReadSession`, the root layout and two routes import it |

The two scripts are on [`check:deps`](/projects/rifty/architecture/checking-the-graph/) and [Dokseo's dependency-cruiser rules](/projects/dokseo/architecture/dependency-rules/). Both apps leave the data-component rule itself to convention. In Dokseo more of the layering is held by a tool or the compiler, and the cost is a longer rule file and a container that has to be kept in step.

## Ports and adapters

The idea is the same in both: the domain or feature that needs something declares a port named for the need, an adapter is named for how it meets it (`PageSource` and `PdfJsPageSource` in Dokseo, `CardFinder` and a SQLite repository in Rifty), and only the composition root builds adapters. Where the adapters live differs: Dokseo keeps them inside each domain, Rifty in a top-level `infrastructure/` folder. Both views are on [ports and adapters](/architecture/ports-and-adapters/).

The grain differs too. Rifty keeps its ports narrow, one need each (`CardFinder`, `CardLister`, `CardCounter`, `DeckSaver`), and a use case takes only the ones it calls. A Dokseo port is broader: `LibraryRepository` has ten methods (`list`, `get`, `add`, `remove`, `update`, `readSource`, `readCover`, `storedBytes` and two for page lists), and `ReadBookDeps` takes all of it to call `get`.

Narrow ports make a use case's fake one function, and the type says exactly what the use case touches; the cost is more interfaces and more names. Broad ports mean fewer files, one adapter and one name per store; the cost is that a use case's dependency type claims more than it uses, so a fake has to stub the rest or assert its type.

## The read and write adapters

Neither app lets a data component use TanStack's result object directly. One shared adapter turns a query into a union, and another turns a mutation into one.

| | Rifty | Dokseo |
| --- | --- | --- |
| Read adapter | `useReadState(options)` in `src/hooks/use-read-state.ts` | `readQuery(() => options)` in `shared/read-query.svelte.ts` |
| Read union | `loading \| failed{error: unknown}`, plus the use case's union spread flat | `loading \| failed{message} \| ready{value}` |
| Write adapter | `useWriteState(options)`: `state`, `submit`, `reset` | `writeQuery(() => options)`: `state`, `submit`, `run`, `reset` |
| Write union | `idle \| saving \| failed{error}`, plus the use case's union | `idle \| saving \| failed{message} \| done{result}` |
| Mapping | a `match()` inside the hook | the pure `readStateOf` and `writeStateOf`, unit-tested |
| A failed refetch | keeps the data | keeps the data |
| Discriminant | `type` | `kind` |

The main difference is flat against nested. Rifty spreads the use case's union into the read state, so `notFound` sits beside `loading` with no extra code. That works on one condition, which Rifty's notes state: no use case may name a variant `loading`, `idle`, `saving` or `failed`. Dokseo nests the value on `ready`. I chose that when Dokseo's use cases still returned a generic `Result` and some writes returned nothing, so there was no union to spread. Now every use case returns a union on `kind`, so the reason is weaker; it still holds for a factory that resolves a bare value (`storageAccountQuery` resolves the account, not the union). The cost is that a data component whose use case has outcomes besides success needs a pure flattener, such as `bookReadOf` on [use cases and failure](/projects/dokseo/architecture/use-cases-and-failure/).

Rifty's version needs no flattener, and the data component's match lists the use case's outcomes directly. Its costs are the reserved names, and that `failed` holds an `unknown`, so each data component writes its own fixed text and the cause never reaches the screen. Dokseo's adapter works for any value, including a bare one, and `failed` holds a message built once by `failureMessage`, which also logs an unexpected cause. Its costs are a flattener per data component with outcomes to flatten (`bookReadOf`, `shelfState`, `storedCaptures`, `setupState`, `shownStorage`), and a failure logged again every time the state is computed.

`writeQuery` also has `run`, which returns the mutation's promise, because a Dokseo write with steps waits for the result (`BookChanges` offers an Undo toast after a mark). Rifty has no `run`; its owners act in `onSuccess`.

## Data components

The core is the same: one owner per query, named `<Thing>Data`, that starts the read, matches the lifecycle and passes `children` the resolved value. `children` is a render prop in React and a `Snippet<[T]>` prop in Svelte 5. Rifty matches in JSX:

```tsx
// card-detail-data.tsx
return match(state)
  .with({ type: "loading" }, () => <LoadingState />)
  .with({ type: "failed" }, () => <ErrorState message="Could not load this card." />)
  .with({ type: "notFound" }, () => <ErrorState message="Card not found." />)
  .with({ type: "success" }, ({ card }) => children(card))
  .exhaustive();
```

Dokseo matches in an `{#if}` chain closed by `unreachable`. A `match()` would compile in Svelte markup too; I keep it in `$derived` and pure modules so the markup stays short. Dokseo also has three kinds of data component Rifty doesn't need, all on [Dokseo's data components](/projects/dokseo/architecture/data-components-and-view-models/):

- **One that draws nothing and is read through `bind:this`**: `TagPageData` and `LibraryShelfData` on the two tags routes, `BookCapturesData`, `CaptureFindData` and `EngineGateData` on the read route. A view model built in a route's script (`TagView`, `ReadSession`) needs the query's data, and a script can't see a snippet's argument, so the route binds the component and calls its exported `read()`.
- **One that passes a named union** (`ShelfRead`, `BookRead`), because the route draws the loading and failure in another component's frame.
- **One that only draws a state it's given** (`LibraryBooksData`, `CaptureListData`, `ReaderBookData`), where the owner is elsewhere.

Rifty's single kind means every data component reads the same, and the match is one expression with `.exhaustive()`. But it assumes whatever needs the data is rendered below the data component. It offers nothing for a long-lived object that must read a query; Rifty has no such screen, so that's untested there. Dokseo's kinds cover screens where a long-lived view model reads query data. The cost is four kinds instead of one, and `bind:this` plus `read()` is a link I have to trace by hand. The bound instance is also `null` until it mounts, so every closure over it falls back with `?? []` or `?? null`.

## View models and presentation hooks

| | Rifty | Dokseo |
| --- | --- | --- |
| Unit | a hook, `use-<x>.ts` in `presentation/hooks/` | a class in `ui/<thing>.svelte.ts` |
| Holds | UI state (`useDeckDraft`) or a write (`useNoteEditing`) | UI state (`ShelfArrangement`, `TagSelection`), a write with steps (`BookChanges`, `BookUpload`), a live resource (`ReaderView`'s open `PageSource`, `EngineWarmup`'s worker session), or route glue (`ReadSession`) |
| Never holds | a read | a read, a generation counter for a read, a `reload()` |
| Composition | a hook calls smaller hooks and returns them as parts (`useDeckBuild` returns `draft`, `legends`, `pool` and `steps`) | a class builds smaller classes in its constructor and exposes them as readonly parts (`ReaderView` exposes `selection`, `grouping`, `navigation`, `preferences`) |
| Reactivity across the boundary | return values, recomputed every render | getters over `$state` and `$derived`; destructuring takes a snapshot that goes stale |
| Effects | `useEffect` | `$effect`, which needs a component or an `$effect.root` that's disposed |

A Dokseo view model is what Rifty calls a hook. They differ in lifetime: a hook runs again on every render and keeps its state through React, while a Svelte class is built once and keeps its own `$state`. That's why route glue has no Rifty counterpart. `ReadSession`, 237 lines beside the read route, is a long-lived object that joins four domains' parts with SvelteKit's `page`, `goto` and `replaceState`, which reach it as getters and callbacks so it runs in a unit spec. It's on [composing domains at the routes](/projects/dokseo/architecture/composing-screens/).

Hooks compose with no question of who owns what, and there's no `$effect.root` to dispose. They cost the hook rules: call order, and dependency arrays (`DeckSaveData`'s `useCallback` for its save lists six dependencies). A class with getters is plain TypeScript and unit-tests in Node, and a long-lived object suits a reader that holds open resources. It costs getter boilerplate (`ShelfRead` is seven getters and a method), a destructured field that goes stale without any error, and route glue that's a large file: `routes-are-thin` covers it, but the read route's `+page.svelte` alone is 155 lines.

## Writes

Both apps use mutations the same way: a queries module holds a factory with only the `mutationFn`, and the owner adds `onSuccess`, `onError`, `onSettled` and the cache work.

```ts
// Rifty: deck-queries.ts
function saveDeckMutation(capabilities: SaveDeckCapabilities) {
  return mutationOptions({ mutationFn: (draft: DeckDraft) => saveDeck(draft, capabilities) });
}

// Dokseo: library-queries.ts
function removeBookMutation(library: Pick<LibraryWrites, 'removeBook'>) {
  return mutationOptions({ mutationFn: (id: BookId) => library.removeBook(id) });
}
```

The owners differ. Rifty has write data components and write hooks. `DeckSaveData` passes its children a described action (a label, its availability, a message and `save`), which is on [Rifty's data components](/projects/rifty/presentation/data-components/#why-the-save-boundary-draws-nothing); `useNoteEditing` and `useBookmarkToggling` are hooks. In Dokseo a write view model owns every write, and there's no write component, because a class's getters already reach markup:

```ts
// library/ui/book-changes.svelte.ts
this.#removal = writeQuery(() => ({
  ...removeBookMutation(library),
  onSettled: () => refreshLibrary(client),
  onError: (cause) => this.#fail(REMOVE_FAILED, failureMessage(cause)),
}));
```

Every data write in Dokseo is a mutation. The reader's book edits and reading-place saves use their own leaf's factories (`viewing-queries.ts`, `flowing-queries.ts`), because `viewing` and `flowing` may not import `library`. What stays outside mutations isn't a data write: opening a book (a live resource that must be closed) and the OCR worker session.

Rifty's write component passes its children a described action, so a screen composes a write the same way as a read. But a write that several screens share needs a hook anyway. Dokseo has one owner kind for every write, and a write with steps (an upload with progress, a mark with an Undo toast) lives in one class. Its costs: the write's plumbing has no unit spec (see [testing](#testing) below), and `BookChanges` holds its own `BookChange` union beside four write states, so whether it's busy is recorded in two places.

## Use-case results

Both apps return a named union per use case. Rifty discriminates on `type`:

```ts
type SaveDeckResult =
  | { readonly type: "success"; readonly deck: Deck }
  | { readonly type: "nameMissing" }
  | { readonly type: "nameTaken" }
  | { readonly type: "copyLimitExceeded"; readonly violations: readonly DeckLegalityViolation[] };
```

Dokseo discriminates on `kind`:

```ts
type ReadBookResult =
  | { readonly kind: 'success'; readonly book: Book }
  | { readonly kind: 'not-found'; readonly id: BookId }
  | StorageUnavailable;
```

Dokseo returned a generic `Result<T, E>` until I compared the two and decided `Result` was too rigid. A named union lists every outcome once in one flat match. The success names what it holds, and an operation can have several successes: `openFile` returns `added` or `already-held`. A union holds only what that use case can return, not a domain-wide error type. And it's already the flat form a data component needs beside `loading` and `failed`. A port returns a single absence as `null`, and the use case names it. Variants that several domains share live in the kernel (`shared/storage-unavailable.ts`).

Named unions read as the operation's outcomes, and a new variant fails every exhaustive caller until it's handled. They cost a type per use case (Dokseo's `use-cases/` folders hold 46 modules, not counting specs), and a callee's outcomes have to be passed on or mapped. The generic `Result` gave uniformity and one-line propagation (`if (!r.ok) return r`). It cost two levels to match, a success always called `value`, and in Dokseo an `E` that had grown a catch-all `storage-failed{cause}` in every domain. The details are on [Rifty's use cases and failure](/projects/rifty/architecture/use-cases-and-failure/) and [Dokseo's](/projects/dokseo/architecture/use-cases-and-failure/).

## Failure and boundaries

Both apps follow the same rules from [expected and unexpected failure](/architecture/expected-and-unexpected-failure/): an expected failure is a named variant and resolves, an unexpected one throws and rejects to a boundary. Both caches set `retry: 0`, and in neither app does a use case catch a storage failure.

| Boundary | Rifty | Dokseo |
| --- | --- | --- |
| Startup | `AppDependenciesProvider`: `opening \| failed \| ready`, logs with `console.error` | none for the container: `buildContainer()` is synchronous and only builds objects |
| One read | the data component's `failed` branch, with fixed text | the data component's `failed` branch, with `failureMessage`'s text, logged |
| One write | `onError` announces the failure | `onError` shows a danger toast with `failureMessage`'s text |
| A render throw | none: I found no `ErrorBoundary` in `src/` | `<svelte:boundary>` in `routes/+layout.svelte`, which logs and shows "Something went wrong" with "Try again" |
| A stray throw or rejection | none found | `<svelte:window onerror onunhandledrejection>`, which logs and raises one toast; `handleError` in `hooks.client.ts` logs a navigation failure |
| Logging | `withQueryLogging` wraps each repository in `dependencies.ts` | `logUnexpected(site, error)` at each boundary |

Rifty logs at the port, so every store call is logged, including one whose failure is handled. But a render throw has no boundary in its code. Dokseo has boundaries for render, stray and navigation failures. Because the read path logs through `failureMessage`, the same failure can be logged more than once. Dokseo's boundaries are on [use cases and failure](/projects/dokseo/architecture/use-cases-and-failure/#boundaries-and-logging).

## Testing

**Rifty** renders data components in Jest with React Native Testing Library and one shared wrapper, `createTestWrapper` in `tests/test-wrapper.tsx`, which builds a fresh `QueryClient` with `retry: false` and `gcTime: 0`. A spec passes fake ports as props and checks the screen (`tests/card/cards-data.test.tsx`, `tests/deck/deck-save-data.test.tsx`). So the query's plumbing, the match and a write's `onSuccess` all run under test. That's on [how Rifty is checked](/projects/rifty/engineering/checks-and-tests/).

**Dokseo**'s unit project compiles `.svelte.ts` files for the server, and there `readQuery` and `writeQuery` never run, so a data component gets no unit spec. I don't design production code around tests, so I left the architecture as it is and test one layer down:

- `readStateOf` and `writeStateOf`, as pure functions and over TanStack's real observers;
- every query factory, through `observedRead` (`shared/testing/observed-read.ts`), which subscribes the same `QueryObserver` class `createQuery` uses and resolves with the `ReadState` a data component would get, with a plain object for the use cases (`storage-queries.spec.ts`, `library-queries.spec.ts`);
- every pure flattener and format module (`bookReadOf`, `library-shelf.ts`);
- the view models' pure parts and UI state, in Node;
- a screen's markup around a data component, by mocking the read adapter in the spec (`storage-screen.spec.ts`).

Not tested: the few lines of rune glue in each adapter, a data component's `{#if}` chain, and each write owner's `onSuccess`, `onError` and `onSettled`. How the specs work is on [testing svelte-query code with Vitest](/testing/svelte-query-specs/) and [Dokseo's checks and tests](/projects/dokseo/engineering/checks-and-tests/).

Rifty runs the whole owner, invalidation included, in a fast unit test; the cost is that its tests depend on a DOM-like renderer and a wrapper, and a data component's spec also tests TanStack. Dokseo's specs run in plain Node, and the parts with logic are pure functions. The cost: the invalidation a write owner does is reachable only in a browser, so a wrong key in an `onSettled` would pass every check.

## Refreshing another domain

A write in one domain sometimes changes what another domain shows. In Rifty, bookmarking a card changes the card list; in Dokseo, saving the reading place changes the library's shelf.

**Rifty.** The route invalidates the other feature's cache through a callback:

```tsx
// src/app/cards/[id].tsx
<BookmarkedSubjectsData
  …
  onBookmarksChanged={() => void queryClient.invalidateQueries({ queryKey: cardKeys.all() })}
>
```

Rifty's features form a graph with an allowance list, so a feature could also import another feature's keys where the list allows the import (`deck` may import `card`). I searched for one, and no feature imports another feature's `queries/` module.

**Dokseo.** `library`, `viewing`, `flowing` and `recognition` are [leaves](/architecture/domains-and-the-graph/#leaves-and-non-leaves) and import no other domain, so a `viewing` write can't name `libraryKeys`. The write takes a callback, and the route glue implements it with the library's helper:

```ts
// src/routes/read/[fileId]/read-session.svelte.ts
this.reader = new ReaderView(
  container,
  notify,
  (place) => this.mirror(place),
  (book, known) => this.#warm(book, known),
  () => this.#bookChanged(),
);
this.captures = new CaptureView(container, notify, client, listing);
this.flow = new FlowView(container, notify, client, () => this.#bookChanged());
…
#bookChanged(): void {
  void refreshLibrary(this.#client);
}
```

In both apps the domain that owns a write has no reference to the other domains that read the data. Rifty's route needs the query client and the other feature's keys inline. Dokseo's leaf rule makes a cycle between domains impossible, and a tool checks it. The cost is that every refresh across domains is a callback threaded through a view model's constructor, and the route glue grows with each one.
