---
title: Applying It in SvelteKit
description: How the domain layout maps onto src/lib, the root layout's container and query client, view models in .svelte.ts files, snippets for composing two domains, error boundaries, and the SvelteKit side of the dependency-cruiser config.
tags: [architecture, sveltekit, svelte-5, typescript]
sidebar:
  order: 20
---

My case is a TypeScript SvelteKit SPA on `@tanstack/svelte-query`. The structure on the other pages doesn't depend on Svelte. Only the glue does: Svelte context to pass the container down, the query client in the root layout, runes in the view models, snippets for data components and for composing screens, Svelte's error boundaries, and the aliases dependency-cruiser has to be configured with.

## The layout in SvelteKit

In SvelteKit, app code lives under `src/lib` (what the `$lib` alias points at), so almost every neutral path gets that prefix. `shared/` is what I call the kernel there.

| Neutral layout | SvelteKit |
| --- | --- |
| `src/routes/` | `src/routes/` (`+page.svelte`, `+layout.svelte`) |
| `src/domains/<name>/` | `src/lib/domains/<name>/` |
| `src/kernel/` | `src/lib/shared/` |
| `src/platform/` | `src/lib/platform/` |
| `src/components/` | `src/lib/components/` |
| `src/styles/`, `src/assets/` | `src/lib/styles/`, `src/lib/assets/` |
| `src/container.ts` | `src/lib/container.ts` |
| `src/query-client.ts` | `src/lib/query-client.ts` |
| `src/context.ts` | `src/lib/context.ts` |
| `src/workers/` | `src/workers/`, outside `src/lib`, through a `$workers` alias |

```text
  src/routes/                         screens: compose, no logic
      │
      ▼
  src/lib/domains/<name>/ui/          components, data components, view models
      │
      ▼
  src/lib/domains/<name>/queries/     query keys and query option factories
      │
      ▼
  src/lib/domains/<name>/use-cases/   operations, one per file
      │
      ▼
  src/lib/domains/<name>/domain/      ports, entities, value objects
      │
      ▼
  src/lib/shared/                     the kernel: ids, geometry, the read
      │                               and write adapters, contracts two
      │                               domains share, UI more than one
      │                               domain composes
      ▼
  src/lib/platform/                   technical capability, no domain words
  src/lib/components/                 the base UI library, knows no app
```

Inside a domain:

```text
src/lib/domains/cards/
  domain/       ports, entities, value objects. Pure TS, no runes, no browser API.
  use-cases/    one stateless operation per file, returning its own named union
  adapters/     the concrete "how" behind each port
  queries/      cards-keys.ts (the key factory) and cards-queries.ts (option factories)
  ui/           components, data components and view models (*.svelte.ts)
```

`components/` is still the bottom of the UI. A base component that needs app behavior gets it as a prop, a snippet or a callback.

## The context passes the container to the component tree

