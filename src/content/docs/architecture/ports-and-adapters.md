---
title: Ports and Adapters
description: A domain declares what it needs as ports and never imports what provides it, ports are named for the need and adapters for the mechanism, an adapter catches only to translate, adapters live in their domain or in one infrastructure folder, and an adapter picked per variant loads on demand.
tags: [architecture, typescript]
sidebar:
  order: 3
---

Ports and Adapters is Alistair Cockburn's pattern, also called hexagonal architecture ([his article](https://alistair.cockburn.us/hexagonal-architecture/)). The app connects to anything outside it (a database, a device, another program) through a port, and for each outside thing an adapter converts between the port and that thing's API. The point is that the app runs the same whether a person, a test or a script drives it, and it can be built and tested without its real databases and devices.

In the card catalog's layout that means two folders in each domain: `domain/` holds the ports, and `adapters/` holds what implements them. (The adapters can also live in one top-level folder instead; [both options](#adapters-live-inside-their-domain-not-in-a-top-level-infrastructure) are below.) Which adapter a use case gets is decided in one place, the [composition root](/architecture/dependency-injection/).

## `domain/` declares what it needs and never imports what provides it

A domain's `domain/` folder holds two kinds of file. A port is an interface for something the domain needs from outside, like storage: `cards/domain/card-repository.ts` is the port the cards domain uses to read and update cards. An entity is a piece of the domain's data with its pure functions: `cards/domain/card.ts` is the card. None of it touches the browser, so it tests in bare Node.

The cards themselves are stored in IndexedDB, but the port has no mention of it. It's plain TypeScript, written around the operations the domain needs. How IndexedDB performs them doesn't come into it.

The port's return types still list what can happen. Reading a card can find it or find nothing. In a browser the store can also be blocked, for example in a private window. A blocked store is an outcome the caller can do something about (tell the person to open a normal window), so it's a variant of the result. Several domains store things and return the same variant for it, so that variant, `StorageUnavailable` (`{ readonly kind: 'storage-unavailable' }`), lives in the kernel. A missing card is `null` inside the success, and the use case above the port turns it into a named outcome:

```ts
type CardLookup = { readonly kind: 'success'; readonly card: Card | null } | StorageUnavailable;
type CardUpdate = { readonly kind: 'success'; readonly card: Card } | StorageUnavailable;

type CardRepository = {
  readonly get: (id: CardId) => Promise<CardLookup>;
  readonly update: (id: CardId, patch: Partial<Card>) => Promise<CardUpdate>;
};
```

