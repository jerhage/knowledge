---
title: Use Cases, Results and Failure in Dokseo
description: Each use case's named union, what a port and an adapter return, how a result reaches the screen, and where an unexpected failure ends up.
tags: [dokseo, architecture, typescript, error-handling, tanstack-query]
sidebar:
  order: 15
---

Dokseo, my manga and book reader, splits failures into two kinds, the way [expected and unexpected failure](/architecture/expected-and-unexpected-failure/) describes. An expected failure is one a caller can act on: the book was removed in another tab, or the browser blocks storage in a private window. It's a named variant of what the use case returns. An unexpected failure is a broken store, a corrupt row or a bug in my code. It throws, and a boundary catches it, logs it and shows a generic message. The rules themselves are on that page. Rifty's version of the same rules is on [Rifty's use cases, results and failure](/projects/rifty/architecture/use-cases-and-failure/).

## A named union per use case

A use case is one operation in one file under a domain's `use-cases/` folder. It takes a deps object with the ports it needs and returns its own union, discriminated on `kind`: the success and every expected outcome are peers. `library/use-cases/mark-unread.ts` resets a book to unread:

```ts
type MarkUnreadResult =
  | { readonly kind: 'success'; readonly book: Book }
  | { readonly kind: 'not-found'; readonly id: BookId }
  | StorageUnavailable;

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

`StorageUnavailable` is `{ readonly kind: 'storage-unavailable' }`, in the kernel at `shared/storage-unavailable.ts`, because use cases in `library`, `recognition`, `flowing` and `storage` all return it. The success names what it holds (`book`), and an operation can have more than one success: `openFile` returns `added` or `already-held`, and both are fine outcomes of adding a file.

`if (found.kind !== 'success') return found;` passes the port's other outcomes on without a `match()`. That's still checked: after the `if`, `found` is narrowed to what's left of the port's union, and returning it has to type-check against `MarkUnreadResult`. If the port gains a variant, the `return` fails to compile until `MarkUnreadResult` names it, which is the same guarantee `match().exhaustive()` gives. So I narrow to pass outcomes on, and use `match()` where each outcome means something different.

Dokseo used a generic `Result<T, E>` before; why it moved is on [how Dokseo moved from view models to data components](/projects/dokseo/architecture/from-view-models-to-data-components/).

## What a port and an adapter return

A port returns a union too, where it has an expected outcome. The library's repository, `LibraryRepository` in `library/domain/book/library-repository.ts`, returns this from `get`:

```ts
type BookLookup = { readonly kind: 'success'; readonly book: Book | null } | StorageUnavailable;
```

A missing book is a `null` inside the success, not a variant. The port reports only whether a book was there, and the use case names the absence: `markUnread` turns it into `not-found`, while `readCover` passes a missing cover on as `null`.

The adapter, `library/adapters/indexeddb-opfs-library.repo.ts`, catches as little as possible. It maps rows outside any `try`, so a corrupt row or a bug in the mapping throws:

```ts
async get(id: BookId): Promise<BookLookup> {
  if (!recordsAvailable()) return STORAGE_UNAVAILABLE;
  const record = await getRecord<StoredBook>(await database(), BOOK_STORE, id);
  return { kind: 'success', book: record === undefined ? null : bookFromStored(record) };
},
```

It keeps a `try` only around a library call whose failure it translates, plus one in `add` that deletes the blobs it already wrote when the record write fails, then rethrows. The one translation is the private window. In a private window, some browsers don't allow OPFS: `navigator.storage.getDirectory()` throws a `SecurityError`. `platform/opfs/directory.ts` rethrows that as `new Error(PRIVATE_WINDOW, { cause })`, and the OPFS writer worker reports the same message. An adapter that reads or writes OPFS recognizes it by that message with `isPrivateWindowRefusal(cause)` and rethrows anything else:

```ts
async function unlessRefused<T>(work: () => Promise<T>): Promise<T | StorageUnavailable> {
  try {
    const done = await work();
    return done;
  } catch (cause) {
    if (isPrivateWindowRefusal(cause)) return STORAGE_UNAVAILABLE;
    throw cause;
  }
}
```

The library returns `storage-unavailable` for it, and the model part-files (`recognition/adapters/model/opfs-partial-downloads.ts`) return `partials-unavailable`. On screen, the library's text for it ends with the advice from `shared/storage-unavailable.ts`: "A private window does not save files, so open the library in a normal window to add a book."

## A read resolves its union, and the data component flattens it

A read reaches the screen through a query, owned by a [data component](/projects/dokseo/architecture/data-components-and-view-models/). The query factory resolves with the use case's union, so an expected outcome is cached like any other result, and the query rejects only when the use case throws. TanStack Query's rejection channel then holds only the unexpected failures, and a `not-found` isn't read again on every mount the way a rejected query would be.

`readQuery` turns the query into `ReadState<T>`: `loading`, `failed` (the read couldn't complete) or `ready` with the value. The use case's union ends up inside `ready.value`. A data component whose use case has outcomes besides success doesn't match a failure inside a success branch. It flattens `ReadState<ReadBookResult>` into its own union, with each outcome as a peer of `loading` and `failed`, in a pure function with its own spec. `bookReadOf`, in `library/ui/book-read.ts`:

```ts
type BookRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly book: Book };