`src/lib/context.ts` passes the [container](/architecture/dependency-injection/#the-container-exposes-use-cases-never-a-port) down through Svelte context, and `src/lib/query-client.ts` builds the query cache with the app's global policy. The root layout builds both once and wraps the app in svelte-query's `QueryClientProvider`, which puts the client into context for every `createQuery` and `createMutation` below it:

```svelte
<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { buildContainer } from '$lib/container';
  import { provideContainer } from '$lib/context';
  import { createQueryClient } from '$lib/query-client';

  let { children } = $props();
  provideContainer(buildContainer());
  const client = createQueryClient();
</script>

<QueryClientProvider {client}>{@render children()}</QueryClientProvider>
```

```ts
const CONTAINER = Symbol('container');

function provideContainer(container: Container): void {
  setContext(CONTAINER, container);
}

function useContainer(): Container {
  const container = getContext<Container | undefined>(CONTAINER);
  if (container === undefined) throw new Error('No container in context.');
  return container;
}
```

On Svelte 5.40 and later, `createContext<Container>()` from `svelte` gives you typed functions without the symbol key. Current versions return a `[get, set, has]` triplet, and `get` already throws when nothing set the context, so the `undefined` check above goes away too. The docs recommend it for the type safety.

Only a route calls `useContainer()`. It passes a domain's group of use cases (`container.cards`) to the data components it renders, and the container to the view models it builds. A view model names its type with `import type { Container } from '$lib/container'`. That's a type edge down into the root. The root never imports a `ui/` module, so no cycle. What the client's defaults should be for an app that stores everything locally is on [svelte-query v6](/svelte/svelte-query/#the-defaults-an-offline-app-overrides).

## View models hold runes in a `.svelte.ts` file

Reads belong to [data components](/svelte/data-components/), so a view model holds what's left: UI state with real logic (a sort, a search, a cursor, a picker), a write, or a live resource the cache must not hold (an open file handle, a worker session). It never holds a read. It's a class in a `*.svelte.ts` file with `$state` and `$derived` fields, so its logic runs in a unit test without rendering anything. It never calls a port, and it imports a use case's module only for a type, like its result union. A one-field toggle with no logic stays `$state` in the component.

Runes stop at `ui/`. `domain/` has none, which is why it tests in bare Node.

**State leaves a view model through getters.** A component reads `view.sort` or `view.busy`, and the read is tracked because the getter reads `$state` behind it. Destructuring (`const { sort } = view`) takes a snapshot that goes stale on the next change.

**A write view model describes its write through getters.** It builds the mutation through the shared `writeQuery` adapter and adds the callbacks that depend on this use, such as an optimistic edit in `onMutate`, a notice in `onError` and an invalidation in `onSettled`. It then exposes the write's state as getters (whether it's busy, which item it's changing) and a method for each write it starts. A getter already reaches markup, so there's no separate write component. When one view model runs several writes, their busy flags become one stored union, and the getters derive from it:

```ts
type CardChange =
  | { readonly kind: 'idle' }
  | { readonly kind: 'removing'; readonly id: CardId }
  | { readonly kind: 'editing'; readonly id: CardId };
```

A `removing` getter then returns the id from the `removing` variant, or `null`, and an `editing` getter does the same for its variant, so the markup can tell which card a write is changing.

Progress that an operation reports whatever state the union is in (a download percentage, say) stays in a field beside the union rather than inside one variant.

**A parent view model exposes its parts, it doesn't forward them.** When a view model grows, I split it into parts. The parent builds each part in its constructor, exposes it as a readonly property, and keeps only the methods that join two parts:

```ts
class Panel {
  readonly list: NoteList;
  readonly drafts: Drafts;

  constructor(notes: NoteWrites) {
    this.list = new NoteList();
    this.drafts = new Drafts(notes, () => this.list.selected);
  }

  open(id: NoteId): void {
    this.drafts.start(this.list.find(id));
  }
}
```

A part that needs the parent's state (the open item, another part's selection) takes a getter, `() => T`, not the value. The closure reads the current value each time it's called, so the part never holds a stale copy. A callback a part calls back into the parent can even reach a sibling part that's built later in the constructor, because the closure only runs after construction. One ordering catch: if the parts are built in field initializers instead of the constructor body, those initializers run before the constructor body assigns the parent's other fields, and a value passed from there is `undefined` (see [a class field initializer runs before the constructor body](/javascript/gotchas/#a-class-field-initializer-runs-before-the-constructor-body)). Passing closures avoids that too.

**A view model takes its effects as functions.** Whoever builds a view model passes it the outside effects it needs, such as a clipboard write or a `notify` for a toast, so no view model reads a context or `navigator` itself. The component keeps what needs the DOM: `tick()`, `focus()`, `scrollIntoView` and `goto`. A method that ends with a focus move returns the element's target (which item to focus), and the component moves focus after `tick()`.

**A view model that measures does so through a port.** A view model that lays something out (a zoom, a scroll position, a selection) never holds an element. It takes getters for what the DOM reports (boxes, offsets, the selection) and a frame clock for animation frames, so the geometry runs in a unit test in bare Node. The component keeps the elements, the observers, `preventDefault`, pointer capture and the scroll writes.

**A remembered choice is a small class built with a reader and a saver.** A setting that should survive a reload (a sort order, a layout) reads its stored value once when the class is built and saves on `choose`. A component that reads its choice when it mounts builds the instance then; an app-wide choice is one module-level instance.

## Composing two domains at a route

The general version, and why a view mustn't import the feature it hosts, is in [two domains meet at the route](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other).

### A slot, filled with a snippet

If the card details view imported the annotations list, `cards` would depend on `annotations`. Instead the view exposes a slot, and the screen that shows both fills it:

```svelte
<!-- cards/ui/CardDetails.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { card, extra }: { card: Card; extra?: Snippet<[CardId]> } = $props();
</script>

<h1>{card.title}</h1>
{@render extra?.(card.id)}
```

