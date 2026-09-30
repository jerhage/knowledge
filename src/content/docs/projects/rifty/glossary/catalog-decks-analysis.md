---
title: "Glossary: Catalog, Decks and Analysis"
description: The words for browsing, deck parts and rules, drafts, verification, and analysis.
tags: [rifty, naming-conventions, domain-driven-design]
sidebar:
  order: 101
---

This is the second page of the Rifty glossary, which keeps [one word per concept](/practices/one-word-per-concept/) across prose, code and screen. It covers where cards live (the catalog, the two data stores, the builder's pool), the parts of a deck and the rules that check one, and the analysis feature's words. The card words it builds on (`Card`, `CardId`, `PrintingId`, type, domain) are on [cards, printings and sets](/projects/rifty/glossary/cards-and-sets/), and the rulings that settle competing words are on [the rulings page](/projects/rifty/glossary/rulings/).

## Where cards live

### catalog

The whole browsable body of cards, and the part of the app that browses it. `features/catalog` owns no model and no persistence: at the latest commit (2026-09-17) it's 14 files of query criteria, the query hook, the hook that opens a picked card, the search screen and its header, the bookmarked filter, the grid and the filter sheet. The sort vocabulary used to live here too; it moved into the card feature on 2026-09-13, and the bookmarked filter arrived on 2026-09-16. It's a *reader* of the card and set features.

The catalog currently browses **printings**: `SqliteCardRepository` always selects `from(cardPrintings).innerJoin(cards, …)`, so a page of cards is a page of printings. Browsing by card is queued, not built.

`catalogOrder` is the default ordering: set code, then collector number cast to an integer, then the raw text, then id. More on [browsing the catalog](/projects/rifty/cards/catalog-browsing/).

### reference data, deck data

One SQLite file, three stores. **Reference data** is the seeded, read-only data: `reference-schema/`, `reference-data-store.ts`, `reference-seeder.ts`, and the generated `catalog-seed.ts` and (since 2026-09-15) `core-rules-seed.ts`. **Deck data** is what a person writes about decks: `deck-schema/`, `deck-data-store.ts`. Since 2026-09-16 the third store beside them is **annotation data**, for a person's bookmarks and notes: `annotation-schema/`, `annotation-data-store.ts`.

The file is called `catalog.db` for historical reasons, and renaming it would orphan the data on every installed device. That's recorded in `open-app-data-store.ts` and isn't a naming precedent. More on [SQLite, Drizzle and the migrations](/projects/rifty/persistence/sqlite-and-drizzle/).

### pool

The cards someone may pick from in a deck builder picker, narrowed by filters: the builder's candidate list. `SectionPoolFilters`, `SectionPoolView`, `SectionPoolLayout`, `poolCriteria`, `SectionPoolData`, `PoolSheet` and `useSectionPool`, in `features/deck/presentation/`.

A pool isn't a section of a deck and it holds no quantities. `poolCriteria(section, …)` narrows it to the card types a section accepts and, by default, to the legend's domains.

The word has two other uses. `poolCode` on a printing is a release concept and always has its suffix. The analysis feature's `poolSize` is a third meaning, and whether it stays is [still open](/projects/rifty/glossary/rulings/#poolsize-or-librarysize).

### criteria, filters, sort

**Criteria** is what goes to the database. `CardListCriteria` in `src/features/card/card-list-criteria.ts` is the query language of the card feature's port (the interface the SQLite adapter implements), and this is all of it: `riftboundIds`, `setCodes`, `typeIds`, `supertypeIds`, `rarityIds`, `domainIds` (AND), `anyDomainIds` (OR), `withinDomainIds` (every domain the card has is in the given set, which is how the champion pool keeps to the legend's domains), `tagIds`, `keywordIds`, `championNames`, `onlyBookmarked`, `energy`/`might`/`power` as a `CardNumericFilter`, `search`, `sort`, `limit`, `offset`. That's nineteen fields as of 2026-09-17.

An earlier version of this entry listed thirteen of what were then eighteen, silently leaving out `riftboundIds`, `supertypeIds`, `rarityIds`, `withinDomainIds` and `championNames`. Three of those are what the champion pool is built from (`champion-pool-data.tsx`) and two are what the catalog counts as active filters, so they weren't unused fields. A partial list here reads as a closed one, so when the schema grows, this line grows in the same commit. (It grew again on 2026-09-16, when `onlyBookmarked` arrived so the catalog could show only bookmarked cards.)

**Filters** is what someone has selected in the UI, before it becomes criteria. `SectionPoolFilters` is `{ domainIds, keywordIds, typeIds }`, and `poolCriteria` turns it into criteria.

