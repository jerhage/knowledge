---
title: PrintingId, CardId and the Other Branded Ids
description: Ids derived from release facts instead of the feed's keys, what is branded and what isn't, parsing at the adapter, and why riftcards borrows two DDD ideas and not the rest.
tags: [riftcards, domain-driven-design, typescript]
sidebar:
  order: 21
---

Riftcards identifies a card, a printing, a deck and a core rule each with its own branded id type, and derives a printing's id from facts about the release rather than taking the card feed's key. This is the worked case for [entities, value objects and identities](/architecture/entities-and-value-objects/). What a card and a printing are is on [cards and printings](/projects/riftcards/cards/card-and-printing/).

## Where the ids live

Each id is a value object owned by its feature. `CardId` and `PrintingId` live in `src/features/card/value-objects/`, and `CoreRuleNumber` in `src/features/rules/value-objects/`. `DeckId` and `NoteId` are declared next to their models, in `deck.ts` and `note.ts`. The printing itself is an entity (a row in `card_printing` with a lifecycle), and it lives with the card feature's model. That split is [an identity is a value](/architecture/entities-and-value-objects/#an-identity-is-a-value-the-thing-it-names-is-not), and it's what answers "where does this type go" every time the question comes up.

Every branded id is one line of Zod:

```ts
const printingIdSchema = z.string().trim().min(1).brand<"PrintingId">();
type PrintingId = z.output<typeof printingIdSchema>;
```

## Why two ids on one row forced the brand

A deck stores one row per card it holds, in `deck_card`, and each row carries two string ids: `card_id` and `printing_id` ([why both](/projects/riftcards/decks/deck-storage/)). With both typed as `string`, a call that passes them in the wrong order compiles. Then it either fails at runtime or quietly resolves the wrong row.

With the brand, that swap is a type error, and so is passing a bare string where either id belongs. The ids started as `type PrintingId = string`, and that held up until the schema had two id columns on one table.

## `PrintingId` is built from the release

The feed that supplies the catalog gives each printing a key, and the obvious thing was to use it. Until 2026-09-11 riftcards did. By then the column held three schemes at once: 1098 Mongo ObjectIds, 241 `preview-` strings and 123 `openrift-` UUIDs. None of them said anything about the printing, and the feed sometimes reissued a printing under a fresh key, which would have stranded every reference to the old one.

So a `PrintingId` is now riftcards' own, derived from the four columns that describe the release, joined with `-`:

1. the set code, lowercased;
2. the collector number;
3. the pool code, when there is one;
4. the finish in kebab case, when it isn't `standard`.

