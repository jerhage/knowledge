---
title: The Seven Features and Their Graph
description: What each Rifty feature owns, the feature DAG, the layer edges, and the absences that mean something.
tags: [rifty, architecture, typescript]
sidebar:
  order: 11
---

Rifty, my Riftbound card app, is organized around product concepts (cards and their printings, sets, decks, browsing, analysis, the core rules, a person's notes) rather than around frameworks or database tables. Each concept is a feature, the Rifty word for what the general pages call a domain. The features form [an acyclic graph](/architecture/overview/#the-goals): each feature owns its concepts, only certain edges exist, and the graph can be any DAG rather than [leaves and non-leaves](/architecture/domains-and-the-graph/#leaves-and-non-leaves).

## The seven features

| Feature | Owns | Persists |
| --- | --- | --- |
| `card` | Gameplay identity: attributes, rules text, classification, domains, tags, speeds, keywords, champion name, and the card query language. Plus the keyword module and the card UI components. | Yes: `CardRepository`, `KeywordLister` |
| `set` | Releases: set code, name, publication date, marketplace references. | Yes: `SetRepository` |
| `deck` | The person's deck, its sections, tournament legality, and the build workflow. | Yes: `DeckRepository` |
| `catalog` | Browsing only: query criteria, the query hook, the search layout, the grid, the filter sheet. (The sort options moved from here into `card` on 2026-09-13.) | No |
| `analysis` | Read-only measurements over a list of cards: curves, mixes, totals, draw odds. | No |
| `rules` | The official Core Rules document: one numbered entry per rule, its bullets and examples, the edition that printed them, and reading, searching and moving around it on screen. | Yes: `CoreRulesRepository` |
| `annotation` | The person's own bookmarks and notes on a core rule, a card or a deck, plus notes about nothing in particular (the scratchpad). | Yes: `BookmarkRepository`, `NoteRepository` |

Measured at the latest commit (2026-09-17), in files and lines under `src/features/`: `deck` 90 files and 7000 lines, `rules` 43 and 3530, `annotation` 45 and 2699, `card` 52 and 2195, `catalog` 14 and 1120, `analysis` 8 and 872, `set` 11 and 168.

`catalog` and `analysis` own no model, no repository, no port and no use case. That's the target, not a leftover. Catalog is browsing, and a catalog that owned persistence was exactly what I was correcting when `card` and `set` became their own features ([containment is not ownership](/projects/rifty/architecture/ownership-and-placement/#card-and-set-are-peers-of-catalog)).

The Saved screen isn't a feature at all. It owns no concept, only a title and a summary line of counts, so it lives in `src/components/app-shell/` and takes its sections as a slot (more on [where a concept lives](/projects/rifty/architecture/ownership-and-placement/#naming-and-slotting-annotation)).

## The feature graph

```text
catalog ──► card ──► set
   └──────────────────▲
deck ──► card
  └──► analysis ──► card

annotation ──► card, rules, deck

rules
```

Every edge points one way, and there are no cycles at feature level or at file level. Read edge by edge:

- `set` imports no feature. It's a leaf.
- `card` imports only `set`, for `SetCode` and `MarketplaceReference`. A card names the release it was printed in.
- `catalog` imports `card` and `set`. It reads both and owns neither.
- `analysis` imports `card` alone. It measures cards and has no reference to decks.
- `deck` imports `card` and `analysis`, never `catalog` or `set`.
- `rules` imports no feature. It's the other leaf.
- `annotation` imports `card`, `rules` and `deck`. A note is about one of them, and the feature that would be meaningless without the other is the one that names it. The first use of those edges is the subject type: each arm of `AnnotationSubject` holds the id type its own feature owns, and that's the only thing `annotation` takes from `deck`. The other use is resolving what a mark names: the Saved screen's data component looks bookmarked cards and rules up through `card` and `rules` capabilities and draws them with their types. Why annotation names them and not the other way round is on [naming and slotting](/projects/rifty/architecture/ownership-and-placement/#naming-and-slotting-annotation).

Nothing imports `catalog` except the browsing route, `src/app/(tabs)/index.tsx`. Nothing imports `analysis` except six files in `deck/presentation/`, the ones that reduce a deck to cards and draw the analysis panels.

## The layer edges

The layers import features like this, as measured:

```text
app            ──► annotation, card, catalog, deck, rules, set
composition    ──► annotation, card, deck, rules, set
infrastructure ──► annotation, card, deck, rules, set
components, hooks, constants, shared, application ──► nothing
```

The absences are as informative as the edges. **Neither `infrastructure` nor `composition` touches `catalog` or `analysis`**, because those two own no persistence: there's nothing to wire and nothing to implement. If a wiring edge into either of them ever appears, a model has gone into the wrong feature. That absence is an invariant, and [the graph checker](/projects/rifty/architecture/checking-the-graph/) fails on it.

## Any DAG, not leaves and non-leaves

The general pages describe two ways to keep the domain graph acyclic. One is the leaf rule: a leaf imports no domain, a non-leaf imports only leaves, and nothing imports a non-leaf, so a cycle is impossible by construction. The other allows any acyclic graph and checks for cycles on [the domain graph itself](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself). Rifty uses the second.

The leaf rule doesn't fit this graph. `analysis` imports `card` and is imported by `deck`, so it would have to be a leaf and a non-leaf at once. `card` imports `set` and is imported by four features. Under the leaf rule, `Card` and every id it holds would have to move down into a shared kernel, and the deck screens couldn't import the analysis panels. I'd rather keep each id and model with the feature that owns it, and let a feature import another when it uses that feature's vocabulary. [Dokseo](/projects/dokseo/architecture/domains/), my manga and book reader, took the leaf rule, where its domains have far fewer edges between them.

What it costs: the guarantee isn't structural any more. A cycle is prevented by [`check:deps`](/projects/rifty/architecture/checking-the-graph/), which aggregates file imports into features and fails on a cycle at either level, not by a rule that makes one impossible to write.

## Direction and acyclicity, not isolation

The constraint is on direction and acyclicity. It doesn't require features to be isolated from each other. `deck` depends on `card` and `analysis` directly and on purpose. They're modules inside one bounded context, so sharing `Card` is correct. Translating between two models belongs at a real context boundary, which would appear when a second source of cards exists, not before.

The structure has a cost of its own. It adds interfaces, mappers and composition code before a small app strictly requires them. It pays off here because the app has durable game rules and its infrastructure is likely to change. For a small, disposable UI, direct calls can be the simpler choice.

## Why the graph must stay a DAG

When two features import each other, three things break, in increasing order of pain. You can't read one feature without the other. You can't test one without constructing the other. And the cycle never gets removed later, because by the time it hurts, both sides depend on whatever sits in the middle.

Acyclicity is what lets `analysis` be tested without a deck, `card` without a catalog, and the whole graph load in any order.

The case that made it concrete came from a legal edge. `deck` may import `analysis`, and the deck model declared its entry type as an extension of analysis's `CardCopy`. The direction was fine and the check passed, but the deck model could no longer be read without opening a calculation feature. That story, and the cycle that extracting analysis would have created if I'd only moved files, are on [extracting analysis](/projects/rifty/architecture/extracting-analysis/).

The alternative is to allow cycles and rely on discipline. That's the choice behind every codebase that has cycles, made one reasonable-looking import at a time.
