---
title: Browsing the Catalog
description: Catalog as pure presentation, CardListCriteria and its callers' dialects, filters against criteria, catalog order, and paging in SQLite.
tags: [rifty, sqlite, react-native, ui-patterns]
sidebar:
  order: 22
---

The catalog is the screen where someone searches, filters and sorts every card in the game and pages through the results in a grid. In Rifty, my Riftbound card app, `catalog` is a feature with no model and no persistence of its own: it reads the card and set features, and every filter, sort and page happens in SQLite. The general rules behind that are [filter, sort, page and count in the store](/architecture/capabilities/#filter-sort-page-and-count-in-the-store) and [the query language belongs to the owner, the dialects to the callers](/architecture/capabilities/#the-query-language-belongs-to-the-owner-the-dialects-to-the-callers).

## Catalog owns no model

A catalog contains cards, so it's tempting to put the card model under it. Rifty doesn't: `features/card` is a peer of `catalog`, not a folder inside it, and so is `set`. If `Card` lived under `catalog`, the deck and analysis features would need edges into catalog to reach a card, and neither of them browses anything. Containment isn't ownership. The full argument is on [where a Rifty concept lives](/projects/rifty/architecture/ownership-and-placement/).

So catalog is a reader of card and set. It's 14 files, all under `features/catalog/presentation/`:

```text
catalog/presentation/           # All of catalog is presentation
  catalog-query-criteria.ts     # CatalogQueryCriteria: CardListCriteria as the UI holds it
  hooks/use-catalog-query.ts    # Query state: applied and draft criteria, search text, sheet
  hooks/use-card-opening.ts     # How a card picked in the grid gets shown
  components/grid/              # card-summary-grid, card-grid-item, card-summary-page-footer
  components/search/            # catalog-search-header, catalog-result-bar, filter-control,
                                #   bookmarked-filter-control
  components/sheet/             # card-catalog-filter-sheet, catalog-filter-face,
                                #   minimum-attribute-input
  screens/catalog-search-screen.tsx
```

The sort vocabulary (`card-sort-options.ts`, the sort control and the sort face) lived here until 2026-09-13. It moved into the card feature, where the deck builder's pools use it too. The bookmarked-only filter arrived on 2026-09-16.

It owns no model, no repository, no port and no use case. That's the goal: an earlier catalog that owned persistence was exactly what I was correcting. A feature is a coherent product behavior, not a table. The catalog browses printings, not cards, because the card adapter always selects printings joined to their cards ([why](/projects/rifty/cards/card-and-printing/#card-is-a-printing-joined-to-its-card)). Browsing by card needs a design pass first.

## `CardListCriteria` is the query language

Every read a screen makes from the card store goes through one type: `CardListCriteria` in `src/features/card/card-list-criteria.ts`. It's the port's query language, and the card feature owns it, because the card feature owns the concept being retrieved. This is all of it:

- `riftboundIds`, `setCodes`, `typeIds`, `supertypeIds`, `rarityIds`
- `domainIds` (the card has all of them), `anyDomainIds` (it has at least one), `withinDomainIds` (every domain the card has is in the given set)
- `tagIds`, `keywordIds`, `championNames`
- `onlyBookmarked` (only printings with a bookmark, added on 2026-09-16)
- `energy`, `might` and `power`, each a `CardNumericFilter` (exact, at least, at most, or between)
- `search`, `sort`, `limit` (at most 100), `offset`

A new kind of query extends this type and the SQLite adapter together. It never becomes a filter over rows already fetched ([why](#why-filter-in-sqlite-when-the-lists-are-small)).

An earlier write-up of this list silently left out five of its eighteen fields, and three of those were exactly what the champion pool is built from. A partial list reads as a closed one, so the list above is complete: nineteen fields, as of the code on 2026-09-17.

## Each caller builds its own dialect

The catalog isn't the only caller. The deck builder shows a pool of candidate cards for each step, and builds its criteria in `poolCriteria`, `legendCriteria` and the champion pool's data component. Those and the catalog's `useCatalogQuery` build `CardListCriteria` differently on purpose:

- the catalog's domain filter is any-of (`anyDomainIds`): show cards from any domain someone ticked;
- the legend picker is all-of (`domainIds`): ticking Calm and Mind selects legends that have both, not either;
- the champion pool is subset-of (`withinDomainIds`): only champions whose every domain is one of the chosen legend's, because a deck pulls from its legend's domains;
- and they sort differently by default: the catalog and the section pools open sorted by name, while the legend and champion pools send no sort and get catalog order.

The three look like one idea written three times, but each encodes a different question. Merging them because they share a type would return the wrong results to one of the callers. The query language is the card feature's; the dialects belong to their callers.

## Filters are not criteria

Separate words keep the two stages apart. **Filters** are what someone has selected in the UI, before any query reaches the store: in the builder, `SectionPoolFilters` is `{ domainIds, keywordIds, typeIds }`. **Criteria** is what goes to the store. A pure function, `poolCriteria`, turns a section's filters, search text and sort into criteria for its pool.

The catalog has no separate filter type. Its state, `CatalogQueryCriteria` in `catalog-query-criteria.ts`, is `CardListCriteria` without `limit` and `offset` and with a required `sort`: the query as the UI holds it, minus the paging that the paged data component owns.

Keeping them apart lets the UI hold whatever's convenient for its controls (a set of ticked chips, a numeric input that's half typed) without that structure leaking into the port.

## Sorting and catalog order

`CardSort` is a discriminated union, not a string: sort by name, energy, might or power, each with a direction, or by `catalogOrder`. When a caller passes `catalogOrder` or sends no sort at all, the store uses **catalog order**: set code, then the collector number cast to an integer, then the collector number as text, then the printing id. The cast puts `9` before `10`; the raw text then orders `119` and `119a`; the id breaks any remaining tie.

Every other sort also ends with catalog order, so two printings with the same energy always come back in the same order. That matters for paging by offset: if ties came back in a different order on each query, a card could appear on two pages or on none.

## Paging in SQLite

The grid loads one page at a time. A page request is the criteria plus `limit` and `offset`, and the adapter turns all of it into one SQL query with `WHERE`, `ORDER BY`, `LIMIT` and `OFFSET`. The count for the result bar comes from a separate capability, `CardCounter`, which runs the same conditions through `count()`. The `listCardSummaries` use case fetches the page and the count together. The data component that runs it for the catalog, `CardSummariesData` in the card feature, takes a `cardCounter` and a `cardSummaryLister` and nothing more. `useCatalogQuery` holds only the query state and never touches the store.

The grid draws a [`CardSummary`](/projects/rifty/cards/card-and-printing/#cardsummary-is-its-own-projection) per printing, not a full `Card`. The options factory that feeds it is `listCardSummariesPagedQuery`: a factory for one item starts with `get`, a factory for many with `list`, and a paged one ends with `PagedQuery`, so the name shows that a caller has to use the paged data component rather than the plain one. How those data components hold the page state is on [data components in Rifty](/projects/rifty/presentation/data-components/).

The page and the count have to match. A printing a later seed dropped can linger on a device with no media row ([why](/projects/rifty/persistence/seed-pipeline/#the-seeder-upserts-and-never-deletes)). The summary query once inner-joined media, so such a printing vanished from the page without an error while `count()` still counted it. Now the query left-joins media and throws the same error the detail path throws. `count()` needs no media join of its own: `card_media.printing_id` is that table's primary key, so the left join can't multiply a row, and the two numbers match.

## Why filter in SQLite when the lists are small

The catalog has 1429 printings, and a deck holds a few dozen cards. It's fair to ask why every filter goes through SQL when JavaScript could narrow a list that size in no time.

Because narrowing a fetched page in JavaScript silently breaks paging and counts. Say the grid fetches a page of 30 and then filters it in JavaScript to the 12 that match. The person sees 12 cards, a result count of 30, and a next page that starts after the 30th row, skipping every match that would have been on this page.

It also stops being small without warning. Real cases:

- A `limit` was once applied before an in-memory filter, which silently cut a 369-card pool down to about 50.
- Resolving a deck's cards by printing id once reused the paged query, and so was capped at 100 ids. A deck with a main deck, runes, battlefields and a sideboard can pass 100, and it resolved short without an error.

The fix for the second was to stop treating it as a page. `CardListCriteria` no longer has `printingIds`. The lookup is its own capability, `CardsByPrintingIdsFinder`, and `SqliteCardRepository.getAllByPrintingIds` resolves the whole list in chunks of 200 ids per statement (`PRINTING_ID_CHUNK_SIZE`), so a deck of any size resolves whole. How 200 was sized against SQLite's limit on bound variables is on [SQLite, Drizzle and the migrations](/projects/rifty/persistence/sqlite-and-drizzle/#the-variable-limit).

The alternative, filtering in JavaScript, is fine exactly until a list grows, and then the failure is invisible rather than slow. So the rule is to extend `CardListCriteria` and the adapter, and never narrow a fetched page in JavaScript. There's one recorded exception, searching the core rules, and it licenses nothing else: [searching the core rules](/projects/rifty/rules-and-notes/rules-search/).
