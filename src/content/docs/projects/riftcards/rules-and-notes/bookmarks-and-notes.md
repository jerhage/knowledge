---
title: Bookmarks, Notes and the Saved Screen
description: "The annotation feature, `AnnotationSubject` with each owner's branded id, slots filled at the route, `SavedScreen` as a shell component, and the open counts question."
tags: [riftcards, architecture, components, react-native]
sidebar:
  order: 52
---

In riftcards a person can bookmark a core rule or a card and write notes about them, and a Saved tab collects what they've marked. The `annotation` feature owns all of that. It's a small feature with an unusual position in the graph: it names three other features, and those three draw its controls without knowing it exists. The general pattern is [naming or slotting](/architecture/placing-a-concept/#naming-or-slotting-which-side-of-a-pair-holds-the-edge); why annotation landed where it did is on [where a riftcards concept lives](/projects/riftcards/architecture/ownership-and-placement/).

## What the annotation feature owns

`annotation` owns the person's own marks and notes over a subject, and a subject is a core rule, a card or a deck. A note may also hang off no subject at all; that's the scratchpad. Two repositories persist it: `BookmarkRepository` and `NoteRepository`.

In the [feature graph](/projects/riftcards/architecture/feature-graph/), `annotation` names `card`, `rules` and `deck`, and nothing names `annotation`. The first use of those edges is the subject type below, which imports `printingIdSchema`, `coreRuleNumberSchema` and `deckIdSchema`, so each kind of subject carries the identifier its own feature owns. That's all `deck` is named for. The [saved screen](#the-saved-screen-is-not-a-feature) spends the other two edges on more: to show what a mark is about, `annotation` looks up the cards and rules it names through capabilities those features define, and borrows a helper from `rules` that files a saved rule under its heading.

## What a mark is about

`AnnotationSubject` is a discriminated union on `kind`, in `src/features/annotation/value-objects/annotation-subject.ts`. Each arm holds the branded id of the feature that owns that identity:

```text
{ kind: "coreRule"; id: CoreRuleNumber } | { kind: "card"; id: PrintingId } | { kind: "deck"; id: DeckId }
```

It used to be `{ kind; id: string }`, which let `{ kind: "card", id: "103.2.a" }` compile: a card bookmark holding a rule number. With each arm typed, that line doesn't compile. I made the change on 2026-09-16. Because `annotation` already names the three features, the ids stay with their owners; nothing had to move to a shared module.

The card arm carries a `PrintingId`, not a `CardId`, which is the difference between a specific printing and the card as a game piece (see [cards, printings and the `Card` model](/projects/riftcards/cards/card-and-printing/)). A mark is made on the thing on screen, and what's on screen is a printing: the card routes hold a `printingId`, and `SqliteCardRepository` joins `bookmark.subject_id` to `card_printing.id` to answer "only bookmarked".

A string becomes a branded id in the adapter and only there. `src/infrastructure/sqlite/annotation-mapper.ts` parses each row through `parseBookmark` and `parseNote`, which parse the subject through this union. Writing needs no conversion: a branded id is a string, so the repositories write `subject.id` into the `text` column as it is. A branded id is reached by parsing, never by casting (see [identities](/projects/riftcards/cards/identities/)).

`AnnotationSubjectId<TKind>` is the id for one kind, read off the union with `Extract` instead of being written out a second time. `BookmarkedSubjectsData`, the [data component](/projects/riftcards/presentation/data-components/) that reads which subjects are bookmarked, is generic over the kind. It hands its children `isBookmarked` and `toggleBookmark` typed in that kind's id, so a screen of cards can't be handed a rule number. It builds the `{ kind, id }` subject by parsing, in one place, so a write can never name a different kind from the one the read was scoped to.

`tests/annotation/annotation-subject.test.ts` pins the guarantee with `@ts-expect-error` on the lines that must not compile, so deleting the brand makes that file fail the type check. That's the technique on [pin a type guarantee with a failing compile](/testing/tests-as-evidence/#pin-a-type-guarantee-with-a-failing-compile).

## The annotated features leave slots

`annotation` names the others, so they can't name it back without a cycle. They don't need to: none of them needs annotation's types, only a place to put its controls. So each one declares a slot, and the route fills it.

`CardDetailScreen` takes `bookmarkControl` and `notes` as React nodes and renders them where they belong, with no reference to what they are. `CoreRulesScreen` can't take a node per row, since the document has 1364 rows, so it takes functions instead, such as `bookmarkFor` and `notesFor`, and calls them per row. A slot can be [a function that makes UI](/react/render-props-and-tanstack-query/#a-render-prop-is-the-react-slot) as well as the UI itself. The routes `src/app/cards/[id].tsx`, `src/app/(tabs)/index.tsx` and `src/app/(tabs)/rules.tsx` fill the slots, at the one layer whose imports may reach every feature.

The cost is that reading `card-detail-screen.tsx` alone doesn't reveal that a bookmark appears there; you have to read the route. The slotting side, which has no import of annotation, pays that price, and that's the right side to pay it.

## A repository and a manager

The feature has narrow capabilities, one per need: `BookmarkFinder`, `BookmarkLister`, `BookmarkRemover`, `BookmarkSaver`, and the same set for notes. Two more types compose all four: `BookmarkRepository` and `BookmarkManager`. Today they're structurally identical, on purpose.

- The repository is what the SQLite adapter implements and what composition exposes. It's the store's whole surface for bookmarks, and it may grow: a count, a scope, a bulk write, whatever the store gains.
- The manager is what a consumer that manages bookmarks takes. `BookmarkedSubjectsData` takes a `bookmarkManager` because it reads marks and writes them. It's not expected to grow with the repository, and a screen that only reads still takes a `BookmarkLister`.

The routes pass the repository that composition built where a parameter is typed as a manager, and it fits structurally with no cast. The day the repository gains a method no screen needs, the two types diverge and every consumer still takes the smaller one. That's why both are written down before that day, and why they mustn't be collapsed into one because they match now. `NoteManager` stands in the same relation to `NoteRepository`; I wrote it on 2026-09-16 together with its first consumer, not ahead of it. That consumer was `SubjectNotesData`, renamed `NotesData` later the same day when a note could hang off any subject or none. The general version is [a repository and a manager are two types even when they match](/architecture/capabilities/#a-repository-and-a-manager-are-two-types-even-when-they-match).

## The saved screen is not a feature

The Saved tab shows what the person has marked, in sections. `SavedScreen` draws it, and it isn't a feature at all. It owns no concept, only a title, a summary line and the order its sections stand in. So it lives in `src/components/app-shell/`, beside `SplitLayout`, where the standing rule that components import no feature already covers it.

It takes what it shows as props built at `src/app/(tabs)/saved.tsx`: the counts for its summary line, and the sections as one React node slot, the way `CardDetailScreen` takes its bookmark control and notes. The sections come from `annotation`. `SavedSectionsData` reads the marks and notes and looks up what they name, through `CardSummariesByPrintingIdsFinder` from `card` and `CoreRulesByNumbersFinder` from `rules` (both added on 2026-09-16), and `SavedSections` draws a section per kind of subject. Because `annotation` already named `card` and `rules`, adding the saved cards and rules added no feature edge.

## An open question: counts that hide the document

The rules screen needs two values besides the document: the note counts for its rules, which `SubjectNoteCountsData` reads, and the set of bookmarked rules, which `BookmarkedSubjectsData` reads. Both data components wrap the rules route.

While the counts load, `SubjectNoteCountsData` has an empty value ready, `NO_COUNTS`, for exactly the states it can't resolve, and then doesn't use it: it draws a loading state instead of its children. So someone opens the Rules tab, and all 1364 rules are replaced by a spinner until a count of notes arrives. `BookmarkedSubjectsData` wraps the same route the same way.

The screen is drawable without those values: the document doesn't depend on a count or a set of marks. By the rule in [a boundary draws in place of its children only when it has no data for them](/architecture/data-components/#a-boundary-draws-in-place-of-its-children-only-when-it-has-nothing-to-pass-them), these two should pass down the empty value and let the document render. For now both are recorded as open questions, not settled design.