function bookReadOf(state: ReadState<ReadBookResult>): BookRead {
  return match(state)
    .with({ kind: 'loading' }, () => BOOK_LOADING)
    .with({ kind: 'failed' }, (failed): BookRead => failed)
    .with({ kind: 'ready', value: { kind: 'not-found' } }, () => NO_BOOK)
    .with({ kind: 'ready', value: { kind: 'storage-unavailable' } }, (): BookRead => ({
      kind: 'failed',
      message: LIBRARY_UNAVAILABLE,
    }))
    .with({ kind: 'ready', value: { kind: 'success' } }, ({ value }): BookRead => ({
      kind: 'ready',
      book: value.book,
    }))
    .exhaustive();
}
```

A blocked store becomes `failed` with the library's private-window text, which is what the screen showed before the cache existed. The other flatteners do the same for their reads: `shelfState` for the shelf, `storedCaptures` and `storedTags` for captures and tags, `setupState` for the OCR engine's setup, `shownStorage` for what a model occupies.

A union with only a success variant has nothing to flatten. `readStorageAccount` and `readReadingSettings` return only `{ kind: 'success'; … }`, so their factories resolve with what the success holds (`read.account`, `read.settings`), and no consumer has to reach through the wrapper.

Covers show why absence and failure have to stay apart. The covers query is cached with `staleTime: Infinity`, so whatever it resolves with stays until the next library write. `readCover` returns `{ kind: 'success'; cover: Blob | null }`: a book without a cover is a `null`, and a broken store throws. The query leaves the `null` covers out and rejects on a throw, so a failure isn't cached as "this book has no cover", and the next mount reads again.

## A write resolves its union too

A write is a mutation, owned by a [write view model](/projects/dokseo/architecture/data-components-and-view-models/#writes). Its `mutationFn` returns the use case's union untouched, so the owner's `run()` resolves with any outcome and rejects only on a throw. `BookChanges` (in `library/ui/book-changes.svelte.ts`) runs every library change through one method:

```ts
async #change<S extends { readonly kind: 'success' }>(
  change: BookChange,
  title: string,
  run: () => Promise<S | LibraryRefusal>,
): Promise<S | null> {
  this.#state = change;
  try {
    const changed = await run();
    if (changed.kind === 'success') return changed;
    this.#fail(title, describeLibraryRefusal(changed));
    return null;
  } catch {
    return null;
  } finally {
    this.#state = NO_CHANGE;
  }
}
```

An expected outcome is described where it's read: `describeLibraryRefusal` gives "That upload is no longer in your library." for `not-found`, and the private-window text for `storage-unavailable`. A throw is reported by the mutation's `onError`, which shows the same title with `failureMessage(cause)`: "Something went wrong: …" for anything that isn't a `QueryFailure`. The `catch` in `#change` only stops a rejection that `onError` already reported. It never turns a throw into a storage message, because that would show a bug in my code as a storage problem.

