---
title: Dokseo's dependency-cruiser Rules
description: "Every rule in `.dependency-cruiser.cjs`, including the three for `queries/`, with real allowed and rejected imports, the gaps no path rule covers, and the commands that run them."
tags: [dokseo, architecture, dependency-cruiser, typescript]
sidebar:
  order: 13
---

Dokseo is my manga and book reader. Its `.dependency-cruiser.cjs` is the config from [enforcing the layers](/architecture/dependency-cruiser-rules/), at [SvelteKit paths](/architecture/sveltekit/#the-dependency-cruiser-config-at-sveltekit-paths), with the second domain rule, `non-leaves-import-only-leaves`, and three rules that guard the `queries/` folder each domain has for its cached reads and writes. One more rule, `icons-are-imported-one-by-one`, is about the icon library rather than the layers. Each rule has its reason in a `comment` field. Every rule has [one allowed and one rejected import](/architecture/dependency-cruiser-rules/#one-allowed-and-one-forbidden-import-per-rule), at real paths. I got every verdict by running the import through dependency-cruiser, not by reading the config.

## The rules, with real verdicts

**`no-circular`**: no module cycle.

```text
refused   shared/a.ts → shared/b.ts → shared/a.ts
allowed   recognition/adapters/engine/worker-recognizer.ts → workers/ocr-worker-protocol.ts
          and workers/paddle-ocr.worker.ts → recognition/domain/engine/ctc-reading.ts
          (different modules at each end)
```

**`only-the-container-builds-adapters`**: only `container.ts` imports a concrete adapter, plus a sibling adapter in the same domain. The `from` is `^src/lib/domains/([^/]+)/adapters/|^src/`, so it covers routes, workers and a domain's own use cases too.

```text
allowed   container.ts → domains/library/adapters/file-source-builder.ts
allowed   flowing/adapters/indexeddb-reading-settings.ts → flowing/adapters/flowing-database.ts
refused   library/use-cases/x.ts → library/adapters/file-source-builder.ts
refused   storage/use-cases/x.ts → library/adapters/file-source-builder.ts
```

**`domain-ring-is-pure`**: a `domain/` file imports nothing else under `src/lib/domains/` except its own `domain/`.

```text
allowed   library/domain/book/book.ts → shared/reading-place.ts
refused   library/domain/x.ts → library/use-cases/mark-unread.ts
refused   library/domain/x.ts → recognition/domain/capture/capture.ts
```

**`queries-know-no-ui-or-wiring`**: a `queries/` file imports no `ui/` (its own included), no `adapters/`, and neither `container.ts` nor `context.ts`. A domain's `queries/` folder holds its cache keys and the factories that pair a key with a use case call. It sits between `use-cases/` and `ui/`, and `ui/` imports it, so an import back into `ui/` would point up.

```text
allowed   recognition/queries/engine-queries.ts → recognition/domain/model/model-footprint.ts
allowed   recognition/queries/engine-queries.ts → shared/query-failure.ts
refused   storage/queries/x.ts → storage/ui/storage-view.svelte.ts
refused   storage/queries/x.ts → storage/adapters/browser-origin-stores.ts
refused   storage/queries/x.ts → container.ts
```

The adapter import is also refused by `only-the-container-builds-adapters`.

**`queries-call-use-cases-they-are-handed`**: a `queries/` file makes no value import from `use-cases/`. A factory calls the use case it receives as a parameter, so `container.ts` stays the one place a use case meets its dependencies. A type-only import passes, because the rule sets `dependencyTypesNot: ['type-only']`, and a factory needs the use case's result type.

```text
allowed   storage/queries/storage-queries.ts → storage/use-cases/read-storage-account.ts (import type)
refused   storage/queries/x.ts → storage/use-cases/read-storage-account.ts
```

**`only-ui-reads-queries`**: no `domain/`, `use-cases/` or `adapters/` file imports `queries/`. Another domain's `queries/` is refused already, by `cross-domain-contract-only` and the leaf rule, and a route's import of it by `routes-are-thin`.

```text
allowed   storage/ui/StorageData.svelte → storage/queries/storage-queries.ts
refused   storage/use-cases/x.ts → storage/queries/storage-keys.ts
refused   library/ui/x.ts → storage/queries/storage-keys.ts   (by cross-domain-contract-only and leaf-domains-are-independent)
```

**`cross-domain-contract-only`**: from another domain, only its `domain/` and `use-cases/`. Inside one domain every folder is open, subject to the other rules.

```text
allowed   storage/use-cases/remove-book-and-captures.ts → library/use-cases/remove-book.ts
refused   storage/ui/x.ts → library/ui/library-view.svelte.ts
refused   storage/use-cases/x.ts → library/adapters/file-source-builder.ts
```

**`leaf-domains-are-independent`**: a file in a leaf imports no other domain. The leaves are named once, in a constant at the top of the file that this rule and the next one both read:

```js
const LEAF_DOMAINS = ['library', 'viewing', 'flowing', 'recognition'];
const LEAF_DOMAIN_PATH = `^src/lib/domains/(${LEAF_DOMAINS.join('|')})/`;

from: { path: LEAF_DOMAIN_PATH },
```

```text
allowed   storage/use-cases/read-storage-account.ts → recognition/domain/model/model-cache.ts
refused   library/use-cases/x.ts → recognition/domain/capture/capture.ts
refused   viewing/ui/x.ts → storage/domain/storage-parts.ts
```

**`non-leaves-import-only-leaves`**: a file in a non-leaf imports only its own domain and the leaves. A non-leaf is any domain folder not in `LEAF_DOMAINS`, so a new folder is held to this rule until it's added to the list. This is the rule that closes [the non-leaf gap](/architecture/domains-and-the-graph/#a-second-rule-keeps-non-leaves-apart) that the leaf rule alone leaves open.

```js
from: { path: '^src/lib/domains/([^/]+)/', pathNot: LEAF_DOMAIN_PATH },
to: {
  path: '^src/lib/domains/',
  pathNot: ['^src/lib/domains/$1/', LEAF_DOMAIN_PATH],
},
```

`$1` is the domain name `from.path` captured, used as a [back-reference](/tooling/dependency-cruiser/#a-back-reference-in-a-rule-exempts-a-group-from-itself) to let the domain import itself. `from.pathNot` contributes no group, so `$1` always refers to `from.path`'s. The verdicts include a made-up non-leaf, `sync`, which is how I proved the rule before a second non-leaf exists:

```text
allowed   storage/use-cases/read-storage-account.ts → recognition/domain/model/model-cache.ts
allowed   sync/use-cases/x.ts → library/domain/book/book.ts
refused   sync/use-cases/x.ts → storage/domain/storage-parts.ts
refused   storage/use-cases/x.ts → sync/domain/y.ts
```

**`the-base-layers-know-no-domain`**: `shared/` and `platform/` import no domain.

```text
allowed   shared/touch-turns.ts → platform/storage/remembered-string.ts
refused   shared/x.ts → library/domain/book/book.ts
refused   platform/x.ts → library/domain/book/book.ts
```

**`routes-are-thin`**: a route imports only `container.ts`, `context.ts`, `query-client.ts`, `shared/`, `styles/`, `assets/`, `components/` and a domain's `ui/`. Logic a route can reach is logic that isn't under test, so a route never reaches a port, a use case, an adapter or a platform module.

```text
allowed   routes/read/[fileId]/+page.svelte → domains/viewing/ui/ReaderScreen.svelte
allowed   routes/read/[fileId]/+page.svelte → components/toast-context.ts
allowed   routes/+layout.svelte → query-client.ts
refused   routes/x.ts → domains/library/use-cases/list-books.ts
refused   routes/x.ts → platform/crypto/md5.ts
```

`query-client.ts` builds the one query cache, which the root layout provides to every screen, so it sits at the top with the container.

**`base-components-know-no-app`**: `components/` imports only its siblings, `assets/` and npm.

```text
allowed   components/x.ts → ts-pattern
refused   components/x.ts → shared/geometry.ts
```

**`icons-are-imported-one-by-one`**: nothing imports an index module in `components/icons/`. Each icon is imported by its own path, so only the icons a screen names reach the build. (The icon components themselves are on [icons](/design-systems/icons/).)

```text
allowed   → components/icons/<Name>.svelte
refused   → components/icons/index.ts
```

**`no-unresolvable`**: every import resolves. An import that doesn't resolve is invisible to every other rule, so a broken alias would switch the architecture checks off in silence. `$app/` and `$env/` are SvelteKit's virtual modules and are exempt.

```text
refused   lib/x.ts → $lib/nowhere/thing
```

## Aliases and type imports

dependency-cruiser resolves `$lib` and `$workers` through `tsconfig.depcruise.json`, which exists for that purpose alone. An alias added through `kit.alias` has to be added there as well, or `no-unresolvable` fails and prints the file name.

`tsPreCompilationDeps: true` makes `import type` count as an edge, so a type-only import is held to the same rules. It also means [two value objects can cycle through types alone](/tooling/dependency-cruiser/#a-type-only-import-is-a-real-edge-so-two-value-objects-can-still-cycle), and Dokseo hit exactly that. A capture can have tags, and each tag has a color from a small palette. When the palette was split out of `tag.ts` into `tag-colour.ts`, `tag.ts` imported `tag-colour.ts` for `TagColour` and the palette's first entry. `nextColour`, in `tag-colour.ts`, picks a color based on the colors the existing tags have, so the obvious signature was `nextColour(existing: readonly Tag[])`. Taking the tag type meant importing it from `tag.ts`, and that import back into `tag.ts` closed the cycle. It failed `deno task verify` at `lint:deps`, not at `check`. The fix was `ColouredTag = { readonly colour: TagColour }`, declared in `tag-colour.ts`, and no caller changed.

## What the rules don't reach

[A path rule only protects the paths it matches](/architecture/dependency-cruiser-rules/#what-path-rules-dont-reach). These imports pass today in Dokseo, and only convention governs them:

- A worker importing a domain's `use-cases/`. `src/workers/` is caught only by the `^src/` catch-all of `only-the-container-builds-adapters`, so the only import that rule rejects from a worker is an adapter.
- A `domain/` file importing `platform/`. The rune-free, browser-free ring is a convention. No `domain/` file does it.
- A domain's `use-cases/` importing its own `ui/`. The same-domain exemption of `cross-domain-contract-only` leaves it open.
- `shared/` and `platform/` importing each other, as long as no module cycle forms.
- A file outside `src/lib/domains/` holding domain logic. The ring rules key off that prefix, so a pure decoder left in `src/workers/` breaks no rule.
- A data component that doesn't own its read, or a view model that holds one. Every read in Dokseo starts in a data component, and no view model holds a read, but these rules only cover imports, and a read is a call, so this is [convention](/projects/dokseo/architecture/data-components-and-view-models/#the-split).

Without `non-leaves-import-only-leaves`, a non-leaf importing another non-leaf would be on this list too.

The first item is [a catch-all in `from.path` governing a folder no rule mentions](/tooling/dependency-cruiser/#a-catch-all-alternative-in-frompath-governs-files-outside-the-tree-you-meant). `src/workers/` fails by name when it imports an adapter. It passes when it imports a domain's `domain/`, because every other rule's `from` starts inside `src/lib/domains/`, `src/lib/shared/`, `src/lib/platform/` or `src/routes/`.

## Proving each rule

[I prove a rule by making it fire](/architecture/dependency-cruiser-rules/#prove-every-rule-by-making-it-fire): write the forbidden import, run `deno task lint:deps`, check that the error names the rule, and delete the import. The allowed case gets the same treatment. That's how I found a hole in the route rule, and then a second one in the kernel: nothing stopped `shared/` or `platform/` from importing a domain until I added `the-base-layers-know-no-domain`.

## No barrel files

There's [no `index.ts` re-export module](/architecture/dependency-cruiser-rules/#no-barrel-files) anywhere in Dokseo, and none may be added. A barrel in `library/` that re-exported both the use cases and the adapters would let a route import the barrel, pass `routes-are-thin` if the barrel sat in an allowed path, and take the IndexedDB adapter out of it. So every import names the real module, and types come through `import type`:

```ts
import { effectiveDirection } from '$lib/shared/layout-kind';
import type { LayoutKind } from '$lib/shared/layout-kind';
```

## Running them

```text
deno task lint:deps       dependency-cruiser alone: depcruise src --config .dependency-cruiser.cjs
deno task deps:graph      draws the architecture, folder and module graphs as SVG
```

A violation prints the rule's name, the importing file and the imported file, and the task exits non-zero. `lint:deps` is also a step of `verify:static`, so every full check runs it. The whole task chain is on [checks and tests](/projects/dokseo/engineering/checks-and-tests/).
