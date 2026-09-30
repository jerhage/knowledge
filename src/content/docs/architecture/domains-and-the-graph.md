---
title: Domains and the Dependency Graph
description: Layers that only import downward, the five parts of a domain, two ways to keep the domain graph acyclic (leaf domains or a domain-level cycle check), a kernel that imports no domain, and breaking a cycle by changing a signature.
tags: [architecture, typescript]
sidebar:
  order: 2
---

Both the file graph and the domain graph have to stay acyclic. Between files, every file sits in a layer, and its imports only point down to lower layers. Between domains, one domain depends on another if any of its files imports a file in the other. The domain graph is the one that determines whether the app stays untangled. The paths here are the framework-neutral layout. How they map onto SvelteKit's `src/lib` is on [applying it in SvelteKit](/architecture/sveltekit/#the-layout-in-sveltekit).

## Every file belongs to one layer, and imports only point down

```text
  src/routes/                     screens: compose, no logic
      │
      ▼
  src/domains/<name>/ui/          components, data components, view models
      │
      ▼
  src/domains/<name>/queries/     query keys and query option factories
      │
      ▼
  src/domains/<name>/use-cases/   operations, one per file
      │
      ▼
  src/domains/<name>/domain/      ports, entities, value objects
      │
      ▼
  src/kernel/                     the kernel: ids, geometry, shared
      │                           result variants, the read and write
      │                           adapters, contracts two domains share,
      │                           UI more than one domain composes
      ▼
  src/platform/                   technical capability, no domain words
  src/components/                 the base UI library, knows no app
```

`routes/` is whatever your framework calls the screens or entry points. `queries/` only exists in a domain whose reads and writes go through a query cache, a library like TanStack Query that stores each read's result under a key and shares it with every component that reads the same key. [The five parts of a domain](#the-five-parts-of-a-domain) has more on it. `adapters/` sits next to `use-cases/` inside each domain. It implements a port from `domain/`, and only the composition root imports it (more on that in [dependency injection](/architecture/dependency-injection/#the-composition-root-builds-everything-once), and on ports in [ports and adapters](/architecture/ports-and-adapters/#ports-are-named-for-the-need-adapters-for-the-mechanism)).

| Layer | May import | Enforced by |
| --- | --- | --- |
| `routes/` | `container.ts`, `context.ts`, `query-client.ts`, `kernel/`, `styles/`, `assets/`, `components/`, a domain's `ui/` | `routes-are-thin` |
| a domain | its own folders, a leaf's `domain/` and `use-cases/` (non-leaves only), `kernel/`, `platform/`, `components/`, npm | `cross-domain-contract-only`, `leaf-domains-are-independent`, `non-leaves-import-only-leaves`, `domain-ring-is-pure`, `only-the-container-builds-adapters`, the three `queries/` rules |
| `kernel/` | `platform/`, `components/`, its siblings, npm | `the-base-layers-know-no-domain` |
| `platform/` | `kernel/`, its siblings, npm | `the-base-layers-know-no-domain` |
| `components/` | its siblings, `assets/`, npm | `base-components-know-no-app` |