The same split reaches a command that needs a read's value. Before a recognition starts, the consent gate needs the model chosen for the language, which comes from the setup query. The gate doesn't read the cache itself: `EngineGateData` holds the read and passes it on as a `ReadState`, and `chosenFootprint` (`recognition/ui/engine/chosen-footprint.ts`) turns it into the chosen model:

```ts
function chosenFootprint(
  language: Language,
  state: ReadState<LanguageSetupRead>,
): ReadState<ModelFootprint | null> {
  return match(state)
    .with(
      { kind: 'loading' },
      { kind: 'failed' },
      (unread): ReadState<ModelFootprint | null> => unread,
    )
    .with({ kind: 'ready', value: { kind: 'success' } }, ({ value }) =>
      readReady(value.setup.selected === null ? null : chosenModel(language, value.setup.selected)),
    )
    .with({ kind: 'ready', value: { kind: 'storage-unavailable' } }, () =>
      readReady(chosenModel(language, null)),
    )
    .exhaustive();
}
```

The setup query resolves `storage-unavailable` as data, so a blocked store arrives as `ready` and leads to the language's default model. A read that threw arrives as `failed` and stays `failed`, and the gate stops the capture and shows a danger notice, "Text recognition could not start", with the read's message. When the gate read the setup by awaiting the cache and catching the rejection, a throw took the same path as a blocked store, because a `.catch` gets every rejection alike. A command gets an expected outcome and a failure as different states only when the factory resolves that outcome as data; the rejection channel holds no reason worth branching on. The gate's steps are on [the model's lifecycle](/projects/dokseo/recognition/model-lifecycle/#a-consent-dialog-before-a-download).

## Data checked where it arrives

The route id is the first arrival. The read route's URL is `/read/[fileId]`, and `parsedBookId` in `shared/ids.ts` checks the raw string before it becomes a `BookId`:

```ts
function parsedBookId(raw: string): BookId | null {
  const flat = raw.length > 0 && !raw.includes('/') && !raw.includes('\\') && !raw.includes('..');
  return flat ? bookId(raw) : null;
}
```

`ReadSession` derives its id from it, and when the id is `null`, `navigate()` sends the reader back to the library at once without reading anything. The repository's own key check (`blobKeys`) now throws, because an id that reaches it unparsed is a bug.

Stored rows are the second. IndexedDB returns whatever was stored, typed as the row type with no check, so `bookFromStored` in `library/domain/book/stored-book.ts` checks every stored enum, with a choice per field:

```ts
function bookFromStored(stored: StoredBook): Book {
  const layoutKind = knownStoredValue('book', 'layout kind', stored.layoutKind, isLayoutKind);
  return {
    ...stored,
    language: isLanguage(stored.language) ? stored.language : FALLBACK_LANGUAGE,
    layoutKind,
    direction: isReadingDirection(stored.direction) ? stored.direction : FALLBACK_DIRECTION,
    sourceKind: knownStoredValue('book', 'source kind', stored.sourceKind, isSourceKind),
    pagePairing: isPagePairing(stored.pagePairing) ? stored.pagePairing : DEFAULT_PAGE_PAIRING,
    pageFit: isPageFit(stored.pageFit) ? stored.pageFit : defaultPageFit(layoutKind),
    …
  };
}
```

`language`, `direction`, `pagePairing` and `pageFit` fall back to a default. `layoutKind` and `sourceKind` have no safe default, so `knownStoredValue` in `shared/corrupt-row.ts` throws a `CorruptRow` naming the row, the field and the value. `captureFromStored` does the same: an unknown origin falls back to `recognized`, and an unknown anchor kind throws. How the checks compile without a cast is on [storage](/projects/dokseo/library/storage/).

A book record whose file is gone from OPFS is corrupt state too. Opening it returns `source-missing`, and the reader shows "The file of this book is missing from this device. Remove the book and add it again." It isn't treated as a removed book, so the reader isn't sent back to a library that still lists it.

Worker replies and model outputs are still trusted, each through a named assertion. Worker replies are typed (`MessageEvent<OcrReply>` in `worker-recognizer.ts`) and never checked; both ends are my code and share the protocol type, so the risk is a cached worker of an older version. Model outputs reach the decoders through `logitsOf` and `ctcLogitsOf` in the workers, casts with a name. A model with a different output layout would fail inside the decode with an unhelpful message.

## Boundaries and logging

A boundary is a place that catches a failure without translating it: it logs it and shows something generic. Dokseo has one for each way a failure can travel:

| Failure | Boundary | What happens |
| --- | --- | --- |
| a read throws | the data component's `failed` branch | `failureMessage` logs it and returns "Something went wrong: …" (a `QueryFailure` shows its own message) |
| a write throws | the mutation's `onError` | a danger toast with `failureMessage`'s text |
| rendering throws | `<svelte:boundary>` in `routes/+layout.svelte` | logs it, shows the message with a "Try again" button |
| a stray throw or rejection | `<svelte:window onerror onunhandledrejection>` in the same layout | logs it, raises one danger toast |
| navigation fails | `handleError` in `src/hooks.client.ts` | logs it |

The root layout holds the two in the middle:

```svelte
<svelte:window
  onerror={(event) => failures.raise('window', windowErrorCause(event))}
  onunhandledrejection={(event) => failures.raise('promise', event.reason)}
/>

<QueryClientProvider client={queryClient}>
  <svelte:boundary onerror={(error) => logUnexpected('render', error)}>
    {@render children()}

    {#snippet failed(error, reset)}
      <EmptyState variant="fill" live message={unexpectedMessage(error)} class="min-h-screen">
        {#snippet action()}
          <Button variant="primary" size="sm" onclick={reset}>Try again</Button>
        {/snippet}
      </EmptyState>
    {/snippet}
  </svelte:boundary>
</QueryClientProvider>
```

Every boundary logs through one function, `logUnexpected(site, error)` in `shared/unexpected-failure.ts`, which calls `console.error` with the site (`navigation`, `render`, `query`, `write`, `window` or `promise`) and the original error, stack included. `UnexpectedFailures.raise` logs too, and shows a new toast only when its last one is no longer showing, so a burst of failures raises one toast. `failureMessage` logs anything that isn't a `QueryFailure`. A `QueryFailure` is the error a query factory throws with a described message, such as "The engine choice could not be read: …"; it shows that message as it is, and keeps the original error on its `cause`.

The window's `onerror` needs care. Svelte's element types (checked in `svelte/elements.d.ts`, Svelte 5.57) type `onerror` on `<svelte:window>` as a handler for a plain `Event`, so `event.error` doesn't type-check, while `onunhandledrejection` gets a `PromiseRejectionEvent` with its `reason`. `windowErrorCause` reads the thrown value without a cast:

```ts
function windowErrorCause(event: Event): unknown {
  return 'error' in event ? event.error : event;
}
```

I used `in` rather than `instanceof ErrorEvent` because it narrows without a cast and still runs in a Node spec, where `ErrorEvent` may not exist.

One cost I accepted: `failureMessage` logs every time a data component's state is computed from a failed read, so the same failure can appear in the console more than once.

## The model download's HTTP

The OCR model's weights download in a worker, in byte ranges that resume after a pause (`workers/resumable-fetch.ts`). Every response goes through `checkedResponse` from `platform/http/http-error.ts`, which returns it when the status is a success or one in the list the caller passes, and otherwise throws an `HttpError` with the status, method and URL. A range request should come back `206`, and when the part-file already holds bytes, the list also holds `416`, the status for a range that starts past the end of the file. The PaddleOCR worker checks its dictionary fetch the same way. Files other than the weights pass through untouched, because transformers.js reads their status itself and treats a `404` for an optional file as absence. Dokseo doesn't retry a failed download. The rest is on [model lifecycle](/projects/dokseo/recognition/model-lifecycle/).
