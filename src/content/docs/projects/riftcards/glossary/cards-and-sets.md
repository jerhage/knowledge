---
title: "Glossary: Cards, Printings and Sets"
description: The words for cards, printings, their identities, what is printed on a card, and sets. One word per concept.
tags: [riftcards, naming-conventions, domain-driven-design]
sidebar:
  order: 100
---

Riftcards keeps a glossary: one word per concept, and the same word in prose, in a type name, in a variable name and on screen. When two words are in use for one thing, the glossary says which one wins. The practice itself is on [one word per concept](/practices/one-word-per-concept/); these four pages are the riftcards glossary as it stands. This page covers cards, printings, their identities, what is printed on a card, and sets. The others cover [the catalog, decks and analysis](/projects/riftcards/glossary/catalog-decks-analysis/), [the core rules, annotations and the screen](/projects/riftcards/glossary/core-rules-annotations-screen/), and [the rulings](/projects/riftcards/glossary/rulings/).

Every entry names where the term is defined and gives a real value from the app. Counts are from the seed as I verified it on 2026-09-13: 941 cards, 1429 printings, 8 sets.

How I use it: before I name a type, a field, a variable, a component or a label, I check whether the concept is already here. If it is, I use that word exactly. If the word I want to use lost a ruling, I use the winner. If the concept is genuinely new, it gets an entry in the same commit that introduces it.

## The decision that is settled: `Card` holds both ids

