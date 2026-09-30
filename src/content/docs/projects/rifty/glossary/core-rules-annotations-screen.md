---
title: "Glossary: Core Rules, Annotations and the Screen"
description: The core-rules words, search words, annotation subjects, and the words for parts of the screen.
tags: [rifty, naming-conventions, domain-driven-design]
sidebar:
  order: 102
---

This is the third page of the Rifty glossary, which keeps [one word per concept](/practices/one-word-per-concept/) across prose, code and screen. It covers the official rules document the Rules tab reads, the words its search uses, the words for bookmarks and notes, and the words for parts of the screen on phone and tablet. The card and deck words it leans on are on [cards, printings and sets](/projects/rifty/glossary/cards-and-sets/) and [catalog, decks and analysis](/projects/rifty/glossary/catalog-decks-analysis/); competing words are settled on [the rulings page](/projects/rifty/glossary/rulings/).

## The core rules

The official Riftbound rules document, which the Rules tab reads. I added it on 2026-09-15 with the `rules` feature. How it gets from a PDF into the database is on [the core rules document](/projects/rifty/rules-and-notes/core-rules/).

### the word `rule`, and why none of this uses it bare

The word `rule` was already taken twice before this feature existed. `DeckLegalityRule` and `SectionRule` are named constraints on a deck. `Card.rulesText` and `CardRulesPanel` are the text printed on a card. So the official document doesn't get the bare word: everything here is prefixed `CoreRule`.

The prefix isn't mine: the document's own title is *Riftbound Core Rules*.

### `CoreRulesDocument`

The whole document, as the parser produces it: `{ title, publishedOn, coreRules }`.

It isn't called `CoreRules`, because the Drizzle schema names each table variable for the plural of its row (Drizzle leaves that name to the author; the plural is the house convention), which makes the `core_rule` table `coreRules`. Two names one character of case apart read badly, and the table keeps the house convention.

### `CoreRule`

One numbered entry: `{ number, parentNumber, position, kind, body, details }`. There are 1364 of them.

`position` is document order and is the only correct sort. A number isn't a sort key: top-level numbers are sparse and segments alternate numeric and alpha, so `103` sorts before `50` as text and `103.2.a` has no numeric reading at all.

