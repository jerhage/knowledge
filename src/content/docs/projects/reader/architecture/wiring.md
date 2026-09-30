---
title: Container, Ports and Adapters in the Reader
description: What `container.ts` builds and exposes, the reader's ports and adapters, per-language recognizers loaded on demand, and where the workers sit.
tags: [reader, architecture, typescript, sveltekit, web-workers]
sidebar:
  order: 11
---

The reader's composition root is `src/lib/container.ts`, wired by hand the way [dependency injection and the composition root](/architecture/dependency-injection/) describes, and its outside needs go through [ports and adapters](/architecture/ports-and-adapters/). This page is the real `Container`, the real ports, and where the workers sit.

## `container.ts` and `context.ts`

`container.ts` is the [composition root](/architecture/dependency-injection/#the-composition-root-builds-everything-once). It's the only file that imports concrete adapters, and it sits above every domain and below the routes. `src/lib/context.ts` passes it to the component tree through [Svelte context](/architecture/sveltekit/#the-context-passes-the-container-to-the-component-tree). The root layout, `src/routes/+layout.svelte`, builds it once:

```svelte
provideContainer(buildContainer());
```

A route takes it out with `useContainer()` and passes each domain's group of use cases to what it renders. The storage settings route passes `container.storage` to `StorageScreen`, and `StorageData` inside it, a data component (a component that starts a read and passes the result to what it renders), starts the read. The library route, `/`, builds its write view model from the library group:

```ts
const container = useContainer();
const view = new LibraryView(container.library, notify);
```

`LibraryView` builds two smaller write view models, `BookUpload` and `BookChanges`, and holds nothing else.

The read route joins four domains, so it passes the whole container, together with the query client and the effects only a route can reach, to a route-local class, `ReadSession`, which builds the readers' view models:

```ts
const container = useContainer();
const session = new ReadSession(
  container,
  useQueryClient(),
  toastNotify(getToaster()),
  { fileId: () => page.params.fileId, requested: () => page.url, … },
  (text) => navigator.clipboard.writeText(text),
  …
);
```

What `ReadSession` builds and why it sits beside the route is on [composing domains at the routes](/projects/dokseo/architecture/composing-screens/#the-read-routes-glue-readsession).

A view model is a class in a `*.svelte.ts` file. It holds UI state, a write, or a live resource such as an open book, and never a read: every read belongs to a data component (the split is on [data components and view models](/projects/dokseo/architecture/data-components-and-view-models/#the-split)). A write view model calls use cases through mutations and never calls a port. One that takes the whole container, like `ReaderView`, names its type with `import type { Container } from '$lib/container'`, and a view model imports a use case's module only for a type, like `import type { OpenedUpload, OpenFileFailure, OpenFileResult } from '../use-cases/open-file'`.

## A use case

Each use case takes a deps object and returns its own named union: the success and every outcome I expect, as peers, discriminated on `kind`. Something unplanned, like a broken store or a programmer error, throws instead. That holds even when the use case is one port call. `library/use-cases/mark-unread.ts`:

```ts
type MarkUnreadResult =
  | { readonly kind: 'success'; readonly book: Book }
  | { readonly kind: 'not-found'; readonly id: BookId }
  | StorageUnavailable;

type MarkUnreadDeps = {
  readonly repository: LibraryRepository;
};

async function markUnread(deps: MarkUnreadDeps, id: BookId): Promise<MarkUnreadResult> {
  const found = await deps.repository.get(id);
  if (found.kind !== 'success') return found;
  if (found.book === null) return { kind: 'not-found', id };

  const updated = await deps.repository.update(id, {
    finishedAt: null,
    lastReadAt: null,
    position: startingPlace(found.book),
  });
  if (updated.kind !== 'success') return updated;
  if (updated.book === null) return { kind: 'not-found', id };
  return { kind: 'success', book: updated.book };
}
```

It's stateless, so it tests with a fake repository and no browser. (What `startingPlace` and the other place fields mean is on [reading place](/projects/reader/library/reading-place/).)

## The ports and their adapters

[A port is named for the need, an adapter for the mechanism](/architecture/ports-and-adapters/#ports-are-named-for-the-need-adapters-for-the-mechanism):

| Port (`domain/`) | Adapter (`adapters/`) |
| --- | --- |
| `LibraryRepository` | `indexeddb-opfs-library.repo.ts` |
| `TextRecognizer` | `manga-ocr.adapter.ts`, `paddle-ocr.adapter.ts`, `fake-recognizer.ts` |
| `CaptureRepository` | `capture/indexeddb-captures.repo.ts` |
| `RegionCropper` | `engine/canvas-cropper.ts` |
| `OriginStores` | `browser-origin-stores.ts` |

`LibraryRepository` and `CaptureRepository` have collection semantics, so they get the name. `TextRecognizer` is a service port, named for what it does.

A port returns a union on `kind` too. `LibraryRepository.get` returns a `BookLookup`:

```ts
type BookLookup = { readonly kind: 'success'; readonly book: Book | null } | StorageUnavailable;
```

A missing book is `null` inside the success. Whether a missing book is a problem depends on the operation, so the use case is where it gets a name. The adapter in `indexeddb-opfs-library.repo.ts` implements it like this:

```ts
async get(id: BookId): Promise<BookLookup> {
  if (!recordsAvailable()) return STORAGE_UNAVAILABLE;
  const record = await getRecord<StoredBook>(await database(), BOOK_STORE, id);
  return { kind: 'success', book: record === undefined ? null : bookFromStored(record) };
},
```

There's no `try` in it. An adapter keeps a `try` only around a library call whose failure it translates on purpose, or, in `add`, to delete the blobs it already wrote when the record write fails before it rethrows. The case that matters is a private window: when OPFS is blocked there, `platform/opfs/directory.ts` throws an error with a fixed message, and the adapter's `try` around the file write checks for that message (`isPrivateWindowRefusal`), returns `storage-unavailable`, and rethrows anything else. Rows are mapped outside any `try`, so a corrupt row or a broken database throws, and the throw reaches [a boundary](/projects/dokseo/architecture/use-cases-and-failure/#boundaries-and-logging) instead of turning into an outcome every screen would have to describe.

[Adapters live inside their domain](/architecture/ports-and-adapters/#adapters-live-inside-their-domain-not-in-a-top-level-infrastructure). The payoff is concrete here: widening `TextRecognizer` touches the port, both real adapters and the fake, all in one folder.

Two adapters in one domain may import each other, and that's how they share a database: `flowing/adapters/indexeddb-reading-settings.ts` imports `./flowing-database.ts`. Across domains, what's shared is the capability. IndexedDB backs three databases, so `platform/idb/connection.ts` owns connection handling, and each domain keeps an adapter that speaks its own vocabulary. (The databases themselves are on [storage](/projects/reader/library/storage/).)

## The `Container`

`buildContainer()` builds each adapter once, puts it into the deps objects, and exposes the use cases grouped by domain:

```ts
type Container = {
  readonly beginTrace: TraceFactory;
  readonly library: { readonly markUnread: (id: BookId) => Promise<MarkUnreadResult>; … };
  readonly flowing: { … };
  readonly recognition: { … };
  readonly storage: { readonly readStorageAccount: () => Promise<ReadStorageAccountResult>; };
};
```

```ts
const repository = createLibraryRepository();
const markUnreadDeps: MarkUnreadDeps = { repository };
…
markUnread: (id: BookId) => markUnread(markUnreadDeps, id),
```

[No member is a port](/architecture/dependency-injection/#the-container-exposes-use-cases-never-a-port). The one member that isn't a use case is `beginTrace`, and it's a factory from `platform/trace`, not a port either.

The query factories in each domain's `queries/` folder call these members, but they never name `Container`. `bookQuery` in `library/queries/library-queries.ts` takes `library: Pick<LibraryReads, 'readBook'>`, where `LibraryReads` is a structural type declared in the queries module itself. A data component passes it `container.library`, which fits that type, and a spec passes a plain object. So `queries/` never imports the composition root, and a rule, `queries-know-no-ui-or-wiring`, keeps it that way.

A member can be named for what the reader means while the use case is named for what it does. `container.library.removeBook` runs `storage/use-cases/remove-book-and-captures.ts`. So the partial `library/use-cases/remove-book.ts`, which would leave a book's captures behind, can't be reached from the UI.

Three specs build a whole `Container` by hand, so adding a member is a four-file change. That's on [checks and tests](/projects/reader/engineering/checks-and-tests/#hand-written-container-fakes).

Every route imports the container, which makes it the place a static import [leaks into the entry bundle](/tooling/code-splitting/#a-dependency-container-is-where-a-static-import-leaks). A static import there once pulled 592 kB of codecs into the library screen before it painted a single cover. A dynamic import at the point of use took that route to about 58 kB. The numbers are on [bundles and workers](/projects/reader/engineering/bundles-and-workers/).

## Recognizers chosen per language

A book carries its `language`. The container resolves, per language, the recognizer that reads it, so a use case receives a `TextRecognizer` and never branches on the language. This is the reader's case of [an adapter picked per variant and loaded on demand](/architecture/ports-and-adapters/#an-adapter-picked-per-variant-is-chosen-by-the-container-and-loaded-on-demand).

The container finds the chosen model for the language, matches on the model's `runtime` with `.exhaustive()`, and loads that runtime's adapter through a dynamic import, which keeps the OCR code out of the library screen's bundle:

```ts
async function loadMangaOcrRecognizer(language: Language): Promise<TextRecognizer> {
  const { createMangaOcrRecognizer } =
    await import('./domains/recognition/adapters/engine/manga-ocr.adapter');
  return createMangaOcrRecognizer(noticesFor(language));
}

match(runtime)
  .with('manga-ocr', () => loadMangaOcrRecognizer(language))
  .with('paddle-ocr', () => loadPaddleOcrRecognizer(language))
  .exhaustive();
```

Adding a runtime to `ModelRuntime` fails to compile in exactly one place, `container.ts`. The same pattern loads the EPUB inspector only when an EPUB arrives (`library/adapters/zip-epub-inspector.ts`).

A recognizer owns a worker and a model download, so the container memoizes it per language, in `recognizers: Map<Language, Promise<TextRecognizer>>`. That way a second capture can't start a second worker and a second download. Download progress has the same one-per-language problem: the adapter takes its listener when it's built, so the container keeps a registry, `Map<Language, Set<(fraction: number) => void>>`, that the adapter's own callback fans out to. Why the memo is safe now that the reader closes the worker when it leaves a book, and the ordering rule for the registry, are on [model lifecycle](/projects/reader/recognition/model-lifecycle/).

## Workers

`src/workers/` holds the worker entry points (`ocr.worker.ts`, `paddle-ocr.worker.ts`, `opfs-writer.worker.ts`), their wire protocols and the fetch plumbing. It sits outside `src/lib` and is reached through the `$workers` alias. This is [workers outside the domain tree](/architecture/dependency-injection/#workers-live-outside-the-domain-tree) with real files:

- A worker imports into a domain's `domain/`: `paddle-ocr.worker.ts` decodes with `recognition/domain/engine/ctc-reading.ts`.
- An adapter imports a worker's protocol: `recognition/adapters/engine/worker-recognizer.ts` imports `ocr-worker-protocol.ts`.

Different modules at each end, so no module cycle forms.

`ctc-reading.ts` is the example of [where a file runs is not where it belongs](/architecture/dependency-injection/#where-a-file-runs-is-not-where-it-belongs). Only a worker calls it, but it's pure logic that decodes a model's output, so it lives in `recognition/domain/engine/`. The worker keeps the entry point, the protocol and the I/O.