```svelte
<!-- routes/cards/[id]/+page.svelte -->
<CardData cards={container.cards} {id}>
  {#snippet children(card)}
    <CardDetails {card}>
      {#snippet extra(id)}
        <NotesData annotations={container.annotations} card={id} />
      {/snippet}
    </CardDetails>
  {/snippet}
</CardData>
```

`CardData` is the cards domain's data component for one card: it reads the card and calls its `children` snippet with it once it's loaded. Inside, `NotesData` does the same for the card's notes. Each domain's read stays in its own data component, and only the route nests one inside the other.

The idea is a slot. In Svelte 5 the mechanism is a snippet prop, since `<slot>` is deprecated (see [a snippet prop is the Svelte 5 slot](/svelte/state-and-props/#a-snippet-prop-is-the-svelte-5-slot)). A snippet declared inside the component's tags becomes a prop with the same name, and `?.` skips the render when nobody passed one.

### A callback

When someone selects a passage on a card, `CardDetails` reports "this passage was selected" through an `onSelect` prop. Inside `CardData`'s snippet, the route fills that prop with a function that passes the selection to the annotations write view model it built:

```svelte
<CardDetails {card} onSelect={(range) => notes.add(card.id, range)} />
```

### A need declared in one domain, supplied by another

Nothing Svelte-specific here: `cards/ui/position-order.ts` implements the `PositionOrder` type `annotations` declares, and the route passes it to the notes data component as a prop, `<NotesData … order={comparePositions} />`.

### Route glue

When a route builds view models from several domains and has to join them (a value derived from two, an ordering across both, callbacks from one into the other), the join goes in a view model next to the route file, such as `routes/cards/[id]/card-session.svelte.ts`. It builds the parts, exposes them, and holds only what needs more than one domain. `routes-are-thin` covers it like the route itself, since it sits under `src/routes/`.

SvelteKit's `page`, `goto` and `replaceState` stay in the `+page.svelte` script. They reach the session as an object of getters and callbacks:

```ts
const session = new CardSession(container, {
  id: () => page.params.id,
  open: (id: CardId) => goto(`/cards/${id}`),
});
```

The session never imports `$app/state` or `$app/navigation`, so a unit test builds it with plain functions and runs without SvelteKit. A cross-domain refresh, such as a card write that has to refresh a storage screen's cached read in another domain, is one of those callbacks: the card write's owner takes `onCardChanged`, and the route glue implements it.

## Error boundaries in SvelteKit

[An unexpected failure throws to a boundary](/architecture/expected-and-unexpected-failure/#an-unexpected-failure-throws-to-a-boundary), and in a SvelteKit app each kind of throw ends up at a different one:

| Failure | Where it ends up |
| --- | --- |
| An unexpected failure of a read | the query rejects, and the data component's `failed` branch draws it |
| An unexpected failure of a write | the mutation rejects, and its `onError` raises a notice |
| A throw while rendering or in an effect | `<svelte:boundary>` around `{@render children()}` in the root layout |
| A throw in an event handler, or a rejection nobody awaits | `<svelte:window onerror onunhandledrejection>` in the root layout |
| A throw while SvelteKit loads a route | `handleError` in `src/hooks.client.ts` |

Both reads and writes resolve their expected outcomes, so only throws reach this table.

`<svelte:boundary>` catches errors thrown while its contents render and while their effects run. Its `failed` snippet replaces the contents with something else, and receives the error and a `reset` function that recreates the contents. Its `onerror` gets the same two arguments, which is where the logging goes. It doesn't catch errors in event handlers, in a `setTimeout` callback or in other async work (the Svelte docs list those explicitly), which is why the window listeners are there too.

```svelte
<QueryClientProvider {client}>
  <svelte:boundary onerror={(error) => logUnexpected('render', error)}>
    {@render children()}

    {#snippet failed(error, reset)}
      <EmptyState message="Something went wrong.">
        <Button onclick={reset}>Try again</Button>
      </EmptyState>
    {/snippet}
  </svelte:boundary>
</QueryClientProvider>

<svelte:window
  onerror={(event) => failures.raise('window', 'error' in event ? event.error : event)}
  onunhandledrejection={(event) => failures.raise('promise', event.reason)}
/>
```

`failures` is a small object built in the root layout: its `raise(site, error)` logs through `logUnexpected` and shows one toast. The `'error' in event` check is there because Svelte types `onerror` on `<svelte:window>` as a plain `Event`; see [a `<svelte:window onerror>` handler receives a plain `Event`](/svelte/attachments-and-listeners/#a-sveltewindow-onerror-handler-receives-a-plain-event).

SvelteKit calls `handleError` in `hooks.client.ts` for an unexpected error thrown while it loads or renders a route, but not for an expected one thrown with `error()` from `@sveltejs/kit`:

```ts
const handleError: HandleClientError = ({ error }) => {
  logUnexpected('navigation', error);
};
```

Every boundary logs through one function, `logUnexpected(site, error)`, so each failure is recorded with its stack and the name of the boundary that caught it. A boundary is the only place that catches an error without turning it into something else.

## The dependency-cruiser config at SvelteKit paths

This is the [full config](/architecture/dependency-cruiser-rules/#the-configuration) as it runs in my SvelteKit app. The rules are the same. The differences are the `src/lib/` prefix and the SvelteKit bits in `no-unresolvable` and `options`.

```js
const LEAF_DOMAINS = ['cards', 'annotations', 'media'];
const LEAF_DOMAIN_PATH = `^src/lib/domains/(${LEAF_DOMAINS.join('|')})/`;

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
        path: '^src/lib/domains/([^/]+)/adapters/|^src/',
        pathNot: '^src/lib/container\\.ts$',
      },
      to: {
        path: '^src/lib/domains/[^/]+/adapters/',
        pathNot: '^src/lib/domains/$1/adapters/',
      },
    },
    {
      name: 'domain-ring-is-pure',
      severity: 'error',
      from: { path: '^src/lib/domains/([^/]+)/domain/' },
      to: { path: '^src/lib/domains/', pathNot: '^src/lib/domains/$1/domain/' },
    },
    {
      name: 'queries-know-no-ui-or-wiring',
      severity: 'error',
      from: { path: '^src/lib/domains/[^/]+/queries/' },
      to: {
        path: [
          '^src/lib/domains/[^/]+/(ui|adapters)/',
          '^src/lib/container\\.ts$',
          '^src/lib/context\\.ts$',
        ],
      },
    },
    {
      name: 'queries-call-use-cases-they-are-handed',
      severity: 'error',
      from: { path: '^src/lib/domains/[^/]+/queries/' },
      to: {
        path: '^src/lib/domains/[^/]+/use-cases/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'only-ui-reads-queries',
      severity: 'error',
      from: { path: '^src/lib/domains/[^/]+/(domain|use-cases|adapters)/' },
      to: { path: '^src/lib/domains/[^/]+/queries/' },
    },
    {
      name: 'cross-domain-contract-only',
      severity: 'error',
      from: { path: '^src/lib/domains/([^/]+)/' },
      to: {
        path: '^src/lib/domains/',
        pathNot: [
          '^src/lib/domains/$1/',
          '^src/lib/domains/[^/]+/domain/',
          '^src/lib/domains/[^/]+/use-cases/',
        ],
      },
    },
    {
      name: 'leaf-domains-are-independent',
      severity: 'error',
      from: { path: LEAF_DOMAIN_PATH },
      to: { path: '^src/lib/domains/', pathNot: '^src/lib/domains/$1/' },
    },
    {
      name: 'non-leaves-import-only-leaves',
      severity: 'error',
      from: { path: '^src/lib/domains/([^/]+)/', pathNot: LEAF_DOMAIN_PATH },
      to: {
        path: '^src/lib/domains/',
        pathNot: ['^src/lib/domains/$1/', LEAF_DOMAIN_PATH],
      },
    },
    {
      name: 'the-base-layers-know-no-domain',
      severity: 'error',
      from: { path: '^src/lib/(shared|platform)/' },
      to: { path: '^src/lib/domains/' },
    },
    {
      name: 'routes-are-thin',
      severity: 'error',
      from: { path: '^src/routes/' },
      to: {
        path: '^src/lib/',
        pathNot: [
          '^src/lib/container\\.ts$',
          '^src/lib/context\\.ts$',
          '^src/lib/query-client\\.ts$',
          '^src/lib/shared/',
          '^src/lib/styles/',
          '^src/lib/assets/',
          '^src/lib/components/',
          '^src/lib/domains/[^/]+/ui/',
        ],
      },
    },
    {
      name: 'base-components-know-no-app',
      severity: 'error',
      from: { path: '^src/lib/components/' },
      to: { path: '^src/lib/', pathNot: ['^src/lib/components/', '^src/lib/assets/'] },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: '^[$](app|env)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.svelte-kit|build|node_modules)/' },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.svelte'],
    },
  },
};
```

The `src/lib/` prefix also changes what some rules reach. `routes-are-thin` and `base-components-know-no-app` only match paths under `^src/lib/`, so a route importing a sibling under `src/routes/` (a `+page.svelte` importing its route glue, say) is outside their `to.path` and needs no exemption. And the alternation in `only-the-container-builds-adapters` stays `|^src/`, not `|^src/lib/`, so routes and workers are still caught.

The rows of the [allowed and forbidden table](/architecture/dependency-cruiser-rules/#one-allowed-and-one-forbidden-import-per-rule) that change in SvelteKit, where a component is a `.svelte` file and a view model a `.svelte.ts` file:

| Rule | Allowed | Forbidden |
| --- | --- | --- |
| `queries-know-no-ui-or-wiring` | `cards/queries/cards-queries.ts → cards/domain/card.ts` | `cards/queries/x.ts → cards/ui/card-view.svelte.ts`; `cards/queries/x.ts → container.ts` |
| `only-ui-reads-queries` | `cards/ui/CardData.svelte → cards/queries/cards-queries.ts` | `cards/use-cases/x.ts → cards/queries/cards-keys.ts` |
| `cross-domain-contract-only` | `housekeeping/use-cases/x.ts → cards/use-cases/remove-card.ts` | `housekeeping/ui/x.ts → cards/ui/CardList.svelte` |
| `routes-are-thin` | `routes/+page.svelte → cards/ui/CardList.svelte` | `routes/+page.svelte → cards/use-cases/list-cards.ts`; `routes/+page.svelte → cards/queries/cards-keys.ts` |
| `base-components-know-no-app` | `components/x.ts → ts-pattern` | `components/x.ts → shared/read-state.ts` |
| `no-unresolvable` | `$app/navigation` | `$lib/nowhere/thing` |

I ran this config with dependency-cruiser 18.4.0 over a fixture at these paths with one import for every row of the table, the SvelteKit rows above included. `.svelte` files stood in as `.ts` files, since the rules only read paths. Every allowed import passed, and every forbidden one failed under its own rule.

### Aliases and virtual modules

`no-unresolvable` lets `$app/` and `$env/` through because only SvelteKit's Vite plugin resolves them. The `$env/` modules are virtual, generated by the plugin with no file on disk. `$app` is a Vite alias into `@sveltejs/kit`'s own runtime folder. Neither is in the tsconfig below, so dependency-cruiser can't resolve them.

`tsconfig.depcruise.json` exists only so dependency-cruiser can resolve the SvelteKit aliases:

```json
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": {
      "$lib": ["src/lib"],
      "$lib/*": ["src/lib/*"],
      "$workers": ["src/workers"],
      "$workers/*": ["src/workers/*"]
    }
  },
  "include": ["src/**/*"]
}
```

`$lib` is built in. `$workers` is my own, added through `kit.alias` in `svelte.config.js`. Any alias you add there has to be added here too. If you forget, `no-unresolvable` fails loudly.

`.svelte` goes in `extensions` so an import of a component resolves, and `.svelte-kit/` (SvelteKit's generated output) goes in `exclude`.

### The rest at SvelteKit paths

- The barrel-free imports go through `$lib`:

  ```ts
  import { archiveCard } from '$lib/domains/cards/use-cases/archive-card';
  import type { ArchiveCardDeps } from '$lib/domains/cards/use-cases/archive-card';
  ```

- Adding a leaf domain means adding its name to `LEAF_DOMAINS` at the top of the file, and its folders go under `src/lib/domains/<name>/`. A new domain left out of the list is a non-leaf, held by `non-leaves-import-only-leaves` to its own folders and the leaves.
- A file outside `src/lib/domains/` holding domain knowledge escapes the domain rules, the same gap as on the [rules page](/architecture/dependency-cruiser-rules/#what-path-rules-dont-reach).
- By default the `archi` reporter collapses to one folder below `src/`, so everything under `src/lib/` becomes a single node. To see domains and their parts, set `options.reporterOptions.archi.collapsePattern` to something like `'^src/lib/domains/[^/]+/[^/]+|^src/lib/[^/]+|^src/[^/]+|^node_modules/[^/]+'`.
