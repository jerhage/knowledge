---
title: "Glossary Rulings: Which Word Wins"
description: Every ruling where two words competed, the naming rules for variables and functions, the banned words, and what is still open.
tags: [riftcards, naming-conventions, domain-driven-design]
sidebar:
  order: 103
---

This is the last page of the riftcards glossary, which keeps [one word per concept](/practices/one-word-per-concept/) across prose, code and screen. The other three pages define the words: [cards, printings and sets](/projects/riftcards/glossary/cards-and-sets/), [catalog, decks and analysis](/projects/riftcards/glossary/catalog-decks-analysis/), and [core rules, annotations and the screen](/projects/riftcards/glossary/core-rules-annotations-screen/). This page records the conflicts: each place where two words were in use for one thing, or one word for two, and which one won and why. It also has the naming rules that reach variables and functions, the words I don't use, and the two questions still open.

## Rulings: which word wins

A ruling is binding. Where the code doesn't match one, the code is what changes.

### `cardId` never names a `PrintingId`

A `CardId` is a card's identity and a `PrintingId` is one printing's (both are defined on [cards, printings and sets](/projects/riftcards/glossary/cards-and-sets/#cardid)). Both are strings underneath, so nothing stops a variable called `cardId` from holding a printing id except the name.

Winner: the name follows the type. A `CardId` is `cardId`; a `PrintingId` is `printingId`.

Fixed on 2026-09-14. Five places called a `PrintingId` `cardId`, and three more called one `id`: `CardFinder.get`, `findCard` and `SqliteCardRepository.get`. All eight are now named `printingId`. A sweep for the reverse found nothing: no `printing*` identifier holds a `CardId`.

The route parameter in `cards/[id]` is a printing id, and it's untouched. It's a path segment, and renaming it would change URLs and deep links. The URL segment may stay `id`; what the code parses it into must not, and that was renamed.

The rule reaches test fixtures, which is where a wrong name does the most damage, because every test that reads a fixture repeats it. Also fixed on 2026-09-14: `tests/card/fixtures.ts` took `card(id, …)` and built a printing from it; the parameter is now `printingId`.

### `attributes` means `{ energy, might, power }` and nothing else

On a Riftbound card, energy, might and power are the three numbers; the app calls them the card's attributes.

Winner: `attributes`, narrowly. A finish isn't an attribute. A type isn't an attribute. A rarity isn't an attribute. The reason is that a name fixes everything it covers: when a formatter named `formatCardAttributes` started returning a finish too, every caller written against the name was silently wrong.

A function that returns attributes and something else names both: `formatCardTypeAndAttributes`, `spokenCardTypeAndAttributes`. A function named `formatCardAttributes` returns exactly the three.

The word reaches style names too. Fixed on 2026-09-14: `styles.stats` held the attribute line and became `styles.attributes`, and `styles.cost` held energy and became `styles.energy`. "Stats" and "cost" were each a second word for something the glossary had already named. The catalog's sort option changed label with them: "Energy cost" now reads **Energy**.

### a card's `name` is `Card.name`, unaltered

A `Card` carries three name-like strings: `name` (shown on screen), `cleanName` (a search key) and `cardId` (the card's identity, which reads like a name). They're defined on [cards, printings and sets](/projects/riftcards/glossary/cards-and-sets/#name-cleanname-printedname).

Winner: `name`, unaltered. Never compose a display name, never append a finish, never show `cleanName` where a name belongs.

This ruling used to read "a card's `name` is what Riot printed". That half is no longer true, and the binding half never depended on it: since 2026-09-13 the seed writes each printing's repaired, normalized name into `printed_name`, so `Card.name` is the card's name rather than the feed's string. What the ruling forbids is unchanged: the app doesn't alter, compose or substitute the name it's given.

`cleanName` is a search key and is never rendered.

`cardId` is an identity first, but I ruled on 2026-09-14 that a Riftbound card's id **is** its name. So the builder's pick chips, which show a picked card's `cardId` as its name, are correct and not a violation. The same held for `PinnedOdds.name`, which `draw-simulation.ts` filled with `pinned.cardId` and `DrawOddsPanel` rendered as a row label, until the pinned odds were dropped on 2026-09-14. Since 2026-09-13 the two strings are also equal on every row, because `printed_name` equals `card.id` on all 1429 printings.

`name` is also not the word for what someone typed into a search box. Fixed on 2026-09-14: the catalog's `name` / `setName` / `onChangeName` are `query` / `setQuery` / `onChangeQuery`, and `CardNameSearchScreen` is `CatalogSearchScreen` in `catalog-search-screen.tsx`. The field has searched names *or* rules text since `CardSearch` gained its `nameOrRulesText` variant, so both old names described one of three cases.

### `tag` beats `trait`

Every card has tags from the feed's taxonomy, and each tag has a kind: `character`, `region` or `trait`.

Winner: `tag`. The table is `tag`, the column is `tag_id`, the model field is `tags` (it was `tagIds` until 2026-09-17, when each tag started reaching the model with its stored name), and the criteria field is `tagIds`. A **trait** is one of the three tag kinds, 21 of the 129 tags, beside `character` (97) and `region` (11).

Fixed on 2026-09-14: `CardTraitLine`, which took `tagIds` and called its local variable `traits`, is `CardTagLine` in `card-tag-line.tsx`, and its local `traits` became `tags`. It renders every tag a card has, which is what its name now describes. Since 2026-09-17 it takes the tags themselves as its `tags` prop and shows each one's stored name.

One consequence: `kind` is dropped at the mapper and never reaches `Card`, so the app **can't** currently show traits separately from character and region tags. The rename didn't change that. If showing them separately is ever wanted, the kind has to reach the model first, and only then does a component called `CardTraitLine` become possible at all.

`tag` is also not a word for a visual shape. Fixed on 2026-09-14: `DomainMarkLayout` was `"segment" | "tag"` and is now `"segment" | "pill"`, so the one word `tag` names the one concept this ruling gives it.

### `section` is the deck word; `zone` is not a deck word at all

A deck has five parts: legend, main deck, rune deck, battlefields and sideboard. In the game, "zone" is something else: an area of the playing field during a match.

Winner: `section`, as the noun and as the qualifier. It's the field on an entry (`entry.section`), the type (`DeckSection`), the parameter name everywhere in `deck-legality.ts`, the prefix on every builder type (`SectionRule`, `SectionPool*`, `SectionSelector`, `SectionsStep`, `SectionsPane`), the builder's third step id `"sections"`, and the label the interface shows.

`zone` is an area of the playing field in an actual match and has no deck sense, not even as a qualifier. I settled that on 2026-09-14 and applied it across the code the same day; see [`zone` is not a deck word](#settled-2026-09-14-zone-is-not-a-deck-word) below.

An earlier version of this entry allowed `zone` as a qualifier. The argument was that `ZoneSection` was defined *by subtraction* from `DeckSection`, and calling the subset a section would leave the legend belonging to a type whose name implied it wasn't one. That subtype is deleted, which removes the argument with it: the problem was the subtraction itself.

### `pane` and `panel` are different words

On a tablet, a screen can show two slots of content side by side; inside a scrolling screen, content sits in titled boxes. Both are defined on [core rules, annotations and the screen](/projects/riftcards/glossary/core-rules-annotations-screen/#pane).

Both words win, for different things. A pane is a slot in the frame beside another slot. A panel is a titled box inside a scroll view.

An earlier version of this entry said the code was already consistent. It wasn't: `sections-step-columns.tsx` sized the builder's **pane** with `PanelMaxWidth`, `panelWidthFor` and `styles.panel`, none of which described a titled box. Fixed on 2026-09-14: they're `PaneMaxWidth`, `paneWidthFor` and `styles.pane`.

### `entry` means a deck entry

A `DeckEntry` is one row of a deck: a section, a card, a printing and a quantity.

Winner: `entry`, reserved. It's one row of `deck_card`. It isn't a loop variable for a `CardCopy`, a `CopyOdds`, a `SpeedShare`, a `KeywordShare` or a placed card, because a reader seeing `entry` should know it's a stored deck row without looking up the type.

Fixed on 2026-09-14: `card-metrics.ts`, `draw-simulation.ts`, `card-copy.ts`, `speed-mix.tsx`, `draw-odds.tsx` and `section-pool-list.tsx` all called a `CardCopy` or a placed card `entry`. Each loop variable is now named for what it holds: `copy` for a `CardCopy`, `odds` for a `CopyOdds`, `share` for a `SpeedShare`, `placed` for a placed card. `held` went the same way: it named a `CardCopy` or a `Card` and is now `copy` or `card`.

### `champion` alone is never the Chosen Champion in a type name

Every deck designates one champion unit from its main deck as its Chosen Champion. But "champion" means other things in Riftbound too.

Winner: `chosenChampion` for the deck's champion. The word "champion" has four meanings in the game, and only naming discipline keeps them apart:

| use | where | reached as |
|---|---|---|
| the deck's Chosen Champion | `deck.ts`, `chosen-champion.ts` | `chosenChampion`, `chosenChampionCardId`, `ChosenChampion` |
| the `Champion` supertype | taxonomy | `classification.supertypeId` |
| the champion a card belongs to | `card.championName` | `championName` |
| a foil treatment | `PrintingFinish` | `finish === "champion"` |

Inside code that's unambiguously about the Chosen Champion (`championViolations`, `pickChampion`, `ChampionPane`, a parameter typed `ChosenChampion`) the bare word is fine. Crossing out of that context, it isn't.

### `criteria` is what the database gets; `filters` is what the person picked

A card list goes through two stages: what someone picks in a filter sheet, and the query that goes to the store.

Both words win, at different stages. `SectionPoolFilters` → `poolCriteria()` → `CardListCriteria` is the pipeline, and it reads correctly.

The catalog skips the middle stage and holds `CatalogQueryCriteria` in UI state directly, which is why `activeFilterCount(criteria: CatalogQueryCriteria)` counts criteria under the name filters. That's the one place the two words touch. It's tolerable, and it shouldn't spread.

### `layoutClass` is never shortened to `layout`

`LayoutClass` is `phone | tablet`, the class of the frame.

Winner: the two-word term, because `layout` alone already means "list or grid" in `SectionPoolLayout`. A variable of that type is `poolLayout`, never `layout`.

Applied on 2026-09-14: `SectionPoolList` was the only place that already wrote it that way; the pool hook's `layout`/`setLayout` and the toggle's prop are now `poolLayout`/`setPoolLayout` everywhere.

### `verification` is the result; `legality` is the subject

`verifyDeck` checks a deck against the tournament rules.

Winner: `verification` for the value. `verifyDeck` returns a `DeckVerification`. Nothing returns a "legality". `legalityColor(verification, theme)` is correctly named for what it reads.

Fixed on 2026-09-14: the two variants of the union were `LegalDeck` and `IllegalDeck`, which named a deck rather than the judgment about one. A verification is derived and a deck is stored, so the names misdescribed the lifetime as well as the type. They're `LegalVerification` and `IllegalVerification`. The label formatter went with them: `completenessLabel` is `legalityLabel`, and the word it renders for an illegal deck changed from **Incomplete** to **Illegal**, because a deck can be complete and still illegal.

### `summary` is a projection, not a formatted line

Winner: `summary` means a narrower projection of a model, fetched separately. `CardSummary` fits that.

`deck-summary-format.ts` produced labels (`deckCountLabel`, `editedLabel`), and no `DeckSummary` type ever existed. Fixed on 2026-09-14: it's `deck-label-format.ts`, which is what it always was. `deckListLabel` went with it: it formatted a count of saved decks, not a list, and is `savedDeckLabel`. Its text changed with its name: "1 list" / "3 lists" now read **1 deck** / **3 decks**, and "Build your first list" reads "Build your first deck", because a deck is a deck.

### `Result` is the word for what a use case returns

A use case (one operation, such as finding a card or saving a deck) returns a named union of what can happen, one variant per case.

Winner: `Result`, as in `FindCardResult` and `SaveDeckResult`. No second word in a type name: no `Outcome`, no `Response`. The ban covers type names only. In prose, "outcome" is fine for what happened.

Riftcards also doesn't use a generic `Result<T, E>` discriminated by an `ok` boolean; each use case gets its own named union. That's a choice with a trade-off, not the only way: [expected and unexpected failure](/architecture/expected-and-unexpected-failure/) sets the two options side by side, and [use cases, results and failure in riftcards](/projects/riftcards/architecture/use-cases-and-failure/) says why I picked named unions.

### `data component` is the word; read and write are its kinds

A data component is a component that owns one read or one write against the app's data. A read data component runs the query and hands its children the resolved data; a write data component hands its children a described action to perform. [Data components in riftcards](/projects/riftcards/presentation/data-components/) shows them in the code.

Two words were in use for this thing. The code and most of my notes said "data component", and the component names follow it (`CardsData`, `DeckSaveData`). My notes on the generic structure said "read boundary" and "write boundary". That's the one-word-per-concept problem this glossary exists to stop, so I ruled on it when I wrote these pages up.

Winner: **data component**. "Read data component" and "write data component" are its two kinds. "Boundary" stays in prose only, to explain what a data component does, never as the name of the thing.

## Naming rules that reach variables

A variable's name follows its type, not its call site.

| holds | call it | never |
|---|---|---|
| one `Card` | `card` | `printing`, `cardPrinting` |
| a `PrintingId` | `printingId` | `cardId`, `id` |
| a `CardId` | `cardId` | `id`, `name` |
| a `CardSummary` | `card` or `summary` | `cardSummary` where the type is already visible |
| a `DeckEntry` | `entry` | `row`, `item` |
| a `CardCopy` | `copy` | `entry`, `held` |
| a `ResolvedDeckEntry` | `entry` | `card` |
| a `DeckSection` | `section` | `zone` |
| a `CopyAllowance` | `allowance` | `limit`, `max` |
| a `DeckVerification` | `verification` | `legality`, `result`, `status` |
| a `LayoutClass` | `layoutClass` | `layout`, `size`, `device` |
| a `SectionPoolLayout` | `poolLayout` | `layout` |

**A plural names which thing there are several of.** `cards: readonly Card[]` is several cards as printed. `printings` means printings without their cards.

An earlier version of this rule claimed the word `printings` didn't appear in the code. It appears throughout `scripts/catalog-seed.ts` (`printings`, `currentPrintings`, `withoutPoollessDuplicates`, `printedPrintings`, `group.printings`), and it's correct there, because the seed pipeline genuinely holds `NormalizedPrinting` values before it groups them under cards. What's true is narrower: no identifier under `src/` is a `printings` array, because the app has no printing without its card. If one ever appears there, it must mean exactly that. `printingIds` on a violation is right: those are ids, and there's no card among them.

**A pair type names the pair, not one half.** `CardCopy` is `{ card, quantity }`, not `Card` with a count bolted on.

**A component or function that formats a line is named for the line, not the data.** `buildCardLabel(card, quantity)`, `deckCountLabel(deck)`, `saveReadinessLabel(verification)`, `sectionRuleSummary(section)`. Not `formatCard`, not `getLabel`.

**A formatter's name lists everything it returns.** `formatCardTypeAndAttributes` returns a type and attributes. If it gains a third thing, the name gains a third thing or the function is split.

**A spoken label's name marks it as spoken.** `spokenCardTypeAndAttributes`, `spokenEditedLabel`: the screen-reader counterpart of a visual label, because a screen reader reads `"3E · 5M"` as "three E dot five M".

**A capability is named for what it provides.** `CardFinder`, `CardLister`, `DeckSaver`, `SetLister`, `Clock`, `IdGenerator`, `RandomSource`. Never for the library or the store inside it.

**A hook is named for what it does and where it wires.** `useOpenCardHapticLongPress` names the gesture, the action, and that a physical side effect fires. `useHapticLongPress` named only the mechanism, which invited the wrong question about what it was for.

**A data component is `<Thing>Data`.** `CardsData`, `CardSummariesData`, `CardDetailData`, `KeywordsData`, `DeckDetailData`, `SectionPoolData`. It owns the query lifecycle and passes its children resolved data.

**A closed union's discriminant is `type`, except a rule's, which is `kind`.** `DeckLegalityRule` uses `kind` because it sits inside a violation that already has a `type`, and that exception is deliberate. It isn't the only one any more: `AnnotationSubject`, added on 2026-09-16, is keyed on `kind` too.

## Words I do not use

| banned | say instead | why |
|---|---|---|
| **chrome** | shell, layout | jargon naming nothing a reader can point at |
| **`Card.id`** | `cardId` or `printingId` | the field someone would reach for by habit must not exist |
| **invalid deck** | illegal deck | validation is a boundary concern; legality is a judgment |
| **unverified** | (nothing) | retired 2026-09-11; `verifyDeck` returns `legal \| illegal` only |
| **`deckSize`** (in analysis) | `poolSize` | analysis must not name a deck |
| **`ChampionOdds`** | `PinnedOdds` (until 2026-09-14, when the pinned odds were dropped) | same reason |
| **`benefitsTheDeck`** | `benefitsOwnSide` | same reason |
| **tally** | mix | `keywordMix` is the concept; nothing in the code is named tally |
| **list** (for a saved deck) | deck | `savedDeckLabel` counts decks; a deck list is the deck |
| **stats, cost** (as style or field names) | attributes, energy | both were second words for named concepts |
| **`number \| null` for a limit** | `CopyAllowance` | a closed state space is a union |
| **`T \| null` as a use-case result** | a discriminated union | never a generic `Result<T, E>` with an `ok` boolean |
| **a barrel `index.ts`** | import from the defining module | re-exports hide the graph |
| **colour, flavour** (in identifiers) | color, flavor | American spelling; `flavour` (`flavourText` in the schema) is the one inherited exception |
| **`endsWith` / `slice` to classify** | a discriminated union | an identifier is never classified by a string method |
| **a composite string key** like `` `${section} ${printingId}` `` | a nested record, or the parts on the value | it gets sliced back out with a cast |

Some shapes are banned as well as words: JSX held in a variable, an effect that syncs one piece of state from another, and a ref shadowing state (all on [React rules I hold in riftcards](/projects/riftcards/presentation/react-conventions/), with the general versions on [React components](/react/components-and-effects/)), and a shim that translates back to an encoding a change just removed (on [code conventions](/projects/riftcards/engineering/code-conventions/)).

## Reserved words

### `role`

The deck builder's pool view shows a `roles` tab that renders "Role breakdowns are on the way", and I've written down the idea of a card-role taxonomy. Until that's built, `role` in the code means React Native's `accessibilityRole` and nothing else, so the word stays free for the feature it's reserved for.

## Open

Two naming questions are still open. I record them here so I don't settle them by accident.

### `poolSize` or `librarySize`

Three things in the app are called a pool: a printing's `poolCode` (a product pool from the release), the deck builder's candidate list (`SectionPool*`), and the multiset of cards being drawn from in `draw-simulation.ts` (`DrawOdds.poolSize`, `DealtHand.pool`).

The third was named on purpose. When I extracted analysis from the deck feature, `deckSize` became `poolSize`, because analysis must not name a deck. That reasoning stands. But the builder's pool and the draw simulation's pool are both "a set of cards", and they aren't the same set: one is what you may add, the other is what you'll draw.

`dealHand` already computes `const library = copies.flatMap(…)` before shuffling it into `pool`, so the alternative word is present in the code and costs nothing to adopt: `librarySize` and `DealtHand.library`. It names the cards you draw from without naming a deck.

I haven't picked. Either `library` wins for the draw simulation, or I accept that "pool" has both senses and the collision stays.

### `DeckDraft` or a name for the save request

`DeckBuildDraft` and `DeckDraft` are both drafts of a deck, in the same feature, with different fields. One holds `Card`s and is the builder's state; the other holds `DeckEntry`s and is what `saveDeck` takes. They never appear in one file, so nothing is broken. Whether `DeckDraft` should be named for being the save request instead is a judgment call.

The neighboring case is already decided: `DeckSaveData`'s `DeckSaveDraft` became `DeckSaveRequest` on 2026-09-14, because what a save receives is a request, not a value still being edited. `DeckDraft` is the same argument against a different caller.

## Settled 2026-09-14

These were open when I first drafted the glossary. They're decided now and not to be reopened.

**`tag` is the generic word; `trait` is a kind of tag.** A tag is any of the 129 taxonomy values a card has. A trait is one specific kind of tag, 21 of them. So "tag" is always safe, and "trait" is only used where the narrower kind is genuinely meant. `CardTraitLine` rendered every tag and was therefore misnamed; it's been `CardTagLine` since 2026-09-14. A component actually named for traits stays impossible until `tag.kind` reaches the model, because the mapper drops it today.

**`section` is the noun for a part of a deck. `zone` means an area of the playing field in an actual match.** Both halves stand. The question the second half left open is resolved in the next section.

When I wrote this, the code had a `ZoneSection` subtype: `DeckSection` minus `legend`, meaning main deck, rune deck, battlefield and sideboard. It was **not** "the sections that have a zone on the field": the legend has a zone of its own, so that reading was wrong.

What it selected was the sections the builder fills from a pool, in quantities, under copy limits. The legend was excluded because it's a single pick made in step 1 rather than a section you add cards to. That set still exists as `COUNTED_SECTION_RULES`. The type doesn't.

**`attributes` means energy, might and power.** Nothing else joins that word. A finish isn't an attribute, a type isn't an attribute, and a formatter whose name contains attributes returns only those.

**`pane` and `panel` are different things and both are correct.** A pane is a slot in the frame: the primary and secondary of a split. A panel is a titled box of content inside a screen. Neither is a loose synonym for the other.

**`champion` always means a champion unit.** It's a kind of unit card, not a role a card plays. The Chosen Champion is simply the champion unit chosen for a deck, which is why `chosenChampion` is the deck's word and why the rule "a chosen champion must be a champion unit" is a rule about the card, not about the slot.

**`Other` and `Token` are real card types.** They're actual cards, and they must parse. What's true of them is narrower than "they don't exist": they never appear in a deck. They exist outside a deck and never enter a deck list. Any rule that seems to need them excluded from the catalog is wrong: exclude them from decks, not from the catalog.

## Settled 2026-09-14: `zone` is not a deck word

A part of a deck is a section. `zone` means an area of the playing field, and nothing else.

The builder's `Zone*` naming was therefore wrong, not merely loose. It reached `ZoneSection`, `ZoneRule`, `ZonePoolList`, `ZonePoolFilters`, `ZonePoolView`, `ZonePoolLayout`, `zoneCardTypes`, `ZonesStep`, `ZoneSelector`, `useZonePool`, `deck-zone-pool.ts`, and the step's own label in the interface, which read "Zones".

I made the change on 2026-09-14. Every one of those is now a `Section*` name, the step id is `"sections"`, and the interface reads Sections.

The one thing left to decide, what the subset is called, was answered by the subset not existing. `ZoneSection` was `DeckSection` minus `legend`, so renaming it would have preserved a type defined by subtraction, with the legend belonging to none. I deleted it instead. `DeckSection` is the single type for a part of a deck, `SECTION_RULES_BY_SECTION` holds a rule for all five including the legend's own, and the four the builder fills with a count are the derived array `COUNTED_SECTION_RULES`. The exclusion moved to where it's actually needed, the loop that `verifyDeck` and `SectionSelector` run, rather than into a type. `LEGEND_ALLOWANCE` went the same way: `copyAllowance("legend")` reads the legend's own rule.