`parentNumber` is a foreign key that proves no rule is orphaned. There's no `depth` column: depth is the number's segment count, and `coreRuleDepthOf` derives it. See [derive from the identifier](#settled-2026-09-15-derive-from-the-identifier-store-what-it-cannot-encode) below.

### `CoreRuleNumber`

The printed identifier, stored exactly as printed but without the trailing period: `103.2.a`, not `103.2.a.`. Branded: `z.string().trim().min(1).brand<"CoreRuleNumber">()` in `src/features/rules/value-objects/core-rule-number.ts`.

An earlier version of this entry said it was "a plain string, deliberately unbranded, like `TaxonomyId`". That was wrong, and I corrected it on 2026-09-16. The comparison doesn't transfer. A [`TaxonomyId`](/projects/rifty/glossary/cards-and-sets/#taxonomyid) is a lookup key for an open set that arrives from a feed (supertypes, rarities, tags), where a new value appears without any change to the app. A `CoreRuleNumber` is a printed identifier with a strict grammar, it's the primary key of `core_rule`, and three derivations hang off it. That's the same kind of thing `PrintingId` is branded for, and it's branded for the same reason: `{ kind: "coreRule", id: aPrintingId }` must not compile.

That correction also said `TaxonomyId` would stay unbranded. It didn't: I branded it on 2026-09-17, together with `SetCode` and a note's id (see [`TaxonomyId`](/projects/rifty/glossary/cards-and-sets/#taxonomyid)).

Three things are derived from a `CoreRuleNumber` and stored nowhere: `coreRuleDepthOf`, `coreRuleAncestorNumbersOf` and `isCoreRuleChapterNumber`. All three take the brand, because each is a reading of the printed identifier and an arbitrary string has no such reading. `coreRuleAncestorNumbersOf` returns branded numbers by parsing each one, not by casting.

Where a stored string becomes a `CoreRuleNumber`: in the adapter, and only there. `src/infrastructure/sqlite/core-rules-mapper.ts` parses every row through `parseCoreRule`, and `src/infrastructure/sqlite/annotation-mapper.ts` parses a bookmark's or a note's subject through `annotationSubjectSchema`. `scripts/` never holds one: `scripts/core-rules-parse.ts` declares its own `type CoreRuleNumber = string`, the same boundary `scripts/card-derivation.ts` keeps for a printing id, because `src/` may not import from `scripts/` and a seed row is a plain column value.

### kind: **heading** and **rule**

A `CoreRule`'s `kind` is `heading | rule`. The document doesn't mark headings, so the parser classifies each entry once and stores the result. A **heading** is an entry whose body is 48 characters or shorter and doesn't end in sentence punctuation. Everything else is a **rule**. There are 196 headings and 1168 rules.

Say **heading** for the short labeling entry and **rule** for the numbered statement. Don't say "section": that word belongs to a deck.

### chapter

A depth-1 heading whose number ends in `00`. There are exactly five: `000`, `100`, `500`, `600`, `700`. The chapters are numbered on century boundaries.

A chapter is a rendering distinction, not a stored one, and not another `kind`. It exists because the screen draws a chapter with a divider and the display font, and because the 112 depth-1 headings are far too many to all be chapters.

### `CoreRuleDetail`, **bullet**, **example**

One ordered piece of text under a rule: `{ position, kind, body }`, where `kind` is `bullet | example`. There are 249 of them, 139 bullets and 110 examples.

A detail isn't rule text and is never folded into a body. It **is** searched, and a hit in one is reported against that detail rather than as an offset into the body. What a detail must not do is stand in for rule text: the app must never show a rule as saying what only its example says.

The word **example** comes from the document, which writes `Example:` for a paragraph and `Examples:` for a list. Everything that isn't an example is a **bullet**.

### `CoreRulesEdition`

Which printing of the document the device holds: `{ title, publishedOn }`. The id is the published date, so a later edition adds a row rather than overwriting an unnamed one.

Say **edition**, not "version". `CORE_RULES_SEED_VERSION` is the seed's content hash and means something else entirely: whether the rows on the device match the bundled ones.

### search: **hit**, **match**, **occurrence**, **passage**

Each of these words has its own meaning, and they aren't interchangeable.

- An **occurrence** is one appearance of the query in one piece of text. It's represented as a start offset, because the screen splits the text there to highlight it.
- A **passage** is one searchable text within a rule: its body, or one of its details.
- A **match** is one rule that contains at least one occurrence, with its passages and its hit count.
- A **hit** is an occurrence counted across the whole document. `hitCount` totals them, and the active hit is the one next and previous step to.

Occurrences don't overlap: `aa` in `aaa` is one hit, because the screen highlights by splitting the text at each offset, and overlapping ranges can't become a sequence of spans.

These four words reach the screen unchanged; I settled that on 2026-09-15. The count line reads `4 hits in 2 rules`, and the controls read *Previous hit* and *Next hit*. A find bar would ordinarily write "17 matches" for what the code calls 17 hits. Adopting that would have made the visible word "match" mean the code's hit while the visible "rule" meant the code's match: two words crossed at once. The **Matches only** toggle keeps its name and is precise: it shows only the matches, and a match is a rule that holds hits.

`searchCoreRules` returns `noQuery` as a variant rather than an empty result. "No query, so show the whole document unhighlighted" and "searched and matched nothing, so filter to empty" are different states, and the screen shouldn't have to re-trim the query to distinguish them. More on [searching the core rules](/projects/rifty/rules-and-notes/rules-search/).

## Shell, layout and the words for parts of the screen

The app runs on phones and tablets. On a tablet the tab bar becomes a rail at the side and some screens show two panes at once. The layout itself is on [phone and tablet layout](/projects/rifty/presentation/phone-and-tablet/); these are its words.

### shell

The surrounding UI: the tab bar, the rail, the headers. Never "chrome", which is jargon that names nothing a reader can point at.

A shell component is named for the shell, not for one of the things inside it. Fixed on 2026-09-14: `src/app/(tabs)/_layout.tsx` exported `CatalogLayout`, which named the whole tab navigator after one of its tabs; it's `TabsLayout`.

### layout class

`LayoutClass` is `phone | tablet`, from `useLayoutSize()`. It describes the frame, computed from `Math.min(width, height) >= MinTabletWidth`. Insets and rails never reach it.

It never travels downward as a prop: a component that needs it calls `useLayoutSize()` itself.

### usable width

`usableWidth`: the width a subtree may actually draw in. It's the window minus insets, narrowed by whatever sits beside it, provided by `UsableWidthProvider` and read with `useUsableWidth`.

Nothing subtracts a rail or a pane itself. The thing that takes the space narrows the provider, and every consumer below reads one number. `fitColumns(usableWidth, spec)` turns it into a `ColumnFit`.

### rail

The tab bar on a tablet: `tabBarPosition: "left"`, `tabBarVariant: "material"`, `RailWidth = 118`. It holds the app's destinations. A pushed route covers it; a pane never does.

### pane

A layout slot inside the tab shell that holds a whole screen's worth of content beside another one. `CardDetailPane`, `DeckDetailPane`, `DrawSimulationPane`, `SectionsPane`.

`DetailOpening` is the union that sets how a detail opens: `{ type: "route", open }` on a phone, `{ type: "pane", open, close, shown }` on a tablet. `shown` is a `DetailPaneContent`, `{ type: "noSubject" } | { type: "subject", id }`; until 2026-09-17 it was `shownId`, an id or null. A pane must render inside the tab navigator's screen, and one component serves both renderings.

### panel

A titled, bordered box inside a scrolling screen. The `Panel` atom in `components/ui/atoms/panel.tsx`, and `DrawOddsPanel`, `HandStatsPanel`, `CardRulesPanel`, `DeckAnalysisPanels`.

A pane is a slot in the frame; a panel is a box in a scroll view. They're different words for different things; see [the ruling](/projects/rifty/glossary/rulings/#pane-and-panel-are-different-words).

### primary, secondary

The two slots of `SplitLayout`, named for their role rather than their position:

| slot | width | where | border |
|---|---|---|---|
| `primary` | `flex: 1` | against the rail | none |
| `secondary` | `min(392, 34% of frame)` | outer edge | leading border |

Tree order equals visual order, so a screen reader sweeps the wide pane first. Never "left", "right", "main" or "side", because the wide slot isn't always the same feature's: `<SplitLayout primary={<CardCatalog/>} secondary={<CardDetailPane/>}/>` on the cards tab, `<SplitLayout primary={<DeckPrimaryPane/>} secondary={<DeckList/>}/>` on the decks tab, where `DeckPrimaryPane` shows either `DeckDetailPane` or `DrawSimulationPane`.

### sheet, face

A **sheet** is the bottom sheet; a **face** is one of its interchangeable contents. `CatalogFilterFace`, `PoolFilterFace`, `SheetFace`, and a `*SheetState` union of `hidden | filter | sort` records which face is showing.

## Settled 2026-09-15: derive from the identifier, store what it cannot encode

`core_rule` first had a `depth` column. Then I asked myself why a rule would need a stored depth, and it doesn't: depth is the number's segment count, so `103.2.a` shows `3` on its face.

The argument for storing it was that the app filters in the database rather than in JavaScript. It doesn't survive the query. The only depth query the app runs is the table of contents ("give me the top level"), and in SQL that's `number NOT LIKE '%.%'`. As built, the contents list doesn't query at all: the Rules screen already holds the whole document, and `core-rules-format.ts` keeps the depth-1 headings with `coreRuleDepthOf`. Indentation while rendering is presentation, computed at the point of use.

The test is whether the identifier encodes it. Three things are derived from a `CoreRuleNumber` and stored nowhere: its depth, its ancestors, and whether it's a chapter. Two neighboring columns are stored, each for a different reason:

- `parent_number` is a **foreign key**. It proves no rule is orphaned. That's enforcement, not a cached derivation, and the database is the only place that can do it.
- `position` is a **fact the identifier can't reconstruct**. Top-level numbers are sparse and segments alternate numeric and alpha, so document order isn't recoverable from the number.

`kind` is the third case and the interesting one: it's derived, but by a heuristic over the body rather than from the identifier, and it's stored anyway. The heuristic is a parse-time judgment that should be made once, visibly and under test, rather than re-run on every device.

## Settled 2026-09-16: a repository and a manager are two things, even when identical

The `annotation` feature holds a person's bookmarks and notes. Its bookmark storage is split into narrow capabilities (one small interface per need): `BookmarkFinder`, `BookmarkLister`, `BookmarkRemover` and `BookmarkSaver`. `BookmarkRepository` and `BookmarkManager` both compose exactly those four. They're structurally identical today, deliberately, and neither is redundant.

- A **repository** is what the adapter implements and what composition and the data store expose. It's the store's whole surface for an aggregate, and it may grow: a count, a scope, a bulk write, whatever the store gains.
- A **manager** is the set of methods a **consumer** calls to manage one thing, named as an agent noun like every other capability in the feature. `BookmarkedSubjectsData` takes `bookmarkManager` because it reads marks and writes them. A manager isn't expected to grow with the repository, and a screen that only reads still takes a `BookmarkLister` rather than either of these.

A route passes `annotations.bookmarkRepository`, which the composition root provides, where a parameter is typed as a manager, and it satisfies the manager structurally with no cast. The day the repository grows a method no screen needs, the two types diverge and every consumer still takes the smaller one. That's the whole point of writing both down before that day.

Don't collapse them into one type because they currently match. A future reader's "these are the same, delete one" is the move this entry exists to stop.

I wrote `NoteManager` on 2026-09-16 alongside its first consumer, `SubjectNotesData` (renamed `NotesData` the same day), and it stands in the same relation to `NoteRepository`. I deliberately didn't invent the pair ahead of that consumer.

The narrow capabilities are unchanged, and a use case still takes only the ones it uses. That's what keeps it testable with one small fake. More on [capabilities, adapters and the composition root](/projects/rifty/architecture/capabilities-and-composition/).

## Settled 2026-09-16: `AnnotationSubject` holds the identifier its own feature owns

What a bookmark or a note is about. It's a discriminated union on `kind`, and each arm holds the branded id of the feature that owns that identity, in `src/features/annotation/value-objects/annotation-subject.ts`:

```text
{ kind: "coreRule"; id: CoreRuleNumber } | { kind: "card"; id: PrintingId } | { kind: "deck"; id: DeckId }
```

It was `{ kind; id: string }` until then, which let `{ kind: "card", id: "103.2.a" }` compile. The `annotation` feature names `card`, `rules` and `deck` (an edge the feature graph allows), so the ids stay in the features that own them and nothing moved to a shared leaf.

The card arm holds a `PrintingId`, not a `CardId`. A mark is made on the thing on screen, and what's on screen is a printing: the card routes hold a `printingId`, and `SqliteCardRepository` joins `bookmark.subject_id` to `card_printing.id` to filter for "only bookmarked".

Where a stored string becomes a subject's branded id: in the adapter, and only there. `src/infrastructure/sqlite/annotation-mapper.ts` parses each row through `parseBookmark` and `parseNote`, which parse the subject through this union. The other direction needs no conversion: a branded id **is** a string, so the repositories write `subject.id` into the `text` column as it stands. Reach a branded id by parsing, never by casting, as [`PrintingId`](/projects/rifty/glossary/cards-and-sets/#printingid) already says.

`AnnotationSubjectId<TKind>` is the id belonging to one kind, read off the union with `Extract` rather than written out a second time. `BookmarkedSubjectsData` is generic over the kind and passes its children `isBookmarked` and `toggleBookmark` in that id, so a screen of cards can't be passed a rule number. It assembles `{ kind, id }` into a subject by parsing, in one place, so a write can never name a kind other than the one the read was scoped to.

The guarantee is pinned in `tests/annotation/annotation-subject.test.ts`, where `@ts-expect-error` marks each use that must not compile: a rule number as a card subject's id and a printing id as a rule subject's, both in a subject and in a screen's `toggleBookmark`. Deleting the brand makes that file fail to typecheck. More on [bookmarks, notes and the Saved screen](/projects/rifty/rules-and-notes/bookmarks-and-notes/).
