---
title: Capabilities, Adapters and the Composition Root
description: Card's narrow capabilities, repository against manager, createAppDependencies, the startup boundary, the four application ports, and time as an ISO string.
tags: [riftcards, architecture, typescript, sqlite]
sidebar:
  order: 14
---

Riftcards talks to SQLite, the device clock and its other outside needs through ports, which it calls capabilities: small interfaces a feature declares for one need. SQLite adapters in `src/infrastructure/` implement them, and one function in `src/composition/` builds everything once at startup. The general versions are [narrow capabilities](/architecture/capabilities/) and [the composition root](/architecture/dependency-injection/#the-composition-root-builds-everything-once). This page is what riftcards actually has, and which of the general options it picked.

## Why ports without a server

Riftcards is local-first, with no server. It's reasonable to ask why it needs ports and adapters at all.

Having no server doesn't remove the boundaries. There's still SQLite, a device clock, a random source, an id generator and a bundled catalog, and those are the things that make tests slow, flaky and order-dependent. Take `createDeck`: it stamps a creation time and mints an id. Called against the real clock and a real id generator, a test of it can't assert what the deck's timestamp or id will be.

With ports, `tests/deck/fixtures.ts` supplies `fixedClock(…)` and `sequentialIds()`, and the use case is deterministic. Without them I'd be freezing the system clock in the test runner.

The alternative, calling `Date.now()` and `crypto.randomUUID()` directly, is simpler right up to the first test that asserts on a timestamp. Four ports is a small price. Forty wouldn't be.

## Capabilities, not one repository interface

Riftcards doesn't have repositories in the one-port-per-aggregate sense. A consumer declares the narrowest interface it needs:

```ts
/** Pages through card printings that match catalog-analysis criteria. */
interface CardLister {
  getPage(criteria?: CardListCriteria, options?: ReadOptions): Promise<Page<Card>>;
}
```

`card` declares one such capability per need, each in its own file: `CardFinder`, `CardLister`, `CardCounter`, `CardSummaryLister`, `CardByCardIdFinder`, `CardsByPrintingIdsFinder` and `CardSummariesByPrintingIdsFinder`. `card-repository.ts` composes them:

```ts
/** Product-facing read capability for the local card catalog. */
interface CardRepository
  extends
    CardByCardIdFinder,
    CardCounter,
    CardFinder,
    CardLister,
    CardSummariesByPrintingIdsFinder,
    CardSummaryLister,
    CardsByPrintingIdsFinder {}
```

`SqliteCardRepository` implements the whole thing. A use case takes only what it calls: `listCards` takes a `CardLister` and a `CardCounter`, so its test needs fakes with two methods instead of seven.

The alternative is one fat `CardRepository` that every consumer takes. It reads fine, and it lies about coupling: every consumer then depends on every method, and a test double has to stub things the code under test never calls. The fat version exists here too, but only composition and the adapter use it. That's the option [narrow capabilities](/architecture/capabilities/#one-interface-per-need) lays out against the repository-per-domain layout [the reader](/projects/reader/architecture/wiring/#the-ports-and-their-adapters) uses.

The cost is more files, and a split can feel like ceremony when a store is small and stable. I don't split for the sake of more interfaces. I split a contract when it makes a use case clearer or protects a boundary that matters.

Two capability rules show up on other pages. The store does the filtering, sorting, paging and counting, so a new query extends `CardListCriteria` and the adapter ([browsing the catalog](/projects/riftcards/cards/catalog-browsing/)). And a slimmer read is its own projection with its own capability, like `CardSummary` and `CardSummaryLister`, not an option on the full lister.

## A repository and a manager

`annotation` has `BookmarkRepository` and `BookmarkManager`, and both compose exactly `BookmarkFinder`, `BookmarkLister`, `BookmarkRemover` and `BookmarkSaver`. They're structurally identical today, on purpose, and I settled on 2026-09-16 that neither is redundant.

- A **repository** is what the adapter implements and what composition and the data store expose. It's the store's whole surface for an aggregate, and it may grow: a count, a scope, a bulk write, whatever the store gains.
- A **manager** is the set of methods a consumer calls to manage one thing, named as an agent noun like every other capability in the feature. `BookmarkedSubjectsData` takes `bookmarkManager` because it reads marks and writes them. It isn't expected to grow with the repository, and a screen that only reads still takes a `BookmarkLister` rather than either.

The routes pass `annotations.bookmarkRepository`, which composition built, where a parameter is typed as a manager, and TypeScript accepts it structurally with no cast. The day the repository grows a method no screen needs, the two types diverge and every consumer still takes the smaller one. That's why both are written down before that day: the move this stops is a later reader deciding "these are the same, delete one".

`NoteManager` was written alongside its first consumer, `SubjectNotesData` (renamed `NotesData` the same day), and stands in the same relation to `NoteRepository`. It wasn't invented ahead of that consumer. The general version is [a repository and a manager are two types](/architecture/capabilities/#a-repository-and-a-manager-are-two-types-even-when-they-match).

## `createAppDependencies`

The composition root is one function in `src/composition/dependencies.ts`:

```ts
async function createAppDependencies(): Promise<AppDependencies> {
  const logger = new ConsoleLogger();
  const store = await openAppDataStore(logger, cardImageBaseUrl());
  return {
    cards: {
      cardRepository: withQueryLogging(store.reference.cards, logger, "CardRepository"),
      keywordLister: withQueryLogging(store.reference.keywords, logger, "KeywordLister"),
    },
    clock: new SystemClock(),
    idGenerator: new CryptoIdGenerator(),
    // …
  };
}
```

It's the only file that names concrete infrastructure. `AppDependencies` has one group per feature that persists something (`annotations`, `cards`, `decks`, `rules`, `sets`), each holding that feature's repositories (the `cards` group also holds the `KeywordLister`), plus the application ports `clock`, `idGenerator` and `randomSource`. Each repository is wrapped in `withQueryLogging`, which logs its queries under the name given.

Adapters are named for the store they cross to, not the library inside: `SqliteCardRepository`, never `DrizzleCardRepository`, so replacing Drizzle renames nothing ([ports are named for the need](/architecture/ports-and-adapters/#ports-are-named-for-the-need-adapters-for-the-mechanism)).

`cardImageBaseUrl()` comes from `composition/card-image-host.ts`. During development, card images are served over the local network by a small HTTP server (`npm run serve:images`, port 8787). That file builds the server's URL: the host comes from `EXPO_PUBLIC_CARD_IMAGE_HOST` when it's set, otherwise from the Expo host URI, otherwise `localhost`, and the port comes from `EXPO_PUBLIC_CARD_IMAGE_PORT`, defaulting to 8787. The host reaches the adapters as a parameter, which is how the one cycle between infrastructure and composition was fixed ([extracting analysis](/projects/riftcards/architecture/extracting-analysis/#the-other-cycle-an-adapter-that-imported-composition)).

## The startup boundary

`AppDependenciesProvider` runs `createAppDependencies` once at startup and puts the result in React context. Its state is a union, `opening | failed | ready`. It's also the startup's error boundary: if opening fails, it catches once, logs, and renders the failure instead of the app.

Opening means `openAppDataStore(logger, imageBaseUrl)`. It opens the database, enables foreign keys and WAL, applies migrations, seeds the reference data, and returns the stores. It catches migration and seeding failures only to say which step failed, and rethrows with the original as the `cause`. Catching and rethrowing with nothing added would be noise; naming the step is real context. What each step does is on [SQLite, Drizzle and the migrations](/projects/riftcards/persistence/sqlite-and-drizzle/).

`useAppDependencies()` reads the result in a route. It throws when its provider is missing, because that's a programming error, not something a screen can handle.

## The root provides capabilities, not use cases

The general pages describe two ways to hand things out from the composition root ([the whole set is for the composition root](/architecture/capabilities/#the-whole-set-is-for-the-composition-root-and-the-adapter)). One exposes only use cases, with their deps filled in, so no screen can reach a port and the compiler enforces it. That's [the container exposes use cases](/architecture/dependency-injection/#the-container-exposes-use-cases-never-a-port), and the reader's layout.

Riftcards takes the other. `AppDependencies` holds capabilities, and the code that calls a use case builds its deps at the call site. The route pulls a capability out of context and hands it to a data component:

```tsx
// app/(tabs)/decks.tsx, trimmed
function DeckList({ onOpenDeck }: { readonly onOpenDeck: (deck: Deck) => void }) {
  const { clock, decks } = useAppDependencies();

  return (
    <DecksData deckLister={decks.deckRepository}>
      {({ decks: savedDecks }) => (
        <DeckListScreen decks={savedDecks} now={clock.now()} onOpenDeck={onOpenDeck} /* … */ />
      )}
    </DecksData>
  );
}
```

`DecksData` takes `deckLister` as a prop and calls the `listDecks` use case with it. A data component calls a use case, never a capability directly; capabilities reach it as props, and it assembles the object the use case takes. How that works is on [data components in riftcards](/projects/riftcards/presentation/data-components/).

Why this way: every data component's props list exactly which capabilities it touches, and a test of it passes fakes for only those. Context only delivers dependencies at the UI boundary, and feature code never reaches into it like a service locator: a route reads it, and everything below receives what it uses as a prop or a parameter. Passing dependencies down is more verbose than importing a singleton, and I accept that.

The cost is that "call a use case, never a capability" is a convention here. Nothing in the types stops a data component calling `deckLister.getAll()` directly.

## Why no DI container

Because one function does it. `createAppDependencies` builds everything and returns it. Everything below a route receives what it needs as a prop or a parameter, and no feature file imports `@/infrastructure` or `@/composition`; [`check:deps`](/projects/riftcards/architecture/checking-the-graph/) enforces that.

A container would add registration, lifetimes and resolution errors to replace a return statement. It becomes attractive when wiring is conditional or deep. Riftcards' is neither.

## The four application ports

`src/application/ports/` holds the ports no single feature owns: `Clock`, `IdGenerator`, `RandomSource` and `Logger`. They're what make time, identity, randomness and logging testable. The layer imports no feature, and pure rules never call the platform directly: no `Date.now()`, no `Math.random()`.

Their adapters are in `src/infrastructure/`: `SystemClock`, `CryptoIdGenerator`, `MathRandomSource`, `ConsoleLogger`. Tests use `fixedClock` and `sequentialIds`, and the draw simulation's shuffle takes an injected random function (`shared/shuffle.ts`), so a test can fix the order. The general version is [time, ids and randomness come from ports](/architecture/dependency-injection/#time-ids-and-randomness-come-from-ports).

## Time is an ISO string

`Clock.now()` returns an ISO 8601 `string`, and every timestamp in the model is a string.

`Temporal` is the right type for this. I deferred it on 2026-09-07: it requires a polyfill, and that's weight I don't want to add yet. Comparing and formatting ISO strings is enough for "edited 3 hours ago". I'll revisit it when duration arithmetic shows up.

Until then, no `Date` objects go into the model. A string that only the port ever produces is easier to keep valid than a `Date` that any line of code can construct.

## No server yet

There's no API today. The seed pipeline stands in for one: a set of scripts turns the card API's data into a bundled seed, and the app imports it ([the seed pipeline](/projects/riftcards/persistence/seed-pipeline/)). A remote feed would arrive as another adapter behind the same capabilities, or as a composite local-first repository that coordinates remote data, the local store, sync and offline writes. Where each of those would attach is on [where a server, sync and sign-in would attach](/architecture/seams-for-later/).

That doesn't mean building for sync concerns now. The places they'd plug in exist; I'll write their implementations when the product requirements are real.