Riftbound has cards (a card's gameplay identity: its name, rules text and so on) and printings (each release of a card, with its own art, set and rarity). Both are defined below. The app's main model, `Card`, is **a card as printed**: one printing joined to its card. It holds `printingId` and `cardId` side by side, and it deliberately has no `id`.

This isn't an oversight to be tidied later, and `Card` isn't going to be split into a `Card` type and a `Printing` type. Nothing in the app needs a card without a printing: every screen shows art, every deck entry stores which printing you own, and every rule that counts by card can reach `cardId` from the same object. Splitting them would put a join between the two at every call site and buy nothing.

What this design buys is that neither identity can be used without naming which one it is. `card.id` doesn't compile. If someone reaches for the printing where a rule applies (counting printings when they meant to count cards), it's visible in the source, not hidden behind a field called `id`.

Defined in `src/features/card/card.ts`. I recorded it so it isn't reopened. The full story is on [cards, printings and the `Card` model](/projects/riftcards/cards/card-and-printing/).

## Card, printing, and their identities

### card

The gameplay identity: the name, energy, might, power, rules text, type, supertype, domains, tags, speeds and keywords. There are 941 rows in `card`, keyed by the normalized card name.

A card is not a physical object. It has no art, no rarity, no set, no collector number and no finish. Two printings of one card are the same card.

The test for whether a field is the card's: would two printings of the same card ever differ on it? If not, it's the card's.

Table: `src/infrastructure/database/reference-schema/cards.ts`, `cards`.

### printing

One released manifestation of a card: a set, a collector number, a pool code, a rarity, a printed name, a finish, a flavor text and art. There are 1429 rows in `card_printing`.

A printing is not a copy you own. A deck holding three copies of one printing holds a quantity of three, not three printings.

Rules, counting, legality and analysis read the card. Display, art, ordering, purchase and anything a person physically owns read the printing.

The seed pipeline (the scripts that build the bundled catalog, on [the catalog seed pipeline](/projects/riftcards/persistence/seed-pipeline/)) is the one place that holds a printing before it has a card, and it says so: `NormalizedPrinting` in `scripts/catalog-seed.ts`. It was called `NormalizedCard` until 2026-09-14, even though `cardGroups` was the step that turned several of them into one card.

### `CardId`

The card's identity. It's branded (a string the type system distinguishes from other strings): `z.string().trim().min(1).brand<"CardId">()` in `src/features/card/value-objects/card-id.ts`.

Its value is a name: the printed name normalized, with any trailing finish parenthetical removed, as in `"Abandon"` or `"Ahri, Nine-Tailed Fox"`. It's an identity first. I ruled on 2026-09-14 that a Riftbound card's id is its name, so a place that shows the id as a label (the builder's pick chips, and until 2026-09-14 the draw odds row for a pinned card) is correct; everywhere a `Card` is at hand, the screen shows `Card.name`. See [the ruling on `name`](/projects/riftcards/glossary/rulings/#a-cards-name-is-cardname-unaltered).

### `PrintingId`

The printing's identity. Branded, in `src/features/card/value-objects/printing-id.ts`. The app derives it by joining with `-`: the set code lowercased, the collector number, the pool code when there is one, and the finish in kebab case when it isn't `standard`.

`ven-150`, `ogn-119a-298-alternate-art`, `opp-255-298-metal-deluxe`, `ogn-299*-298-signature`.

Why both ids are branded: `deck_card` carries a `card_id` and a `printing_id`. As bare strings, swapping them compiles, and then it either fails at runtime or silently resolves the wrong row. The brand makes the swap a type error. Reach a branded type by parsing, never by casting. More on [`PrintingId`, `CardId` and the other branded ids](/projects/riftcards/cards/identities/).

### `riftboundId`

The upstream card API's id for a card **face**, for example `ogn-119-298`. It isn't unique: there are 1411 distinct ids over 1429 rows, because upstream reused 18 faces for a `standard` row and a `metal` or `summonerCircle` row. So it's never a key. Use `printingId`.

### `collectorNumber`, `poolCode`

`collectorNumber` is the number printed on the card, and it's **text**: `119a`, `r04b`, `t1a-001`, `SP3`, `299*`. Never an integer. An integer column destroyed 230 of these values once.

`poolCode` is the product pool the printing was released in, parsed from the `riftboundId`: `298`, `005`, `219`, or null. It's a release concept and has nothing to do with the card pool in the deck builder. See [pool](/projects/riftcards/glossary/catalog-decks-analysis/#pool).

### `finish`

One of twelve values, and it belongs to the printing, never to the card:

`standard` · `alternateArt` · `overnumbered` · `signature` · `metal` · `metalDeluxe` · `summonerCircle` · `champion` · `starter` · `launchExclusive` · `ultimate` · `nx`

Defined in `src/features/card/value-objects/printing-finish.ts`. The current spread: 1084 standard, 157 alternateArt, 60 overnumbered, 45 signature, 33 metal, 28 metalDeluxe, 10 summonerCircle, 5 champion, 4 starter, and 1 each of launchExclusive, ultimate and nx.

A finish is not an attribute, and it's not part of a card's name. Only four of the twelve can be read from the feed's flags. The other eight exist because the feed's name contains them, and the pipeline reads that name before it normalizes it. Since 2026-09-13 no finish label survives into `printed_name`. That the name and the finish travel together in the feed doesn't make them one thing in the app.

`finish: "champion"` is a foil treatment. It has nothing to do with a Chosen Champion or the `Champion` supertype. See [the ruling on `champion`](/projects/riftcards/glossary/rulings/#champion-alone-is-never-the-chosen-champion-in-a-type-name).

### `name`, `cleanName`, `printedName`

`name`, `cleanName` and `printedName` hold different strings for different jobs.

| in the model | source | what it is |
|---|---|---|
| `Card.name` | `card_printing.printed_name` | the card's name, normalized: the string shown on screen |
| `Card.cleanName` | derived from `card.id` | the card's name with punctuation dropped, for search |
| `Card.cardId` | `card.id` | the card's identity, which happens to be a normalized name |

`Card.name` is the one people see, and nothing above the seed alters it: never compose a display name, never append a finish to it, never show `cleanName` where a name belongs.

This changed on 2026-09-13. `printed_name` used to hold the feed's name verbatim, so a printing named `Nine-Tailed Fox (Metal)` was displayed that way. The seed now writes `printedName: printing.identityName` (the printing's own repaired, normalized name), so `printed_name` equals `card.id` on all 1429 rows: commas rather than ` - `, and no finish suffix. The source was too inconsistent for verbatim to be a usable rule: 424 names were separated with ` - ` and 100 with `, `, 19 cards had printings whose names differed from each other, 234 names had a finish suffix the pipeline had already read to derive `finish`, and 71 of 157 alternate-art printings had no suffix at all.

The normalization happens once, at the boundary where the feed enters. Everything below it still treats `name` as given.

`cleanName` is a search key. `"Ahri, Nine-Tailed Fox"` becomes `"Ahri Nine-Tailed Fox"`. It's never displayed.

Mapped in `src/infrastructure/sqlite/card-mapper.ts`.

### `Card`

`src/features/card/card.ts`. A printing joined to its card, parsed with `parseCard`. Fields: `printingId`, `cardId`, `riftboundId`, `setCode`, `collectorNumber`, `name`, `cleanName`, `attributes`, `rulesText`, `orientation`, `finish`, `sourceUpdatedAt`, `classification`, `domainIds`, `speeds`, `keywords`, `championName`, `tags`, `imageUrl`, `marketplaceReferences`.

### `CardSummary`

`src/features/card/card-summary.ts`. A deliberate second projection for paging the card grid, not a truncated `Card`: `printingId`, `riftboundId`, `name`, `domainIds`, `orientation`, `imageUrl`. It has its own capability, `CardSummaryLister`.

"Summary" means a narrower projection of a model, fetched separately. It never means a formatted line about a model. See [the ruling on `summary`](/projects/riftcards/glossary/rulings/#summary-is-a-projection-not-a-formatted-line).

## What is on a card

### `attributes`

`attributes` means exactly `{ energy, might, power }`. Nothing else is an attribute, ever.

Defined as `cardAttributesSchema` in `src/features/card/card.ts`. The catalog's filter axis matches: `type NumericAttribute = "energy" | "might" | "power"` in `catalog-query-criteria.ts`. All three are nullable: a Spell has no might, a Battlefield no energy.

The scar: a formatter named `formatCardAttributes` was changed to also return a finish. A name fixes the set of things it covers, and adding a finish to a three-value concept silently made every caller wrong. The glossary exists because of that change.

A function whose output is attributes and something else must name both: `formatCardTypeAndAttributes` is accurate; `formatCardAttributes` returning a type would be misleading.

### `classification`

`{ typeId, supertypeId, rarity }`, in `card.ts`. Two of the three come from the card and one (rarity) from the printing, which is exactly why they're grouped rather than flattened into `Card`. Until 2026-09-17 the third field was `rarityId`, the bare id; it's now the rarity's id together with its stored name.

### type / `CardType`

What the card is. A closed union of eight in `src/features/card/value-objects/card-type.ts`: `Unit`, `Spell`, `Gear`, `Legend`, `Battlefield`, `Rune`, `Other`, `Token`. `ORDERED_CARD_TYPES` puts them in play order rather than alphabetical order.

`Other` and `Token` are two real cards, `Buff` and `Recruit`, and they never enter a deck. They're last in the order because neither is a stage of play. The rule lives where it belongs: every deck section names the types it accepts, and none of them names these two. `tests/deck/deck-section-card-types.test.ts` holds that for all five sections.

Say "type", never "card kind", "category" or "class".

### supertype

An extra classification a card may have, or null: `Champion`, `Signature`, `Basic`, `Token`. It isn't a closed union in code: `supertypeId` is a `TaxonomyId` (see below).

A card is a champion unit when `typeId === "Unit"` **and** `supertypeId === "Champion"`. The supertype alone doesn't settle it, because legends have it too. `CHAMPION_UNIT` in `deck-legality.ts` is the single place that pair is written down.

### rarity

The printing's rarity: `Common`, `Uncommon`, `Rare`, `Epic`, `Showcase`, `Promo`. It sits on `classification.rarity` as a `CardTaxonomy`, `{ id, name }`, whose `id` is a `TaxonomyId`. It was a bare `TaxonomyId` on `classification.rarityId` until 2026-09-17. It's the printing's because rarity differs across most cards that have several printings.

### domain / `CardDomain`

A game term. (In riftcards the word also names the pure rules layer, and it never names a module: modules are features.) A closed union of seven in `src/features/card/value-objects/card-domain.ts`: `Body`, `Calm`, `Chaos`, `Fury`, `Mind`, `Order`, `Colorless`. A card may carry several, so `Card.domainIds` is an array. `ORDERED_DOMAINS` is play order; the schema's own order is alphabetical and isn't for display.

Domain is game vocabulary, not catalog vocabulary. The deck feature reads it for legality, analysis groups by it, and the theme is keyed by it. It isn't a color, even though the theme gives each one a color.

Two of the seven colors are indistinguishable under deuteranopia, so a domain is never shown by color alone. `domainCode` gives the one-letter stand-in (`Chaos` becomes `X`, `Colorless` becomes `N`).

### speed / `CardSpeed`

`normal`, `action`, `reaction`. `Card.speeds` is an array, because a card may have more than one. `cardSpeedName` gives the display form.

### keyword

A named ability with an optional numeric value and a list of targets. There are 30 rows. `Card.keywords` is `{ id, name, value, targets }`. A target is `{ kind, isToken, allegiance }`, where `kind` and `allegiance` are closed unions in `value-objects/`.

`benefitsOwnSide` decides whether a target helps the player holding the card. It's named that and not `benefitsTheDeck`, because the analysis feature must not name a deck (see [analysis](/projects/riftcards/glossary/catalog-decks-analysis/#analysis)).

Analysis leaves `action`, `reaction` and `equip` out of the keyword mix, because those duplicate `speeds`.

### tag, and `trait`

`Card.tags` is a list of `CardTaxonomy` values, `{ id, name }`, each `id` a `TaxonomyId`. It was `tagIds`, a list of bare ids, until 2026-09-17, when the model started holding each tag's stored name. There are 129 tag rows, each with a `kind`: 97 `character`, 11 `region`, 21 `trait`.

A trait is one of three kinds of tag. "Tag" is the whole set; "trait" is a subset. They aren't synonyms, and today the model can't tell them apart, because `kind` is dropped at the mapper and never reaches `Card`. See [the ruling on `trait`](/projects/riftcards/glossary/rulings/#tag-beats-trait).

### `championName`

The champion a card *belongs to*, or null: a card's association with a champion. It's a `string` on the card, derived from the flat feed. It isn't a `CardId` and it isn't the Chosen Champion.

### `orientation`

`landscape` or `portrait`. It's the card's, not the printing's. Battlefields are landscape; the rest are portrait. It drives the aspect ratio, `5 / 7` for portrait.

### rules text, `flavour` text

`Card.rulesText` is `{ rich, plain, flavour }`. `rich` has markup and `plain` doesn't; both are the card's. `flavour` is the printing's and may be null.

`flavour` is a British spelling inherited from the feed, and the one exception the American-spelling rule allows. Everything else is meant to be `color`, `normalize` and so on. One more British spelling has slipped into the code without a ruling: the `LabelledSection` atom in `labelled-section.tsx`.

### `TaxonomyId`

`src/features/card/value-objects/taxonomy-id.ts`. A trimmed string for ids that live in a lookup table rather than a closed union: supertypes, rarities, tags. The set is open and arrives from the feed, so a new value can appear without any change to the app.

Until 2026-09-17 it was deliberately unbranded, and the open set was the whole reason. That reason was also why it didn't carry over to a printed identifier (see [`CoreRuleNumber`](/projects/riftcards/glossary/core-rules-annotations-screen/#corerulenumber)). On 2026-09-17 I branded it anyway, `z.string().trim().min(1).brand<"TaxonomyId">()`, in the same change that branded `SetCode` and a note's id. A value in code, such as the `"Champion"` supertype in `CHAMPION_UNIT`, now reaches the brand by parsing.

`formatTaxonomyId` used to turn a stored id into title case for display. I deleted it on 2026-09-17: the card detail screen now shows the rarity's and each tag's stored `name`, and a type's id as it stands.

## Set

### set / `CardSet`

One release. There are 8 rows: `JDG`, `OGN`, `OGS`, `OPP`, `PR`, `SFD`, `UNL`, `VEN`. A set is keyed by `code`, which is the only set identifier the app needs. `CardSet` is `{ code, name, declaredCardCount, publishedOn, marketplaceReferences }` in `src/features/set/card-set.ts`.

A set is a release concept, which is why it belongs to the `set` feature and not to `card`, even though `card.ts` imports `SetCode`.

### marketplace reference

`{ marketplace, externalId }`, where marketplace is `cardmarket` or `tcgplayer`. Both a set and a printing hold one. It's in the set feature because it's a purchase concept.