That gives ids like `ven-150`, `unl-131-219`, `ogn-119a-298-alternate-art`, `opp-255-298-metal-deluxe` and `ogn-299*-298-signature`. The seed pipeline computes the id from the same values it writes into those columns, so the two can't disagree, and a check called `assertOnePrintingPerRelease` fails the build if two printings ever share the key. The feed's key survives only inside the pipeline, as `NormalizedPrinting.sourceId`, and reaches no table. The general rule is [never persist another system's surrogate key](/architecture/entities-and-value-objects/#never-persist-another-systems-surrogate-key); the pipeline side is on [the seed pipeline](/projects/riftcards/persistence/seed-pipeline/).

Two of those parts are easy to get wrong:

- **`collectorNumber` is text.** Printed collector numbers include `119a`, `r04b`, `t1a-001`, `SP3` and `299*`. An integer column once destroyed 230 of these values.
- **`poolCode` is a release concept.** It's the product pool a printing was released in (`298`, `005`, `219`, or none), parsed from the feed's face id. It has nothing to do with the pool of cards a deck builder shows.

## `riftboundId` is not a key

The feed also gives every card face an id of its own, like `ogn-119-298`, and it's stored as `riftboundId`. It looks like a key and isn't one: there are 1411 distinct values over 1429 rows, because the feed reused 18 faces for both a `standard` row and a `metal` or `summonerCircle` row. Code never keys anything by it. It uses `printingId`.

## `CardId` reads like a name and isn't one

A `CardId`'s value is the printed name, normalized, with any trailing finish in parentheses removed: `"Abandon"`, `"Ahri, Nine-Tailed Fox"`. That it reads like a name doesn't make it one. It's an identity, and the app never renders it as a card's name. The name shown on screen is `Card.name` ([three strings](/projects/riftcards/cards/card-and-printing/#three-strings-name-cleanname-cardid)).

A variable's name follows its type. A `CardId` is called `cardId` and a `PrintingId` is called `printingId`, never `id`. On 2026-09-14 I fixed eight places that broke this: five called a `PrintingId` `cardId`, and three more (`CardFinder.get`, `findCard` and `SqliteCardRepository.get`) called one `id`. The same fix reached the test fixtures, where a builder took `card(id, …)` and built a printing from it. A wrong name in a fixture does the most damage, because every test that uses it repeats it.

The one exception is the route. `/cards/[id]` keeps `id` as its path segment, because renaming it would change URLs and deep links. The value it's parsed into is a `printingId`.

## What is branded, and what was left plain

As of 2026-09-16, four ids were branded: `CardId`, `PrintingId`, `DeckId` and `CoreRuleNumber`. `TaxonomyId`, the id for supertypes, rarities and tags, was deliberately left as a plain trimmed string. Its values live in lookup tables and arrive from the feed as an open set, where a new value can appear without any change to the app.

`CoreRuleNumber` was briefly described as unbranded "like `TaxonomyId`", and on 2026-09-16 I corrected that. The comparison doesn't transfer. A rule number is a printed identifier with a strict grammar, it's the primary key of `core_rule`, and three functions read meaning out of it (its depth, its ancestors, and whether it's a chapter). That's the same kind of thing `PrintingId` is branded for, and for the same reason: an annotation subject like `{ kind: "coreRule", id: aPrintingId }` must not compile. All three functions take the brand, because an arbitrary string has no such reading. Why they're derived rather than stored is on [the core rules document](/projects/riftcards/rules-and-notes/core-rules/).

On 2026-09-17 I branded `TaxonomyId` too, along with `SetCode` and `NoteId`. That makes seven branded ids today.

## Parsing at the adapter

A branded type is reached by parsing, never by casting. `id as PrintingId` would compile for any string, so it would put a value with the brand's guarantee into trusted code without checking anything.

The strings arrive in two places, and both parse:

- **The SQLite adapters.** Each mapper parses its rows through the model's schema. For example, `core-rules-mapper.ts` parses every row through `parseCoreRule`, and `annotation-mapper.ts` parses a bookmark or a note through `parseBookmark` or `parseNote`, whose schemas check the subject with `annotationSubjectSchema`. The other direction needs no conversion: a branded id is a string, so the repositories write `subject.id` into the text column as it is.
- **Route parameters**, which always arrive as bare strings. The card route parses its `id` with `printingIdSchema.parse`. The failure to watch for is a branded type reached by a cast instead of a parse.

The seed scripts never hold a branded id. `scripts/core-rules-parse.ts` declares its own `type CoreRuleNumber = string`, and `scripts/card-derivation.ts` keeps the same boundary for a printing id, because `src/` may not import from `scripts/`, and a seed row is a plain column value.

## Pinning the annotation subject

A bookmark or a note can be about a core rule, a card or a deck. `AnnotationSubject` is a union on `kind`, and each arm holds the branded id of the feature that owns that identity:

```text
{ kind: "coreRule"; id: CoreRuleNumber } | { kind: "card"; id: PrintingId } | { kind: "deck"; id: DeckId }
```

Until 2026-09-16 it was `{ kind; id: string }`, which let `{ kind: "card", id: "103.2.a" }` compile. The card arm holds a `PrintingId`, not a `CardId`, because a mark is made on the thing on screen, and what's on screen is a printing.

Nothing at runtime would notice if the brand were removed again, so a test pins it at compile time. `tests/annotation/annotation-subject.test.ts` marks each line that must not compile with `@ts-expect-error`: a card subject holding a rule number, a rule subject holding a printing id, and the same two mix-ups passed to a bookmark toggle. Delete the brand and those lines compile, the directive becomes unused, and the file fails to type-check. The technique is [pin a type guarantee with a failing compile](/testing/tests-as-evidence/#pin-a-type-guarantee-with-a-failing-compile). How the annotation feature uses the subject is on [bookmarks and notes](/projects/riftcards/rules-and-notes/bookmarks-and-notes/).

## Why borrow two DDD ideas and not the rest

Entities, value objects and brands can read like enterprise Java in a React Native app. I took exactly two ideas from domain-driven design, and I kept each one because it removed a problem I could name:

- **Branded value objects**, because `deck_card` has two string ids. Unbranded, swapping them compiles and then silently resolves the wrong row. Branded, it's a type error. It deletes a whole class of bug.
- **The split between entities and values**, because it answers "where does this type go" without argument. `PrintingId` has no identity of its own, so it's a value and lives in `value-objects/`. The printing is the entity and lives with the model.

The rest of the tactical patterns I left out: no aggregates as classes, no domain events, no repository per aggregate. There's one aggregate in spirit, `Deck` with its entries, and a Zod `superRefine` enforces it rather than a class. Nothing needs events and nothing is distributed.

The full pattern set would add vocabulary without deleting a bug. That's the test I use for a pattern here: can I name a defect its absence caused? The general version is [take only the patterns whose absence caused a bug](/architecture/entities-and-value-objects/#take-only-the-patterns-whose-absence-caused-a-bug).
