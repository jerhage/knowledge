---
title: "Code Conventions: Comments, Kept Code and Spelling"
description: No comments except two kinds, keep-markers, the 2026-09-12 sweep, no shims, American spelling, and why the decisions are written down.
tags: [rifty, naming-conventions, project-structure]
sidebar:
  order: 91
---

These are the conventions in Rifty that aren't about architecture or naming but are still easy to get wrong: which comments are allowed, how kept code is marked, what a shim is, and which spelling the code uses. Most of them are the Rifty form of [writing down decisions, departures and kept code](/practices/recording-decisions/). The naming rules are on [one word per concept](/practices/one-word-per-concept/) and in the Rifty glossary, starting at [cards, printings and sets](/projects/rifty/glossary/cards-and-sets/).

## Comments and keep-markers

By default, Rifty has no comments. Wanting one is a sign to rename something, split a function or introduce a named type instead. I tightened the rule on 2026-09-16. Two kinds of comment survive: one on complicated business logic that records a decision (never how the code works), and one explaining an outside library or a technical limitation whose behavior isn't obvious. Until then the exceptions were a one-line doc comment on an export where every sibling file had one, and the keep-marker below. The sibling doc line no longer counts as an exception, and older comments in the repository aren't precedent.

The keep-marker is for code that's unused on purpose, and the code still has them. The rule, from 2026-09-12: unused code that's kept on purpose has a comment stating that, and unused code with no such comment may be deleted on sight. The marker has to name what would make the code live:

```ts
/** Not in use. Waiting on a set-detail screen and the `getSetQuery` that would feed it. */
```

"Unused" here means that nothing in the app produces or calls it. A symbol the app uses isn't a candidate just because its export is reached only from `tests/`; exporting a real value for a test to share is better than a copied literal (see [share the real value with a test](/practices/recording-decisions/#share-the-real-value-with-a-test-not-a-copy)).

The rule came from auditing this repository. Twice the question "has its caller not been written yet, or was its caller removed?" could only be answered by reading git history, because the code recorded no intent. `createDeck` and `deleteDeck` had no UI yet; `listCardsByPrintingIds` had been superseded and was deleted. The three looked identical. Its tests-only use was the evidence that `listCardsByPrintingIds` was dead: a test isn't a producer.

A marked function still needs a test, because nothing else runs it. `DomainBand`, the lettered alternative to `DomainBar` kept for a later trial, is unused and still has four assertions, so it will work the day someone reaches for it.

## Declared but never produced

