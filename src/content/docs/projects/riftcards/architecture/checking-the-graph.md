---
title: "check:deps: Riftcards' Graph Checker"
description: The Deno script that resolves every import form, checks cycles at file and feature level, what it can't see, and the edge snapshot I'd build first.
tags: [riftcards, architecture, typescript]
sidebar:
  order: 16
---

Riftcards' [feature graph](/projects/riftcards/architecture/feature-graph/) is any acyclic shape, not leaves and non-leaves, so no structural rule makes a cycle impossible. A checker has to find them. That's `npm run check:deps`, a script in `scripts/dependency-graph.ts` that runs under Deno. It's the "check cycles on the domain graph itself" option from [domains and the dependency graph](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself); [the reader](/projects/reader/architecture/dependency-rules/) takes the other option and enforces its leaf rule with dependency-cruiser.

## Why a module cycle check isn't enough

A file-level cycle check finds a chain of imports between files that comes back to where it started. Two features can depend on each other without any such chain: a file in `deck` imports one file in `analysis`, and a different file in `analysis` imports a different file in `deck`. Neither edge closes a loop between files, so a file-level check passes, and the two features are still in a cycle ([a module cycle check doesn't detect a cycle between domains](/architecture/domains-and-the-graph/#a-module-cycle-check-doesnt-detect-a-cycle-between-domains)).

So the check has to cover the graph between features as well as between files.

## What the script does

It reads every file under `src/` and resolves every import form the project uses: the `@/` alias and relative specifiers, `import type`, `export … from`, and dynamic `import()`. A check that missed type-only imports would miss the edges that bring in vocabulary. A check that only resolved the alias would miss a cross-feature import written as a relative path.

It then groups the file edges into zones. Each `src/features/*` folder is a zone, and so is every other top-level folder under `src/`: `app`, `composition`, `infrastructure`, `components`, `hooks`, `constants`, `shared`, `application` and `types`. By default it draws the feature graph as text and reports `7 features — a DAG, no cycles` on a clean run. `npm run check:deps -- --full` prints every zone's edges instead, with the number of file imports behind each one, and `--mermaid` prints the feature graph as a `graph LR` block, to paste into a markdown file or a GitHub comment.

It exits non-zero on a cycle or a broken rule. (An internal import it can't resolve to a file is listed, but doesn't fail the run.) Cycles are checked at both levels:

- **Zone level**, which catches two features that depend on each other through different files.
- **File level**, because a cycle inside one feature makes no zone edge at all, and would otherwise pass.

The rules, one violation each:

- A feature imports only the features its entry allows. The script declares, per feature, which features it may import: `card` may import `set`, `deck` may import `card` and `analysis`, and so on down the graph.
- No feature imports `infrastructure`.
- `infrastructure` never imports `composition`.
- `components`, `hooks`, `constants`, `shared` and `application` import no feature.
- `infrastructure` and `composition` import neither `catalog` nor `analysis`, since those two own no persistence.

## The greps it replaced

Before the script, each of these rules was a grep that had to print nothing. The last two were the direction checks:

```sh
grep -rn "@/infrastructure" src/features
grep -rn "@/composition" src/infrastructure
```

Feature code never imports infrastructure, and infrastructure never imports composition. The second was a real cycle until `openAppDataStore(logger, imageBaseUrl)` started receiving the image host instead of importing it from `@/composition/card-image-host` ([the other cycle](/projects/riftcards/architecture/extracting-analysis/#the-other-cycle-an-adapter-that-imported-composition)).

The script checks all of them at once, and it catches what a grep for `@/features/` can't: a cross-feature import written as `../../deck/…`.

One practical note: a rule checker is only worth trusting once you've seen each rule fail. Write the forbidden import, run the check, read the error, delete the import ([prove a rule fires before trusting it](/tooling/dependency-cruiser/#prove-a-rule-fires-before-trusting-it)). That applies to a hand-written checker as much as to dependency-cruiser, and more, because nobody else has tested its resolver.

## What the check does not detect

The deck model once declared `interface ResolvedDeckEntry extends CardCopy`, importing analysis's type into deck's own aggregate. `deck` may import `analysis`, so the direction was legal and `check:deps` passed. The deck model still couldn't be read without opening a calculation feature ([the full story](/projects/riftcards/architecture/extracting-analysis/#the-extends-cardcopy-edge)).

That's its limit. The script checks direction and cycles. It doesn't check which layer of a feature an edge ends in, or what kind of thing crosses it: a call or a type in the model. `deck-contents.ts` producing a `CardCopy` to pass to `energyCurve` is a call. Delete it and the dependency goes. `extends CardCopy` is a definition, and every reader of the deck model inherits it.

The rule I wrote after it: another feature's vocabulary may cross at a call site, never into your model. The test is whether you can remove the dependency by deleting a call. If you'd first have to redefine one of your own types, it's vocabulary, and it has entered your model ([calls may cross an edge](/architecture/placing-a-concept/#calls-may-cross-an-edge-vocabulary-may-not-enter-the-model)). Path rules in dependency-cruiser have the same blind spot ([what path rules don't reach](/architecture/dependency-cruiser-rules/#what-path-rules-dont-reach)).

## The edge snapshot I would build first

No rule distinguishes a good edge from a bad one in a legal direction. A person can, if a failing check puts the question in front of them at the right moment.

A snapshot of the edge set, checked in, and a check that fails whenever the graph changes, would do that. Every new edge would show up in a diff, and whoever reviews it would have to ask whether it should exist. If the snapshot records file edges, `extends CardCopy` would have shown up as a new edge from the deck model into `analysis`, which is exactly the question that needed asking.

It's written up and not built yet. If I started again, it would exist from day one. The rule about what may cross a boundary was learned the expensive way, and a snapshot would have raised the question when the edge was added rather than after.
