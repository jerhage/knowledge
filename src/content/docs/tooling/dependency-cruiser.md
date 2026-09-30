---
title: Architecture Rules with dependency-cruiser
description: "Module granularity, catch-all `from.path`, back-reference exemptions, type-only cycles and type-only exemptions, and proving a rule fires."
tags: [dependency-cruiser, architecture, typescript]
sidebar:
  order: 3
---

dependency-cruiser reads the import graph of a codebase and checks it against rules you write, each rule listing which files may import which. The examples here assume a domains/adapters layout, for example `src/lib/domains/<name>/adapters/` next to a pure `domain/` folder, with one composition root that builds the adapters. That's the SvelteKit version of the layout in [architecture](/architecture/overview/) (how the paths map: [applying it in SvelteKit](/architecture/sveltekit/#the-layout-in-sveltekit)), and its full config is in [enforcing the layers](/architecture/dependency-cruiser-rules/).

## dependency-cruiser works at module granularity

A rule matches on which module imports which module. It has no information about which names come across. That matters for a barrel, a module that re-exports what other modules export. Importing a barrel is one edge to one module, so it's legal no matter which names you pull from it, even if some of those names come from places a rule forbids for the importer. dependency-cruiser can't check that.

Only a path rule can control which imports cross a boundary, and a path rule only works if every import names the real file. That's a reason to have no barrel files at all in a codebase where dependency-cruiser enforces the boundaries. (Icons are one place I use this: each icon is imported through its own file and nothing else, see [icons as Svelte components](/design-systems/icons/).)

## A catch-all alternative in `from.path` governs files outside the tree you meant

Each rule has a `from` side that picks the importing files by a path regex. Say you want a rule like "only the composition root builds adapters". It might read:

```js
from: { path: '^src/lib/domains/([^/]+)/adapters/|^src/' }
```

The regex has two alternatives, and the second one is a catch-all. It matches every file under src, so the rule also covers folders like `src/workers/`, which no other rule mentions. The result is lopsided. A worker that imports an adapter fails, by name, because this rule matches it. A worker that imports a domain's pure `domain/` folder passes, because the rules that would forbid that each have a `from` that starts inside the folders it was written for, so none of them matches the worker.

You can't reliably work that out by reading the config. Instead, write the import, run the dependency check, and read the verdict. Do that for the *allowed* case as well as the forbidden one. A rule that passes an import silently shows you as much about the architecture as one that fires.

## It also rejects an unsafe regex outright

A rule's path regex is also checked for being safe to run. If you nest a quantifier inside an optional group, dependency-cruiser stops with "has an unsafe regular expression. Bailing out." An alternation with star height 1 works.

## A back-reference in a rule exempts a group from itself

The side of a rule that picks the imported files can refer back to a group captured in `from`:

```js
from: { path: '^src/lib/domains/([^/]+)/adapters/' },
to: { pathNot: '^src/lib/domains/$1/adapters/' }
```

The $1 in the second path is whatever domain name the capture group matched for the importing file. So the rule lets an adapter import a sibling adapter in its own domain, and forbids every other file. It's the exemption that makes a shared IndexedDB upgrade module legal when several adapters on one database have to call it (see [IndexedDB](/storage/indexeddb/)).

Prove both halves: the failure *and* the exemption. If you only check that a forbidden import fails, you can't tell a working rule from one that's switched off.

## Prove a rule fires before trusting it

A rule can be written wrong and still pass, because a rule that matches nothing never reports anything. So write a probe file that breaks the rule, run the check, confirm it fails *by name*, then delete the probe. A rule nobody has seen fire isn't really a rule. This is how I find holes in architecture rules.

## A type-only import is a real edge, so two value objects can still cycle

TypeScript erases an `import type` when it compiles, so at runtime there's no edge. dependency-cruiser treats it differently. With `tsPreCompilationDeps: true`, it resolves `import type` exactly like an `import`. So `no-circular` fires on a pair of modules that never reference each other at runtime, and that TypeScript erases completely.

A typical case: a tag module needs a color type and the palette's first entry, so it imports the palette module. The palette's "next color" function reads the color each existing tag has, so the obvious signature is `nextColour(existing: readonly Tag[])`. Naming the tag type there means importing it from the tag module, and that import back into the tag module closes the cycle. It fails at the dependency check, not at the type check.

The fix is to take the narrowest type the function actually reads, declared on the downstream side:

```ts
type ColouredTag = { readonly colour: TagColour };
```

`readonly Tag[]` is assignable to `readonly ColouredTag[]`, so no caller changes. The arrow now points one way only, and the palette module has no reference to anything else a tag holds.

I do this whenever I'm about to have a "lower" module name a "higher" one just to describe a parameter. With structural typing, it almost never has to. More type techniques in [TypeScript: brands, strict flags and typed arrays](/typescript/type-checking-techniques/).

Because a type-only import is its own kind of edge, a rule can also treat it differently from a value import. dependency-cruiser records a list of dependency types on each edge, and an `import type` gets `type-only` in that list. A rule's `to` side takes `dependencyTypesNot: ['type-only']`, and then the rule only matches the edges that aren't type-only. I use it where a module may name another module's types but must not call its code. In the architecture setup, a query module may import a use case's result type, while a value import of the use case itself fails ([why the `queries/` rules](/architecture/dependency-cruiser-rules/#why-the-three-queries-rules)). I checked the matching in dependency-cruiser 18.4's `validate/matchers.mjs`: a rule with `dependencyTypesNot` matches an edge only if none of the edge's types are in that list.