Rifty used to have two declarations that read as working behavior and had nothing producing them. Both are resolved, and the lesson is to [look for a producer, not a declaration](/practices/recording-decisions/#look-for-a-producer-not-a-declaration) before building on anything.

The first was `unverified`. `deck.ts` declared it as a third kind of deck verification, with three reasons (`notChecked`, `missingCards`, `unknownRuleset`). Every formatter in `deck-legality-format.ts` handled it, yet `verifyDeck` only ever returned `legal` or `illegal`. I retired it on 2026-09-11. The foreign keys make an entry that doesn't resolve to a card impossible, and `findResolvedDeck` throws on one, so `missingCards` had nothing left to report; the other two reasons never had a producer. `deckVerificationSchema` is now exactly `legal | illegal` (see [deck legality](/projects/rifty/decks/legality/)).

The second was `isActionEnabled`, a prop on the deck builder's footer button that nothing passed. It got a producer on 2026-09-12: `DeckSaveData` passed `isActionEnabled={state.type !== "saving"}` and `isActionBusy={state.type === "saving"}`, so the save button was disabled while the write was in flight and a second press couldn't submit twice. The write state leaves `"saving"` on both exits, a failure or the save's result, so the button re-enables whichever way the save ends. `Button` reports `accessibilityState={{ busy, disabled }}`. Busy was kept a separate prop from enabled so that a step footer could be grayed out, unavailable without being busy, for example before a legend is chosen. Neither step footer (legend and champion) passed either prop, so whether a grayed step button should be hard-disabled or only advisory was left open.

On 2026-09-17 the two optional booleans became one required prop, `actionAvailability`, which is `"busy"` or `"ready"`. `DeckSaveData` passes the footer `"busy"` while saving and `"ready"` otherwise, and busy now also means disabled. The legend and champion steps pass `"ready"`, so there is no longer a grayed-out state for a step button to take.

## The 2026-09-12 sweep

After the rule was written, I swept the repository for unmarked, unused symbols:

- **Deleted.** `ThemedText`'s `linkPrimary` variant, which hardcoded `#3c87f7`, ignored the theme and measured 3.50:1 on white; and the `draftEntries` export from `deck-build-steps.ts`, whose last consumer in another file had gone away. The function stayed, called twice inside its own file. It was exported again on 2026-09-13, when `deck-build-allowance.ts` started calling it.
- **Marked as kept.** `findSet`, kept for a set-detail screen and a `getSetQuery`; `mightCurve` and `totalPower`, kept for analysis panels that would render them; and the export of `atLeastOneChance`, which the draw odds call inside their own file but nothing outside does, kept for a panel that shows the odds of one chosen card. All four already had tests, which is what keeps the marker accurate.
- **`EMPTY_POOL_FILTERS` keeps its export.** It was briefly unexported, and that was wrong. The app uses the constant (`defaultPoolFilters` spreads it), so it was never the kind of code this rule is about; only its export was reached solely by a test. Sharing the real value with the test beats a hand-written copy: add a field to `SectionPoolFilters`, and a copied "empty" fixture can end up holding a non-empty value without anyone noticing, and still type-check.

## No shims

When a change breaks old callers, I change the callers. I don't add an adapter that translates back to the old interface so they keep compiling. That kind of shim keeps alive the encoding the change just removed.

The exception is the classic adapter, which translates an outside library into Rifty's own types at a boundary; that's the architecture, not a shim. The test is which direction the translation goes (see [a shim translates in the wrong direction](/practices/recording-decisions/#a-shim-translates-in-the-wrong-direction)).

## Exports and imports

Every export sits in a single block at the end of its file's code, with no inline exported declarations, so the file's public surface is in one place. In a component file only the `StyleSheet` comes after the block. And there are no barrel files: an import names the module that defines the symbol, so the dependency graph is the real one. The reasoning is on [layers and folders](/projects/rifty/architecture/layers-and-folders/#why-no-barrel-files).

## American spelling

Identifiers use American spelling: `color`, not `colour`, and `flavor`, not `flavour`. The glossary bans the British forms in identifiers. The one inherited exception is `flavour`, which came from the card feed and kept its spelling: `Card.rulesText.flavour`, and the `flavourText` column behind it.

This is also the rule for prose on this site now, so the pages about Rifty and the code they quote spell the same words the same way.

## Departures are written beside the rule

Some rules in Rifty have a deliberate exception. The accessibility rules say meaning is never conveyed by color alone, yet card art shows a card's domain by color alone while the palette work is pending. That exception is written down with the audit findings, and the reverted implementation is recorded with it (see [where the app is not conformant](/projects/rifty/presentation/accessibility/#where-the-app-is-not-conformant)).

Any deliberate departure from a rule gets written down where the rule is, with the reason and the date. A rule the code breaks with no written record stops being a rule: the next reader either re-fixes the departure or copies it as precedent. The general version is [a departure is written beside the rule](/practices/recording-decisions/#a-departure-is-written-beside-the-rule).

## Why write any of this down

Rifty has a set of documents next to the code: the structure, the reasoning behind it, what's in the repository, and the glossary. I did ask myself whether the code alone should be the truth.

The code is the truth about what. It doesn't record why, and why is what gets reopened. Several of the rules exist because I rediscovered a dead end I hadn't written down.

The form sheet is the clearest case. The deck builder is presented as a `fullScreenModal`, and presenting it as a `formSheet`, a native sheet presentation, ran into [a constraint in `react-native-screens`](/react-native/screens/#a-formsheet-supports-a-scroll-view-only-as-the-first-or-second-child) on where a scroll view may sit. The builder had four siblings, with the list at index two, and the library hoisted the list to fill the screen. Nothing in the code recorded that, and I made two attempts to present the builder as a form sheet before I read the constraint. The details are on [the deck builder](/projects/rifty/decks/deck-builder/#the-formsheet-constraint).

The alternative is comments, and they go stale in place. A document entry dated and tied to a commit ages visibly: a reader can see when it was decided and check it against the code as it was.

Writing a decision down doesn't mean it's never revisited. Several rules exist because I went back to a decision and changed my mind: the query factories moved out of `presentation/` that way, and the dead-code rule was written after a deletion that shouldn't have happened. The only requirement is that a decision is recorded. When I change one, I change its record in the same commit.