Filter in the database. Extend `CardListCriteria` and the adapter; never narrow a fetched page in JavaScript. (The one recorded exception is the core-rules search, on [searching the core rules](/projects/rifty/rules-and-notes/rules-search/).)

`CardSort` is a discriminated union, not a string. Catalog order is one of its variants, `{ type: "catalogOrder" }`, and the catalog and the builder's pool always hold a sort. Until 2026-09-17 the UI expressed catalog order as an **absent** sort instead; `sort` is still optional in `CardListCriteria`, and the adapter reads a query with no sort as catalog order.

## Deck

### deck

`src/features/deck/deck/deck.ts`. `{ id, name, createdAt, updatedAt, chosenChampionCardId, entries }`. A saved deck deliberately permits incomplete and illegal compositions; it enforces only what's needed to store quantities unambiguously. More on [how a deck is stored](/projects/rifty/decks/deck-storage/).

### entry / `DeckEntry`

One row of a deck: `{ section, cardId, printingId, quantity }`. The first three are the primary key together with the deck, so a deck has one quantity entry per printing per section.

Both ids are stored and neither is redundant. `printingId`, because a deck is a physical object and you own a particular art. `cardId`, because every rule in the game counts by card.

`entry` means a deck entry. It isn't a loop variable for anything else; see [the ruling on `entry`](/projects/rifty/glossary/rulings/#entry-means-a-deck-entry).

### section / `DeckSection`

`DeckSection` is the five-member union `legend`, `mainDeck`, `runeDeck`, `battlefield`, `sideboard`. It's the field on an entry and the word for the value, and it's the only type for one: there is no subset type. `DECK_SECTIONS` is the ordered array of all five.

