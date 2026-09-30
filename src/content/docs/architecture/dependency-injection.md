---
title: Dependency Injection and the Composition Root
description: One file builds every adapter once and exposes use cases or capabilities, one operation per use-case file returning a named union (or a generic `Result`), time and ids from ports, workers outside the domain tree, and two ways to show two domains on one screen.
tags: [architecture, typescript]
sidebar:
  order: 4
---

Dependency injection means a module receives what it needs as an argument, instead of building it or importing a concrete one itself. Martin Fowler named it in [a 2004 article](https://martinfowler.com/articles/injection.html): a separate assembler fills in the implementation. The place where that assembling happens is the composition root, Mark Seemann's term for "a (preferably) unique location in an application where modules are composed together", as close as possible to the entry point ([his summary](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)).

I wire mine by hand, in both Dokseo, my manga and book reader, and Rifty, my Riftbound card app. `Container` below is a plain object I build myself, not a DI container library. Seemann calls that [Pure DI](https://blog.ploeh.dk/2014/06/10/pure-di/). A library would add registration, lifetimes and resolution errors to replace one function that returns an object. It starts paying for itself when most of the wiring is conditional or deeply nested.

## The composition root builds everything once

`src/container.ts` is the composition root: the only file that imports concrete adapters. It builds each adapter once, wires every use case to what it needs, and returns a `Container`. It sits above every domain and below the routes. (Rifty's composition root is `composition/dependencies.ts`, and it exposes something different, as [below](#the-container-exposes-use-cases-never-a-port) describes.)

Every route imports it, so anything `container.ts` imports statically ends up in the entry bundle that every screen downloads. That's why heavy adapters load through a dynamic import, see [keeping the bundle small](/tooling/code-splitting/#a-dependency-container-is-where-a-static-import-leaks) and [adapters loaded on demand](/architecture/ports-and-adapters/#an-adapter-picked-per-variant-is-chosen-by-the-container-and-loaded-on-demand).

## `use-cases/` has one operation per file

A use case is one operation the app performs, like archiving a card. Each one gets its own file in `use-cases/`, even when the operation is a single port call. I'd rather have one kind of thing sitting above the domain than save a few files.

A use case takes a deps object, which holds the ports it needs, and returns its own named union of outcomes. Archiving a card, for example, needs the card repository and a clock:

```ts
type ArchiveCardDeps = {
  readonly cards: CardRepository;
  readonly now: () => number;
};

type ArchiveCardResult =
  | { readonly kind: 'success'; readonly card: Card }
  | { readonly kind: 'notFound'; readonly id: CardId }
  | StorageUnavailable;

async function archiveCard(deps: ArchiveCardDeps, id: CardId): Promise<ArchiveCardResult> {
  const found = await deps.cards.get(id);
  if (found.kind !== 'success') return found;
  if (found.card === null) return { kind: 'notFound', id };

  return deps.cards.update(id, { archivedAt: deps.now() });
}
```

It's stateless. Everything it needs comes in through the deps object, so a test just passes a fake. That deps object is the injection: the use case names the ports it needs, and the container supplies what fills them.

The union lists the success, named for what it holds, and every expected outcome beside it. The repository's `get` returns `null` inside its success for a missing card, because at a port, absence is one fact. The use case is where that fact becomes a named outcome, `notFound`. An unavailable store is expected too: in a private window, for example, the browser can block storage, and the screen can tell the person why nothing loads. So `get` returns it as a `StorageUnavailable` variant, a type in the kernel because every domain that stores anything can return it. `archiveCard` passes that variant up with `if (found.kind !== 'success') return found;`, and returns `update`'s answer as it is, because every variant of it is also a variant of `ArchiveCardResult`.

That one line is still checked. After the `if`, `found` is narrowed to `get`'s other variants, and they have to fit `ArchiveCardResult`. If `get` gains a variant the union doesn't name, the `return` stops compiling until the union names it or the use case handles it. So I pass outcomes up by narrowing, and write a match only where an outcome gets a new name or a meaning of its own.

A store that broke is a different case from an unavailable one. Nothing a caller does can fix it, so the adapter throws, up to an error boundary that reports it, and the union never mentions it. An operation can also have more than one success, like `added` and `alreadyHeld` for adding something that may already be there, each with its own name. What a named union buys is that every outcome is named for what it means, and a caller that matches on `kind` exhaustively fails to compile when a new outcome is added. What it costs is a type per use case. Which failures belong in the union and which ones throw is on [expected and unexpected failure](/architecture/expected-and-unexpected-failure/). Both of my apps work this way; Rifty's use cases are on [use cases, results and failure](/projects/rifty/architecture/use-cases-and-failure/).

The other option is a generic `Result<T, E>`: one type for every use case, with an `ok` flag that indicates whether it worked, a value when it did, and an error from the domain's error union when it didn't. What it buys is one return type everywhere, and a failure passes up in one line, `if (!found.ok) return found`. What it costs is that `ok` only has two values. An operation with several legitimate outcomes has to fit all but one of them into the error side, next to the failures nobody expected, and the type doesn't distinguish one kind from the other. Dokseo started this way. Every storage adapter returned a catch-all "storage failed" variant, so it ended up in every domain's error union, and that's what moved Dokseo to named unions ([result types](/architecture/result-types/)).

## Time, ids and randomness come from ports

An app with no server still has a boundary. Besides its storage, it reads the device clock, makes new ids, draws random numbers and writes logs. Each of those makes a test slow, flaky or dependent on the order tests run in, if the code calls it directly.

So each one is a port too: a clock, an id generator, a random source and a logger. No domain owns them, and every domain may need them, so in the card catalog's layout they sit in the kernel. (Rifty gives them a layer of their own, `application/ports/`, which imports no feature.) `now` in `archiveCard` above is already one. The container passes the real clock, and a test passes a fixed one.

The payoff is a deterministic test. A use case that stamps a creation time and makes a new id would otherwise produce a different card on every run, and a test that asserts on either value would have to freeze the machine's clock. With a fixed clock and an id generator that returns ids in sequence, the test can assert on exactly what the use case produces. Shuffling works the same way: a shuffle takes the random function as a parameter, so a test can pass one that always returns the same sequence.

The alternative, calling `Date.now()` and `crypto.randomUUID()` directly, is simpler until the first test that asserts on a timestamp. A handful of ports like these is a small price.

I use the same reasoning to pick the type of a timestamp. If a timestamp in the model is a string produced only by the clock port, the port is the one place timestamps come from. A `Date` in the model makes it easy to call `new Date()` anywhere, which reads the machine clock and skips the port. Rifty keeps its timestamps as ISO strings for this reason ([capabilities, adapters and the composition root](/projects/rifty/architecture/capabilities-and-composition/)).

## The container exposes use cases, never a port

The function in `container.ts` that builds everything creates each adapter, puts it into the deps objects, and returns the `Container`: one group per domain, holding that domain's use cases with their deps already filled in. A screen calls a use case and never has a reference to a repository.

```ts
type Container = {
  readonly cards: {
    readonly listCards: () => Promise<ListCardsResult>;
    readonly archiveCard: (id: CardId) => Promise<ArchiveCardResult>;
  };
  readonly annotations: { … };
  readonly housekeeping: {
    readonly removeCard: (id: CardId) => Promise<RemoveCardResult>;
  };
};

function buildContainer(): Container {
  const cards = createCardRepository();
  const archiveCardDeps: ArchiveCardDeps = { cards, now: Date.now };
  …
  return {
    cards: {
      archiveCard: (id: CardId) => archiveCard(archiveCardDeps, id),
      …
    },
    …
  };
}
```

No member is a repository, so a view model or a data component can't call one. The compiler reports an error, so nobody has to catch it in a code review. The same holds for a member that isn't a use case, like a factory the UI calls to create some object: it still must not be a port.

A member can have a different name from the use case behind it. Take removing a card. A card's notes live in another domain, so removing a card involves two use cases: one in the cards domain that removes only the card, and one in the housekeeping domain that removes the card and its notes together. The container member is named for what the person using the app means, `removeCard`. The use case behind it is named for what it actually does, `removeCardAndNotes`. The partial operation (removing a card but leaving its notes) has no member, so it can't be reached from the UI at all.

Since `Container` is a structural type, adding a member breaks every hand-written fake of it, and only the type check reports it. More on that in [fakes and async ticks](/testing/fakes-and-async/#widening-a-composition-root-type-breaks-every-hand-written-fake-and-only-the-type-check-reports-it).

Exposing use cases is one option, and Dokseo works this way ([its `Container`](/projects/dokseo/architecture/wiring/#the-container)). The other option is a composition root that exposes capabilities, the ports themselves, grouped by domain. The route takes the ports a screen needs and passes them down, and the code that runs the operation builds the use case's deps object right where it calls it:

```ts
type AppDependencies = {
  readonly cards: { readonly cardRepository: CardRepository };
  readonly now: () => number;
};

// below the route, where the archive button's operation runs
const result = await archiveCard({ cards: cardRepository, now }, id);
```

Rifty works this way, and the code that calls the use case is a [data component](/architecture/data-components/). What it buys is a composition root that stays small (it grows with the adapters, not with every use case), and a use case's deps that are built from exactly the ports passed to the caller. What it costs is the guarantee above. A member of `AppDependencies` is a port, so nothing in the type system stops a screen from calling `cardRepository.update` directly and skipping the use case. "Call a use case, never a port" becomes a convention that review has to hold. Rifty's version is on [capabilities, adapters and the composition root](/projects/rifty/architecture/capabilities-and-composition/).

When reads go through a query cache, the choice also sets what a query factory takes. A query factory is the function that builds the options for one read: its cache key and the function that loads it. Side by side:

| | Ports at the boundary (Rifty) | Use cases from the composition root (Dokseo) |
| --- | --- | --- |
| Can a screen call a port? | yes, by type; review has to stop it | no, the type has no port |
| Are a use case's dependencies visible where it's called? | yes | no, they're in the composition root |
| Adding a dependency to a use case | changes props up to the route | changes one line in the composition root |
| The wiring file | small | large: each use case needs its deps object, its member in `Container` and the line that binds them |
| What a query factory takes | the ports | a structural type of only the use cases it calls, so the queries module never imports the composition root |

The last row matters for the graph. A factory in the cards domain declares the use cases it calls as its own type, say `CardReads`, with `listCards` and `readCard`, and `container.cards` fits that type without either file importing the other.

## The context passes the container to the UI tree

The root of the UI builds the container once and puts it where every screen can reach it. `src/context.ts` does that with whatever the UI framework offers for passing a value down a component tree. (The Svelte version is in [applying it in SvelteKit](/architecture/sveltekit/#the-context-passes-the-container-to-the-component-tree).)

When reads go through a query cache, the cache is built once too. `src/query-client.ts` sits beside the container and builds the cache with the app's global policy: whether failed reads are retried, how long unused data stays cached, whether reads refetch when the window regains focus or the network comes back, and the network mode. The root of the UI builds both and provides the cache to the tree with the library's provider component.

A route takes the container out. It passes one domain's group of use cases (`container.cards`) to the [data components](/architecture/data-components/) it renders, and the container to the view models it builds. A view model names its type with `import type { Container }` from `container.ts`. That's a type edge down into the root. The root never imports a `ui/` module, so no cycle.

With a composition root that exposes capabilities, the context holds the dependencies object instead, and a route passes each data component the ports it needs as props.

## Workers live outside the domain tree

Some work runs in a web worker, off the main thread. A worker is started from an adapter, and the two exchange messages. `src/workers/` holds the worker entry points, their message protocols (the types of the messages each side sends) and the I/O plumbing, outside `src/domains/`.

A worker may import `kernel/`, `platform/` and a domain's `domain/`, never an adapter. An adapter that starts a worker imports the worker's protocol type. So the domain imports into `src/workers/` and `src/workers/` imports into the domain, which looks like a cycle. It isn't one, because the two edges have a different module at each end: the adapter imports the protocol, and the worker entry imports a `domain/` file. (How I manage a long-lived adapter that owns a worker is in [model workers](/machine-learning/worker-lifecycle/).)

## Where a file runs is not where it belongs

Say a worker needs a pure function of domain knowledge that only it ever calls. It's tempting to put that function in `src/workers/` next to its only caller. It still goes in that domain's `domain/`. The domain rules only govern paths under `src/domains/`, so knowledge parked in `src/workers/` escapes them. The worker keeps the entry point, the protocol and the I/O, and nothing else.

## Two domains meet at the route, not inside each other

Some screens show two domains at once. The card details screen shows a card from `cards` and its notes from `annotations`. Dokseo puts them together at the route ([its read route](/projects/dokseo/architecture/composing-screens/)), and most of this section describes that option: no domain imports another domain's `ui/`, so neither domain's view can pull in the other. Instead the route, the screen's entry point, builds both and connects them. In a way the route is a small composition root for that screen: the one place that imports both domains, the same way `container.ts` is the one place that imports every adapter. I connect them with a slot, a callback, or a need declared in one domain and supplied by another.

**A slot the route fills.** A slot is a place in a view that the view leaves empty for its caller to fill. If the card details view imported the annotations list, `cards` would depend on `annotations`. Instead the view exposes a slot, and the screen that shows both fills it with the annotations list. How a slot looks depends on the UI framework. The Svelte version is in [applying it in SvelteKit](/architecture/sveltekit/#a-slot-filled-with-a-snippet).

**A callback.** The card details view reports "this passage was selected" through an `onSelect` callback it takes from outside, and the route passes it to `annotations`:

```ts
// in the route, the only place that sees both domains
const onSelect = (range: TextRange) => notes.add(card.id, range);
```

`cards` has no reference to notes. It calls a function passed in from outside.

**A cross-domain refresh is a callback too.** Say a write in `cards` changes what a storage screen in `housekeeping` reads, and that screen's read is cached. After the write, the cached read has to be refreshed. The write can't do that itself: it would have to import `housekeeping`'s query keys, an edge from one domain into another. So whatever owns the write takes an `onCardChanged` callback, and the route implements it by refreshing `housekeeping`'s read.

**A need declared in one domain, supplied by another.** A note records where on its card it's attached. `annotations` has to order notes by that position, whose format only `cards` defines. `annotations` can't import `cards`, so it declares the need as a type in its own `domain/`:

```ts
type PositionOrder = (earlier: string, later: string) => number;
```

`cards/ui/position-order.ts` implements it, and the route passes one into the other: it renders the notes data component with `order={comparePositions}`. That's dependency injection again, one level up: a port declared by one domain, filled at the route by another.

A view that pulls in the feature it's supposed to host creates a cycle. Exposing a slot and composing at the screen layer fixes it.

**Glue between domains lives beside the route.** Sometimes a route builds view models from several domains and has to join them: a value derived from two of them, an ordering across both, or callbacks from one into the other. That join goes in a view model local to the route, next to the route file (in SvelteKit, `routes/cards/[id]/card-session.svelte.ts`). It builds the parts, exposes them, and holds only what needs more than one domain. The same rules that keep a route thin cover it. The framework's navigation (in SvelteKit, `page`, `goto` and `replaceState`) stays in the route and reaches the session as an object of getters and callbacks, so a unit test can build the session without the framework.

What this option buys is that neither domain imports the other, and under [the leaf rule](/architecture/domains-and-the-graph/#leaves-and-non-leaves) it's the only option, since one leaf can't import another. What it costs is that the coupling moves instead of going away: the route now imports both domains. And the code of a view that takes a slot no longer names what it shows. Reading the card details view, you see an empty place, not the notes.

**The other option: a domain may show UI another domain exports for its own types.** Under [a cycle check on the domain graph](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself), domains can import each other in one direction. Say `collections` imports `stats` (the two domains from [inverting an input](/architecture/domains-and-the-graph/#break-a-cycle-by-inverting-an-input-not-by-moving-a-file)). Then `stats` may export a panel that renders its own cost curve, and the collection view in `collections` imports that panel and shows it, with no slot and no route in between. The rule is that a domain may export UI for its own types and may not borrow another domain's UI for types that aren't its own. Rifty works this way: its deck screens import the analysis feature's panels directly ([where a concept lives](/projects/rifty/architecture/ownership-and-placement/)).

What it buys is that the view's code names what it renders, and the edge is where the graph check detects it. What it costs is that the edge fixes a direction: once `collections` imports `stats`, nothing in `stats` can ever show anything from `collections`. And where the edge already runs the other way, the route is still the only place. In Rifty the annotation feature imports the card feature, so the card details screen takes the bookmark control and the notes as slots, and the route fills them. I'd use the slot on purpose, too, where the hosted part is optional or could be swapped for another. [Which domain owns a concept](/architecture/placing-a-concept/#a-domain-may-expose-ui-for-its-own-types-never-borrow-anothers) has the rule in full.
