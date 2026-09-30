---
title: How Rifty Is Checked
description: The five checks, the Jest suite, scenario tests on a real in-memory SQLite, fixtures with a fixed clock, and the Deno-resolution gap.
tags: [rifty, testing, sqlite, typescript, expo]
sidebar:
  order: 90
---

Rifty, my Riftbound card app, is checked by five commands: the type check, the linter, the Jest tests, a Drizzle schema check and a dependency-graph check. They're the Rifty side of [tests as evidence](/testing/tests-as-evidence/), with real commands, suites and fixtures. Dokseo, my manga and book reader, does the same job with a chain of Deno tasks and Vitest, on [how Dokseo is checked](/projects/dokseo/engineering/checks-and-tests/); the biggest difference is that Rifty's tests run under Jest while its scripts run under Deno, which leaves [a gap](#the-deno-resolution-gap).

## The five checks

```text
npm run check:types    tsc --noEmit
npm run check:lint     oxlint
npm test               jest
npm run check:db       drizzle-kit check
npm run check:deps     the dependency graph, under Deno
```

`check:deps` is a Deno script of mine, `scripts/dependency-graph.ts`, described on [Rifty's graph checker](/projects/rifty/architecture/checking-the-graph/). Formatting is separate: `npm run format` runs `oxfmt`, on what I touched.

The linter is oxlint, not ESLint. That matters for one command: `npx expo lint` [would install ESLint as a side effect and rewrite the lock file](/react-native/expo-setup/#npx-expo-lint-installs-eslint-and-rewrites-the-lock-file), so it's never the way to lint this project.

## The Jest suite

`npm test` runs `jest --runInBand`. When I counted on 2026-09-16 there were 89 suites and 808 tests, all passing, in about 26 seconds. The suite has grown since: by 2026-09-17 there were 95 test files.

The tests mirror the feature layout, plus a directory for the shared hooks: `tests/analysis/`, `card/`, `catalog/`, `deck/`, `hooks/`, `infrastructure/`, `shared/`, `annotation/`, `rules/` and `components/`, with `tests/sqlite-scenario-store.ts` at the root. `annotation/`, `card/`, `deck/` and `rules/` each have their own fixtures file.

There is no `tests/set/`. The set feature's scenario test lives at `tests/catalog/set-catalog.scenario.test.ts` and reaches into `../card/fixtures` for its `cardSet` builder. It's a known wrinkle in the layout, not a rule.

## Scenarios run on a real SQLite

A test that walks through something a person does in the app is a scenario, named `*.scenario.test.ts`. There are ten:

- `tests/annotation/annotation-storage.scenario.test.ts`
- `tests/card/bookmarked-card-catalog.scenario.test.ts`
- `tests/card/card-catalog.scenario.test.ts`
- `tests/card/card-summaries-by-printing-ids.scenario.test.ts`
- `tests/catalog/set-catalog.scenario.test.ts`
- `tests/deck/deck-editing.scenario.test.ts`
- `tests/deck/deck-storage.scenario.test.ts`
- `tests/rules/core-rules-by-numbers.scenario.test.ts`
- `tests/rules/core-rules-read.scenario.test.ts`
- `tests/rules/core-rules-search.scenario.test.ts`

A scenario runs on [real critical infrastructure](/testing/tests-as-evidence/#a-scenario-runs-on-real-critical-infrastructure). `tests/sqlite-scenario-store.ts` builds a real SQLite engine on Node with `node:sqlite`, replays the committed migrations from `drizzle/`, and puts the production repository adapters on top; the setup is on [replaying the same migrations on node:sqlite](/react-native/expo-setup/#under-jest-replay-the-same-migrations-on-nodesqlite). It seeds cards, printings, sets, decks and the core rules from one store, which also holds the annotation tables, because the app has one database file; splitting the store per feature would test a layout the device never has.

The schema's own rules are why this matters. `tests/infrastructure/deck-integrity.test.ts` drives the schema directly: it proves the database fails a delete of a card or a printing that a deck holds, and fails an insert of a deck entry naming a printing that doesn't exist. Those failures come from foreign keys (see [how a deck is stored](/projects/rifty/decks/deck-storage/)), and no fake store would enforce them.

The same foreign keys determine how the deck scenarios are set up. A deck row now needs its card and printing to exist, so `deckScenarioStore()` in `tests/deck/fixtures.ts` is `createSqliteScenarioStore()` with the catalog rows those decks reference already seeded.

Outside scenarios, a capability may be replaced with a controlled fake where real I/O would be slow or unreliable. The fake has to [model the contract](/testing/tests-as-evidence/#a-fake-models-the-contract), not bypass the use case it's feeding.

## Fixtures with a fixed clock

Rifty has no server, but it still has a clock, an id generator and a random source, and those are what make tests slow, flaky or order-dependent. So they're ports (see [capabilities, adapters and the composition root](/projects/rifty/architecture/capabilities-and-composition/#why-ports-without-a-server)), and `tests/deck/fixtures.ts` supplies deterministic ones: `fixedClock(…)` returns the instants it's given, and `sequentialIds()` returns `deck-1`, `deck-2` and so on. A use case that stamps `createdAt` and mints an id then produces the same deck on every run, and the test can assert on both.

The alternative, calling `Date.now()` and `crypto.randomUUID()` directly, is simpler right up to the first test that asserts on a timestamp. Then the test runner has to freeze the system clock instead.

## What each layer is tested with

Each layer gets the kind of test that fits it:

- Data components: loading, success, failure, retry and pagination.
- UI components: props and explicit callbacks.
- Use cases: deterministic clocks and id generators.
- Repositories and mappers: the in-memory SQLite scenario store.

How a data component is tested is on [data components in Rifty](/projects/rifty/presentation/data-components/).

## The evidence rules, in this codebase

The rules from [tests as evidence](/testing/tests-as-evidence/) each have a Rifty case:

- **An assertion deleted, not weakened.** When I reverted the lettered domain band, the assertion that the catalog grid identifies a domain without color became false on purpose. I deleted it and recorded the decision beside the accessibility finding it came from (see [where the app is not conformant](/projects/rifty/presentation/accessibility/#where-the-app-is-not-conformant)).
- **Kept code with tests.** `DomainBand` is unused and still has four assertions. `findSet`, `mightCurve`, `totalPower` and `atLeastOneChance` are marked as kept and already have tests (see [code conventions](/projects/rifty/engineering/code-conventions/#comments-and-keep-markers)).
- **A type guarantee pinned by a failing compile.** `tests/annotation/annotation-subject.test.ts` marks with `@ts-expect-error` the subjects that must not compile, like a card bookmark holding a core rule number. Deleting the brand makes the file fail `check:types` (see [bookmarks and notes](/projects/rifty/rules-and-notes/bookmarks-and-notes/#what-a-mark-is-about)).

## The Deno-resolution gap

The seed pipelines in `scripts/` run under Deno, and they import the app's schemas by relative path, like `../src/features/card/value-objects/...`. The `@/` alias is a `paths` mapping in `tsconfig.json`, and Deno uses those mappings only for type checking, never to resolve an import at run time ([Deno's tsconfig migration guide](https://docs.deno.com/runtime/reference/ts_config_migration/)). Their pure parts are tested under Jest: `tests/catalog/catalog-seed-generator.test.ts` imports `scripts/catalog-seed.ts`, and `tests/rules/core-rules-seed.test.ts` imports the core rules seed builder and runs it over the real extracted text.

Jest resolves those imports its own way, not the way Deno does, and it only loads the modules a test imports. The I/O shells, `generate-catalog-seed.ts` and `generate-core-rules-seed.ts`, are imported by no test at all. So `npm test` can pass while a script no longer runs: a moved file breaks an import in one of the shells, the tests stay green, and nobody finds out until the next `npm run generate:catalog-seed` fails to resolve it. An alias-based find-and-replace doesn't help here, because the scripts' imports are relative paths it never matches.

Only a real `npm run generate:catalog-seed` (or `generate:core-rules-seed`) proves the scripts' imports still resolve after files move. The pipelines themselves are on [the catalog seed pipeline](/projects/rifty/persistence/seed-pipeline/) and [the core rules document](/projects/rifty/rules-and-notes/core-rules/#from-pdf-to-seed).
