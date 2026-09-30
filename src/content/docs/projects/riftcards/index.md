---
title: Riftcards
description: A local-first Expo app for browsing Riftbound cards, building decks and reading the core rules; how its pages map onto the general notes.
tags: [riftcards, architecture, react-native, react, expo]
sidebar:
  order: 0
---

Riftcards is my companion app for the Riftbound trading card game. These pages are the app itself: its real modules, names and numbers, and the decisions as I made them. Each one links to the general page that explains the idea, so the concept is written once and riftcards shows one real implementation of it. (Back to [all projects](/projects/).) The React knowledge these pages rely on is in [React](/react/components-and-effects/), and the React Native and Expo knowledge is in [React Native](/react-native/accessibility/).

## What it is

A React Native app, built with Expo (SDK 57) and expo-router. It does three things: browse a catalog of Riftbound cards, build decks from them, and read and search the official core rules. On top of those, a person can bookmark a card or a core rule and write notes on it, plus notes about nothing in particular. (The annotation model has a deck subject too, but no screen offers it yet.)

Everything is local. The data lives in SQLite on the device, seeded from a catalog bundled with the app: 941 cards, 1429 printings (a card's releases, each with its own art and set), 8 sets and 1364 core-rule entries. There's no server and no account.

## Screens

| Route | What it shows |
| --- | --- |
| `/` | card browsing: the catalog grid with search, filters and sort |
| `/decks` | the saved decks |
| `/rules` | the core rules document, with search |
| `/saved` | the Saved screen: what I've bookmarked and noted |
| `/cards/[id]` | one printing of a card, with its bookmark and notes |
| `/decks/[id]` | one deck, with its analysis panels |
| `/decks/[id]/draw` | the draw simulation for a deck |
| `/decks/build` | the deck builder, for a new deck or an existing one |

On a tablet some of these open as panes beside the list instead of as pushed routes; that's on [phone and tablet layout](/projects/riftcards/presentation/phone-and-tablet/).

## The seven features

The code is split into features. A feature is what [the architecture notes](/architecture/overview/) call a domain; in riftcards "domain" is a game term (Fury, Calm and the other `CardDomain` values a card carries), so the modules are features. The graph between them is on [the seven features and their graph](/projects/riftcards/architecture/feature-graph/).

- `card`: a card's gameplay identity, its printings, and the card query language
- `set`: releases, with their codes, names, publication dates and marketplace references
- `deck`: the decks a person saves, their sections, tournament legality, and the build workflow
- `catalog`: browsing only (query criteria, the search screen, the grid, the filter sheet), with no model and no persistence
- `analysis`: read-only measurements over a multiset of cards (curves, mixes, draw odds), also with no persistence
- `rules`: the official core rules document, its entries, bullets and examples, and reading and searching it
- `annotation`: a person's bookmarks and notes on a core rule, a card or a deck

## Stack

- [Expo and expo-router](/react-native/expo-setup/) for the app and its routes, on React Native
- expo-sqlite for the database, with Drizzle for the schema, queries and migrations
- Zod to parse data where it enters, ts-pattern for exhaustive matches
- [TanStack Query](/react/render-props-and-tanstack-query/) (React Query) behind the data components
- Jest for tests, oxlint and oxfmt for linting and formatting
- Deno scripts for the seed pipeline and the dependency-graph check

## How it differs from the reader

[The reader](/projects/reader/) follows the same general architecture: an acyclic dependency graph, ports named for the need, one composition root, and a tool that checks the graph. Where the general pages offer two options, the two apps often picked differently. Neither is the exception; each page says which option riftcards took and why.

- **Features, not domains.** Same idea, different word, for the reason above. The layout is on [riftcards' layers and folders](/projects/riftcards/architecture/layers-and-folders/).
- **A top-level `infrastructure/`.** The reader keeps adapters inside their domain; riftcards keeps them in one `infrastructure/` folder that no feature imports. Also on [layers and folders](/projects/riftcards/architecture/layers-and-folders/).
- **Any DAG plus a zone check.** The reader uses [the leaf rule](/architecture/domains-and-the-graph/#leaves-and-non-leaves), which gives the graph a shape in which a cycle can't form. Riftcards lets features form any acyclic graph and [fails when a cycle appears](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself), between features or between files. See [the seven features and their graph](/projects/riftcards/architecture/feature-graph/).
- **Named result unions.** The reader's use cases return a generic `Result`; each riftcards use case returns its own named union. See [use cases, results and failure](/projects/riftcards/architecture/use-cases-and-failure/).
- **The composition root provides capabilities.** The reader's container hands out use cases; riftcards' composition root hands out narrow capabilities, and a use case's dependencies are built where it's called. See [capabilities, adapters and the composition root](/projects/riftcards/architecture/capabilities-and-composition/).
- **Data components, not view models.** Screen state for a read or a write lives in a data component that owns it. See [data components in riftcards](/projects/riftcards/presentation/data-components/).
- **A custom Deno checker, not dependency-cruiser.** See [`check:deps`](/projects/riftcards/architecture/checking-the-graph/).

## The pages

### Architecture

| Page | What's on it |
| --- | --- |
| [Layers and folders](/projects/riftcards/architecture/layers-and-folders/) | the `src/` layers, the shape of a feature, file naming, and where it departs from the general layout |
| [The seven features and their graph](/projects/riftcards/architecture/feature-graph/) | what each feature owns, the feature DAG, the layer edges, and the absences that carry meaning |
| [Extracting analysis without a cycle](/projects/riftcards/architecture/extracting-analysis/) | how analysis left the deck feature by changing signatures, and the renames that followed |
| [Where a riftcards concept lives](/projects/riftcards/architecture/ownership-and-placement/) | card and set as peers of catalog, the three ownership tests, component placement, annotation naming what it annotates |
| [Capabilities, adapters and the composition root](/projects/riftcards/architecture/capabilities-and-composition/) | the card feature's seven narrow capabilities, repository vs manager, `createAppDependencies`, startup, and time as an ISO string |
| [Use cases, results and failure](/projects/riftcards/architecture/use-cases-and-failure/) | `createDeck` as the model use case, the result unions, what throws and where it lands |
| [`check:deps`](/projects/riftcards/architecture/checking-the-graph/) | the Deno script that checks the graph, what it can't see, and the edge snapshot I'd build first |

### Cards

| Page | What's on it |
| --- | --- |
| [Cards, printings and the `Card` model](/projects/riftcards/cards/card-and-printing/) | gameplay identity vs released printing, the "would two printings disagree?" test, `Card` and `CardSummary` |
| [The branded ids](/projects/riftcards/cards/identities/) | `PrintingId`, `CardId` and the others: derived from release facts, branded, parsed at the adapter |
| [Browsing the catalog](/projects/riftcards/cards/catalog-browsing/) | catalog as pure presentation, `CardListCriteria`, filters vs criteria, and paging in SQLite |

### Decks

| Page | What's on it |
| --- | --- |
| [How a deck is stored](/projects/riftcards/decks/deck-storage/) | `deck` and `deck_card`, storing the printing you own, counting by card, and the invariants the schema holds |
| [Deck legality](/projects/riftcards/decks/legality/) | the five sections, `CopyAllowance`, the rule kinds, and `verifyDeck` |
| [The deck builder](/projects/riftcards/decks/deck-builder/) | the three steps, create and edit modes, the drafts, the pool, and saving |
| [Analysis: curves, mixes and draw odds](/projects/riftcards/decks/analysis-and-draw-odds/) | the measurements, hypergeometric odds, opening hands and mulligans |

### Rules and notes

| Page | What's on it |
| --- | --- |
| [The core rules document](/projects/riftcards/rules-and-notes/core-rules/) | from PDF to 1364 entries: the parse, headings and rules, chapters, details, editions |
| [Searching the core rules](/projects/riftcards/rules-and-notes/rules-search/) | hits, matches, occurrences and passages, and the one search done in JavaScript |
| [Bookmarks, notes and the Saved screen](/projects/riftcards/rules-and-notes/bookmarks-and-notes/) | the annotation feature, `AnnotationSubject`, slots filled at the route, and `SavedScreen` |

### Persistence

| Page | What's on it |
| --- | --- |
| [SQLite, Drizzle and the migrations](/projects/riftcards/persistence/sqlite-and-drizzle/) | one database file, reference data vs a person's own rows, squashed migrations, startup, mappers that parse |
| [The catalog seed pipeline](/projects/riftcards/persistence/seed-pipeline/) | the Deno scripts from the card API to a bundled seed, feed defects, name repair, and the seeder |

### Presentation

| Page | What's on it |
| --- | --- |
| [Data components in riftcards](/projects/riftcards/presentation/data-components/) | `DecksData` and its route, the read and write data components, the data flow, React Query factories |
| [React rules I hold](/projects/riftcards/presentation/react-conventions/) | no JSX in a variable, callbacks instead of effects, no ref shadowing state, hooks named for what they provide |
| [Phone and tablet layout](/projects/riftcards/presentation/phone-and-tablet/) | the shell, `LayoutClass`, usable width, the rail, panes and panels, sheets and faces |
| [Accessibility](/projects/riftcards/presentation/accessibility/) | the rules in React Native terms, what the audit found, and the recorded exceptions |

### Engineering

| Page | What's on it |
| --- | --- |
| [How riftcards is checked](/projects/riftcards/engineering/checks-and-tests/) | the five checks, the Jest suite, scenario tests on in-memory SQLite, and fixtures with a fixed clock |
| [Code conventions](/projects/riftcards/engineering/code-conventions/) | comments, kept code, no shims, American spelling, and why decisions are written down |

### Glossary

| Page | What's on it |
| --- | --- |
| [Cards, printings and sets](/projects/riftcards/glossary/cards-and-sets/) | the words for cards, printings, their identities, what's printed on a card, and sets |
| [Catalog, decks and analysis](/projects/riftcards/glossary/catalog-decks-analysis/) | the words for browsing, deck parts and rules, drafts, verification, and analysis |
| [Core rules, annotations and the screen](/projects/riftcards/glossary/core-rules-annotations-screen/) | the core-rules and search words, annotation subjects, and the parts of the screen |
| [Rulings](/projects/riftcards/glossary/rulings/) | which word won each conflict, naming rules, banned words, and what's still open |

## Where to start reading the code

Two places. `src/features/deck/deck/deck-legality.ts` is the densest rules logic in the app, and it's pure, so it reads without any context about React or the database. And the path from `src/app/(tabs)/decks.tsx` down to the SQLite adapter is the shortest one that crosses every layer: route, data component, use case, capability, adapter.

## Questions I asked myself

Each answer sits on the page that owns the rule, next to the alternative I turned down.

- [Why ports and adapters in an app with no server?](/projects/riftcards/architecture/capabilities-and-composition/#why-ports-without-a-server)
- [Why narrow capabilities instead of one repository per aggregate?](/projects/riftcards/architecture/capabilities-and-composition/#capabilities-not-one-repository-interface)
- [Why no DI container?](/projects/riftcards/architecture/capabilities-and-composition/#why-no-di-container)
- [Why does the dependency graph have to be acyclic? What breaks?](/projects/riftcards/architecture/feature-graph/#why-the-graph-must-stay-a-dag)
- [The graph check passed on a bad edge, so what does it actually enforce?](/projects/riftcards/architecture/checking-the-graph/#what-the-check-cannot-see)
- [Why DDD vocabulary in a React Native app, and why not aggregates and domain events too?](/projects/riftcards/cards/identities/#why-borrow-two-ddd-ideas-and-not-the-rest)
- [Why data components instead of hooks?](/projects/riftcards/presentation/data-components/#why-data-components-and-not-hooks)
- [Doesn't all that render-prop nesting get deep?](/projects/riftcards/presentation/data-components/#the-cost-nesting)
- [Why does the read data component draw a spinner while the write one draws nothing?](/projects/riftcards/presentation/data-components/#why-the-save-boundary-draws-nothing)
- [Why do use cases return unions instead of throwing?](/projects/riftcards/architecture/use-cases-and-failure/#why-use-cases-return-unions-instead-of-throwing)
- [Why are the rules pure, when plenty of apps query the database inside a component?](/projects/riftcards/decks/legality/#why-the-rules-are-pure)
- [Why filter in SQLite when the lists are small?](/projects/riftcards/cards/catalog-browsing/#why-filter-in-sqlite-when-the-lists-are-small)
- [Why no barrel files?](/projects/riftcards/architecture/layers-and-folders/#why-no-barrel-files)
- [Why is accessibility blocking rather than a pass before release?](/projects/riftcards/presentation/accessibility/#why-accessibility-blocks)
- [Did accessibility slow the work down?](/projects/riftcards/presentation/accessibility/#what-the-audit-found)
- [Is the app actually conformant?](/projects/riftcards/presentation/accessibility/#where-the-app-is-not-conformant)
- [Why write so much down? Isn't the code the truth?](/projects/riftcards/engineering/code-conventions/#why-write-any-of-this-down)
- What would I change if I started again? [The deck feature's extra nesting](/projects/riftcards/architecture/layers-and-folders/#the-deck-features-extra-nesting), and [an edge snapshot from day one](/projects/riftcards/architecture/checking-the-graph/#the-edge-snapshot-i-would-build-first).
