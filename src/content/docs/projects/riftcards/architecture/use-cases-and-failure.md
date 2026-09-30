---
title: Use Cases, Results and Failure in Riftcards
description: "`createDeck` as the model use case, the result unions, what throws and where it lands, parse vs safeParse, and the two channels."
tags: [riftcards, architecture, error-handling, typescript, tanstack-query]
sidebar:
  order: 15
---

In riftcards a use case is one application operation in a feature's `use-cases/` folder, like creating a deck or finding a card. It takes the capabilities it needs as a parameter object and returns a named union of its outcomes. This page shows what that looks like, and how the app sorts [expected and unexpected failure](/architecture/expected-and-unexpected-failure/): which failures are variants, which ones throw, and where the thrown ones land. The one-operation-per-file layout is the general one from [dependency injection](/architecture/dependency-injection/#use-cases-has-one-operation-per-file).

## `createDeck`, the model use case

Creating a deck takes a name. The name can be empty, or it can match a deck that already exists, and the screen has to show the person which. Otherwise a new deck is saved. `features/deck/deck/use-cases/create-deck.ts`:

```ts
type CreateDeckResult =
  | { readonly type: "success"; readonly deck: Deck }
  | { readonly type: "nameMissing" }
  | { readonly type: "nameTaken" };

interface CreateDeckCapabilities {
  readonly clock: Clock;
  readonly deckLister: DeckLister;
  readonly deckSaver: DeckSaver;
  readonly idGenerator: IdGenerator;
}

async function createDeck(
  name: string,
  { clock, deckLister, deckSaver, idGenerator }: CreateDeckCapabilities,
): Promise<CreateDeckResult> {
  const parsedName = deckNameSchema.safeParse(name);
  if (!parsedName.success) return { type: "nameMissing" };
  if (isDeckNameTaken(parsedName.data, await deckLister.getAll(), null)) {
    return { type: "nameTaken" };
  }
  // …
}
```

The rest builds the deck with `parseDeck`, stamps it with `clock.now()` and `idGenerator.next()`, saves it through `deckSaver`, and returns `success`.

Every use case does the same four things:

1. **Capabilities arrive as a parameter object.** Nothing is imported from infrastructure and nothing is constructed inside, which is what lets a test pass a fake clock. The capabilities themselves are on [capabilities, adapters and the composition root](/projects/riftcards/architecture/capabilities-and-composition/).
2. **The result is a discriminated union** named for what each outcome means: `nameTaken`, not `error`.
3. **Time and ids come from ports.** A use case never calls `Date.now()` or `Math.random()`, so its tests are deterministic.
4. **The rule lives elsewhere.** `isDeckNameTaken` is a domain function, shared by three use cases.

## A thin use case is still worth keeping

`findCard` holds no rule of its own:

```ts
type FindCardResult =
  | { readonly type: "success"; readonly card: Card }
  | { readonly type: "notFound" };

async function findCard(
  printingId: PrintingId,
  { cardFinder }: FindCardCapabilities,
  options?: ReadOptions,
): Promise<FindCardResult> {
  const card = await cardFinder.get(printingId, options);
  return card ? { type: "success", card } : { type: "notFound" };
}
```

I keep it anyway. It gives the screen an application name for the operation instead of a storage one, and it's where orchestration goes later. It also shows where absence changes its type: `CardFinder.get` returns `Card | null`, because at the port absence is a single fact, and the use case turns it into the `notFound` variant.

What I don't do is the opposite: a use case for every repository method. A use case names a real operation, not a CRUD verb.

## The result unions

