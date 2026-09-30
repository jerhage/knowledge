---
title: Where a Rifty Concept Lives
description: Card and set as peers of catalog, the three ownership tests on real cases, component placement, and annotation naming what it annotates.
tags: [rifty, architecture, components, react-native]
sidebar:
  order: 13
---

These are the placement decisions Rifty, my Riftbound card app, actually made: which feature got a type, a capability, a data component or a component, and why. The rules behind them are on [which domain owns a concept](/architecture/placing-a-concept/). In Rifty the modules are called features, so read "domain" on that page as "feature" here.

## Card and set are peers of catalog

The browsing screen is the `catalog` feature: search, filters, sort and a grid of cards. A catalog contains cards, and a set contains printings, so it's tempting to nest them. The card model used to live in `catalog`, and by the same reasoning sets would have gone in `catalog/set/`.

That produced the wrong graph. `deck` needs `Card` to hold its entries, and `analysis` needs `Card` to measure them, so both had to import `catalog`. Neither browses. Those were edges that described nothing real, from features that have nothing to do with a search screen.

So `features/card` became a peer of `catalog`, not a folder inside it, and `features/set` the same. No feature has to go through a neighbor to reach a card concept. The graph now reads the other way round: `catalog` is a reader of `card` and `set` and owns no model at all. It's 14 files of pure presentation: query criteria, the query hook, the search layout, the grid, the filter sheet. (The sort options started out here too and moved into `card` on 2026-09-13.) [Containment is not ownership](/architecture/placing-a-concept/#containment-is-not-ownership).

## The three tests on real cases

