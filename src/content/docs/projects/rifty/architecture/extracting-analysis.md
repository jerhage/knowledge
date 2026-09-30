---
title: Extracting Analysis Without a Cycle
description: How analysis left the deck feature by changing signatures instead of moving files, and the renames and the extends CardCopy edge that followed.
tags: [rifty, architecture, naming-conventions]
sidebar:
  order: 12
---

`analysis` is the Rifty feature that measures a list of cards: energy curves, speed and keyword mixes, draw odds. It started life inside the deck feature and was extracted into its own. A plain move would have made a cycle, a signature change avoided it, some names had to change with it, and one legal edge still turned out wrong. The general rules are [break a cycle by inverting an input](/architecture/domains-and-the-graph/#break-a-cycle-by-inverting-an-input-not-by-moving-a-file) and [calls may cross an edge; vocabulary may not enter the model](/architecture/placing-a-concept/#calls-may-cross-an-edge-vocabulary-may-not-enter-the-model).

## Moving the files would have made a cycle

The deck detail screen shows panels about the deck: how its cards spread across energy costs, how its speeds mix, the odds of drawing a given card. The code behind those panels grew up in `deck`, and it read a `Deck` to get at the cards.

Moving those files into a new `analysis` feature, unchanged, would have produced two imports pointing at each other. Analysis would import `deck` to read a deck's contents. The deck detail screen would import `analysis` to draw the panels. Each feature would import the other, and a cycle means neither can be read, tested or changed on its own, which is the whole benefit the extraction was meant to buy.

## Changing the signatures instead

So the extraction changed what analysis takes. Every measurement takes `readonly CardCopy[]`, a list of `{ card, quantity }` pairs, instead of a deck.

That moves one decision to the caller. The deck screen's code selects which sections of the deck are in scope, reduces them to card copies, and passes those in. At the time, one panel was about a single card, the odds of drawing your champion, and the caller passed that `Card` in as the pinned card rather than naming a champion. (That panel was dropped on 2026-09-14; the draw odds now cover the whole pool.) Nothing in a curve or a speed mix ever needed to reference sections, legality or champions.

The dependency is now gone rather than relocated: `analysis` imports only `card`, and `deck` imports `analysis`. The rule I take from it: an analytic that has to reference decks is in the wrong feature. Either the caller reduces the deck to a list of cards first, or the measurement belongs in `deck`.

## The renames

The imports were already clean at this point, and some names were still wrong:

| Was | Became | Why |
| --- | --- | --- |
| `ChampionOdds` | `PinnedOdds` (dropped with its panel on 2026-09-14) | analysis has no concept of a champion |
| `deckSize` | `poolSize` | analysis measures a pool of cards, not a deck |
| `benefitsTheDeck` | `benefitsOwnSide` | same reason |

A name that belongs to another feature is the leading indicator of a dependency about to come back. Someone reads `deckSize` in `analysis`, reasonably concludes analysis depends on decks, and imports `Deck` to compute it. `benefitsTheDeck` named a deck inside analysis before any import did. So I rename when the module moves, not later ([a name in the wrong domain comes before the import](/architecture/placing-a-concept/#a-name-in-the-wrong-domain-comes-before-the-import)).

`poolSize` is itself still open. Rifty now has three things called a pool: a printing's pool code (a product pool), the deck builder's list of candidate cards, and the cards the draw simulation draws from. The builder's pool is what you may add, and the simulation's is what you'll draw, so they aren't the same set. The simulation already builds a `library` before shuffling it, so `librarySize` would cost nothing and name the cards you draw from without naming a deck. I haven't decided between that and accepting that "pool" has both senses.

## The `extends CardCopy` edge

Some time after the extraction, the deck's resolved-entry type was declared like this, in the deck feature's own model:

```ts
interface ResolvedDeckEntry extends CardCopy {
  // …
}
```

It came from reusing `CardCopy` rather than declaring a second pair type: both hold a card and a quantity, so why write it twice?

The direction was never wrong. `deck` may depend on `analysis`, and six files in `deck/presentation/` do and should. `check:deps` passed. What was wrong was the layer the edge sat at and the kind of thing that crossed it. The deck model itself could no longer be read without the analysis feature, and if analysis added a field to `CardCopy`, every deck entry would inherit it.

Compare it with the call that's fine. `deck-contents.ts` reduces deck entries to `CardCopy` values, and `deck-analysis-format.ts` passes them to `energyCurve`. That names an analysis type inside `deck` too, but at a call site. Delete the call and the dependency goes with it. `extends CardCopy` was a definition, and every reader of the deck model inherited it.

The fix moved the edge down one layer and changed nothing else. `ResolvedDeckEntry` declares its own `card`, `quantity` and `section`, and the `CardCopy` is built at the call site. The two types now hold the same pair on purpose: the repetition marks the boundary. Don't-repeat-yourself is right inside a feature and wrong across one, where it trades the feature's independence for two lines.

A dependency checker counts a type-only import as a real edge (the dependency-cruiser version of that is on [a type-only import is a real edge](/tooling/dependency-cruiser/#a-type-only-import-is-a-real-edge-so-two-value-objects-can-still-cycle)), but an edge in a legal direction still passes. Why no direction check catches this is on [what the check does not detect](/projects/rifty/architecture/checking-the-graph/#what-the-check-does-not-detect).

## The other cycle: an adapter that imported composition

The other cycle Rifty has had to repair was between layers, not features. `open-app-data-store.ts`, the infrastructure code that opens and seeds the database, imported `@/composition/card-image-host` to read the host that serves card images. Composition imports infrastructure to build it, so that closed a loop.

It already passed the image base URL down to the adapters. It just got it by import instead of by parameter. The fix was a parameter: `openAppDataStore(logger, imageBaseUrl)`, and composition passes the host in. "Infrastructure never imports composition" is one of the checker's direction rules now.

Both repairs worked the same way. Neither moved a file. Each changed a signature so that a module received the value it uses instead of importing it from a layer above, and the module boundaries stayed where they were.

## What it cost

Choosing sections moved to the caller. A panel's denominator, the number of cards the odds are computed over, is now the screen's responsibility, and that's a new place to get something wrong without noticing. Analysis is also more general than its single caller uses today.

This isn't a rule that features must be isolated or that a shared model is suspect. `deck` depends on `card` and `analysis` directly, and sharing `Card` is correct. `Card` was later given its own feature so that sharing it doesn't mean depending on `catalog`, and `set` its own so that `card → set` names a release rather than a browser. The constraint is direction and acyclicity, and it held.

Card-level analysis is the near test of the boundary. Measuring cards outside any deck belongs in `analysis` and imports only `card`, so it can arrive without the deck feature being involved at all. Splitting cards from their printings didn't disturb it either, because analysis reads gameplay fields, which belong to the card. If card-level analysis ever turned out to need a deck, that would be evidence the boundary sits in the wrong place. That's a consequence of the design and was never a reason for it: the cycle it removed justified the extraction, and features that don't exist yet played no part.
