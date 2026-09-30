---
title: Rifty's Layers and Folders
description: The src/ layers, what a feature contains, file naming, and how the layout compares with the general one.
tags: [rifty, architecture, project-structure, react-native]
sidebar:
  order: 10
---

Rifty, my Riftbound card app, splits `src/` into layers and its product into features. A feature is what the general pages call a [domain](/architecture/domains-and-the-graph/#the-five-parts-of-a-domain): one coherent thing the app does. (In Rifty "domain" means something else twice over: a game term, `CardDomain`, and the pure rules layer inside a feature.) Its folder layout lines up with [the general layers](/architecture/domains-and-the-graph/#every-file-belongs-to-one-layer-and-imports-only-point-down). Which feature may import which is on [the feature graph](/projects/rifty/architecture/feature-graph/).

## The layers

```text
routes           resolve parameters, render one screen or one data component
composition      builds every adapter once and provides them
features         models, capabilities, use cases, presentation: the product itself
application      capabilities no single feature owns
infrastructure   adapters: persistence, transport, platform, time, identity, randomness
shared           pure utilities with no product knowledge
components       presentational primitives owned by no feature
```

**Routes** are expo-router's route files in `src/app/`, and nothing else. A route resolves its parameters, validates them, and renders. It holds no loading lifecycle, no business rule and no layout worth naming; when it starts to, that code belongs in a screen or a data component. Routes are the one layer whose imports may reach every feature, because a route is where features are put together into an app.

**Composition** is where the concrete world is built: it opens the database, applies migrations, creates every adapter, and passes them down as one typed object behind a provider that is also the startup boundary. Nothing else constructs infrastructure. It's on [capabilities and composition](/projects/rifty/architecture/capabilities-and-composition/).

**Features** are the product. Each owns its model, the capabilities it declares, the use cases that run its operations, and its own presentation. A feature may depend on another feature, in one direction, when it uses that feature's vocabulary.

**Application** holds the ports no single feature owns: `Clock`, `IdGenerator`, `Logger`, `RandomSource`, in `src/application/ports/`. It imports no feature. It exists so that pure rules never call the platform directly.

**Infrastructure** implements the capabilities the features declare. It owns every technology detail: the driver, the schema, the queries, the mappers. Rows and driver exceptions stop there.

**Shared** is pure code that names no product concept at all: a page value object, the read options that hold a cancellation signal, a helper that splits a list into chunks, a shuffle over an injected random function, and a helper that adds a value to a list or removes it. If a utility names a product concept, it isn't shared; it belongs to the feature that owns the concept.

**Components** are presentational primitives owned by no feature, plus the theme they read. Their props may name no type that belongs to only one feature. A component that takes a product type belongs to that feature (the test is on [where a concept lives](/projects/rifty/architecture/ownership-and-placement/#component-placement)).

Stated as a direction rule: routes may import every feature; composition and infrastructure import only the features that own something to wire or implement; `shared/`, `components/`, `hooks/`, `constants/` and `application/` import no feature at all.

## How the layers map onto the general ones

| General layout | Rifty |
| --- | --- |
| `routes/` | `src/app/` (expo-router) |
| `container.ts` | `src/composition/` |
| `domains/<name>/` | `src/features/<name>/` |
| a domain's `adapters/` | top-level `src/infrastructure/` |
| `kernel/` (ports and types no domain owns) | `src/application/ports/` for the ports, `src/shared/` for pure utilities |
| `platform/` | split between `src/infrastructure/` and `src/shared/` |
| `components/` | `src/components/`, `src/hooks/`, `src/constants/` |

The general pages describe [a kernel and a platform folder as one base](/architecture/domains-and-the-graph/#platform-and-kernel-are-one-base) under every domain. Rifty has no kernel of shared ids: an id stays with the feature that owns it, and a feature that uses it imports that feature (see [the feature graph](/projects/rifty/architecture/feature-graph/)).

The row that differs most is where adapters live. The general pages lay out two options on [where adapters live](/architecture/ports-and-adapters/#adapters-live-inside-their-domain-not-in-a-top-level-infrastructure): inside each domain, or in one top-level `infrastructure/`. Rifty took the top-level folder. One SQLite file holds every feature's tables, and the tables cross feature lines: the reference tables (cards, printings, keywords, sets, taxonomy) are read by the card and set adapters, the deck tables point at cards and printings by foreign key, and the card adapter reads the annotation feature's bookmarks table when the catalog is filtered to bookmarked cards. So the schema, the migrations and the code that opens and seeds the database don't belong to any one feature. Two direction rules keep the folder in line, and the [graph checker](/projects/rifty/architecture/checking-the-graph/) enforces both: a feature never imports infrastructure, and infrastructure never imports composition.

## The directory tree

Trimmed to the parts that show the layout:

```text
src/
  app/                              # Expo Router route files only
    _layout.tsx                     # Root stack, theme, splash, dependency provider
    (tabs)/index.tsx                # Card browsing, the only importer of catalog
    (tabs)/decks.tsx
    (tabs)/rules.tsx
    (tabs)/saved.tsx                # The Saved screen, composed from the features it shows
    cards/[id].tsx
    decks/[id]/index.tsx
    decks/build.tsx

  application/ports/                # Capabilities no single feature owns
    clock.ts, id-generator.ts, logger.ts, random-source.ts

  composition/
    dependencies.ts                 # createAppDependencies and AppDependencies
    app-dependencies-provider.tsx   # Typed React context and startup boundary
    card-image-host.ts

  features/
    card/
      card.ts                       # Zod schema and model: a printing joined to its card
      card-summary.ts               # The minimal projection grid browsing needs
      card-list-criteria.ts         # The card query language
      card-finder.ts, card-lister.ts, card-counter.ts, …   # narrow capabilities
      card-repository.ts            # Aggregate capability for composition and adapters
      use-cases/find-card.ts, list-cards.ts, …
      value-objects/                # branded ids and closed enumerations
      queries/card-keys.ts, card-queries.ts
      presentation/
        card-taxonomy-format.ts
        data/                       # cards-data, card-summaries-data, card-detail-data, …
        components/                 # card-art, card-face, domain-bar, …
        screens/card-detail-screen.tsx
    set/
    catalog/presentation/           # All of catalog is presentation
    deck/
      deck/                         # The aggregate, its rules, and its use cases
      queries/
      presentation/
    analysis/
    rules/
    annotation/

  infrastructure/
    sqlite/                         # sqlite-card-repository.ts, card-mapper.ts, …
    database/                       # schemas, open-app-data-store.ts, reference-seeder.ts
    identity/, logging/, random/, time/

  shared/                           # chunked, page, read-options, shuffle, toggle
  components/                       # ui/atoms/, ui/icons/, app-shell/
  constants/theme.ts
  hooks/                            # use-read-state, use-write-state, use-announcement, …
```

## What a feature contains

```text
features/<feature>/
  <aggregate>.ts                    # the model and its schema
  <aggregate>-rules.ts              # invariants and derived judgments, pure
  <concept>-finder.ts               # narrow capability: load one
  <concept>-lister.ts               # narrow capability: page many
  <concept>-counter.ts              # narrow capability: count matches, ignoring paging
  <concept>-saver.ts                # narrow capability: write one
  <concept>-repository.ts           # aggregate capability, for composition and adapters only
  <concept>-list-criteria.ts        # the query language: filters, search, sort, paging
  use-cases/<verb>-<concept>.ts     # one application operation each
  value-objects/                    # branded ids and closed enumerations
  queries/<concept>-keys.ts         # the query key factory for the concepts it owns
  queries/<concept>-queries.ts      # query and mutation options factories
  presentation/
    <concept>-format.ts             # pure model to view vocabulary
    data/<concept>-data.tsx         # data components
    components/                     # components that render this feature's own types
    hooks/                          # UI mechanics several of its components share
    screens/
```

The general pages split a domain into [five parts](/architecture/domains-and-the-graph/#the-five-parts-of-a-domain). Rifty's layout has the same layering with different folders: the model, its rules and its capabilities sit at the top of the feature where the general layout has `domain/`, `use-cases/` and `queries/` match, the adapters live outside the feature, and `presentation/` is the general layout's `ui/`. Both hold data components for reads. Where the general layout's `ui/` also holds view models for UI state and writes, Rifty's `presentation/` owns a write with a write data component or a hook, and keeps UI mechanics in hooks (the difference is on [data components in Rifty](/projects/rifty/presentation/data-components/)).

`queries/` sits beside `presentation/`, not inside it. A query key, a query function and a stale time aren't rendering concerns (see [the query options factory](/react/render-props-and-tanstack-query/#a-query-options-factory-holds-the-key-the-query-function-and-the-stale-time)). The query factories used to live in `presentation/`, and I moved them out once I saw that.

Not every feature has every part, and the gaps mean something. `catalog` is only presentation: criteria, a query hook, a search screen, a grid and a filter sheet. (It held the sort options too until 2026-09-13, when that vocabulary moved into `card`.) `analysis` is only calculation over a list of cards the caller supplies. Neither retrieves anything, so neither has a capability, a repository or a use case. That's intended, and nothing is missing.

A feature must not contain:

- A persistence or transport implementation. It declares the capability, and infrastructure implements it. This is the rule that keeps feature logic free of the framework, the driver, the ORM and HTTP.
- React, the platform or native modules anywhere in its model or rules. Presentation may use them; the model may not.
- A direct call to the wall clock or the random generator. Those arrive as capabilities, so a rule tests without freezing time.
- Another feature's model reached against the graph's direction, or any import of infrastructure or composition.
- Database rows, or a caller's job of reassembling an aggregate from joins.

## File and export naming

- **Files are kebab-case and named for what they export.** `card-lister.ts` exports `CardLister`.
- **A file is named for what it provides, never for the library inside it.** `use-open-card-haptic-long-press.ts`, not `use-expo-haptics.ts`. The same goes for adapters: `SqliteCardRepository`, never `DrizzleCardRepository`.
- **An options factory's name describes what it returns.** One item starts with `get` and ends with `Query`. Many items start with `list` and end with `Query`. A paged read starts with `list` and ends with `PagedQuery`, so the name alone shows that a caller has to use the paged data component rather than the plain one:

```text
getCardQuery                      one card
listKeywordsQuery                 every keyword, unpaged
listCardSummariesPagedQuery       a page at a time
```

- **Every export sits in one block at the end of the file.** No `export` on a declaration inline. Reading the last lines of a file tells you its whole public surface.

## Why no barrel files

A barrel is an `index.ts` that re-exports a folder, so a caller imports `features/card` instead of `features/card/card-lister`. Rifty has none, and an import always names the module that defines the symbol.

The graph is what the codebase is organized around, and a barrel hides it. With one, every import looks like it comes from a feature rather than a module, so reading an import line no longer tells you whether it crossed a boundary or which part of the other feature it reached. Barrels also make circular imports easy to create and hard to find: a file inside the feature imports the barrel, the barrel imports that file back, and the loop runs through a module nobody thinks of as code.

The alternative is shorter import paths. I took the explicit ones. The general argument, from the dependency-checking side, is on [no barrel files](/architecture/dependency-cruiser-rules/#no-barrel-files).

## The deck feature's extra nesting

`card` is flat: its model, capabilities and use cases sit at the top of `features/card/`. `deck` nests them one level deeper, in `features/deck/deck/`, with `queries/` and `presentation/` beside that folder. The nesting grew from `deck` owning more than its aggregate, but `card` owns more than one concept too (its keyword module sits in `features/card/keyword/`) and stays flat. The difference is history. Don't read meaning into it.

If I started again, this is the first thing I'd change. The two layouts mean nothing different, and every new reader of the code needs a sentence explaining that, which is a cost paid over and over for nothing.
