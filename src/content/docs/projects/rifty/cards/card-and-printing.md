---
title: Cards, Printings and the Card Model
description: Gameplay identity against a released printing, the "would two printings differ?" test with measured data, Card as a printing joined to its card, and CardSummary.
tags: [rifty, domain-driven-design, sqlite, naming-conventions]
sidebar:
  order: 20
---

A Riftbound card can be released more than once: in another set, with alternate art, as a foil. Rifty, my Riftbound card app, keeps the card and each release of it as two concepts in two tables, and every field and call site picks one of them by the same test. The general idea of an identity as a value is on [entities, value objects and identities](/architecture/entities-and-value-objects/#an-identity-is-a-value-the-thing-it-names-is-not). The words themselves are in the [glossary](/projects/rifty/glossary/cards-and-sets/).

## Two concepts, one table each

A **card** is gameplay identity: the name, energy, might, power, rules text, type, supertype, domains, tags, speeds and keywords. A card isn't a physical object. It has no art, no rarity, no set, no collector number and no finish, and two printings of one card are the same card. The `card` table has 941 rows, keyed by the normalized card name (`"Abandon"`, `"Lux, Illuminated"`).

A **printing** is one released manifestation of a card: a set, a collector number, a pool code, a rarity, a printed name, a finish, a flavor text and art. The `card_printing` table has 1429 rows, each referencing a card and a set. Its key is an id Rifty derives from the release itself (how is on [identities](/projects/rifty/cards/identities/)).

A printing also isn't a copy someone owns. A deck that holds three copies of one printing holds a quantity of three, not three printings.

Around the two tables, lists hang off whichever side they describe:

```text
card (941)                          card_printing (1429)
  ├─ card_domain                      ├─ card_media (image file, artist, alt text)
  ├─ card_tag                         ├─ card_image_source (ranked candidate URLs)
  ├─ card_speed                       └─ card_marketplace_reference
  └─ card_keyword ─ card_keyword_target
```

A third table, `card_set`, holds one row per release: 8 of them, keyed by `code` (`OGN`, `OPP`, and so on).

## The test: would two printings differ?

Every column had to go on one table or the other, and I decided each one with the same question: **would two printings of the same card ever differ on it?** If yes, it's the printing's. If no, it's the card's.

I asked it of the real data, not from memory. In the current seed, 268 cards have more than one printing, covering 756 printing rows. 164 of those families span more than one set, and `Mind Rune` has nine printings. Across them:

- rarity differs in 219 families, and flavor text in 87, so both are the printing's;
- energy, might, power and type differ in none, so those are the card's.

The flavor text column is spelled `flavourText` (`flavour_text` in SQL), and the model's field is `rulesText.flavour`. The upstream feed names the field `flavour`, and the schema kept its spelling. It's the one British spelling in the schema.

## Which one a call site reads

The same split decides which side a piece of code should read, and the question there is what a wrong answer would mean.

- **Rules, counting, legality and analysis read the card.** Three copies means three copies of a card, however many printings they came from.
- **Display, art, ordering, purchase, and anything a person physically owns read the printing.**

A deck needs both, which is why it stores both ids ([how a deck is stored](/projects/rifty/decks/deck-storage/)).

## `Card` is a printing joined to its card

The app's `Card` model, in `src/features/card/card.ts`, is **a card as printed**: one printing joined to its card, so both are reachable from one object. It holds `printingId` and `cardId` side by side, and it deliberately has no `id`.

That gap is the point. `card.id` is the field anyone would reach for by habit, and it would have to mean one of the two identities. Whichever it meant, some call site would use it for the other: a legality check that counts `card.id` when it should count cards, and gets printings. With no `id`, `card.id` doesn't compile, and each use has to name `printingId` or `cardId`. The mistake becomes visible in the source instead of hiding behind a neutral name.

I considered splitting it into a `Card` type and a `Printing` type and decided against it, for good. Nothing in the app needs a card without a printing: every screen shows art, every deck entry stores which printing is owned, and every rule that counts by card can reach `cardId` from the same object. Splitting would put a join between the two at every call site and buy nothing.

The rest of the model follows the same split. `classification` groups `typeId` and `supertypeId`, which come from the card, with `rarity`, which comes from the printing. Since 2026-09-17, `rarity` holds the rarity's id and its stored name, joined from the `rarity` table, instead of the bare id, so the detail screen shows the stored name instead of title-casing the kebab-case id. They're grouped rather than flattened because they come from two places. `SqliteCardRepository` always selects `from(cardPrintings).innerJoin(cards, ...)`, so a page of cards is a page of printings, and the catalog browses printings today.

## Three strings: name, cleanName, cardId

A card as printed has three strings that look alike and do three jobs:

| In the model | Source | What it is |
| --- | --- | --- |
| `Card.name` | `card_printing.printed_name` | the card's name, normalized: the string shown on screen |
| `Card.cleanName` | `card.clean_name`, derived from `card.id` by the seed | the name with punctuation dropped, for search |
| `Card.cardId` | `card.id` | the card's identity, which happens to be a normalized name |

`Card.name` is the one people see, and nothing above the seed alters it. The app never composes a display name, never appends a finish to it, and never shows `cardId` or `cleanName` where a name belongs. `cleanName` is only a search key: `"Ahri, Nine-Tailed Fox"` becomes `"Ahri Nine-Tailed Fox"`.

Since 2026-09-13, `printed_name` holds the printing's repaired, normalized name, so it equals its card's `cardId` on all 1429 rows. Before that it held the feed's name verbatim, and a printing named `Nine-Tailed Fox (Metal)` was displayed that way. Why the feed's names couldn't be used as they were is on [the seed pipeline](/projects/rifty/persistence/seed-pipeline/#name-repair).

## `CardSummary` is its own projection

The catalog grid pages through thousands of printings and draws a small tile for each. It draws no rules text, keywords or marketplace references, so it doesn't load a full `Card`.

`CardSummary` is a deliberate second projection with only what a tile draws: `printingId`, `riftboundId`, `name`, `domainIds`, `orientation` and `imageUrl`. It's not a truncated `Card`. It has its own type and its own capability, `CardSummaryLister`, rather than an option on the full lister, for the reasons on [a projection is its own type](/architecture/capabilities/#a-projection-is-its-own-type-with-its-own-capability). In Rifty, "summary" always means a narrower projection of a model, fetched separately. It never means a formatted line about one.

## The image URL is composed at the adapter

Each printing has a `card_media` row with its image file name, not a URL. The images are served over the local network during development, from a host the app computes at startup, so a stored URL would be wrong on the next machine. The adapter receives `imageBaseUrl` from composition and composes the URL when it maps a row, as described in [store a reference, compose the URL at the adapter](/architecture/entities-and-value-objects/#store-a-reference-compose-the-url-at-the-adapter).