A port with no expected failure leaves the union out and returns `Promise<Card | null>`. Why absence is `null` at a port and a named variant at the use case is on [narrow capabilities](/architecture/capabilities/#absence-at-a-port-is-a-fact-at-a-use-case-it-is-a-variant).

## Ports are named for the need, adapters for the mechanism

Each port gets a name for what the domain needs, and each adapter gets a name for how it provides it. In the card catalog they pair up like this:

| Port (`domain/`) | Adapter (`adapters/`) |
| --- | --- |
| `CardRepository` | `indexeddb-cards.repo.ts` |
| `NoteRepository` | `indexeddb-notes.repo.ts` |
| `Thumbnailer` | `canvas-thumbnailer.ts`, `fake-thumbnailer.ts` |

A port is one interface per file, named for the role it plays. It gets no `I` prefix and no `port` in the file name. I keep `Repository` for ports with collection semantics (get, list, add, remove), like `CardRepository`. A port that does a job instead, a service port, is named for what it does, like `Thumbnailer`. An adapter's file name says what it's built on: IndexedDB, a canvas, or a fake for tests.

"What it's built on" means the store or device the adapter crosses to, not the library it happens to use to get there. Rifty, my Riftbound card app, keeps its cards in SQLite and queries them through Drizzle, an ORM, and its adapter is `SqliteCardRepository`, not `DrizzleCardRepository`. Replacing Drizzle with hand-written SQL would then rename nothing, while moving the cards out of SQLite would rename the adapter, which is right, because that changes what the adapter crosses to.

A port can also be wide or narrow. The card catalog's `CardRepository` is one port with every operation on cards, and every consumer takes all of it. The other option splits it into one narrow port per need (a lister, a finder, a counter), and each consumer takes only the one it uses, so its fake in a test has one method. The repository then survives only as the name for the whole set, which the adapter implements and the composition root builds. Rifty works that way, and [narrow capabilities](/architecture/capabilities/#one-interface-per-need) covers it.

## `adapters/` implements the ports

A domain's `adapters/` folder holds the concrete code behind its ports, like the IndexedDB repository behind `CardRepository`.

Two adapters in the same domain may import each other. Say two of a domain's adapters store their data in the same IndexedDB database: one module opens that database, and both adapters import it to share the handle. (For IndexedDB that sharing is close to required, see [one upgrade module for every adapter on a database](/storage/indexeddb/#adding-a-store-to-a-live-database-is-a-version-bump-and-every-adapter-on-that-database-has-to-move-together).)

Nothing else imports an adapter: not a use case, not a screen, not another domain. The only file that does is the composition root, the one file that builds every adapter and passes each one to the code that needs it. The dependency-cruiser rule for that is `only-the-container-builds-adapters` in [the config](/architecture/dependency-cruiser-rules/#the-configuration).

## An adapter catches only to translate

The IndexedDB adapter behind `CardRepository.get` reads one row from the database and maps it to a `Card`. A few different things can throw along the way: the browser can block storage, the database can break, the row can be corrupt, and the mapping code can have a bug. Only the first is something a caller can act on.

The tempting way to write an adapter is one `try` around the whole operation that turns anything thrown into a `storage-failed` variant. Then all four failures reach the caller as the same answer, and a caller can't do anything useful with it. A bug looks like a storage problem, and on a list, one corrupt row fails the whole list. Dokseo, my manga and book reader, started with exactly that catch-all in every storage adapter.

So an adapter catches only to translate a failure into an expected answer, to clean up after itself, or to recover on purpose. The `try` goes around the one library call whose failure becomes an answer, the row mapping goes outside it, and everything else throws to a boundary ([an unexpected failure throws](/architecture/expected-and-unexpected-failure/#an-unexpected-failure-throws-to-a-boundary)):

```ts
async function get(id: CardId): Promise<CardLookup> {
  let row: CardRow | undefined;
  try {
    row = await readRow(id);
  } catch (cause) {
    if (isPrivateWindowRefusal(cause)) return STORAGE_UNAVAILABLE;
    throw cause;
  }
  return { kind: 'success', card: row === undefined ? null : cardFromRow(row) };
}
```

That check needs the private-window failure to be recognizable. In a Firefox private window, `navigator.storage.getDirectory()` rejects with a `SecurityError`, and other browsers can fail with a different error ([the origin private file system](/storage/origin-private-file-system/#getdirectory-can-throw-in-a-private-window) has the details). I wrap that call once, in the platform module that opens storage, and rethrow a `SecurityError` from it as an `Error` with one fixed message and the original as its `cause`. A worker that touches the same storage reports the same message, so the same failure inside a worker is recognized too. `isPrivateWindowRefusal(cause)` then only compares the message, and the adapter rethrows anything else.

## Adapters live inside their domain, not in a top-level `infrastructure/`

The card catalog nests its adapters inside their domain, in `adapters/`, and so does Dokseo, my manga and book reader. The other option puts every adapter in one top-level `infrastructure/` folder, apart from the domains, and Rifty works that way. The import direction comes out the same either way, because in both layouts the adapter imports the port and the domain never imports the adapter. They differ in what sits next to what.

**Adapters inside their domain.** What this buys:

- A port and its adapters change together, so they sit in one folder.
- Deleting a domain folder deletes its adapters with it.
- The rule that nothing but the composition root imports an adapter can be written once, by path, for every domain (`only-the-container-builds-adapters` in [the config](/architecture/dependency-cruiser-rules/#the-configuration)).

What it costs: code that several domains' adapters share, like opening an IndexedDB database, has no domain to live in. What gets shared is that capability, not an adapter. `platform/idb/connection.ts` owns opening databases, and each domain keeps its own adapter that uses its own vocabulary.

**A top-level `infrastructure/`.** It holds every technology detail in one place: the driver, the schema, the queries, the mappers from stored rows to the domain's types. What this buys:

- One store shared by many domains is set up in one place. Rifty keeps cards, sets, the core rules, decks, bookmarks and notes in one SQLite database with one set of migrations, and all of that sits next to the adapters that query it.
- Rows, driver errors and anything else from the storage library stop at one folder, and no domain file has any reason to import them.
- The edges from `infrastructure/` into the domains show which domains store anything. In Rifty, the two features that store nothing are exactly the two that `infrastructure/` never imports.

What it costs: a port and its adapter live in two folders, and deleting a domain means deleting in both. It also changes what the domain graph shows. `infrastructure/` is one node with an edge to every domain that stores anything, so the dependency on storage belongs to that shared node instead of to each domain. Which domains store can be read off `infrastructure/`'s edges, as above, but a domain's own node no longer shows it. And the layout holds only through two direction rules, which are the ones that break without any error:

- **A domain never imports `infrastructure/`.** Otherwise a use case can reach past its port to the adapter.
- **`infrastructure/` never imports the composition root.** The composition root imports every adapter, so an adapter that reaches back for a setting closes a cycle. Rifty had exactly that: the module that opens its database imported the image host from the composition folder, and the fix was to pass the host in as a parameter (the general move is [inverting an input](/architecture/domains-and-the-graph/#break-a-cycle-by-inverting-an-input-not-by-moving-a-file)).

Rifty's layout, and why I set it up that way, is on [its layers and folders](/projects/rifty/architecture/layers-and-folders/). Dokseo's is on [its container, ports and adapters](/projects/dokseo/architecture/wiring/#the-ports-and-their-adapters).

## An adapter picked per variant is chosen by the container and loaded on demand

Sometimes the right adapter depends on a property of the data: a card's `kind`, a document's language. In the card catalog, a card's images get thumbnails, and a bitmap needs a different thumbnailer from a vector image. The container, the object the composition root builds, resolves that. A use case gets the `Thumbnailer` port and never branches on the property.

The property is a closed union of its possible values. I match on it with ts-pattern's `.exhaustive()` and load each variant's adapter through a dynamic import. A screen that never needs an adapter then never downloads it:

```ts
async function loadSvgThumbnailer(): Promise<Thumbnailer> {
  const { createSvgThumbnailer } = await import('./domains/media/adapters/svg-thumbnailer');
  return createSvgThumbnailer();
}

match(kind)
  .with('bitmap', () => loadBitmapThumbnailer())
  .with('vector', () => loadSvgThumbnailer())
  .exhaustive();
```

With `.exhaustive()`, the code fails to compile while any value of the union has no branch. So adding a variant fails to compile in exactly one place, the container.

The weak spot is the dynamic import. Say someone tidies the container and turns it into a static one: the code still compiles and passes every dependency rule. Only the bundle grows, because every screen now downloads the adapter. So when I touch these, I check the bundle, the way [keeping the bundle small](/tooling/code-splitting/#measure-never-assume) describes. If the adapter is expensive to build (it starts a worker, say), the container memoizes it, and that has its own gotchas in [model workers](/machine-learning/worker-lifecycle/).
