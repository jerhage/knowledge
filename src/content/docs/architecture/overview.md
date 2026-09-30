---
title: Architecture Overview
description: Split an app into domains, keep the dependency graph acyclic, put every outside need behind a port, and wire it all in one composition root; plus where two apps built this way chose differently.
tags: [architecture, typescript]
sidebar:
  order: 1
---

This is how I divide a front-end app into domains where every dependency points one way, and then make a tool refuse any import that points the other way. I've built two apps this way. [The reader](/projects/reader/) is a TypeScript SvelteKit SPA, and [riftcards](/projects/riftcards/) is a React Native app built with Expo. None of the structure depends on the UI framework. Only the glue does, and SvelteKit's glue is on [its own page](/architecture/sveltekit/).

The two apps hold to the same goals. Past those goals I made different choices for each app in a few places, and neither app's choice is the rule: the pages in this section describe each option with what it costs, and link the app that uses it. [Where the two apps differ](#where-the-two-apps-differ) lists those places.

## The goals

These hold in both apps. Everything else in the section is a way to meet them.

**Domains.** I split the app by what it does, not by what kind of file something is. A domain is one folder per area of the app. In the card catalog these pages use as their example (below), the `cards` domain owns everything about cards: the entities, the storage, the screens. A change to cards then mostly stays inside one folder, and deleting a feature is deleting a folder. (Riftcards calls a domain a "feature", because "domain" is already a word in the card game it's about.)

**An acyclic dependency graph.** Draw an arrow from every module to each module it imports. A directed acyclic graph (a DAG) is one where following arrows never brings you back to where you started. Imports point one way, down the layers, and the same holds one level up, between domains. Why it matters: with no cycle, every piece can be understood, tested and replaced with only the pieces below it in view. A cycle glues two modules (or two domains) into one unit that has to change and be read together. How the domain graph is kept acyclic is one of the choices: a rule that makes a cycle impossible by the graph's structure, or a check that detects one.

**Ports and Adapters.** This is Alistair Cockburn's pattern, also called hexagonal architecture. His stated intent is an app that can be driven by users, programs, automated tests or batch scripts alike, and that can be developed and tested in isolation from its eventual run-time devices and databases. The app connects to the outside through ports, and an adapter per outside thing converts between the app's terms and that thing's API. In my layout a port is an interface a domain declares for something it needs (storage, a thumbnailer), named for that need, and an adapter is the concrete "how" behind it (IndexedDB, a canvas, SQLite). The domain logic never imports an adapter, so it runs in a unit test with a fake.

**Dependency injection through one composition root.** Dependency injection means a module receives what it needs as an argument instead of building it or importing a concrete one itself. (The name comes from Martin Fowler's 2004 article, where the idea is a separate assembler that fills in the implementation.) The composition root is where those dependencies are built and passed in. The term is Mark Seemann's: "a (preferably) unique location in an application where modules are composed together", as close as possible to the entry point. In both apps it's one file, and it's the only file that imports concrete adapters. I wire it by hand, with no DI container library, which Seemann calls Pure DI. Why it matters: swapping an adapter touches one file, and a test swaps it by passing a fake.

**A tool that says no.** Nothing in the language stops someone from writing an import that breaks the rules above. Until something reads every import and refuses the ones that point the wrong way, all of this is only a convention. The reader uses dependency-cruiser for that, and riftcards uses a small script of its own.

## The running example

All the pages in this section use the same small card catalog:

| Domain | Owns |
| --- | --- |
| `cards` | the cards, their storage, the card list and details screens |
| `annotations` | notes attached to a card, their storage, the notes list |
| `media` | images attached to a card and their thumbnails |
| `housekeeping` | what the app stores, and removing a card with its notes and images |

## The pages in this section

1. Overview (this page): the goals, the running example, and where the two apps differ.
2. [Domains and the dependency graph](/architecture/domains-and-the-graph/): the layers and which folder may import which, the five parts of a domain (with `queries/`), two ways to keep the domain graph acyclic (leaves and non-leaves, or a cycle check between domains), the kernel, breaking a cycle, and adding a domain.
3. [Ports and adapters](/architecture/ports-and-adapters/): ports declared in `domain/`, how ports and adapters are named, the two places adapters can live, and adapters picked per variant and loaded on demand.
4. [Dependency injection and the composition root](/architecture/dependency-injection/): the composition root, use cases and how they report failure, ports for time and ids, exposing use cases or capabilities, workers, and two ways to show two domains on one screen.
5. [Enforcing it with dependency-cruiser](/architecture/dependency-cruiser-rules/): the full config, one allowed and one forbidden import per rule, what path rules miss, no barrels, and running the checks.
6. [Which domain owns a concept](/architecture/placing-a-concept/): containment versus ownership, three tests for an owner, and which side of a pair holds the edge.
7. [Narrow capabilities instead of one repository](/architecture/capabilities/): one interface per need, filtering in the store, and projections as their own types.
8. [Data components](/architecture/data-components/): one owner per read, a component that passes its children only what they use, and view models kept for UI state and writes.
9. [Expected and unexpected failure](/architecture/expected-and-unexpected-failure/): which failures go in the return type, which ones throw, and where each one ends up.
10. [Result types, `unwrap()` and typed outcomes](/architecture/result-types/): when a `Result` fits, why unwrapping it into an exception loses type safety, when a named union fits better, and where TanStack Query's states sit.
11. [Entities, value objects and identities](/architecture/entities-and-value-objects/): identities as values, branded ids, and what to store about someone else's data.
12. [Where a server, sync and sign-in would plug in](/architecture/extension-points/): the boundaries to keep for things not built yet.
13. [Applying it in SvelteKit](/architecture/sveltekit/): the `src/lib` paths, Svelte context for the container, runes in view models, snippets for composing screens, data components and error boundaries, and the SvelteKit side of the dependency-cruiser config.

The general gotchas I ran into with dependency-cruiser itself are on [its own page](/tooling/dependency-cruiser/).

## Where the two apps differ

Each row is a place where both options meet the goals above, at a different cost. The linked section describes both and says what each one costs.

| Choice | The reader | Riftcards | Where both are described |
| --- | --- | --- | --- |
| Keeping the domain graph acyclic | leaves and non-leaves, with a rule for each, so a cycle can't form | any DAG, plus a check that fails on a cycle between domains | [domains and the graph](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself) |
| An id two domains both use | lives in the kernel | stays with the domain that owns it | [the kernel](/architecture/domains-and-the-graph/#the-kernel-imports-no-domain) |
| Where adapters live | inside their domain | in a top-level `infrastructure/` | [ports and adapters](/architecture/ports-and-adapters/#adapters-live-inside-their-domain-not-in-a-top-level-infrastructure) |
| What the composition root exposes | use cases | capabilities (ports), with the use case called where it runs | [the container](/architecture/dependency-injection/#the-container-exposes-use-cases-never-a-port) |
| UI from two domains on one screen | only the route puts them together | a domain may also show UI another domain exports for its own types | [two domains on a screen](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other) |
| Who holds a screen's data and state | view models | data components | [data components](/architecture/data-components/) |
| The tool that says no | dependency-cruiser path rules | a script that checks cycles at file and domain level | [the rules](/architecture/dependency-cruiser-rules/), [riftcards' checker](/projects/riftcards/architecture/checking-the-graph/) |

Why each app picked what it did is on its own pages: [the reader's architecture](/projects/reader/architecture/domains/) and [riftcards' architecture](/projects/riftcards/architecture/layers-and-folders/).

## Sources

- Alistair Cockburn, [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) (2005)
- Martin Fowler, [Inversion of Control Containers and the Dependency Injection pattern](https://martinfowler.com/articles/injection.html) (2004)
- Mark Seemann, [Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/) (2011) and [Pure DI](https://blog.ploeh.dk/2014/06/10/pure-di/) (2014)
