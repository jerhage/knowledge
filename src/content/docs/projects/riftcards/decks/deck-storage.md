---
title: How a Deck Is Stored
description: deck and deck_card, why the printing someone owns is stored while rules count by card, invariants that hold by construction, and the RESTRICT keys.
tags: [riftcards, sqlite, drizzle, domain-driven-design]
sidebar:
  order: 30
---

A deck in riftcards is the person's own data: a name, a chosen champion, and a list of which printings they put in which section, in what quantity. It lives in two SQLite tables beside the seeded catalog. This page is about why those tables store what they store. The ids themselves are on [identities](/projects/riftcards/cards/identities/), and the split between entities and values behind them on [entities, value objects and identities](/architecture/entities-and-value-objects/).

## The two tables

```text
deck(id, name, created_at, updated_at, chosen_champion_card_id)
    INDEX deck_updated_at (updated_at)
deck_card(deck_id, section, card_id, printing_id, quantity)
    PRIMARY KEY (deck_id, section, card_id, printing_id)
    CHECK quantity > 0
    INDEX deck_card_copy_limit (deck_id, card_id)
    deck_id CASCADEs from deck; card_id and printing_id RESTRICT into card and card_printing
    deck.chosen_champion_card_id RESTRICTs into card, and stays nullable
```

Each `deck_card` row is a **deck entry**: `{ section, cardId, printingId, quantity }` in the model. The four key columns make it one quantity per printing per section. `section` is one of the five deck sections (legend, main deck, rune deck, battlefields, sideboard), covered on [deck legality](/projects/riftcards/decks/legality/).

A saved deck may be incomplete, and even illegal. Someone builds a deck up over several sessions, and a half-built deck still has to save. So storage enforces only what's required to store quantities unambiguously, and checking the deck is a separate step that's never stored.

## Storage keeps the printing; rules count by card

A deck row has two ids for the same card, and neither is redundant.

`printing_id` is there because a deck is a physical object. Someone owns a particular alternate art. A deck list that dropped which one would be wrong on the table and useless for pricing.

`card_id` is there because every rule in the game counts by card. The main deck and sideboard together may hold three copies of a card, however they're split across printings, so the gameplay quantity is `SUM(quantity) GROUP BY card_id`, and the limit applies to that sum. Mixed printings are allowed, and the limit still binds. In the domain, `copiesByCard()` in `deck-legality.ts` does that reduction and reports the offending `printingIds` next to the `cardId`, so the builder can show the rows involved. The `deck_card_copy_limit` index on `(deck_id, card_id)` is there for the same grouping.

`card_id` could be derived from `printing_id` at query time instead, since every printing belongs to one card. But that would put a join between the deck and every legality check, for a column that never changes. Storing it is cheaper and shows what the rules read.

The distinction between the two is on [cards and printings](/projects/riftcards/cards/card-and-printing/#which-one-a-call-site-wants).

## Two invariants that hold by construction

Storing the pair on each row also means two rules need no code to enforce them.

- **"The selected printings add up to the entry's quantity."** In a design with a card-level entry and a separate list of chosen printings, the two could drift apart. Here there's no separate entry to drift from: the quantity is on the printing's row.
- **"A selected printing belongs to the entry's card."** That's a property of the row itself, since the row names both, not a validation rule run over two tables.

## The chosen champion is a card

A deck's Chosen Champion is stored as `deck.chosen_champion_card_id`, a card reference, not a printing. Which champion someone is playing is a gameplay fact, and the rules about it (it must be a champion unit, and it must be one of the main deck's cards) are about the card. `chosenChampionCard()`, in `findResolvedDeck`, resolves it to a printing only for display: the printing seated in the main deck when there is one, otherwise the card as the catalog returns it. The column stays nullable, because a deck in progress may not have one yet.

## The foreign keys RESTRICT

`deck_card.card_id`, `deck_card.printing_id` and `deck.chosen_champion_card_id` are `ON DELETE RESTRICT` foreign keys into `card` and `card_printing`. With `RESTRICT`, SQLite fails any delete of a card or printing that any deck row still names, at the moment of the delete. Deleting a deck still cascades to its rows through `deck_id`. A null champion passes, because a null column needs no parent row. Both details are on [foreign keys are off until each connection turns them on](/storage/sqlite/#foreign-keys-are-off-until-each-connection-turns-them-on).

An earlier write-up recorded the absence of these keys as deliberate, so that decks would survive a reseed of the catalog. That reasoning was wrong, and I corrected it on 2026-09-11. The seeder now upserts the six catalog tables a deck row can reach and deletes none of them ([the seed pipeline](/projects/riftcards/persistence/seed-pipeline/#the-seeder-upserts-and-never-deletes)). A catalog row a deck holds is never removed under it, and the database now refuses any deletion that would strand a deck entry. Keys only do anything in SQLite with foreign keys switched on for the connection, which the app does at startup ([opening the database](/projects/riftcards/persistence/sqlite-and-drizzle/#startup)).

## What the keys made impossible

With the keys in place, a deck entry whose card has left the catalog can't exist.

So `findResolvedDeck`, which pairs a deck with its cards so nothing downstream looks a printing up again, throws if an entry doesn't resolve, rather than render a deck whose contents are silently short. A missing card is now a broken invariant, not something a person can cause, so it goes to an error boundary as described in [an unexpected failure throws to a boundary](/architecture/expected-and-unexpected-failure/#an-unexpected-failure-throws-to-a-boundary).

And the `unverified` variant of a deck's verification lost its reason to exist. One of its three reasons, `missingCards`, had nothing left to report, and the other two never had a producer. It was retired on 2026-09-11, so a verification is `legal | illegal` and nothing else.

## One aggregate, checked by a schema

A deck with its entries is the one aggregate in the app, in spirit: the entries mean nothing without their deck. It's enforced by the deck's Zod schema rather than by a class. A `superRefine` on the schema rejects a deck with two entries for the same printing in the same section, the in-memory mirror of the primary key, so a deck that would violate the key fails when it's parsed instead of when it's written. Why that's the only aggregate machinery is in [why borrow two DDD ideas](/projects/riftcards/cards/identities/#why-borrow-two-ddd-ideas-and-not-the-rest).
