---
title: Narrow Capabilities Instead of One Repository
description: One port per need, the full set kept for the composition root and the adapter, a repository against a manager, absence at a port, filtering in the store, query languages and their dialects, and projections.
tags: [architecture, typescript, storage]
sidebar:
  order: 7
---

A port is the interface a domain declares for something it needs from outside, like storage ([ports and adapters](/architecture/ports-and-adapters/#ports-are-named-for-the-need-adapters-for-the-mechanism)). This page is about how wide a port should be. The usual answer is one repository per aggregate, holding every storage operation for it. The other answer is a set of narrow ports, one per need, that I call capabilities. Both work, and they cost different things. The examples use the [card catalog](/architecture/overview/#the-running-example). [Riftcards](/projects/riftcards/architecture/capabilities-and-composition/) is the real case of the narrow version, and [the reader](/projects/reader/architecture/wiring/) of the repository version.

## One interface per need

The cards domain stores cards, and over time it needs to read one card, page through cards that match a search, count the matches, and save a card. The repository version puts all of that in one port:

```ts
interface CardRepository {
  get(id: CardId): Promise<Card | null>;
  getPage(criteria: CardListCriteria, options?: ReadOptions): Promise<Page<Card>>;
  count(criteria: CardListCriteria, options?: ReadOptions): Promise<number>;
  save(card: Card): Promise<void>;
}
```

A use case that lists cards takes a `CardRepository`, even though it only calls `getPage`. Its test needs a fake, and the fake has to provide all four methods, three of which the code under test never calls. The type also declares that the use case depends on saving, which it doesn't. That's the coupling the one-port version hides: every consumer depends on every method.

The capability version splits the port by need and names each piece for what it provides:

```ts
interface CardFinder {
  get(id: CardId): Promise<Card | null>;
}

interface CardLister {
  getPage(criteria?: CardListCriteria, options?: ReadOptions): Promise<Page<Card>>;
}

interface CardCounter {
  count(criteria?: CardListCriteria, options?: ReadOptions): Promise<number>;
}
```

The listing use case now takes `CardLister` alone, and its fake has one method. Two needs are two capabilities, even when they return the same page type, so I don't widen a capability because a second operation happens to fit its signature. A narrow port also protects its fakes when the store grows: adding a method to the full set touches no fake of `CardLister`, where widening a type that fakes implement in full breaks every one of them, and only the type check reports it (see [widening a composition-root type](/testing/fakes-and-async/#widening-a-composition-root-type-breaks-every-hand-written-fake-and-only-the-type-check-reports-it)).

The trade-off is files and names. A small, stable store split into five interfaces can feel like ceremony, and the goal isn't the largest number of interfaces. I split a port when the split makes a use case clearer or protects a boundary that matters. A single repository port is fewer names to learn and reads as "the cards store", which is why the reader keeps one per domain.

## The whole set is for the composition root and the adapter

The narrow capabilities still describe one store, and something has to name all of them together. That's the aggregate interface:

```ts
interface CardRepository extends CardFinder, CardLister, CardCounter, CardSaver {}
```

The adapter implements it, because one IndexedDB adapter (or one SQLite adapter) really does provide every operation on the store. And the [composition root](/architecture/dependency-injection/#the-composition-root-builds-everything-once) holds it, because that's where the adapter gets built. When a consumer takes a `CardLister`, the composition root passes it the whole repository, and TypeScript's structural typing accepts it with no cast.

The aggregate interface is not the type a use case takes. If it were, every use case would be back to depending on every method.

What happens between the composition root and the use case is the second choice:

- **The composition root exposes use cases only.** It builds each use case's deps from the capabilities and hands the UI the finished functions, so no screen ever holds a port. The compiler enforces that: there's nothing else to reach. That's the layout on [the container exposes use cases](/architecture/dependency-injection/#the-container-exposes-use-cases-never-a-port), and [the reader](/projects/reader/architecture/wiring/) uses it.
- **The composition root provides capabilities, and the code that calls a use case builds its deps at the call site.** A screen's data loader receives `CardLister` as a prop and passes `{ cardLister }` into the use case. Less wiring in one central file, and a loader's props say exactly which capabilities it touches. The cost is that "call a use case, never a port" is a convention: nothing stops the loader calling `cardLister.getPage` directly. [Riftcards](/projects/riftcards/architecture/capabilities-and-composition/) uses this one.

## A repository and a manager are two types even when they match

Notes in the card catalog have a finder, a lister, a saver and a remover. The adapter implements `NoteRepository`, the full set. Now a screen of notes needs to read notes and also write them: it needs all four capabilities. Taking four separate props is clumsy, and taking `NoteRepository` looks like exactly the mistake from the section above.

So I write a second type, `NoteManager`: the set a consumer needs to manage notes. Today it composes the same four capabilities as the repository. The two are structurally identical, and the composition root passes the repository wherever a parameter's type is the manager, with no cast.

They're still two types because they describe different things.

- A **repository** is the store's full set of operations for an aggregate, the thing the adapter implements. It may grow: a count, a bulk write, a scope, whatever the store adds.
- A **manager** is what a consumer needs to manage one thing. I don't expect it to grow with the store.

The day the repository grows a method no screen needs, the two part company, and every consumer keeps the smaller type without being touched. Without the second type, someone reads the code, sees two identical interfaces, deletes the manager as redundant, and points the screen at the repository. Nothing breaks until the repository grows, and then the screen depends on operations it never uses, with its fakes broken for no reason.

A manager is still not the default. A screen that only reads takes `NoteLister`, and a use case takes only the capabilities it calls. I write a manager alongside its first consumer that really needs the whole set, not ahead of one.

Under the one-repository layout, this distinction doesn't arise: the repository port is what consumers take, and "repository" names the collection-style port itself (see [how ports are named](/architecture/ports-and-adapters/#ports-are-named-for-the-need-adapters-for-the-mechanism)).

## Absence at a port is a fact; at a use case it is a variant

`CardFinder.get(id)` returns `Promise<Card | null>`. That looks like it breaks a rule about never using `null` for an outcome, and it doesn't.

At the port, "no card with this id" is a single fact about the store. There's nothing else it could mean, so `null` represents it completely. The use case above the port is where it becomes an outcome the app has to handle. `findCard` turns the `null` into a named variant beside `success`:

```ts
type FindCardResult =
  | { readonly type: 'success'; readonly card: Card }
  | { readonly type: 'notFound' };
```

A caller then matches on the variants, and a new one fails to compile everywhere it isn't handled. A store that can't be read at all isn't a variant here: that's an unexpected failure, and it throws. That's the named-union style [riftcards](/projects/riftcards/architecture/use-cases-and-failure/) uses. The other style is a generic `Result<T, E>` checked through an `ok` flag, where the port itself already answers with a `Result`, the way the reader's ports do. The trade-offs between the two are on [expected and unexpected failure](/architecture/expected-and-unexpected-failure/#an-expected-failure-is-a-named-variant-of-the-return-type).

## Filter, sort, page and count in the store

The browsing screen shows cards 30 at a time, with a total count and a next-page button. Now a filter is added: only cards with art. The quick way is to fetch a page and call `.filter()` on it in application code.

Then the store returns 30 cards, the filter keeps 12, and the screen shows 12 cards. The count still says 30, because the count was never filtered. The next page starts at card 31, so whatever matching cards the filter would have matched further down are skipped. Nothing throws. The screen is just wrong.

A worse version: a `limit` is applied first and the in-memory filter second. The pool of candidates silently shrinks to whatever survived the limit. A list that looked small stops being small without warning, and the failure is invisible rather than slow.

So a query that needs a narrower set extends the criteria type and the adapter, and the store does the filtering, sorting, paging and counting. The store is also the layer that can index for the query, which application code can't.

A rule this strict needs its exceptions named, or each one becomes a precedent for the next. When one is justified, write it down with its reasons, and say that it licenses nothing else. Riftcards has exactly one: searching its core rules document, which it loads whole on purpose and scans in JavaScript because highlighting needs the offset of each occurrence, and because SQLite's `LIKE` only folds case for ASCII, so counting in SQL as well would give a second answer that disagrees ([searching the core rules](/projects/riftcards/rules-and-notes/rules-search/)).

## The query language belongs to the owner, the dialects to the callers

`CardListCriteria` is the language for querying the cards store: filters, search text, sort, paging. It belongs to `cards`, because it describes cards.

Two callers can build that same type in different ways. The browsing screen lets someone tick tags and shows cards with any of them. A collection builder might offer only cards whose tags all fall within the collection's chosen tags. Both need a tag filter, and they need different set semantics, so the criteria type holds each one separately:

```ts
interface CardListCriteria {
  readonly anyTags?: readonly TagId[];    // any of these
  readonly tags?: readonly TagId[];       // all of these
  readonly withinTags?: readonly TagId[]; // no tag outside these
  // search, sort, paging …
}
```

Each caller also has its own defaults: a different default sort, a different page size. Those ways of building criteria are the callers' dialects, and they live with the callers.

The tempting cleanup is to merge the two builders because they produce the same type. That's the mistake: the shared type is the language, and the builders express different things in it. Merged, one caller's semantics changes the other's results without anyone noticing.

## A projection is its own type with its own capability

The browsing grid pages through thousands of cards and draws a thumbnail, a title and a kind for each. A full `Card` has far more than that. Ways to give the grid less:

- **An option flag on the full lister**, like `getPage(criteria, { summary: true })`. The method now returns two types depending on a flag, and every fake and every caller has to handle both.
- **The full type with fields omitted**, like `Omit<Card, 'text' | 'history'>`. The grid's type stays tied to the full model, so every field added to `Card` ends up in the grid's contract unless someone remembers to omit it.
- **A projection of its own**, `CardSummary`, with its own capability, `CardSummaryLister`.

I use the third. `CardSummary` holds exactly what the grid draws, the adapter writes a query that reads only those columns, and the grid's contract changes only when the grid does. The full lister stays the full lister.
