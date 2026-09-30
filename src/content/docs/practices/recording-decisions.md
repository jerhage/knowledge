---
title: Writing Down Decisions, Departures and Kept Code
description: Why decisions live in dated documents rather than comments, how a departure and kept code are marked, looking for a producer, sharing real values with tests, shims, and revisiting a decision by changing its record.
tags: [git]
sidebar:
  order: 2
---

Most of what a codebase decided is invisible in the code. The code shows the choice that won, never the ones that lost or why they lost. This page is about the few habits that keep the why findable. They come from riftcards, my React Native app, where the conventions side is on [code conventions](/projects/riftcards/engineering/code-conventions/).

## The code says what; a document says why

Say the card catalog's add-note sheet once showed its list full screen instead of inside the sheet, and after two attempts, it turned out that the UI library only handles a scroll view in that kind of sheet when it's among the first children. The fix is a reordering, and the code afterwards looks ordinary. The next person who tidies the sheet has no reason to keep that order, moves the list, and rediscovers the same dead end.

The code is the truth about what the app does. It doesn't record why, and the why is what gets argued again. So a decision that cost something to reach goes into a document in the repository: what was decided, what was rejected, and why.

The alternative is a comment next to the code, and comments go stale in place. A comment says nothing about when it was written, so when the code around it changes, it keeps making its claim with the same confidence. A document entry carries a date and is tied to the commit that made the change, so it ages visibly: a reader can see how old a decision is and what the code looked like then. The real story this example is based on is in [why write any of this down](/projects/riftcards/engineering/code-conventions/#why-write-any-of-this-down).

## A departure is written beside the rule

Rules have exceptions, and some of them are deliberate. In riftcards, the accessibility rules say meaning is never carried by color alone, yet card art shows a card's domain by color alone while some palette work is pending. That's a choice, not an oversight.

The next reader usually has none of the reasoning that produced it. They see a rule and code that breaks it, and an unexplained violation reads as a mistake. They then do one of two things: fix it again, undoing a decision they didn't know about, or copy it as precedent, spreading an exception that was meant to stay single. Both are worse than the departure itself.

So a deliberate departure from any rule gets written down where the rule is, with the reason and the date. A departure that isn't written down is just the rule breaking, with nobody aware of it. [An exception is written down or it is not an exception](/ui-patterns/accessibility-as-done/#an-exception-is-written-down-or-it-is-not-an-exception) applies this to accessibility.

## Kept code says why it is kept and what would make it live

Unused code comes in two kinds that look identical. Some is kept on purpose: an operation waiting for the screen that will call it, or an alternative component kept for a later trial. Some is dead because its caller went away. In riftcards I twice had to answer "is this waiting for a caller, or did its caller go away?" by reading git history, because the code recorded nothing. Two operations waiting for UI and one superseded lookup looked exactly alike.

So the rule is: unused code kept on purpose has a comment saying so, and unused code without one may be deleted. The comment has to say two things: that the missing caller is deliberate, and what would make the code live.

```ts
/** Not in use. Waiting on a set-detail screen and the `getSetQuery` that would feed it. */
```

The second half matters. A marker that only says "kept" is a license to hoard; one that names what would make the code live can be checked, and dropped when that thing is no longer coming. Unmarked, unused code goes without ceremony. Git holds it, and a commit message is a better archive than a branch nobody reads.

Kept code also needs a test, because nothing else runs it (see [kept code needs a test](/testing/tests-as-evidence/#kept-code-needs-a-test)).

## Look for a producer, not a declaration

A type can exist, be handled everywhere, and never be constructed. Say a deck's verification has three variants: legal, illegal and unverified. Every formatter handles all three. But the one function that produces a verification only ever returns legal or illegal. The unverified variant reads as working behavior, and nothing in the app can reach it.

That happened in riftcards, and the variant was retired. The lesson is about where to look. Before building on something, search for the code that creates it, not the code that declares or handles it. Handlers prove only that someone expected a value to arrive.

## Share the real value with a test, not a copy

A test often needs a real value from the app: the empty filter set, a default sort order. One way is to copy the value into the test file. The other is to export it from the app and import it.

The copy looks safer, since it keeps the export surface small. But it can drift in meaning while still type-checking. Say the catalog's filters gain an optional field. The app's empty value is updated to set it to empty. The test's copy leaves it out, still type-checks, and now holds whatever the missing field falls back to, which may not be empty at all. The test still passes, and it's no longer testing the empty filters.

So a real value is exported and shared with the test. An export whose only importer is a test isn't dead code as long as the app itself uses the value; only the export is reached from a test.

## A shim translates in the wrong direction

When I rename something or change its type, the old callers stop compiling. A shim is a small adapter that translates back to the old form so those callers keep working. It's always tempting, because it makes the change look smaller.

It translates in the wrong direction. The change just removed an encoding, and the shim translates back to it, so now the old encoding lives on in a place nobody will look. The fix is to change the callers.

A classic adapter looks similar and is the opposite: it translates an outside library into the project's own types at a boundary (see [ports and adapters](/architecture/ports-and-adapters/)). That's the architecture, not a shim. The test is which direction the translation goes: toward the project's own current types is an adapter, back toward an old encoding is a shim.

## Revisit a decision by changing its record

Written decisions can make people feel they can't disagree. That's not the point. Several of riftcards' rules exist because an earlier decision turned out to be wrong: the query factories moved out of the presentation layer that way, and the rule about dead code was written after a deletion that shouldn't have happened.

The point of the record is that a decision is recorded, not that it's never revisited. When I change a decision, I change its record in the same commit as the code. Then the document always matches the code, and the history of the record shows when and why the decision moved.