`container.ts` is the composition root and `context.ts` passes it to the UI tree, both on [the dependency injection page](/architecture/dependency-injection/). The rule names in the last column are dependency-cruiser rules from [the config](/architecture/dependency-cruiser-rules/#the-configuration). "Leaf" and "non-leaf" are about the domain graph: a leaf imports no other domain, and a non-leaf may import a leaf but nothing imports it. Details [below](#leaves-and-non-leaves).

The "a domain" row is written for one of two ways to keep the domain graph acyclic, the leaf rule, which Dokseo, my manga and book reader, uses. Under the other way, [a cycle check on the domain graph](#or-check-cycles-on-the-domain-graph-itself), which Rifty, my Riftbound card app, uses, a domain may import another domain as long as no cycle forms between them.

## `components/` is the bottom of the UI

`components/` holds the base component library: generic UI pieces the app's screens are built from. It imports nothing from the app. Not the kernel, not a domain, not the container. `kernel/`, a domain's `ui/` and the routes all build on it, so any import from it back up would close a cycle. If a base component needs app behavior, it gets it as a prop, a slot the caller fills, or a callback.

A pure TypeScript module in `components/` (zoom math, say) can be imported by a domain's `domain/`. That's still pointing down.

## `platform/` and `kernel/` are one base

`platform/` and `kernel/` sit under every domain. `platform/` holds technical capability, like opening a database or cropping an image. `kernel/` holds what domains share: ids, result variants several domains return (like `StorageUnavailable`, the result when the browser blocks a store), and contracts two domains both need. Neither may import a domain. Between the two, imports can go both ways, as long as no module cycle forms.

So the line between them isn't enforced by direction, and I decide which folder a file goes in by its vocabulary. If I can't describe the file without a domain noun, it isn't `platform/`. A function that crops an image to the size it's passed is platform. The maximum size a thumbnail may be is `media` policy.

## The five parts of a domain

```text
src/domains/cards/
  domain/       ports, entities, value objects. Pure TS, no framework state, no browser API.
  use-cases/    one stateless operation per file, returning its own named union
  adapters/     the concrete "how" behind each port
  queries/      cards-keys.ts (the key factory) and cards-queries.ts (option factories)
  ui/           components, data components and view models
```

A domain only gets the folders it needs. One that stores nothing has no `adapters/`, and maybe no `use-cases/` either. A domain gets `queries/` when its first read or write goes through the query cache. A big domain can split every folder by the same themes (`domain/note/`, `use-cases/note/`, and so on). The theme split is up to you. The layer split is what gets checked.

Two of these parts have an alternative. `adapters/` can move out of the domain into one top-level `infrastructure/` folder, which is what Rifty does ([both options](/architecture/ports-and-adapters/#adapters-live-inside-their-domain-not-in-a-top-level-infrastructure)). And a use case can return a generic `Result<T, E>` instead of a named union of its own ([both options](/architecture/dependency-injection/#use-cases-has-one-operation-per-file)).

| Part | May import | May not import |
| --- | --- | --- |
| `domain/` | its own `domain/`, `kernel/`, a pure `components/` module, pure npm packages | its own `use-cases/`, `adapters/`, `queries/`, `ui/`; any other domain |
| `use-cases/` | its own `domain/`, `kernel/`, `platform/`; a leaf's `domain/` and `use-cases/` if this domain is a non-leaf | any `adapters/`, including its own; any `queries/` |
| `adapters/` | its own `domain/`, a sibling adapter in its own domain, `kernel/`, `platform/`, a worker protocol, npm | another domain's `adapters/`; any `queries/` |
| `queries/` | its own `domain/`, `kernel/`, the query library, `import type` from its own `use-cases/` | any `ui/`, any `adapters/`, a value import from `use-cases/`, `container.ts`, `context.ts`; another domain's `queries/` |
| `ui/` | its own `domain/` and `queries/`, its own `use-cases/` (for types), `kernel/`, `components/`, `platform/`, `import type` from `container.ts` | any `adapters/`; another domain's `ui/` or `queries/` |

- `domain/` declares what the domain needs as ports and never imports what provides them. See [ports and adapters](/architecture/ports-and-adapters/#domain-declares-what-it-needs-and-never-imports-what-provides-it).
- `use-cases/` has one operation per file, and each one returns its own named union of outcomes. See [dependency injection](/architecture/dependency-injection/#use-cases-has-one-operation-per-file).
- `adapters/` implements the ports. See [ports and adapters](/architecture/ports-and-adapters/#adapters-implements-the-ports).
- `queries/` holds the domain's query keys and the factories that return query options and mutation options for the query cache. A factory takes the use cases it calls as a parameter. The parameter's type is a structural type declared in the queries module (`CardReads` below), never the composition root's `Container` type, so `queries/` never imports the composition root, and a test passes a plain object. If a factory needs failure text, it writes its own, because it may not import `ui/`:

  ```ts
  const cardsKeys = {
    all: () => ['cards'] as const,
    list: () => [...cardsKeys.all(), 'list'] as const,
    card: (id: CardId | null) => [...cardsKeys.all(), 'card', id] as const,
  };

  type CardReads = { readonly readCard: (id: CardId) => Promise<ReadCardResult> };

  function cardQuery(cards: Pick<CardReads, 'readCard'>, id: CardId | null) {
    return queryOptions({
      queryKey: cardsKeys.card(id),
      queryFn: id === null ? skipToken : () => cards.readCard(id),
      staleTime: 0,
    });
  }
  ```

  While the id is `null`, `skipToken` stands in for the query function, so the cache doesn't run the read. Every key starts with its domain's `all()`, so invalidating `all()` reaches every read in the domain. A mutation factory holds only the `mutationFn`, the function that runs the write.
- `ui/` holds screens, data components and view models. A data component owns one read: it runs the query, draws the loading and failure states itself, and passes its children only the loaded data. A view model is a class that holds UI state or a write that takes several steps, never a read, and its logic runs in a unit test without rendering anything. Neither one calls a port. `ui/` imports a use case's module only for a type, like its result union. (In Svelte a view model holds runes, see [view models](/architecture/sveltekit/#view-models-hold-runes-in-a-sveltets-file).) [Data components](/architecture/data-components/) explains the split between the two.

## Leaves and non-leaves

A domain depends on another when any of its files imports a file in the other, and the domain graph has to stay acyclic. This section and the next two describe the leaf rule, which Dokseo uses: it gives the graph a structure in which a cycle can't form. The other way, [a cycle check on the domain graph itself](#or-check-cycles-on-the-domain-graph-itself), lets the graph take any form and fails when a cycle appears.

```text
                          ┌──────────────┐
                          │ housekeeping │  non-leaf
                          └──────┬───────┘
                  ┌──────────────┼──────────────┐
                  ▼              ▼              ▼
           ┌───────────┐  ┌─────────────┐  ┌─────────┐
           │   cards   │  │ annotations │  │  media  │
           └───────────┘  └─────────────┘  └─────────┘

   leaves: no arrow leaves them
   housekeeping → a leaf: only to its domain/ and use-cases/
   no arrow enters housekeeping, or any non-leaf
   every domain → kernel/, platform/, components/
```

**A leaf imports no other domain.** Not its `domain/`, not its `use-cases/`, not its `queries/`. `annotations` is a leaf even though a note belongs to a card. It refers to the card by a `CardId` from the kernel and never imports `cards`.

**A non-leaf may import a leaf's `domain/` and `use-cases/`, and nothing imports it.** Any domain folder not named as a leaf is a non-leaf, and a non-leaf imports only its own domain and the leaves. So a second non-leaf could never import `housekeeping`, and `housekeeping` could never import it. `housekeeping/use-cases/remove-card-and-notes.ts` combines `annotations/use-cases/clear-notes.ts` and `cards/use-cases/remove-card.ts`, because the leaf rule forbids either leaf from importing the other. It imports the two use cases, not the two repositories, and its deps are the two use cases' deps objects. Its own `domain/` stays pure.

**The graph determines where a concept ends up.** Say a domain produces something, and that output feels big enough for a domain of its own. If the new domain were a leaf, and the domain that produces the output is a leaf too, the producer could no longer import it, because a leaf imports no other domain. So a concept that is one domain's output lives in that domain. Under a cycle check instead of the leaf rule, the producer may import the new domain, and the question becomes which domain owns the concept, which [which domain owns a concept](/architecture/placing-a-concept/) works through.

**A domain's queries are its own.** No domain imports another domain's `queries/`. Say a write in `cards` changes something that `housekeeping`'s storage screen shows. The storage screen's read is cached under a `housekeeping` key, and the `cards` write can't import that key to invalidate it. So the code that owns the write takes a callback, `onCardChanged`, and the route implements it by refreshing `housekeeping`'s reads. The general version of composing at the route is on [the dependency injection page](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other).

## A module cycle check doesn't detect a cycle between domains

dependency-cruiser's `no-circular` rule reports a module cycle: a chain of imports between files that comes back to where it started. It checks modules, not domains, and two domains can depend on each other without any module loop:

```text
cards/use-cases/x.ts           ──► annotations/domain/y.ts
annotations/use-cases/z.ts     ──► cards/domain/w.ts
```

Those are two module edges and neither one closes a loop, so `no-circular` passes. But `cards` now depends on `annotations`, and `annotations` depends on `cards`. A rule that only limits cross-domain imports to `domain/` and `use-cases/` allows both edges.

The leaf rule is one way to close the gap, and it takes two rules. `leaf-domains-are-independent`: a leaf imports no domain, so every edge between domains starts at a non-leaf. `non-leaves-import-only-leaves`: a non-leaf imports only its own domain and the leaves, so no edge ends at a non-leaf. An edge from a non-leaf to a leaf can never be followed back. So a cycle can't exist at all.

Both rules read the leaf names from one constant, `LEAF_DOMAINS`, in [the config](/architecture/dependency-cruiser-rules/#the-configuration).

## A second rule keeps non-leaves apart

The first rule only fires from a leaf, so on its own it doesn't cover an edge between two non-leaves. Say the catalog grows a second non-leaf, `sync`. With only the leaf rule, `sync` could import `housekeeping`'s `use-cases/` while `housekeeping` imported `sync`'s `domain/`, and nothing would fire. That's a cycle between two domains, and the module cycle check misses it for the reason above.

`non-leaves-import-only-leaves` forbids both of those imports, because each one ends at a domain that is neither the importer's own nor a leaf. The rule doesn't list the non-leaves: any domain folder missing from `LEAF_DOMAINS` counts as one. So a new domain is held to the rule from its first file, until someone adds it to the list.

## Or check cycles on the domain graph itself

The leaf rule keeps the domain graph acyclic by forbidding almost every edge between domains. The other way is to allow any edge and look for a cycle in the graph that results. Rifty works this way.

The check reads every import in the app and puts each file in a zone: one zone per domain, and one per layer outside the domains (the routes, the composition root, the kernel, and so on). A file in `cards` importing a file in `annotations` becomes a zone edge from `cards` to `annotations`. The check then fails if the zone graph has a cycle. The two edges from [the section above](#a-module-cycle-check-doesnt-detect-a-cycle-between-domains), which `no-circular` passed, become `cards → annotations` and `annotations → cards`, and that's a cycle.

It has to check cycles between files as well. A cycle inside one domain stays inside one zone, so it makes no zone edge, and a zone check alone would pass it.

And it has to detect every way one file can depend on another: `import type`, `export … from`, a dynamic `import()`, and a relative path as well as an alias. Suppose the check only matched the alias (`@/domains/annotations/...`). Someone in `cards` writes `../../annotations/domain/note` instead, the import works, and the check never records the edge.

What this buys is that domains can form whatever DAG the product has. In the card catalog, `annotations` could import `cards`, since a note is about a card, and nothing would need to be a non-leaf. `cards` then can't import `annotations`, because that would close a cycle, and the check fails.

What it costs:

- **A check instead of a proof.** Under the leaf rule a cycle can't exist. Here the graph is acyclic because a script confirms it on every run, so the script is one more thing I have to trust. I'd prove it the same way as a path rule: plant a cycle, watch it fail, delete it.
- **Any new edge passes.** An edge that doesn't close a cycle is allowed, whether or not it should exist. The leaf rule forbids most new edges by default. Here a person has to notice them (more in [what path rules don't reach](/architecture/dependency-cruiser-rules/#what-path-rules-dont-reach)).
- **Layer direction is still separate.** A cycle check doesn't test whether a domain imports something it shouldn't, like an adapter or the composition root, so the direction rules stay.

Rifty's version is a script it runs as `check:deps`, described on [checking the graph](/projects/rifty/architecture/checking-the-graph/). Its graph is on [the seven features](/projects/rifty/architecture/feature-graph/).

## The kernel imports no domain

`kernel/` and `platform/` import no domain. Suppose one kernel file did: `cards` imports a kernel file, and that kernel file imports `annotations`. That's a dependency from one leaf domain to another that no other rule detects:

```text
cards ──► kernel/x.ts ──► annotations
```

That makes `cards` depend on `annotations` through the kernel. The leaf rule doesn't fire, because it only checks direct imports, and there's no module cycle either. So it takes its own rule, `the-base-layers-know-no-domain`. (dependency-cruiser does have `reachable` rules for transitive dependencies, but forbidding the kernel's edge into a domain is simpler and catches it at the source.)

**A contract two leaves both need lives in the kernel.** A leaf can't import a leaf, so a value one domain produces and another one consumes moves down:

| Kernel file | Produced by | Consumed by |
| --- | --- | --- |
| `kernel/ids.ts` (`CardId`) | `cards` | `annotations`, `media` |
| `kernel/card-source.ts` (a port) | `cards` (its adapters) | `media` |
| `kernel/text-search.ts` (a matcher) | | `cards` (titles), `annotations` (note text) |
| `kernel/storage-unavailable.ts` (a result variant) | every domain that stores | the callers of those use cases |

The test is vocabulary again. [Folding text for a search](/text/search-folding/) is text handling, so it belongs in the kernel once two domains search. Ordering notes by their position on a card is annotation vocabulary, so it stays in `annotations` even if another file uses it. A kernel that uses a domain's nouns has stopped being a kernel.

The read and write adapters over the query library live in the kernel too. A read adapter turns the query library's state for one read into a small union a data component can branch on (loading, failed, or ready with a value), and a write adapter does the same for one write. Each comes with the union it produces and the pure functions that build it. Every domain's data components use them, and they name no domain. The Svelte version is on [data components in Svelte](/svelte/data-components/).

Moving a contract into the kernel keeps both leaves independent. What it costs is that `CardId` is defined away from the domain that owns cards, so a change to how cards are identified touches the kernel as well as `cards`.

**Or the contract stays with its owner.** Under [a cycle check](#or-check-cycles-on-the-domain-graph-itself) instead of the leaf rule, `annotations` may import `cards`, so `CardId` can stay in `cards` and `annotations` imports it from there. Which of the two domains imports the other follows from the product: a note is meaningless without a card, and a card means something without notes, so the domain that would be meaningless without the other is the one that imports it. The edge then matches a real dependency in the product, and the id has one home. The cost is that `cards` can never import `annotations`, so anything about notes shown on a card screen has to be passed to `cards` from outside, the way [two domains meet at the screen](#two-domains-meet-at-the-screen-not-inside-each-other) describes. Rifty works this way: its annotation feature imports the card, rules and deck features for their ids, and nothing else. The kernel still holds what no domain owns, like the text folding above.

## Break a cycle by inverting an input, not by moving a file

Sometimes a cycle shows up between two domains anyway. Say the card catalog grows a `collections` domain, which holds a person's saved lists of cards, each card with a count. Statistics over a collection, like how its cards spread across costs, start out inside `collections`, and then I move them into a `stats` domain of their own. `stats` needs a collection from `collections` to read which cards are in it. The collection screen in `collections` shows the statistics panel from `stats`. That's `stats → collections` and `collections → stats`, a cycle.

Moving files doesn't fix it. Wherever the statistics live, the function still takes a collection, so it still imports `collections`, and an `import type` counts as an edge too ([type-only cycles](/tooling/dependency-cruiser/#a-type-only-import-is-a-real-edge-so-two-value-objects-can-still-cycle)).

What fixes it is changing the input. A cost curve never needed a collection. It needs cards and how many of each. So `stats` declares its own input, `CardCount = { card, quantity }`, and takes a list of those. The caller in `collections` reduces its entries to that type before calling:

```ts
// stats/domain/cost-curve.ts: knows nothing about collections
function costCurve(counts: readonly CardCount[]): ReadonlyMap<number, number> { … }

// collections/ui/collection-stats.ts: the caller does the reducing
const curve = costCurve(collection.entries.map(({ card, quantity }) => ({ card, quantity })));
```

Now only `collections → stats` is left, plus `stats → cards` for the `Card` type, which closes no cycle. The same move works for an adapter. Say the media thumbnailer imports the image host from `container.ts`. The composition root imports that adapter, so the two import each other. The fix is for the adapter to take the host as a parameter, `createThumbnailer(imageHost)`, and for the composition root to pass it in. In both repairs a signature changes, and the boundary between the modules stays where it was.

Then rename what's left of the old home. If `stats` still had a total called `collectionSize`, that name would keep a collection's vocabulary inside `stats`, and it's usually how the dependency comes back: someone reads the name and reaches for the type. I rename it for what `stats` actually measures (`poolSize`, a pool of cards and nothing more). [Which domain owns a concept](/architecture/placing-a-concept/) has more on names as the first sign, and [extracting analysis](/projects/rifty/architecture/extracting-analysis/) is the real case in Rifty.

## Two domains meet at the screen, not inside each other

When a screen needs two domains, one option is that no domain imports another domain's `ui/`. The route builds both and connects them, with a slot, a callback, or a need one domain declares and another supplies. Dokseo works this way, and under the leaf rule it's the only option between two leaves.

The other option, which Rifty uses, lets a domain import UI another domain exports for rendering that domain's own types, in the direction the graph already allows. Both, with what each costs, are on [the dependency injection page](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other).

## Adding a domain

1. **Name it for the activity, not the technology**, so swapping a library renames nothing.
2. **Create only the folders it needs** under `src/domains/<name>/`. Add `queries/` when its first read or write goes through the query cache.
3. **Decide leaf or non-leaf.** Default to leaf. Make it a non-leaf only when it has to compose another domain's `domain/` or `use-cases/`, and only if nothing will ever need to import it. If two leaves need one type, move the type into `kernel/`.
4. **Update `LEAF_DOMAINS`** for a leaf: `['cards', 'annotations', 'media', '<name>']`. For a non-leaf, change nothing: a domain missing from the list is a non-leaf, and `non-leaves-import-only-leaves` holds it. No other rule names a domain.
5. **Wire it in `container.ts`**: build its adapters, give each use case a deps object, add a `<name>: { … }` group holding only use cases, and load a heavy adapter through `await import(...)`.
6. **Compose its UI at a route.** The route passes the domain's group of use cases from the container (`container.<name>`) to the domain's data components. If it has to show up inside another domain's screen, that screen exposes a slot or a callback prop and the route fills it.
7. **Prove the rule fires** for the new name, then delete the probe. For a leaf, `leaf-domains-are-independent` should fail on an import of another domain. For a non-leaf, `non-leaves-import-only-leaves` should fail on an import of another non-leaf. [Proving a rule](/architecture/dependency-cruiser-rules/#prove-every-rule-by-making-it-fire) has the steps.
8. **Write it down** in the project's layout doc and its domain graph.

Those steps are for the leaf rule and its non-leaf counterpart, enforced by dependency-cruiser. Under [a cycle check on the domain graph](#or-check-cycles-on-the-domain-graph-itself), steps 3, 4 and 7 change: decide which domains the new one imports and which import it, from which one would be meaningless without the other, then run the check and confirm the new edges are the ones you meant. Step 5 is for a composition root that exposes use cases, and step 6 for domains that meet only at the route. The other option for each is on [the dependency injection page](/architecture/dependency-injection/).
