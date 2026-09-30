---
title: "Tests as Evidence: Assertions, Guards and Scenarios"
description: Why a failing assertion is never weakened, a guard counts only once it has failed, kept code gets a test, scenarios run on a real database, fakes model the contract, and a type guarantee is pinned by a line that must not compile.
tags: [testing]
sidebar:
  order: 5
---

A test suite is only worth something if a green run means the app works. Each of my testing rules protects that meaning. Most of them come from Rifty, a React Native card app of mine for the Riftbound card game, where each one was learned by a test that passed and proved nothing. The Rifty side, with its real suites and fixtures, is on [how Rifty is checked](/projects/rifty/engineering/checks-and-tests/).

## Never weaken an assertion to pass

Say I change how the card catalog sorts, and an assertion in an old test fails. The quick fix is to loosen the assertion until it passes: check the length instead of the order, or wrap it in a condition that's now never true.

That throws away what the failure just showed me. A failing assertion means one of two things. Either my change is wrong, or the behavior the assertion described is really gone. In the first case I fix the code. In the second case the behavior went away *by decision*, and then the assertion should go too: I delete it and say why, in the commit and beside whatever recorded the decision.

What I never do is keep the test and make it assert nothing. A vacuous test still counts in the suite total and still reads as coverage to the next person who opens the file. They see a test named for a behavior and believe the behavior is checked. That's worse than no test at all, because no test at least looks like a gap.

In Rifty this happened when I reverted a lettered band that marked a card's domain (a game term: cards belong to domains such as Body or Calm). An assertion checked that the catalog grid identifies a domain without relying on color, and after the revert that was false on purpose. I deleted the assertion and wrote the decision down next to the accessibility finding it came from.

## A guard counts once you have seen it fail

A regression test is written after a bug is fixed, to stop the bug from coming back. The trouble is that it's written against the fixed code, where it passes. Passing there proves nothing: a test can pass because the behavior is right, or because it asserts something that was never broken, or because it asserts nothing at all.

So before I trust a regression test, I run it against the code I'm replacing and watch it fail. If it doesn't fail on the old code, it isn't guarding anything. The same goes for any check that's meant to block something, like an architecture rule. [Prove a rule fires before trusting it](/tooling/dependency-cruiser/#prove-a-rule-fires-before-trusting-it) is this idea applied to dependency-cruiser.

## Kept code needs a test

Sometimes I keep code that nothing calls yet: a component I plan to try again, or an operation waiting for the screen that will use it. I mark it with a comment that says it's kept and what would make it live (see [kept code says why it is kept](/practices/recording-decisions/#kept-code-says-why-it-is-kept-and-what-would-make-it-live)).

Code like that has no callers by definition, so nothing in the app exercises it. If a refactor breaks it, no screen fails and no other test fails. It rots without anyone noticing, and the day someone finally reaches for it, it doesn't work. A test is the only thing that keeps running it, so kept code gets one. In Rifty an unused alternative to the domain bar, `DomainBand`, still has four assertions for exactly this reason.

A test isn't a caller, though. When I find code whose only callers are tests and that has no keep-marker, the tests-only use is evidence it's dead, and I delete it along with its tests.

## A scenario runs on real critical infrastructure

Most tests check one piece in isolation. A scenario test checks a workflow a person actually goes through, like adding a card to the catalog, writing a note on it and then removing the card. In Rifty these files are named `*.scenario.test.ts`, so they're easy to find.

A scenario only means something if the parts that determine whether the workflow works are real. For an app that stores data in a database, that's the database itself. So a scenario runs on:

- a real database engine, in memory, so it's still fast;
- the migrations the app ships, replayed in order, so the schema is the one a device gets;
- the production adapters, the same code that reads and writes the database in the app.

A fake store isn't enough, because the schema has rules of its own: a foreign key that blocks deleting a card a deck still holds, a uniqueness constraint, a column that can't be null. A fake store written in TypeScript implements none of them. A scenario against it passes, the app runs the same steps against the real database, and the delete fails with an error nobody handles. Only a real engine with the real migrations can show that. For an Expo app on SQLite, how to do that under Jest is on [replaying the same migrations on node:sqlite](/react-native/expo-setup/#under-jest-replay-the-same-migrations-on-nodesqlite).

## A fake models the contract

Outside scenarios, most tests replace a port with a fake: a small object that implements the same interface without real I/O. That's right wherever the real thing would be slow or unreliable. Time, ids and randomness are the usual examples. A use case that stamps a creation date and mints an id can't be asserted on if it reads the real clock and a random UUID, so it takes them as ports (see [time, ids and randomness come from ports](/architecture/dependency-injection/#time-ids-and-randomness-come-from-ports)) and the test passes it deterministic ones:

```ts
function fixedClock(...instants: readonly string[]): Clock {
  let index = 0;

  return {
    now: () => instants.at(Math.min(index++, instants.length - 1)) ?? "2026-09-01T10:00:00.000Z",
  };
}

function sequentialIds(prefix = "deck"): IdGenerator {
  let index = 0;

  return { next: () => `${prefix}-${++index}` };
}
```

The rule for any fake is that it models the contract of the port, not the result the test checks for. A fake card finder stores cards and returns the one with the requested id, or reports that there's none, exactly as the port's contract specifies. A fake that skips ahead and returns what the screen should end up showing bypasses the use case in between, so the test passes whether or not the use case works.

Each layer then gets the kind of test that fits it: use cases run with a fixed clock and sequential ids; repositories and mappers run against the real in-memory store; UI components are tested through their props and callbacks. The hand-written fake has a maintenance cost of its own, described in [widening a composition-root type breaks every hand-written fake](/testing/fakes-and-async/#widening-a-composition-root-type-breaks-every-hand-written-fake-and-only-the-type-check-reports-it). A narrow port keeps it small: a port with one method needs a one-method fake.

## Pin a type guarantee with a failing compile

Some guarantees live only in the types. Say the catalog's notes can be attached to a card or to a set, and each kind of subject has its own branded id:

```ts
type CardId = string & { readonly __brand: "CardId" };
type SetCode = string & { readonly __brand: "SetCode" };

type NoteSubject =
  | { readonly kind: "card"; readonly id: CardId }
  | { readonly kind: "set"; readonly id: SetCode };
```

The point of the brands is that `{ kind: "card", id: someSetCode }` doesn't compile. But brands vanish at runtime: both ids are plain strings. If someone later simplifies `id` to `string`, every runtime test still passes, because no runtime test can observe a type. The guarantee is gone and the suite is green.

So the guarantee gets a test that fails to compile when the guarantee breaks. TypeScript's `// @ts-expect-error` comment marks the next line as one that must have a type error. If that line compiles, the type checker reports "Unused '@ts-expect-error' directive" ([TypeScript 3.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html)), and the check fails:

```ts
const setCode = parseSetCode("ogn");

// @ts-expect-error a set code is not a card id
const wrong: NoteSubject = { kind: "card", id: setCode };
```

Remove the brand and this file stops type-checking, which is exactly the failure I want. The test only works if the type check runs as part of the checks, since a test runner that strips types without checking them never reports the error. Write one such line for each mix-up the types are meant to stop. A brand with a hole in it passes this kind of test for the wrong reason, so see also [a phantom brand must be invariant](/typescript/type-checking-techniques/#a-phantom-brand-must-be-invariant-or-it-has-a-hole).
