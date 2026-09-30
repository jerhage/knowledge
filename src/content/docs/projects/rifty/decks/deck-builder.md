---
title: The Deck Builder
description: "The three steps, create and edit modes, the three kinds of draft, the pool, `DeckSaveData`'s described action, and the formSheet constraint."
tags: [rifty, react-native, ui-patterns, mobile]
sidebar:
  order: 32
---

The deck builder is where someone makes a new deck or changes a saved one. It walks through three steps, keeps the deck being built in memory, shows a pool of cards for each part of the deck, and saves at the end. It's the busiest screen in the app, so most of the presentation rules show up here: a [write data component](/architecture/data-components/#a-write-boundary-passes-down-a-described-action) for the save, [a data component that forwards](/architecture/data-components/#a-boundary-draws-in-place-of-its-children-only-when-it-has-nothing-to-pass-them) for the pool, and a mode that's [a state, not an action](/practices/one-word-per-concept/#a-mode-is-a-state-not-an-action). The code is in `features/deck/presentation/`, and the route is `app/decks/build.tsx`, [presented as a full-screen modal](/react-native/screens/#a-routes-presentation-is-an-option-on-its-stack-screen).

## The three steps

A Riftbound deck has five sections: legend, main deck, rune deck, battlefields and sideboard. The builder takes them in three steps. `DeckBuildStepId` is `legend | chosenChampion | sections`, and `DECK_BUILD_STEPS_BY_ID` is the total record that holds each step's label, title and blurb:

1. **Legend.** The legend starts the game in play and sets which domains the rest of the deck can draw from.
2. **Chosen champion.** One champion unit is the deck's chosen champion. It isn't a sixth section. It's a main deck card the deck designates, through `chosenChampionCardId`, and its copies are main deck copies. That's why the rules say the main deck has to hold one, and why its three copies are shared with the main deck rather than separate. On the playing field the chosen champion has a zone of its own, but that's the field, not the deck list.
3. **Sections.** The rest of the deck, section by section, with a stepper on each card for the number of copies.

A step is a stage of the builder, and the step machine lives in `deck-build-steps.ts`. The legality rules run on every stepper press, which is why they're pure; see [why the rules are pure](/projects/rifty/decks/legality/#why-the-rules-are-pure).

## Create and edit modes

The builder opens in one of two modes. `DeckBuildMode`, in `deck-build-mode.ts`:

```ts
type DeckBuildMode =
  | { readonly type: "create" }
  | { readonly type: "edit"; readonly resolvedDeck: ResolvedDeck };
```

The route's id parameter sets which. With no deck id it builds a new deck in `create` mode. With the id of a saved deck it wraps the builder in `DeckDetailData`, which loads the deck and passes the resolved deck to the builder in `edit` mode. An id that names no deck shows a missing-deck screen instead.

A mode is what you're in, for as long as you're in it. You're in `create` mode from the moment you start a new deck until you save it: you haven't created anything yet, and it doesn't matter which of the three steps you're on. You're in `edit` mode from opening a saved deck until you save. That's why the type used to be called `DeckBuildStart`, with values `new | edit`, and was renamed: a start is an instant, and this value describes the whole session. It also settles what the type looks like. A mode may hold data, so `edit` holds the deck it opened, because that data belongs to the state, not to the moment it began.

A component that only distinguishes the modes takes `DeckBuildMode["type"]`, not the union. The progress header shows a label and reads no deck.

## Three kinds of draft

A draft is a value being edited that hasn't been committed. The builder has three kinds, and each name describes what it holds:

- **`DeckBuildDraft`**, in `deck-build-steps.ts`: the builder's whole deck in progress, `{ name, legend, chosenChampion, sectionCards }`. It holds `Card` objects, not ids.
- **`DeckDraft`**, in `use-cases/save-deck.ts`: what `saveDeck` is given, `{ id, name, createdAt, chosenChampion, entries }`. It's already reduced to deck entries.
- **The `draft` of `useDraftSheet`**: the pending, unapplied state of a bottom sheet, like the pool's filters, beside its `applied` value.

The two deck drafts never appear in one file. The builder reduces one to the other at the boundary between them.

The builder's draft holds the legend and the chosen champion outside its section map, each as a single pick. The draft is a view of a deck under construction, not the deck. A single pick makes "exactly one" true by construction, and it passes the card directly to the champion pool, the pick chips and the default filters. The pick started out as a `Card | null`; since 2026-09-17 it's a `DeckBuildPick`, `{ type: "notPicked" } | { type: "picked"; card }`, so the value records whether a legend or champion has been picked instead of leaving it to a null. The saved deck has no such split: it stores the legend as an ordinary entry. The known cost is that `sectionCards.legend` is always empty, so one pass of any loop over the map does nothing.

There used to be a fourth kind, and its name was wrong. `DeckSaveData`'s prop was a `DeckSaveDraft`, but it wasn't a value being edited. It was the argument of a save someone had already asked for. On 2026-09-14 it became `DeckSaveRequest`, with the prop `request`. Whether `DeckDraft` should be renamed for being the save's request too is still open; it's the same argument against a different caller.

## The pool

The pool is the cards someone may pick from in a picker, narrowed by filters: the builder's list of candidates. Its pieces are `SectionPoolFilters`, `SectionPoolView`, `SectionPoolLayout`, `poolCriteria`, `SectionPoolData`, `PoolSheet` and `useSectionPool`, all in `features/deck/presentation/`.

A pool isn't a section of a deck, and it holds no quantities. `poolCriteria(section, …)` narrows it to the card types that section accepts and, by default, to the legend's domains. Those criteria go to the database, like every other card query (see [catalog browsing](/projects/rifty/cards/catalog-browsing/)).

`SectionPoolData`, `ChampionPoolData` and `LegendPoolData` are data components that draw nothing of their own. Each builds its criteria and passes its children straight to `CardsData`, which owns the match, so they're forwarding, not an exception to the rule about when a data component draws.

The word has two other uses in the app. `poolCode` on a printing is a release concept. Analysis's `poolSize` is a third meaning, and whether it should be `librarySize` is still open.

## Resetting the pool with a callback

Each section draws from a different pool, so when the section changes, the pool's filters and search reset. The ordering stays.

The reset is a named function, `resetFor(legend)`, and the builder calls it at the two moments the pool's subject changes: when someone enters the sections step, and when they pick another section. There's no effect watching the section. The caller can be read, and an effect can't; the rule is on [React rules I hold](/projects/rifty/presentation/react-conventions/#state-changes-through-callbacks-not-effects), and the general version is [an effect never keeps two pieces of state in step](/react/components-and-effects/#an-effect-never-keeps-two-pieces-of-state-in-step).

## The save: a described action

The save button sits in a footer at the bottom of the sections step. Pressing it saves the deck, and three things can come back: the deck saved, the use case returned a rule failure (`nameMissing`, `nameTaken`, `copyLimitExceeded`), or the save failed unexpectedly.

`DeckSaveData` owns that write. It receives the `request` (the name, the entries, the chosen champion and the deck's verification), the mode and the capabilities, and it runs `saveDeck` through `useWriteState`. In `create` mode the new deck's id and creation time come from the id generator and the clock. In `edit` mode they come from the deck that was opened.

What happens with each outcome:

- **Saved.** It invalidates every cached deck query, so the next read of a deck gets the saved version, announces "Deck saved." to the screen reader, and calls `onSaved`, which closes the builder.
- **Not saved.** It announces the rule failure, and the builder stays open with the draft intact. Editing the name after a rule failure clears its message (and after a failure, the failure).
- **Failed.** It announces the failure, and the builder stays open.

Closing only on success is [keeping an editor open until the storage outcome is known](/ui-patterns/saving-and-undo/#keep-an-editor-open-until-the-storage-outcome-is-known), applied to a whole screen.

`DeckSaveData` draws nothing itself. It passes its children a described action: the button's label, its availability (`busy | ready`), the message to show beside it, and the `save` callback. `SectionsPane` draws the footer from those values. While the save is in flight, the availability is `busy`, so the button is disabled and reports itself busy, and a second press can't submit twice; it's `ready` again whichever way the save ends. (Until 2026-09-17 the action held two booleans, `isBusy` and `isEnabled`, that always held the same value from opposite sides; one named availability replaced them.) How the save came to draw nothing, and why a read data component still draws its states, is in [why the save boundary draws nothing](/projects/rifty/presentation/data-components/#why-the-save-boundary-draws-nothing).

## The formSheet constraint

The builder has four sibling views, with the scrolling list of cards third, at index two. The react-native-screens library can present a screen as a `formSheet`, a sheet that slides up over the screen below, but [it supports a scroll view only as the first or second child](/react-native/screens/#a-formsheet-supports-a-scroll-view-only-as-the-first-or-second-child).

With the list third, the library hoisted it to fill the screen. Nothing in the code records any of that, and I made two attempts to present the builder as a form sheet before I read the constraint. That's one of the reasons decisions like this get written down; see [why write any of this down](/projects/rifty/engineering/code-conventions/#why-write-any-of-this-down).
