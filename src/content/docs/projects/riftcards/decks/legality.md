---
title: "Deck Legality: Sections, Allowances and verifyDeck"
description: The five sections as a total record, CopyAllowance, the rule kinds, a verification that is derived and never stored, and prevention against report.
tags: [riftcards, domain-driven-design, typescript]
sidebar:
  order: 31
---

A Riftbound deck has to meet tournament rules: a set number of cards in each part of the deck, a limit on copies of one card, and a Chosen Champion that fits. In riftcards those rules are pure functions and data in one file, `features/deck/deck/deck-legality.ts`, and every closed set in them follows [closed unions](/typescript/closed-unions/). If you want to read one file of the app first, it's this one: it needs no knowledge of React, SQLite or navigation.

## The five sections as a total record

A deck has five **sections**, and `DeckSection` is the union of them: `legend`, `mainDeck`, `runeDeck`, `battlefield`, `sideboard`. It's the field on a deck entry and the only type for a section; there's no subset type. (A part of a deck is always a section. "Zone" means an area of the playing field in a match and isn't a deck word.)

Each section has a rule: a label, how many cards it needs, and how many copies of one card it takes.

| Section | Label | Required | Copies of one card |
| --- | --- | --- | --- |
| `legend` | Legend | 1 | 1 |
| `mainDeck` | Main deck | 40 | 3, shared with sideboard |
| `runeDeck` | Rune deck | 12 | unlimited |
| `battlefield` | Battlefields | 3 | 1 |
| `sideboard` | Sideboard | 10 | 3, shared with main deck |

Those rules are a [total record](/typescript/closed-unions/#a-union-that-indexes-a-table-gets-a-total-record) keyed by the section, with an accessor that always returns a row:

```ts
const SECTION_RULES_BY_SECTION: Readonly<Record<DeckSection, SectionRule>> = {
  legend: {
    section: "legend",
    label: "Legend",
    requiredCount: 1,
    copyAllowance: { type: "limited", copies: 1 },
  },
  // mainDeck, runeDeck, battlefield, sideboard …
};

function sectionRule(section: DeckSection): SectionRule {
  return SECTION_RULES_BY_SECTION[section];
}
```

Adding a sixth section to the union fails to compile until it has a rule. No caller recovers a rule from a failed `find` or falls back to the first row.

## Four counted sections, derived from the record

The legend is different from the other four. It's a single pick made in the first step of the builder, and it's checked on its own. The other four are filled from a pool of cards, in quantities, under copy limits.

For a while the code expressed that with a subtype, `ZoneSection`: `DeckSection` minus `legend`. On 2026-09-14 I deleted it. Renaming it would have kept a type defined by subtraction, and the legend would have belonged to no type at all. What was actually needed was narrower: two loops skip the legend. So the exclusion moved into those loops, as an ordered list derived from the record ([a subset is a derived list](/typescript/closed-unions/#a-subset-is-a-derived-list-not-a-subtype)):

```ts
const COUNTED_SECTION_RULES: readonly SectionRule[] = [
  SECTION_RULES_BY_SECTION.mainDeck,
  SECTION_RULES_BY_SECTION.runeDeck,
  SECTION_RULES_BY_SECTION.battlefield,
  SECTION_RULES_BY_SECTION.sideboard,
];
```

`verifyDeck` and the builder's `SectionSelector` iterate it. The legend is left out of a loop, never out of a type, and `copyAllowance("legend")` reads the legend's own rule rather than a separate `LEGEND_ALLOWANCE` constant.

## `CopyAllowance`: a limit that includes "no limit"

The rune deck takes any number of copies of a card; every other section has a number. So a copy limit is a `CopyAllowance`, never `number | null`:

```ts
type CopyAllowance = { readonly type: "limited"; readonly copies: number } | { readonly type: "unlimited" };
```

The reason is on ["no limit" is a variant](/typescript/closed-unions/#no-limit-is-a-variant-not-a-null): a remaining allowance of zero copies and "no limit" must never look alike. The functions around it each return an allowance:

- `copyAllowance(section)` is a section's limit. The main deck and the sideboard share one allowance of three (`SHARED_COPY_LIMIT`), so no one can hide extra copies of a card in the sideboard.
- `remainingCopies(entries, section, cardId, printingId)` subtracts the copies of that card already held in the sections sharing the allowance. It counts by `cardId`, so other printings of the same card use up the same three.
- `narrowerAllowance(left, right)` takes the tighter of two, with a match that has to cover every pair of variants.

The words are fixed too: **quantity** is how many of one printing sit on one entry, **copies** is a total across entries for one card, the **copy limit** is the rule and its number, and the **allowance** is the value that encodes it.

## Rules and violations

Each thing a deck can get wrong is a named rule, `DeckLegalityRule`, a union keyed by `kind`:

- `sectionRequired`: the legend section needs exactly one card.
- `sectionSize`: a counted section needs exactly its required count.
- `sectionCopyLimit`: too many copies of a card within one section.
- `sharedCopyLimit`: too many copies across the main deck and the sideboard together.
- `championRequired`: there's no Chosen Champion.
- `championIsChampionUnit`: the Chosen Champion must be a unit with the `Champion` supertype. The supertype alone doesn't settle it, because legends have it too, and `CHAMPION_UNIT` is the one place the pair is written down.
- `championInMainDeck`: the Chosen Champion is one of the main deck's cards, so the deck has to hold a copy of it there.

A broken rule becomes a `DeckLegalityViolation`: a `deckConstraint` for a rule about the deck as a whole, or a `cardConstraint` holding the offending `cardId` and its `printingIds`, so the builder can show which rows are involved.

Closed unions in riftcards discriminate on `type`, and a rule is a deliberate exception: it uses `kind`, because it sits inside a violation that already has a `type`. It isn't the only union keyed by `kind` in the code, though: `AnnotationSubject`, what a bookmark or note is about (`coreRule | card | deck`), is keyed by `kind` as well ([bookmarks and notes](/projects/riftcards/rules-and-notes/bookmarks-and-notes/)).

## `verifyDeck` derives a verification

`verifyDeck(composition, ruleset)` returns a `DeckVerification`: `legal` or `illegal` with its list of violations, and nothing else. There's no boolean and no `unverified` (retired on 2026-09-11, as told on [how a deck is stored](/projects/riftcards/decks/deck-storage/#what-the-keys-made-impossible)).

Its input is a `DeckComposition`, `{ entries, chosenChampion }`: a deck reduced to exactly what its rules read. Both a saved deck and the builder's in-progress draft reduce to one (`resolvedComposition` and `draftComposition`), which is what lets one function check both. The Chosen Champion arrives as a `ChosenChampion` of `{ cardId, typeId, supertypeId }`, the kind of card it is rather than a whole `Card`, because that's all the rules check. `TournamentRuleset` is `{ id, format, version }`, and `RIFTBOUND_STANDARD` is the only one.

A verification is **derived, never stored**. The catalog data a verification reads changes with each seed, and tournament rules change too, so a stored verdict would go stale without anyone noticing.

A deck that breaks a rule is **illegal**, never "invalid". Validation is what a schema does to data at a boundary; legality is a judgment about a deck against a ruleset.

## Prevention against report

A rule can be enforced at more than one point, and riftcards uses exactly two for each: [prevent at one boundary, detect at the other](/architecture/expected-and-unexpected-failure/#prevent-at-one-boundary-detect-at-the-other).

Take the Chosen Champion. The builder's champion pool queries only champion units, so the screen never shows anything else to pick. That's prevention. `verifyDeck` still checks `championIsChampionUnit`, because data arrives from places the pool doesn't filter: there was already a saved deck naming a legend as its champion, and deck import is planned. That's detection, and it stays even though the UI can't break the rule.

When I first put the champion fix in, it added a third check between the two. `chooseChampion` returned `{ type: "chosen" } | { type: "notChampionUnit" }`, and its only caller handled `notChampionUnit` by returning the draft unchanged: a silent no-op for a state no press could reach. I decided the middle check had to go, and deleted it on 2026-09-13, 37 lines lighter. It failed both tests I now apply to such a branch: can a person actually cause the failure, and does the check have a reachable branch? If the honest answer needs a comment saying "this can't happen", the branch goes.

## The rune deck's overfill stop is not a rule

The builder stops someone from adding a thirteenth rune, but lets the main deck, battlefields and sideboard sit over or under their targets. That looks like an inconsistency and is a choice (made 2026-09-11).

The domain already owns each target and reports a section that misses it, as a `sectionSize` violation. What the builder adds for the rune deck is prevention instead of report, for the one section where an overfill is never intentional: runes are interchangeable filler, while the other three sections get built up over time. So `copiesTheBuilderWillAdd` in `deck-build-allowance.ts` returns a `limited` allowance of the rune deck's free slots, and `unlimited` for every other section. The builder then takes the narrower of that and the domain's `remainingCopies`. Neither `verifyDeck` nor `saveDeck` reads the cap, and `saveDeck` deliberately doesn't enforce section sizes either: a deck in progress has to save.

How the builder uses all of this is on [the deck builder](/projects/riftcards/decks/deck-builder/).

## Why the rules are pure

Plenty of apps check rules wherever they're needed, including in a component that queries the database. Riftcards keeps the deck rules pure: plain synchronous functions over values, with no I/O.

The practical reason is the builder. It checks legality on every press of a quantity stepper. If `verifyDeck` needed I/O, each press would be an async round trip, or the rule would be copied into the presentation code to return synchronously. That second thing happened before the rules moved: `copiesHeldElsewhere` in the domain and `copiesOfName` in the builder implemented the same copy limit over two different data structures.

The alternative, rules where they're used, is faster to write and drifts. Two copies of a copy limit is one copy too many for a rule the whole game counts by. A pure domain is also the only part of the codebase you can read without knowing React, SQLite or navigation, which is why `deck-legality.ts` is where I'd send someone new.
