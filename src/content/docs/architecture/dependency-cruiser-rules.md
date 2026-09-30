---
title: Enforcing the Layers with dependency-cruiser
description: The full dependency-cruiser config for the layers and the domain graph, one allowed and one forbidden import per rule, and what path rules don't catch.
tags: [architecture, dependency-cruiser, typescript]
sidebar:
  order: 5
---

The [layers and the domain graph](/architecture/domains-and-the-graph/), [ports and adapters](/architecture/ports-and-adapters/) and [the composition root](/architecture/dependency-injection/) are only conventions until a tool fails on the imports that break them. Dokseo, my manga and book reader, uses dependency-cruiser path rules for that. This setup enforces the [leaf rule](/architecture/domains-and-the-graph/#leaves-and-non-leaves) for the domain graph, with [a second rule](/architecture/domains-and-the-graph/#a-second-rule-keeps-non-leaves-apart) for the non-leaves. Rifty, my Riftbound card app, takes the other option, a script that checks cycles between domains, described on [checking the graph](/projects/rifty/architecture/checking-the-graph/) (the general idea is [on the graph page](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself)). The general gotchas (module granularity, catch-all `from.path`, back-references, type-only cycles and exemptions) are on the [dependency-cruiser](/tooling/dependency-cruiser/) page. The setup covers the whole card catalog, at the framework-neutral paths. The same config at SvelteKit's paths is on [applying it in SvelteKit](/architecture/sveltekit/#the-dependency-cruiser-config-at-sveltekit-paths).

## The configuration

It lives in `.dependency-cruiser.cjs`. Each rule matches the importing file by path (`from.path`) and the imported file by path, with `to.pathNot` for exceptions, and an import that matches a rule is reported as a violation. The leaf names show up in exactly one place, the `LEAF_DOMAINS` constant at the top of the file, and two rules read it: `leaf-domains-are-independent` and `non-leaves-import-only-leaves`. No non-leaf is named anywhere, and every other rule matches all domains by pattern. Give each rule a `comment` saying why it exists, because the error only prints the rule's name.

```js
const LEAF_DOMAINS = ['cards', 'annotations', 'media'];
const LEAF_DOMAIN_PATH = `^src/domains/(${LEAF_DOMAINS.join('|')})/`;

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'only-the-container-builds-adapters',
      severity: 'error',
      from: {
        path: '^src/domains/([^/]+)/adapters/|^src/',
        pathNot: '^src/container\\.ts$',
      },
      to: {
        path: '^src/domains/[^/]+/adapters/',
        pathNot: '^src/domains/$1/adapters/',
      },
    },
    {
      name: 'domain-ring-is-pure',
      severity: 'error',
      from: { path: '^src/domains/([^/]+)/domain/' },
      to: { path: '^src/domains/', pathNot: '^src/domains/$1/domain/' },
    },
    {
      name: 'queries-know-no-ui-or-wiring',
      severity: 'error',
      from: { path: '^src/domains/[^/]+/queries/' },
      to: {
        path: [
          '^src/domains/[^/]+/(ui|adapters)/',
          '^src/container\\.ts$',
          '^src/context\\.ts$',
        ],
      },
    },
    {
      name: 'queries-call-use-cases-they-are-handed',
      severity: 'error',
      from: { path: '^src/domains/[^/]+/queries/' },
      to: {
        path: '^src/domains/[^/]+/use-cases/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'only-ui-reads-queries',
      severity: 'error',
      from: { path: '^src/domains/[^/]+/(domain|use-cases|adapters)/' },
      to: { path: '^src/domains/[^/]+/queries/' },
    },
    {
      name: 'cross-domain-contract-only',
      severity: 'error',
      from: { path: '^src/domains/([^/]+)/' },
      to: {
        path: '^src/domains/',
        pathNot: [
          '^src/domains/$1/',
          '^src/domains/[^/]+/domain/',
          '^src/domains/[^/]+/use-cases/',
        ],
      },
    },
    {
      name: 'leaf-domains-are-independent',
      severity: 'error',
      from: { path: LEAF_DOMAIN_PATH },
      to: { path: '^src/domains/', pathNot: '^src/domains/$1/' },
    },
    {
      name: 'non-leaves-import-only-leaves',
      severity: 'error',
      from: { path: '^src/domains/([^/]+)/', pathNot: LEAF_DOMAIN_PATH },
      to: {
        path: '^src/domains/',
        pathNot: ['^src/domains/$1/', LEAF_DOMAIN_PATH],
      },
    },
    {
      name: 'the-base-layers-know-no-domain',
      severity: 'error',
      from: { path: '^src/(kernel|platform)/' },
      to: { path: '^src/domains/' },
    },
    {
      name: 'routes-are-thin',
      severity: 'error',
      from: { path: '^src/routes/' },
      to: {
        path: '^src/',
        pathNot: [
          '^src/routes/',
          '^src/container\\.ts$',
          '^src/context\\.ts$',
          '^src/query-client\\.ts$',
          '^src/kernel/',
          '^src/styles/',
          '^src/assets/',
          '^src/components/',
          '^src/domains/[^/]+/ui/',
        ],
      },
    },
    {
      name: 'base-components-know-no-app',
      severity: 'error',
      from: { path: '^src/components/' },
      to: { path: '^src/', pathNot: ['^src/components/', '^src/assets/'] },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(build|dist|node_modules)/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js'],
    },
  },
};
```

`routes-are-thin` exempts `^src/routes/` because its `to.path` covers all of `src/`. Without it a route couldn't import a helper that sits next to it.

`tsPreCompilationDeps: true` makes dependency-cruiser count dependencies that only exist before TypeScript compiles to JavaScript, so an `import type` is an edge too and a type-only import is held to the same rules. Each of those edges is marked `type-only`, so a rule can also exempt them by name with `dependencyTypesNot: ['type-only']`. (That also means two types can form a cycle, see [type-only cycles](/tooling/dependency-cruiser/#a-type-only-import-is-a-real-edge-so-two-value-objects-can-still-cycle).)

### Framework aliases

A framework usually adds three things this config doesn't cover: its own component file extension, a folder of generated output, and import paths only its bundler can resolve (aliases, virtual modules with no file on disk). The first goes in `extensions`, the second in `exclude`. For the third, an alias dependency-cruiser should follow goes in the tsconfig that `tsConfig` points at, and a module no file backs gets a `pathNot` on `no-unresolvable`. Anything left over fails `no-unresolvable` loudly, which is what you want. The SvelteKit version of all three is in [aliases and virtual modules](/architecture/sveltekit/#aliases-and-virtual-modules).

## Five mechanisms make the whole config work

- **A back-reference exempts a group from itself.** `([^/]+)` in `from.path` captures the domain name, and `$1` in `to.pathNot` puts it back. So a domain can import its own folders, or an adapter its siblings, while the same import from any other file is forbidden.
- **An alternation widens `from`.** `^src/domains/([^/]+)/adapters/|^src/` matches every file in `src/`, so a route, a worker or a domain's own use case fails the rule when it imports an adapter. When a file only matches the second branch, the group captured nothing. dependency-cruiser then leaves `$1` in `to.pathNot` as literal text instead of filling it in, and in a regex a `$` in the middle means "end of input", so that `pathNot` can never match. The exemption never applies to those files, which is exactly what I want. (I read this in dependency-cruiser's [`regex-util.mjs`](https://github.com/sverweij/dependency-cruiser/blob/main/src/utl/regex-util.mjs): `extractGroups` drops groups that didn't match, and `replaceGroupPlaceholders` only replaces the ones it has.)
- **`no-unresolvable` guards the guards.** No other rule checks an import that doesn't resolve. So a broken alias would switch off every architecture check, with no error.
- **The leaf list is the only list of names.** A domain that's missing from `LEAF_DOMAINS` is a non-leaf, and `non-leaves-import-only-leaves` holds it to its own folders and the leaves until someone adds it to the list. That rule uses the leaf pattern twice: in `from.pathNot`, so the rule skips files in a leaf, and in `to.pathNot`, so a non-leaf may import a leaf. The pattern has a capture group, but `$1` doesn't come from it. dependency-cruiser fills `$1` only from the groups `from.path` captured, so in this rule `$1` is always the importing non-leaf's own name. (`extractGroups` in the same `regex-util.mjs` reads `from.path` alone. I also checked it in the fixture below: with the group taken out of `from.path`, a non-leaf's import of its own `domain/` fails the rule, because `$1` is left as literal text.)
- **A dependency type narrows a rule.** `dependencyTypesNot: ['type-only']` in `queries-call-use-cases-they-are-handed` lets a `queries/` module import a use case's result type while a value import of the use case itself fails. How dependency-cruiser marks those edges is on [its own page](/tooling/dependency-cruiser/#a-type-only-import-is-a-real-edge-so-two-value-objects-can-still-cycle).

## Why the three `queries/` rules

A domain's `queries/` folder sits between its `ui/` and its `use-cases/`. It holds the domain's query keys and the factories that build query options from the use cases they're passed as a parameter ([the five parts of a domain](/architecture/domains-and-the-graph/#the-five-parts-of-a-domain)). Three rules keep it in that spot:

- `queries-know-no-ui-or-wiring` keeps the factories below the UI and away from the composition root and the context, so a factory depends only on the use cases it receives. It forbids the factory's own domain's `ui/` too, because `ui/` sits above `queries/` and imports it, so an import from `queries/` into `ui/` would point up.
- `queries-call-use-cases-they-are-handed` keeps the composition root the one place where a use case meets its dependencies. A factory that imported `archiveCard` itself would have to build the deps object to call it. The `import type` exemption still lets the factory name the use case's result type.
- `only-ui-reads-queries` stops a `domain/`, `use-cases/` or `adapters/` file from importing up into the cache layer.

None of the three mentions another domain's `queries/`, because other rules already forbid it: `cross-domain-contract-only` forbids it from any other domain (and from a leaf, the leaf rule forbids it as well), and `routes-are-thin` forbids it from a route.

## One allowed and one forbidden import per rule

The `non-leaves-import-only-leaves` row adds a second non-leaf, `sync`, next to `housekeeping`. I checked every row against dependency-cruiser 18.4 with a small fixture in this layout, each import in a tree of its own: every allowed import passed, and every forbidden one failed under its own rule and no other.

| Rule | Allowed | Forbidden |
| --- | --- | --- |
| `no-circular` | `adapters/x.ts → workers/protocol.ts` and `workers/w.ts → domain/y.ts` | `kernel/a.ts → kernel/b.ts → kernel/a.ts` |
| `only-the-container-builds-adapters` | `container.ts → cards/adapters/indexeddb-cards.repo.ts`; `cards/adapters/a.ts → cards/adapters/b.ts` | `cards/use-cases/x.ts → cards/adapters/indexeddb-cards.repo.ts` |
| `domain-ring-is-pure` | `cards/domain/card.ts → kernel/ids.ts` | `cards/domain/x.ts → cards/use-cases/archive-card.ts` |
| `queries-know-no-ui-or-wiring` | `cards/queries/cards-queries.ts → cards/domain/card.ts` | `cards/queries/x.ts → cards/ui/card-view.ts`; `cards/queries/x.ts → container.ts` |
| `queries-call-use-cases-they-are-handed` | `cards/queries/x.ts → cards/use-cases/read-card.ts` as `import type` | the same import as a value import |
| `only-ui-reads-queries` | `cards/ui/card-data.ts → cards/queries/cards-queries.ts` | `cards/use-cases/x.ts → cards/queries/cards-keys.ts` |
| `cross-domain-contract-only` | `housekeeping/use-cases/x.ts → cards/use-cases/remove-card.ts` | `housekeeping/ui/x.ts → cards/ui/card-list.ts` |
| `leaf-domains-are-independent` | `housekeeping/use-cases/x.ts → annotations/domain/note.ts` | `cards/use-cases/x.ts → annotations/domain/note.ts` |
| `non-leaves-import-only-leaves` | `sync/use-cases/x.ts → cards/domain/card.ts` | `sync/use-cases/x.ts → housekeeping/domain/y.ts`; `housekeeping/use-cases/x.ts → sync/domain/y.ts` |
| `the-base-layers-know-no-domain` | `kernel/x.ts → platform/storage/remembered.ts` | `kernel/x.ts → cards/domain/card.ts` |
| `routes-are-thin` | `routes/cards.ts → cards/ui/card-list.ts` | `routes/cards.ts → cards/use-cases/list-cards.ts`; `routes/cards.ts → cards/queries/cards-keys.ts` |
| `base-components-know-no-app` | `components/x.ts → ts-pattern` | `components/x.ts → kernel/read-state.ts` |
| `no-unresolvable` | `ts-pattern` (installed) | `../nowhere/thing` |

## What path rules don't reach

A path rule only protects the paths it matches. With the config above, these all pass, and only convention stops them:

- A worker importing a domain's `use-cases/`. The worker is only covered by the `^src/` branch of the adapter rule.
- A `domain/` file importing `platform/`. Keeping that ring free of browser APIs is a convention.
- A domain's `use-cases/` importing its own `ui/`. The same-domain exemption leaves it open.
- A file outside `src/domains/` holding domain knowledge. The domain rules key off that prefix.
- Which part of the UI owns a read and which owns a write. A read loads data a screen shows, and the rule I follow is that a data component owns it and a view model never does: a view model holds UI state or a write ([data components](/architecture/data-components/)). A view model that loads data imports the same kinds of modules as one that only holds UI state, so no import rule can tell the two apart.
- A legal edge that starts bringing types into a model. A rule matches the fact that one domain imports another, not what crosses the edge. Say `housekeeping` calls a `cards` use case, which is allowed. Later someone declares `interface CardRemoval extends Card` in `housekeeping/use-cases/`, and more of `housekeeping` builds on it. The edge is the same one, so every rule still passes, but `housekeeping`'s own concepts can no longer be read without `cards`. See [calls may cross an edge](/architecture/placing-a-concept/#calls-may-cross-an-edge-vocabulary-may-not-enter-the-model).
- A new edge that nobody decided on. Every rule above allows any edge it doesn't forbid, so a new allowed edge goes in without anyone asking whether it should exist. A snapshot of the edge set, checked in, with a check that fails when the graph changes, puts each new edge in a diff where a person has to approve it. Rifty has this written up and not yet built ([the edge snapshot](/projects/rifty/architecture/checking-the-graph/#the-edge-snapshot-i-would-build-first)).

Add a rule for any of these as soon as it matters.

## Prove every rule by making it fire

For every new or changed rule: write the forbidden import, run the check, read the error by name, and delete the import. Prove the allowed case the same way. A rule nobody has seen fire isn't a rule. (More on this, including why reading the config isn't enough, on the [dependency-cruiser](/tooling/dependency-cruiser/#prove-a-rule-fires-before-trusting-it) page.)

## No barrel files

A barrel file is an `index.ts` that re-exports other modules, so a caller can import a whole folder's exports from one path. I allow no barrel anywhere. dependency-cruiser works at module granularity: it records that a file imports a module, not which names the file imports from it. A barrel that re-exported a domain's use cases and its adapters would let a route import the barrel from an allowed path and pull the adapter out of it. Only a path rule can control what crosses a boundary, and a barrel hides the path.

Import the real module, and use `import type` for types. From `src/container.ts`:

```ts
import { archiveCard } from './domains/cards/use-cases/archive-card';
import type { ArchiveCardDeps } from './domains/cards/use-cases/archive-card';
```

Same for an icon set: one module per icon, imported by its own path, and no index.

## Running the checks

The checks run as npm scripts. One runs dependency-cruiser alone, one adds it to the type check, lint and format check, one adds the tests on top of those, and one adds the build:

```json
{
  "scripts": {
    "lint:deps": "depcruise src --config .dependency-cruiser.cjs",
    "verify:static": "npm run check && npm run lint && npm run format:check && npm run lint:deps",
    "verify:tests": "npm run verify:static && npm run test",
    "verify": "npm run verify:tests && npm run build",
    "deps:graph": "depcruise src --config .dependency-cruiser.cjs -T archi | dot -T svg > graphs/architecture.svg"
  }
}
```

A violation prints the rule name, the importing file and the imported file. With the default `err` reporter, the exit code is the number of `error` violations, so any violation fails CI. `deps:graph` uses the `archi` reporter, a variant of the `dot` output that collapses dependencies to folders, and `dot` (from Graphviz) turns that into an SVG. By default `archi` collapses to one folder below `src/`, so everything under `src/domains/` becomes a single node. To see domains and their parts, set a pattern in `options.reporterOptions.archi.collapsePattern`, for example `'^src/domains/[^/]+/[^/]+|^src/[^/]+|^node_modules/[^/]+'`.
