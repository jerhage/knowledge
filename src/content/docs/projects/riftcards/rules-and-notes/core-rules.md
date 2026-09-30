---
title: The Core Rules Document
description: "From PDF to 1364 entries: the parse, the heading/rule heuristic, chapters, details, editions, and deriving from the rule number."
tags: [riftcards, sqlite, drizzle, domain-driven-design]
sidebar:
  order: 50
---

Riftcards has a Rules tab that shows the official rules of the game, a document titled *Riftbound Core Rules*, on the device and without a network. The `rules` feature owns it: one numbered entry per rule, the bullets and examples under each, the edition they come from, and reading, searching and moving around the document on screen. It's a leaf in the [feature graph](/projects/riftcards/architecture/feature-graph/): it names no other feature.

The data side is a worked example of [deriving what the identifier says and storing what it cannot](/architecture/entities-and-value-objects/#derive-what-the-identifier-says-store-what-it-cannot). The words used here are defined in the [core rules glossary](/projects/riftcards/glossary/core-rules-annotations-screen/). Search has its own page: [searching the core rules](/projects/riftcards/rules-and-notes/rules-search/).

## From PDF to seed

The document arrives as a PDF. It becomes app data through a pipeline of Deno scripts in `scripts/`, run by hand. It's a second pipeline next to the [catalog seed pipeline](/projects/riftcards/persistence/seed-pipeline/), with the same three steps and no shared code.

First the PDF is turned into text:

```sh
pdftotext -layout data/rules/core-rules.pdf data/rules/core-rules.txt
```

`data/` is gitignored, so neither the PDF nor the text is committed. Then three scripts do the rest:

- `core-rules-parse.ts`: `parseCoreRules(text)` reads the text into a `CoreRulesDocument`, the whole document as `{ title, publishedOn, coreRules }`. That's 1364 numbered entries, each with its parent number, its position in the document, its kind and its body, and 249 details beneath them (139 bullets and 110 examples).
- `core-rules-seed.ts`: the pure builder. `buildCoreRulesSeed(document)` returns three arrays of rows, one per table, and validates every row against that table's Drizzle insert schema, naming the offending row when one fails. It reads no files, so `tests/rules/core-rules-seed.test.ts` imports it directly and runs it over the real extracted text.
- `generate-core-rules-seed.ts` (`npm run generate:core-rules-seed`): the I/O shell. It reads the text, parses it, builds the seed, hashes it into `CORE_RULES_SEED_VERSION`, and writes `src/infrastructure/database/generated/core-rules-seed.ts`, which is gitignored like the catalog seed and about 11,000 lines long.

The scripts never hold a branded `CoreRuleNumber` (see [the rule number](#the-rule-number-is-branded) below). `core-rules-parse.ts` declares its own `type CoreRuleNumber = string`, because `src/` may not import from `scripts/` and a seed row is a plain column value.

The seed test has the same gap as the catalog's: Jest runs the script's module, but not under Deno's module resolution, so only a real `npm run generate:core-rules-seed` proves the script's imports still resolve (see [how riftcards is checked](/projects/riftcards/engineering/checks-and-tests/#the-deno-resolution-gap)).

## Why nothing here is called a rule

The word "rule" was taken twice before this feature existed. `DeckLegalityRule` and `SectionRule` are named constraints on a deck (see [deck legality](/projects/riftcards/decks/legality/)). `Card.rulesText` and `CardRulesPanel` are the text printed on a card. A third meaning under the bare word would make every "rule" ambiguous, so everything in this feature is prefixed `CoreRule`. The prefix isn't invented; it comes from the document's own title.

The whole document is `CoreRulesDocument` rather than `CoreRules` for a Drizzle reason. Drizzle's convention names a table variable for the plural of its row, so the `core_rule` table is `coreRules`. Two names one character of case apart read badly, and the table keeps the convention.

## One entry and its order

A `CoreRule` is one numbered entry: `{ number, parentNumber, position, kind, body, details }`.

`position` is the order the entries have in the document, and it's the only correct sort. It's tempting to sort by the number instead, since the numbers look ordered, but they aren't a sort key. Top-level numbers are sparse, so as text `103` sorts before `50`. And segments alternate between numbers and letters, so `103.2.a` has no numeric reading at all. A natural sort (like a [numeric `Intl.Collator`](/javascript/gotchas/#intlcollator-sorts-naturally-but-is-not-a-total-order)) would only be a guess at an order the document already states, so the parser records the position and the app sorts by it.

## Heading or rule

The document doesn't mark which entries are headings. A short label and a full statement of a rule both arrive as a number followed by some text. The screen has to distinguish them, because it draws the two differently.

So the parser classifies each entry once and stores the result as the entry's `kind`: `heading` or `rule`. A heading is an entry whose body is 48 characters or shorter and doesn't end in sentence punctuation. Everything else is a rule. That gives 196 headings and 1168 rules.

In prose and in code, "heading" is the short labeling entry and "rule" is the numbered statement. "Section" is never used here, because that word belongs to a deck.

## Chapters are read off the number

The screen draws a chapter with a divider and the display font. There are 112 headings at the top level, far too many to all be chapters. The chapters are the depth-1 headings whose number ends in `00`, because the document numbers its chapters on century boundaries. There are exactly five: `000`, `100`, `500`, `600` and `700`.

A chapter is a rendering distinction, so it isn't a fourth `kind` and isn't stored. `isCoreRuleChapterNumber` reads it off the number.

## Details: bullets and examples

Under a rule there can be ordered pieces of text: a list of bullets, or an example. Each is a `CoreRuleDetail`, `{ position, kind, body }`, with `kind` either `bullet` or `example`. The word "example" comes from the document, which writes `Example:` before a paragraph and `Examples:` before a list. Everything that isn't an example is a bullet.

A detail is never folded into the rule's body. The reason is what a reader sees: an example illustrates a rule, it doesn't state it, and the app must never show a rule as saying something only its example says. Details are still searched, and a hit in one is reported against that detail rather than as an offset into the body.

## Editions

A `CoreRulesEdition` records which printing of the document the device holds: `{ title, publishedOn }`. Its id is the published date, `2025-06-02` today, so when a later edition comes out it adds a row rather than overwriting an unnamed one.

The word is "edition", never "version", because `CORE_RULES_SEED_VERSION` already means something else: the content hash of the seed, which shows whether the rows on the device match the bundled ones.

## The rule number is branded

A `CoreRuleNumber` is the printed identifier, stored exactly as printed but without the trailing period: `103.2.a`, not `103.2.a.`. It's branded:

```ts
z.string().trim().min(1).brand<"CoreRuleNumber">()
```

An earlier version of the glossary said it was deliberately a plain string, like `TaxonomyId` (the key for supertypes, rarities and tags). That was wrong, and I corrected it on 2026-09-16. A `TaxonomyId` is a lookup key into an open set that arrives from a feed, where a new value can appear without the app knowing it. A `CoreRuleNumber` is a printed identifier with a strict grammar, it's the primary key of `core_rule`, and three derivations hang off it. That's the same kind of thing `PrintingId` is branded for (see [identities](/projects/riftcards/cards/identities/)), and for the same reason: a bookmark on a core rule must not be able to carry a printing id. `TaxonomyId` stayed unbranded after that correction, but not for long: on 2026-09-17 it was branded too, together with the set code and the note id.

A string becomes a `CoreRuleNumber` in the adapter and only there. `core-rules-mapper.ts` parses every row through `parseCoreRule`, and `annotation-mapper.ts` parses a bookmark's or a note's subject through the annotation subject schema (see [bookmarks and notes](/projects/riftcards/rules-and-notes/bookmarks-and-notes/)).

## Derive from the number, store what it cannot encode

The `core_rule` table first had a `depth` column. I asked myself why a rule would need to store its depth, and it doesn't: depth is the number's segment count, so `103.2.a` shows `3` on its face.

The argument for storing it was that riftcards filters in the database rather than in JavaScript. That argument didn't survive the actual query. The only depth question the app asks is for the table of contents, "give me the top level", and in SQL that's `number NOT LIKE '%.%'`. Indenting a row while rendering is presentation, computed where it's drawn.

So three things are derived from a `CoreRuleNumber` and stored nowhere: `coreRuleDepthOf`, `coreRuleAncestorNumbersOf` and `isCoreRuleChapterNumber`. All three take the branded type, because each is a reading of the printed identifier and an arbitrary string has no such reading. `coreRuleAncestorNumbersOf` returns branded numbers by parsing each one, not by casting.

Three neighboring columns are stored, each for a different reason:

- `parent_number` is a foreign key. It proves no rule is orphaned. That's enforcement, not a cached derivation, and the database is the only place that can do it.
- `position` is a fact the number can't reconstruct, for the reasons in [one entry and its order](#one-entry-and-its-order).
- `kind` is derived, but by a heuristic over the body rather than from the number. It's stored anyway, because the heuristic is a judgment made at parse time, and it should be made once, visibly and under test, rather than re-run on every device.

The test is whether the identifier encodes it. If it does, derive it. If it doesn't, or if storing it lets the database enforce something, store it.