Of the [two ways to put a failure in the return type](/architecture/expected-and-unexpected-failure/#a-generic-result-or-a-named-union-per-use-case), riftcards uses a named union per use case, with a `type` discriminant (see [closed unions](/typescript/closed-unions/#a-closed-set-is-a-readonly-discriminated-union)). There's no generic `Result<T, E>` with an `ok` flag, and no `T | null` from a use case.

Some of the unions:

| Use case | Returns |
| --- | --- |
| `createDeck` | `success`, `nameMissing`, `nameTaken` |
| `saveDeck` | `success`, `nameMissing`, `nameTaken`, `copyLimitExceeded` (with its violations) |
| `findCard` | `success`, `notFound` |

`verifyDeck`, the domain's legality check, follows the same idea: it returns `legal` or `illegal`, and `illegal` carries typed violations rather than a boolean and a message. That's on [deck legality](/projects/riftcards/decks/legality/).

Why a named union and not the generic one: a failure outcome is a closed set of meaningful alternatives, and a closed set here is always a readonly discriminated union. Each union lists its outcomes as peers, and the success variant names what it holds (`deck`, `card`), so one exhaustive match covers the whole answer.

The word for these types is `Result`: `FindCardResult`, `SaveDeckResult`. The glossary bans a second word for it in type names, so there's no `Outcome` or `Response` type.

## Why use cases return unions instead of throwing

A caller can act on some failures and not on others.

`nameTaken` is a fact about what the person typed. The screen has to show it, so it's in the return type, and `ts-pattern`'s `.exhaustive()` makes every caller handle it:

```ts
match(result)
  .with({ type: "success" }, …)
  .with({ type: "nameTaken" }, …)
  .exhaustive();
```

A deck entry whose printing the catalog doesn't hold is a different kind of failure. It's a violated invariant, and no caller can do anything useful about it. So it throws a plain `Error`, which is caught at a boundary.

The test is exactly that: can the caller do something meaningful with this? If yes, a variant. If no, throw.

I rejected both extremes. A result type for everything turns unrecoverable states into ones every call site has a branch for, usually one that rethrows. Throwing everything loses exhaustiveness at the places it helps most.

## What throws, and where it's caught

These are the things in riftcards that throw on purpose, because each means an assumption was broken:

- `useAppDependencies` throws when its provider is missing. That's a wiring bug.
- `SqliteCardRepository` throws when a printing has no media row, which the schema guarantees.
- `findResolvedDeck` throws on a deck entry that can't be resolved against the catalog. The foreign keys make that impossible, so if it happens, the data is corrupt.
- `assertValid` in the seed pipeline throws on every seed invariant, because a bad seed is a pipeline bug (see [the seed pipeline](/projects/riftcards/persistence/seed-pipeline/)).

A thrown error is caught at one of two kinds of boundary:

- **Startup.** `AppDependenciesProvider` opens the database and builds the dependencies. Its state is `opening | failed | ready`, so a failure while opening is caught once, logged, and drawn as a failure screen.
- **One query.** A data component's lifecycle union is the boundary for its read. A thrown error rejects the query, React Query's rejection channel carries it, and the data component draws its `failed` state. How that works is on [data components in riftcards](/projects/riftcards/presentation/data-components/).

Only one place catches in between. `openAppDataStore` catches migration and seeding failures to name which step failed, and rethrows with the original error as the `cause`. That's catching to add context, the one kind of catch-and-rethrow worth writing.

## Parse and safeParse

Riftcards validates with Zod, and Zod has both kinds of parse. Which one a call uses follows from whether invalid data is expected there.

`safeParse` is for input a person gave, where invalid data is a normal outcome:

- the deck name in `createDeck`, `renameDeck` and `saveDeck`, which becomes `nameMissing`,
- a note's body in `writeNote`,
- a deck id taken from a route parameter, in `linked-deck.ts`,
- the raw card feed in the seed pipeline, where a payload that doesn't match falls back to the flat format.

`parse` is for data the domain or the database already guarantees: `parseDeck`, `parseDeckVerification`, and the `*SelectSchema.parse` call in every mapper in `infrastructure/sqlite/`. A stored row that fails to parse is corrupt data, not a caller's outcome, so it throws. The mappers are covered on [SQLite, Drizzle and the migrations](/projects/riftcards/persistence/sqlite-and-drizzle/).

The failure mode to watch for is a brand reached by a cast. `CardId` and `PrintingId` are branded, and a route hands over a bare string. A cast type-checks and lets that string into trusted state unvalidated. So a route parameter is parsed where it arrives. The brands are on [identities](/projects/riftcards/cards/identities/).

## Two channels

A read in riftcards runs through React Query, and a query's promise has two channels: it resolves or it rejects. The use cases put `notFound` on the resolving channel, beside `success`, because "no card has this id" is an answer. Only an unexpected failure rejects.

`useReadState`, the hook the read data components are built on, turns a query into one flat union:

```ts
type ReadState<Result> =
  | { readonly type: "loading" }
  | { readonly type: "failed"; readonly error: unknown }
  | Result;
```

`Result` is the use case's own union, spread in as peers. So a card detail screen's data component matches `loading`, `failed`, `success` and `notFound` side by side, and no failure ever sits inside a success.

Putting `notFound` on the rejection channel would collide with React Query's retry and cache defaults, which all act on rejections; they're listed on [an expected outcome resolves](/react/render-props-and-tanstack-query/#an-expected-outcome-resolves-because-tanstack-querys-retry-and-cache-act-on-rejections). Riftcards' query client sets `retry: 0` today, but the day a retry is turned on for a flaky source, a rejected `notFound` would be asked again and again before the screen could say "not found", and a missing card would be looked up again every time the screen opened.

## Business failure and execution state

A use case never owns `loading`, `saving` or `refreshing`. Those describe the UI, not the operation, so they belong to the data component that runs the use case. The use case's union holds only the expected failures, and an unexpected one keeps throwing past it.

The data component's own union combines the two, as the `ReadState` above does. The general version of this split is [who owns what](/architecture/data-components/#use-case-data-component-presentation-who-owns-what).