A part of a deck is a section, and nothing else is. `zone` means an area of the playing field in an actual match. See [the ruling on `section`](/projects/rifty/glossary/rulings/#section-is-the-deck-word-zone-is-not-a-deck-word-at-all).

### section rule / `SectionRule`

`{ section, label, requiredCount, copyAllowance }`. The convention is the total record `SECTION_RULES_BY_SECTION` (a record with a row for every section, so a missing row fails to compile) with its accessor `sectionRule(section)`. It covers all five sections, the legend included.

| section | label | required | copies of one card |
|---|---|---|---|
| `legend` | Legend | 1 | 1 |
| `mainDeck` | Main deck | 40 | 3, shared with sideboard |
| `runeDeck` | Rune deck | 12 | unlimited |
| `battlefield` | Battlefields | 3 | 1 |
| `sideboard` | Sideboard | 10 | 3, shared with main deck |

Two subsets of the five are named in code, and each is named for what selects it rather than for being "the main ones". `PLAYABLE_DECK_SECTIONS` in `deck-label-format.ts` (legend, main deck, rune deck, battlefields) is the deck proper, used by `deckCardCount` because the sideboard is counted and shown separately. It was `MAIN_SECTIONS` until 2026-09-14, a name that gave no reason the sideboard was out and collided with the `mainDeck` section it contains.

`COUNTED_SECTION_RULES` is the array derived from that record for the four sections a deck fills with a count. The legend is one pick and is verified on its own by `singletonViolations`, so it's left out of a **loop**, never out of a type. `copyAllowance("legend")` reads the legend's own rule; there's no `LEGEND_ALLOWANCE` constant. More on [deck legality](/projects/rifty/decks/legality/).

### legend

The word has two senses, and they're consistent. `Legend` is a `CardType`; `legend` is the deck section that holds exactly one card of that type. The legend starts in play, sets which domains the deck may draw its cards from, and sits outside every count.

### champion, and **chosen champion**

The deck's champion is always the **Chosen Champion**, spelled `chosenChampion` in code.

```ts
interface ChosenChampion {
  readonly cardId: CardId;
  readonly typeId: CardType;
  readonly supertypeId: TaxonomyId | null;
}
```

It's a card, not a printing, because which champion you're playing is a gameplay fact. `chosenChampionCard()` resolves it to a seated printing only for display.

Three rules bind it, each a named `DeckLegalityRule` (defined below): `championRequired`; `championIsChampionUnit`, because it must be a champion unit (`typeId: "Unit"` with `supertypeId: "Champion"`); and `championInMainDeck`, because it's one of the main deck's cards and shares its three copies with them.

`ChosenChampion` holds the kind of card it is rather than the whole `Card`, because that's all the rules check. `chosenChampionOf(card)` reduces a catalog card to it.

The word "champion" also names a supertype, a card's `championName` association, and a `PrintingFinish`. See [the ruling on `champion`](/projects/rifty/glossary/rulings/#champion-alone-is-never-the-chosen-champion-in-a-type-name).

### draft

A value being edited that hasn't been committed. Each kind is accurately named:

- `DeckBuildDraft` (`deck-build-steps.ts`): the builder's whole in-progress deck. It holds `Card` objects, not ids: `{ name, legend, chosenChampion, sectionCards }`.
- `DeckDraft` (`use-cases/save-deck.ts`): what `saveDeck` is given, `{ id, name, createdAt, chosenChampion, entries }`. It's already reduced to entries.
- the `draft` of `useDraftSheet`: the pending, unapplied state of a bottom sheet, beside its `applied` value.

The two deck types never appear in one file; the builder reduces one to the other at the boundary between them. Whether `DeckDraft` should be named for the save request instead is [still open](/projects/rifty/glossary/rulings/#deckdraft-or-a-name-for-the-save-request).

There was a fourth kind when I first wrote this entry, and its name was wrong: the prop of `DeckSaveData` (the data component that performs a save) was a `DeckSaveDraft`, which wasn't a value being edited but the argument of a save someone had already started. I renamed it on 2026-09-14 to `DeckSaveRequest`, prop `request`. More on [the deck builder](/projects/rifty/decks/deck-builder/).

### composition / `DeckComposition`

`{ entries, chosenChampion }`: a deck reduced to exactly what its own rules read. Both `resolvedComposition(resolvedDeck)` and `draftComposition(draft)` produce it, which is what lets `verifyDeck` check a saved deck and a draft with one function.

### resolved deck / `ResolvedDeck`

A deck paired with its cards, so nothing downstream looks a printing up again: `{ deck, entries: ResolvedDeckEntry[], chosenChampionCard }`, where a `ResolvedDeckEntry` is `{ card, quantity, section }`.

"Resolved" means the ids have been turned into the things they name. `findResolvedDeck` throws rather than render a deck whose contents are silently short, and the foreign keys make an unresolvable entry impossible in the first place.

`ResolvedDeckEntry` declares its own `card`, `quantity` and `section` rather than extending the analysis feature's `CardCopy`. The two repeated lines mark the boundary between the features.

### deck contents

`deck-contents.ts`. `deckCards(entries, sections)` reduces entries to `CardCopy` values for analysis. `deckGroups(entries)` arranges them into the seven display groups: Legend, Units, Spells & Gear, Runes & Battlefields, Rune deck, Battlefields, Sideboard.

A group is a display arrangement; a section is a stored field. A group may span sections or split one by card type.

### quantity, copies, allowance, copy limit

- **quantity:** how many of one printing sit on one entry. `entry.quantity`, `CardCopy.quantity`.
- **copies:** a total across entries for one card. `copiesByCard()` returns `{ copies, printingIds }` per `CardId`.
- **copy limit:** the rule and its number. `SHARED_COPY_LIMIT = 3`, the rule kinds `sectionCopyLimit` and `sharedCopyLimit`, and the use-case result variant `copyLimitExceeded`.
- **allowance:** the value that encodes a limit, including "no limit": `CopyAllowance = { type: "limited"; copies } | { type: "unlimited" }`. Never `number | null`, because a null would have to mean "no limit" by convention, and a union encodes it. `remainingCopies(...)` returns one; `narrowerAllowance` takes the tighter of two.

The main deck and the sideboard share one allowance of three, so no one can hide extra copies of a card in one of them.

### verification, legality, rule, violation, ruleset

- **`verifyDeck(composition, ruleset)`** returns a **`DeckVerification`**: `legal | illegal`, and nothing else. There's no `unverified` and no boolean.
- **legality** is the subject matter: the module `deck-legality.ts` and the formatter `deck-legality-format.ts`. It isn't a value.
- **`DeckLegalityRule`** is the named constraint, a union keyed by `kind`: `sectionRequired`, `sectionSize`, `sectionCopyLimit`, `sharedCopyLimit`, `championRequired`, `championInMainDeck`, `championIsChampionUnit`.
- **`DeckLegalityViolation`** is one broken rule, either `deckConstraint` or `cardConstraint`. A `cardConstraint` holds the offending `cardId` and its `printingIds`.
- **`TournamentRuleset`** is `{ id, format, version }`. `RIFTBOUND_STANDARD` is the only one.

A verification is derived, never stored, because catalog data and tournament rules both change.

Say "illegal", not "invalid". Validation is what Zod does at a boundary where data enters; legality is a judgment about a deck against a ruleset.

### build step

`DeckBuildStepId` is `legend | chosenChampion | sections`, with `DECK_BUILD_STEPS_BY_ID` as the total record. A **step** is a stage of the builder. `DeckBuildMode`, in `deck-build-mode.ts`, is `create | edit`: which session you're in, not where in it you are. It was `DeckBuildStart` with the values `new | edit` until 2026-09-14; see [a mode is a state, not an action](#settled-2026-09-14-a-mode-is-a-state-not-an-action) below.

## Analysis

The analysis feature measures a multiset of cards: curves, mixes and draw odds. It must not name a deck, because a deck term surviving in the wrong module is the leading sign of a dependency about to come back. (Analysis was extracted from the deck feature; the story is on [extracting analysis without a cycle](/projects/rifty/architecture/extracting-analysis/).)

### `CardCopy`

`{ card, quantity }`. The only input type analysis accepts. The caller selects which sections are in scope, so nothing in a curve or a speed mix references sections, legality or champions. Until 2026-09-14 the caller also passed a pinned `Card` rather than a champion, for the draw odds of one card (see **pinned** below).

### curve, mix, odds

- **curve:** counts per bucket of an attribute. `energyCurve` and `mightCurve`, each a `CurveBucket[]` of `{ label, count }`.
- **mix:** shares of a whole. `speedMix` gives `SpeedShare[]`; `keywordMix` gives `{ carrying, keywords }`. There's no "tally": this heading used to list one and never defined it, and `KeywordTally` was the only thing that used the word. It's been `KeywordMixPanel` since 2026-09-14. A count of shares is a mix.
- **odds:** a probability. `drawOdds` gives `{ poolSize, copyOdds }`, computed hypergeometrically by `atLeastOneChance`. Each `CopyOdds` applies to any card held at a given number of copies.
- **pinned:** the one card passed to a panel, as opposed to the aggregate. `PinnedOdds` held it, named `pinned` and never `champion` because analysis has no concept of a champion. I dropped the chosen champion's own draw odds on 2026-09-14, and `PinnedOdds` went with them.

More on [analysis: curves, mixes and draw odds](/projects/rifty/decks/analysis-and-draw-odds/).

### hand, opening hand, mulligan

`OPENING_HAND_SIZE = 4`, `MULLIGAN_LIMIT = 2`, `TURN_THREE_CARDS_SEEN = 6` (one draw a turn on top of the opening four), `EARLY_PLAY_ENERGY = 2`.

`dealHand` returns a `DealtHand` of `{ hand, pool, cursor }`; `mulliganHand` returns a `MulliganedHand`. `handStats` gives `HandStats`, whose `verdict` is a `HandVerdict` of `keepable | risky`.

`opening` here means "in the opening hand". The hooks that open a card's detail use the same word for showing a card. The two never meet in one module, and I keep it that way.

## Settled 2026-09-14: the chosen champion is not a section

A deck has five sections: legend, main deck, rune deck, battlefields, sideboard. That's `DECK_SECTIONS`, and it's complete.

The chosen champion is a main deck card that the deck designates. It isn't a sixth section. The deck points at it with `chosenChampionCardId`, and its copies are main deck copies, which is why the rule says the main deck has to hold one and why its three copies are shared rather than separate.

On the playing field the Chosen Champion occupies a zone of its own. That's the field, not the deck list, and it doesn't make the champion a section. This is the clearest case of why the two words are kept apart: the same card is a **main deck card** in the deck and sits in the **champion zone** in play.

The builder's draft may hold the legend and the chosen champion outside its section map. The draft is a view of a deck under construction, not the deck. Holding each as a single pick makes "exactly one" true by construction and passes the card directly to the champion pool, the pick chips and the default filters. The saved deck has no such split: it stores the legend as an ordinary entry. The pick was a `Card | null` until 2026-09-17; it's now a `DeckBuildPick`, `{ type: "notPicked" } | { type: "picked"; card }`.

I'll revisit this only if it causes a real problem. The known cost is that `sectionCards.legend` is always empty, so one pass of any loop over the map does nothing.

## Settled 2026-09-14: a mode is a state, not an action

A mode is what you're in, for as long as you're in it. It isn't a point in time and it isn't a verb you just performed.

The deck builder has two modes, `create` and `edit`. You're in create mode from the moment you start a new deck until you save it: you haven't created anything yet, and it doesn't matter which of the three steps you're on. You're in edit mode from the moment you open an existing deck until you save. Nothing about the current step changes the mode.

That's why `DeckBuildMode` is the right name and `DeckBuildStart` wasn't. A "start" is an instant; the value describes the whole session. It also settles what the type looks like: a mode may hold data (`edit` holds the `ResolvedDeck` it opened), because the data belongs to the state, not to the moment it began.

The test for the word: if it stops being true one step later, it's an action, not a mode. If it stays true until something ends it, it's a mode.

A consumer that only distinguishes the modes takes `DeckBuildMode["type"]`, not the union. The progress header renders a label and reads no deck.
