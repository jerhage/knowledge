---
title: The Reader's Domains and Graph
description: The five domains, why storage is the one non-leaf, the kernel contracts two leaves share, and where each concept landed.
tags: [reader, architecture, typescript]
sidebar:
  order: 10
---

This is the layout from [domains and the dependency graph](/architecture/domains-and-the-graph/) as the reader actually has it, with real folders where the general pages use a [card catalog](/architecture/overview/#the-running-example). One naming difference: the reader's kernel folder is `src/lib/shared/`, where the general pages say `kernel/` (the full mapping is in [applying it in SvelteKit](/architecture/sveltekit/#the-layout-in-sveltekit)).

## The layers, and the rule behind each

The [layers](/architecture/domains-and-the-graph/#every-file-belongs-to-one-layer-and-imports-only-point-down) at the reader's paths:

```text
  src/routes/                         screens: compose, no logic
      │
      ▼
  src/lib/domains/<name>/ui/          data components, components and view models
      │
      ▼
  src/lib/domains/<name>/queries/     query keys and the factories that build queries
      │
      ▼
  src/lib/domains/<name>/use-cases/   operations, one per file
      │
      ▼
  src/lib/domains/<name>/domain/      ports, entities, value objects
      │
      ▼
  src/lib/shared/                     the kernel: ids, geometry,
      │                               contracts two domains share, and the
      │                               reader UI both readers compose
      ▼
  src/lib/platform/                   technical capability, no domain words
  src/lib/components/                 the base UI library, knows no app
```

`shared/` holds a bit more than a kernel usually would: the reader UI that both readers compose, like `PageBar.svelte` and `ReaderFrame.svelte`.

Each row names the dependency-cruiser rules that enforce it. What each rule allows and refuses, with real paths, is on [the reader's dependency-cruiser rules](/projects/reader/architecture/dependency-rules/).

| Layer | May import | Enforced by |
| --- | --- | --- |
| `routes/` | `container.ts`, `context.ts`, `query-client.ts`, `shared/`, `styles/`, `assets/`, `components/`, a domain's `ui/` | `routes-are-thin` |
| a domain | its own folders, a leaf's `domain/` and `use-cases/` (non-leaves only), `shared/`, `platform/`, `components/`, npm | `cross-domain-contract-only`, `leaf-domains-are-independent`, `non-leaves-import-only-leaves`, `domain-ring-is-pure`, `only-the-container-builds-adapters`, plus three rules for `queries/`: `queries-know-no-ui-or-wiring`, `queries-call-use-cases-they-are-handed`, `only-ui-reads-queries` |
| `shared/` | `platform/`, `components/`, its siblings, npm | `the-base-layers-know-no-domain` |
| `platform/` | `shared/`, its siblings, npm | `the-base-layers-know-no-domain` |
| `components/` | its siblings, `assets/`, npm | `base-components-know-no-app` |

`query-client.ts` builds the one query cache that the root layout provides to every screen, so it belongs with `container.ts` and `context.ts` at the top, and a route may import it.

## The bottom of the UI, and the one base

[`components/` is the bottom of the UI](/architecture/domains-and-the-graph/#components-is-the-bottom-of-the-ui). In the reader, `shared/` composes it (`PageBar.svelte`, `ReaderFrame.svelte`), and so do a domain's `ui/` and the routes. A pure TypeScript module in `components/` can go lower still: `viewing/domain/overscroll.ts` imports the pan and zoom math from `components/pan-zoom.ts`, and that's still a downward import.

[`platform/` and `shared/` are one base](/architecture/domains-and-the-graph/#platform-and-kernel-are-one-base), and in the reader the imports between them really do go both ways at folder level: `platform/image/pixels.ts` reads `shared/geometry.ts`, and `shared/touch-turns.ts` reads `platform/storage/remembered-string.ts`. Neither pair forms a module cycle.

The vocabulary test in practice: `platform/image/pixels.ts` crops and stitches whatever regions its caller passes. The 2048 pixel ceiling on a model's input is recognition policy, so it lives in `recognition/domain/engine/model-input.ts`.

## The parts of each domain

Every domain uses [the five parts](/architecture/domains-and-the-graph/#the-five-parts-of-a-domain) it needs and no more:

```text
src/lib/domains/library/
  domain/       ports, entities, value objects. Pure, rune-free TS.
  use-cases/    one stateless operation per file, returning its own union
  adapters/     the concrete "how" behind each port
  queries/      library-keys.ts (the cache keys) and library-queries.ts (the factories)
  ui/           data components, components and view models (*.svelte.ts)
```

`queries/` is the newest part. Dokseo keeps what it reads in a [TanStack Query](/svelte/svelte-query/) cache, and each cached read needs a key and a function that fetches it. A domain's `queries/` folder holds both: `<d>-keys.ts` builds the keys, and `<d>-queries.ts` has the factories that pair a key with a call to a use case. A data component, a component in `ui/` that starts a read and passes the result to what it renders, starts its read from one of those factories. How the reads and writes are split between data components and view models is on [data components and view models in Dokseo](/projects/dokseo/architecture/data-components-and-view-models/).

What each part may import:

| Part | May import | May not import |
| --- | --- | --- |
| `domain/` | its own `domain/`, `shared/`, a pure `components/` module, npm (`ts-pattern`) | its own `use-cases/`, `adapters/`, `ui/`; any other domain |
| `use-cases/` | its own `domain/`, `shared/`, `platform/`; a leaf's `domain/` and `use-cases/` if this domain is a non-leaf | any `adapters/`, including its own |
| `adapters/` | its own `domain/`, a sibling adapter in the same domain, `shared/`, `platform/`, a worker protocol, npm | another domain's `adapters/` |
| `queries/` | its own `domain/`, `shared/`, npm (`@tanstack/svelte-query`), `import type` from its own `use-cases/` | any `ui/`, any `adapters/`, a value import from `use-cases/`, `container.ts`, `context.ts`; another domain's `queries/` |
| `ui/` | its own `domain/`, `queries/` and `use-cases/` (for types), `shared/`, `components/`, `platform/`, `import type` from `container.ts` | any `adapters/`; another domain's `ui/` or `queries/` |

- `viewing` has `domain/`, `ui/` and `queries/`, and no `use-cases/` or `adapters/`, because it stores nothing itself. Its `queries/viewing-queries.ts` holds only mutations: the image reader saves a reading place and edits a book through use cases that `library` owns, and a leaf may not import `library/queries/`, so `viewing` has its own factories for those writes. They're generic over the use cases' types, so the file imports nothing from `library` either.
- `storage`, `library`, `recognition` and `flowing` each have a `queries/` folder too. `recognition` splits its factories by theme (`engine-queries.ts`, `tag-queries.ts`, `capture-queries.ts`) and keeps one key file, `recognition-keys.ts`.
- `recognition` splits every folder into the same themes: `capture/`, `engine/`, `model/` and `tag/`. The layer split is the one that's enforced. The theme split is for the eye.
- `library/domain/book/library-repository.ts` is a port, and `library/domain/book/book.ts` is an entity with its pure functions.

`domain/` staying free of runes and browser APIs is a convention here too. No rule forbids a `domain/` file importing `platform/`, and no `domain/` file does. What a use case, an adapter and a view model look like in the reader is on [container, ports and adapters](/projects/reader/architecture/wiring/).

## The five domains

| Domain | Owns |
| --- | --- |
| `library` | files, books, page sources, reading place |
| `viewing` | the image reader: viewport, selection geometry, pairing, the strip |
| `flowing` | the ebook reader (EPUB through foliate-js) and its settings |
| `recognition` | the recognizer, model weights, captures and tags |
| `storage` | what the origin holds, part by part, and removing a book with its captures |

```text
                          ┌───────────┐
                          │  storage  │  non-leaf
                          └─────┬─────┘
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
           ┌─────────────┐            ┌───────────────┐
           │   library   │            │  recognition  │
           └─────────────┘            └───────────────┘

           ┌─────────────┐            ┌───────────────┐
           │   viewing   │            │    flowing    │
           └─────────────┘            └───────────────┘

   leaves (library, recognition, viewing, flowing): no arrow leaves them
   storage → a leaf: only to its domain/ and use-cases/
   no arrow enters storage, or any non-leaf
   every domain → shared/, platform/, components/
```

Read plainly: `storage → library`, `storage → recognition`, and no other domain edge exists.

## Why `storage` is the one non-leaf

`library`, `viewing`, `flowing` and `recognition` are [leaves](/architecture/domains-and-the-graph/#leaves-and-non-leaves): none of them imports another domain at all. `storage` is the only non-leaf. It needs two things `recognition` already owns and one thing both leaves own:

- `storage/use-cases/read-storage-account.ts` imports `recognition/domain/model/model-cache.ts` and `model-footprint.ts`. It uses them to separate a model's cached files from the runtime's, and to label each model.
- `storage/use-cases/remove-book-and-captures.ts` composes `recognition/use-cases/capture/clear-captures.ts` and `library/use-cases/remove-book.ts`, because neither leaf may import the other. It imports the two use cases, not the two repositories, and its deps are the two use cases' deps objects.

`storage/domain/` stays pure. The classification lives in the use case, and only the arithmetic is in `storage/domain/storage-parts.ts`.

## The non-leaf gap is closed

The general config only fires from the leaves, so [two non-leaves could still import each other](/architecture/domains-and-the-graph/#two-non-leaves-can-still-import-each-other). The reader has a rule for that half too, `non-leaves-import-only-leaves`: a non-leaf imports only its own domain and the leaves. Any domain folder not named as a leaf counts as a non-leaf, so a second non-leaf could never import `storage`, and `storage` could never import it. With both rules, every domain edge starts at a non-leaf and ends at a leaf, which is the [argument for why a domain cycle is impossible](/architecture/domains-and-the-graph/#a-module-cycle-check-cant-see-a-cycle-between-domains), now enforced both ways. How the rule is written is on [the rules page](/projects/reader/architecture/dependency-rules/).

## Where a concept ended up

A capture is what recognition produces when it reads a selected region: the text, which I can then edit, tag and search. Captures are recognition's output, so they live in `recognition`. A separate `captures` leaf couldn't be used by `CapturePanel`, which is recognition UI, because `recognition` is a leaf too, and a leaf imports no other domain.

Two more domains are planned, not built: a `reading` orchestrator (selection, then crop, then OCR, then word lookup) and a `lexicon` leaf (a dictionary). `.dependency-cruiser.cjs` names neither. `reading` needs no entry, because an unnamed domain is a non-leaf, and `lexicon` joins `LEAF_DOMAINS` when its folder exists.

## The kernel contracts

[The kernel knows no domain](/architecture/domains-and-the-graph/#the-kernel-knows-no-domain), and a contract two leaves both need moves down into it. These are the reader's:

| Kernel file | Produced by | Consumed by |
| --- | --- | --- |
| `shared/page-source.ts` (`PageSource`, a port) | `library` (PDF, archive, EPUB adapters) | `viewing`, `recognition` |
| `shared/image-region.ts` (`ImageRegion`) | `viewing` (a selection) | `recognition` (what to read) |
| `shared/reading-place.ts` (`ReadingPlace`) | `viewing`, `flowing` | `library` (saved per book) |
| `shared/anchor.ts` (`Anchor`) | `recognition` (a capture's place) | `flowing` (the passages it lifts and highlights) |
| `shared/text-search.ts` (the matcher) | | `recognition` (captures), `library` (titles) |
| `shared/storage-unavailable.ts` (`StorageUnavailable`, and the private-window advice) | `library`, `recognition`, `flowing` (returned when storage isn't available) | `storage` (passes it on), and the `ui/` of every domain that describes it |

The matcher shows the test. It started out in `recognition`, for searching captures. Folding text for a search is text handling, not recognition vocabulary, and once the library screen searched titles it had to move: `library` may not import `recognition`, and a route may not import a domain's `domain/`. Ordering things by their place on a page is capture vocabulary, though, so `inBookOrder` stays in `recognition/domain/capture/capture-order.ts`.

The other half of the test: a model id is recognition vocabulary, so it stays in `recognition/domain/model/model-footprint.ts` even though a worker imports it. Moving it to `shared/` would put a model repository's name in the kernel.

`StorageUnavailable` is in the kernel for the plainer reason the table is about. When storage isn't available, as in some private windows, three leaves return the same variant, `{ kind: 'storage-unavailable' }`. None of them may import another, so the type sits in the kernel.

## Adding a domain here

The [general steps](/architecture/domains-and-the-graph/#adding-a-domain) apply, with two reader details:

- **The name is for the activity.** The ebook domain is `flowing`, not `foliate`, so replacing the library renames nothing.
- **Leaf or non-leaf is one list.** For a leaf, add the name to `LEAF_DOMAINS` at the top of `.dependency-cruiser.cjs`. For a non-leaf, change nothing: a domain missing from that list is a non-leaf already. No other rule names a domain.

Then prove it fires for the new name. For a leaf, add an import to another domain and see `leaf-domains-are-independent` reject it. For a non-leaf, add an import to `storage` and see `non-leaves-import-only-leaves` reject it. Run `deno task lint:deps`, check that the error names the rule, and delete the import.