When `card` split out of `catalog`, each type and module had to be placed. I used [three tests](/architecture/placing-a-concept/#three-tests-for-an-owner), in the order below.

**1. Would another feature need this if the candidate owner didn't exist?** `deck` needs `CardDomain` for legality, because which domains a card belongs to is a rule of the game. `analysis` needs `CardSpeed` for a speed mix. Neither needs them because of `catalog`, so the card vocabulary is `card`'s. The same test excludes `SetCode`: a set code is a release concept, so it stayed with `set` even though `card.ts` imports it.

**2. Does it name a type that belongs to only one feature?** `CardImage` takes `{ alternative, contentFit, source, style }`. It names no card type, so it stayed in `components/ui/atoms/` despite its file name. `DomainBar` and `CardArt` name `CardDomain` and card media, so they moved into `features/card/presentation/components/`.

**3. Is this module retrieving the concept, or only coordinating?** `CardsData`, `CardSummariesData`, `CardDetailData` and `KeywordsData` are data components: each owns one read and its loading and failure states. They belong to `card`, whoever calls them, because each reads a card projection through a card capability. `CardSetsData` followed `SetLister` into `features/set/`. `catalog` retrieves nothing of its own, so it owns no repository. `analysis` retrieves nothing at all, and it mustn't become a persistence feature just to hold filters, a sort or a projection.

Corollaries that came up in practice:

- **A matched pair isn't split by consumer.** `CardsData` and `CardSummariesData` differ only in which card projection they page and which card capability they take. Moving one to `catalog` because browsing is its only caller would be the split that needed a justification.
- **Ownership decides placement, not usage count.** When `card` became a feature, all eight of its value objects moved together. Splitting them by call count would have left `card.ts` importing five schemas from `catalog`, the exact edge the move existed to remove.

The same rule places capabilities: the feature that owns the concept declares the capability, and `infrastructure/sqlite/` implements it. `card/card-repository.ts` declares, and `infrastructure/sqlite/sqlite-card-repository.ts` implements.

## Component placement

The rules for where a component goes:

- **A component that imports a feature's types lives with that feature.** `card-art.tsx` and `domain-bar.tsx` are `card`'s.
- **A generic component lives in `components/ui/`, and its props name no type that belongs to only one feature.** `card-image`, `selectable-chip-row` (which takes `{ id, name, color }[]`), `sheet-face`, `chip`.
- **A feature may expose components that render its own types, and may not borrow another feature's.**

The third rule resolves what looks like a collision between the first two, and the next section is about it.

## A feature may expose UI for its own types

The deck detail screen shows analysis panels: `AttributeCurve`, `KeywordMixPanel`, `SpeedMix`, `DrawOddsPanel` and `HandStatsPanel`. Those render analysis's own result types, so they live in `analysis`, and the deck screens import them. That's `deck → analysis`, the legal direction, so they pass.

`card-art` is the counter-case. It used to sit in `components/ui/`, and `deck` imported it from there. It names card media, a type that belongs only to `card`, so it failed the second rule and moved into `card`. `deck` now imports it from `card`, in the legal direction.

`card-grid-item.tsx` renders a `CardSummary`, a card type. It exists for the catalog grid's paging and has one consumer, inside `catalog`, so it stays in `catalog` and imports `CardFace` from `card`. That's also the legal direction.

The general pages lay out [two options](/architecture/placing-a-concept/#a-domain-may-expose-ui-for-its-own-types-never-borrow-anothers) here. The other is to compose cross-feature UI at the route: the deck screen would take `analytics` as a slot, and the route would fill it with the panels, the way [domains meet at the route](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other) and the way [Dokseo, my manga and book reader, composes its screens](/projects/dokseo/architecture/composing-screens/). I considered that as the default and rejected it. It moves the coupling to the route rather than removing it, and a screen's code no longer shows what it renders. I use it only where a dependency is really optional or substitutable, which is the annotation case below. Rifty can make this choice because its feature graph allows any DAG, not only [leaves and non-leaves](/projects/rifty/architecture/feature-graph/#any-dag-not-leaves-and-non-leaves).

## Naming and slotting: annotation

`annotation` holds the person's bookmarks and notes on a card, a core rule or a deck. It needs to show up inside the card detail screen and beside every rule in the core rules document, and those screens belong to `card` and `rules`. Something has to depend on something. I settled which way on 2026-09-16, using the rule from [naming or slotting](/architecture/placing-a-concept/#naming-or-slotting-which-side-of-a-pair-holds-the-edge).

One feature can use another by naming it or by slotting it:

- **Naming.** It imports the other and names its types and capabilities. `deck` names `card`: it holds `Card` values, builds a `CardListCriteria`, calls a card capability. The edge is declared in `scripts/dependency-graph.ts`.
- **Slotting.** It declares a hole and something above it fills the hole. `CardDetailScreen` takes `bookmarkControl: ReactNode` and `notes: ReactNode`, draws them where they belong, and has no reference to what they are. The route fills them. No edge exists.

A slot can only hold UI, never a type. `deck → card` was never a decision, because `deck` needs card types. `card` only needs to place some annotation UI, so there the choice was real, and the choice was whether the edge exists at all.

The feature that would be meaningless without the other is the one that names it. A note is about a card. Delete every annotation and `card` is untouched; delete every card and a note about one means nothing. So `annotation` names `card`, `rules` and `deck`, and those three slot the controls they draw.

From card's side, it slots: a place beside the name and a place under the rules panel, filled by something it has no import of. From annotation's side, it names: it holds `{ kind: "card", id }`, imports `card`, and fetches the card to draw its name beside the note. Nothing passes it the card. That second half is what makes a screen of everything I've written possible, because a feature that can't resolve its own subjects can't list them.

**The subject holds each owner's branded id.** What a bookmark or note is about is a union on `kind`, in `src/features/annotation/value-objects/annotation-subject.ts`:

```text
{ kind: "coreRule"; id: CoreRuleNumber } | { kind: "card"; id: PrintingId } | { kind: "deck"; id: DeckId }
```

It was `{ kind; id: string }` before, which let `{ kind: "card", id: "103.2.a" }` compile. Now each arm holds the id type of the feature that owns that identity, and the union states exactly what may be annotated and with which identifier. This is the first use of the three edges: `AnnotationSubject` imports `printingIdSchema`, `coreRuleNumberSchema` and `deckIdSchema`, and it's the only use of `deck`. The edges into `card` and `rules` also bring in what resolving a subject needs, such as `CardSummary` and the finders the Saved screen looks marks up through. No shared-id leaf was needed, and `PrintingId` stays in `card`.

**A slot can be a function** (see [a render prop is the React slot](/react/render-props-and-tanstack-query/#a-render-prop-is-the-react-slot)). A rule row can't take a node per row; the core rules document has 1364 entries. So `CoreRulesScreen` takes `bookmarkFor` and `notesFor`, one function each, and calls them per row: `bookmarkFor: (number) => ReactNode`.

**The routes fill the slots.** `src/app/cards/[id].tsx`, `src/app/(tabs)/index.tsx` and `src/app/(tabs)/rules.tsx` fill them, at the one layer whose imports may reach every feature.

The cost: reading `card-detail-screen.tsx` alone doesn't reveal that a bookmark appears there. You have to read the route. That's the price of the slot, and the screen with the slot pays it.

The other way to lay this out keeps annotation a leaf that refers to its subjects through ids in a shared kernel, which is what the general pages and Dokseo do. It keeps every edge provably acyclic, but annotation couldn't then resolve its own subjects, and the ids would leave the features that own them. The details of the annotation feature itself, its repositories and the Saved screen's sections, are on [bookmarks and notes](/projects/rifty/rules-and-notes/bookmarks-and-notes/).

## The Saved screen is not a feature

The Saved screen lists what the person has bookmarked and written. It owns no concept: only a title and a summary line of counts. So `SavedScreen` isn't a feature. It lives in `src/components/app-shell/` beside `SplitLayout`, where the standing rule that components import no feature already covers it.

It takes the counts and a `sections` slot of type `ReactNode`, both built at `src/app/(tabs)/saved.tsx`, the one layer whose imports may reach every feature, the same way `CardDetailScreen` takes `bookmarkControl` and `notes`. The sections come from `annotation` (`SavedSectionsData` and `SavedSections`), which resolves the bookmarked cards and core rules itself through card and rules capabilities the route passes it. So showing cards and rules on the Saved screen adds no feature edge to `SavedScreen`.
