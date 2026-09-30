---
title: Data Components and View Models in Dokseo
description: How a read becomes a query owned by a data component, how a write becomes a mutation owned by a write view model, and what a view model is still for.
tags: [dokseo, architecture, svelte, svelte-5, tanstack-query]
sidebar:
  order: 14
---

Dokseo, my manga and book reader, keeps everything on the device: book files in OPFS, records in IndexedDB, model weights in the Cache API. A screen reaches that data through use cases, which [the container](/projects/dokseo/architecture/wiring/) builds once and groups by domain (`container.library`, `container.recognition` and so on). Between a use case and the markup sits a cache: TanStack Query, through its Svelte adapter `@tanstack/svelte-query` 6.3.0.

The Svelte mechanics of that setup are on [data components in Svelte](/svelte/data-components/) and [what the svelte-query cache does](/svelte/svelte-query/), and the reasons for splitting screen state this way are on [data components](/architecture/data-components/). How Dokseo got here from one view model per screen is on [how Dokseo moved from view models to data components](/projects/dokseo/architecture/from-view-models-to-data-components/).

## The split

A Dokseo screen deals with three kinds of state: data read from storage, writes back to storage, and state that only exists in the UI, such as a sort order, a search cursor or a page's zoom. Each kind has one kind of owner:

- **A read is a query, and a data component owns it.** A query factory in the domain's `queries/` folder names the cache key and calls the use case. A component named `<Thing>Data.svelte` starts the query with `readQuery`, and either draws the loading and failed states itself or passes its children a union that names them.
- **A write is a mutation, and a write view model owns it.** The mutation factory holds only a `mutationFn` that resolves with the use case's union. The view model adds `onMutate`, `onSuccess`, `onError` and `onSettled`, and does the cache work.
- **A view model holds UI state, a write with steps, or a live resource the cache must not hold.** Examples of the last: the open `PageSource` in `ReaderView`, the foliate surface in `FlowView`, the worker session in `EngineWarmup`, the recognition waiting for consent in `ConsentGate`. No view model holds a read, a generation counter for a read, or a `reload()`.

Sometimes a command needs a cached value at the moment it runs. Before a recognition starts, `ConsentGate` has to check whether consent for the model is stored, and `EngineWarmup` whether the model's weights are on disk. When an ebook opens, `FlowView.open` needs the reading settings. No command reads the cache for them. Each one gets the value from a data component: `ConsentGate` and `EngineWarmup` from `EngineGateData` as read states, and `FlowView.open` from `ReadingSettingsData` as an argument. Both data components are in [the kinds of data component](#the-kinds-of-data-component) below, and the general pattern is on [app code never reads the cache imperatively](/svelte/svelte-query/#app-code-never-reads-the-cache-imperatively).

A tool checks only part of this: three [dependency-cruiser rules](/projects/dokseo/architecture/dependency-rules/) keep the imports of the `queries/` folders in line. That a data component holds every read and no view model holds one is a convention.

## The `queries/` folder

Each domain that reads or writes through the cache has two files in `queries/`: `<domain>-keys.ts` for the cache keys and `<domain>-queries.ts` for the factories. `storage`, `library`, `recognition` and `flowing` have both. `viewing` has only `viewing-queries.ts`, with mutations and no reads. The library's keys, `library/queries/library-keys.ts`:

```ts
const ALL = ['library'] as const;

const libraryKeys = {
  all: () => ALL,
  books: () => [...ALL, 'books'] as const,
  book: (id: BookId | null) => [...ALL, 'book', id] as const,
  covers: (ids: readonly BookId[]) => [...ALL, 'covers', ids] as const,
  size: () => [...ALL, 'size'] as const,
};
```

Every key starts with the domain's `all()`, so one call can mark everything the library caches as stale. That's `refreshLibrary` in `library/ui/library-refresh.ts`:

```ts
function refreshLibrary(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: libraryKeys.all() });
}
```

A query factory takes the use cases it calls as a parameter, typed with a structural type declared in the same module (`LibraryReads`, `StorageReads`, `EngineReads`) and narrowed with `Pick`. It never takes a port and never the `Container` type, so `queries/` doesn't import the composition root, and a spec can pass a plain object. A data component passes the container's group for its domain. `bookQuery` in `library-queries.ts` reads one book for the read route:

```ts
function bookQuery(library: Pick<LibraryReads, 'readBook'>, id: BookId | null) {
  return queryOptions({
    queryKey: libraryKeys.book(id),
    queryFn: id === null ? skipToken : () => library.readBook(id),
    staleTime: 0,
  });
}
```

The `id` is `null` when the route's URL doesn't hold a valid book id. Instead of an `enabled` flag beside a made-up id, the factory passes TanStack's `skipToken` in place of the query function. The query then stays pending, which `readQuery` shows as loading, and the key holds the real `null`. TanStack doesn't allow a `refetch()` on a query disabled through `skipToken`, so `BookCapturesData`, which reads a book's captures the same way, reloads them only while a book is open.

Each factory also sets its own `staleTime`, because the client sets none. Most reads use `0`: a screen that mounts again shows the cached value at once and reads the store again behind it. Two use `Infinity`. One is `coversQuery`: covers change only when the library is written, and every library write invalidates `libraryKeys.all()`, which includes the covers. The other is `computeQuery`, the check for which compute device the recognizer can use. (How the covers query keeps the old covers on screen while the book list changes is on [importing a book](/projects/dokseo/library/importing-books/).)

A read can also wait until someone asks for it. The read route has a search dialog that needs the library's books, and it reads them through `LibraryShelfData` with its `lazy` prop set. With `lazy`, the component starts its queries with `enabled: false` and turns them on the first time its `reload()` runs, and the route calls `reload()` when the dialog opens. Until then the queries read nothing. They also cost nothing when they're invalidated, because `invalidateQueries` refetches only queries that have an enabled observer. That matters on the read route: every saved reading place refreshes the library, and the reader saves its place each time it settles on a page, half a second after the last turn.

A mutation factory holds only the function that calls the use case. `removeBookMutation`:

```ts
function removeBookMutation(library: Pick<LibraryWrites, 'removeBook'>) {
  return mutationOptions({
    mutationFn: (id: BookId) => library.removeBook(id),
  });
}
```

What happens after the write (refreshing, reporting) belongs to the write's owner, in [the writes section](#writes) below.

## The client

`src/lib/query-client.ts` holds the cache's global policy, and the root layout, `routes/+layout.svelte`, builds it with `createQueryClient()` and wraps the app in `QueryClientProvider`:

```ts
const GC_TIME_MS = 60 * 60 * 1000;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 0,
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
      },
      mutations: { retry: 0, networkMode: 'always' },
    },
  });
}
```

- `retry: 0`: a failed read or write fails at once. Dokseo doesn't retry anything.
- `gcTime` of one hour: an entry nobody reads stays cached that long, so going back to a screen within the hour shows its data at once.
- No default `staleTime`: each factory sets its own, as above.
- No refetch on focus or reconnect: Dokseo didn't refresh on focus before the cache, and I kept it that way.

`networkMode: 'always'` needs more explanation. TanStack's default network mode is `'online'`: once the browser reports that it's offline, a query or mutation waits for the browser to report being online again before it calls its function. Every read and write in Dokseo goes to IndexedDB, OPFS or the Cache API on the device, so the network has nothing to do with them. With the default, someone reading on a plane would see reads stuck in loading, and the reading-place saves would wait in memory behind them, so closing the tab before the browser came back online would lose them. So the client sets `'always'` for queries and mutations.

## `readQuery` and `ReadState`

`readQuery`, in `shared/read-query.svelte.ts`, wraps svelte-query's `createQuery`. It maps the query's result through the pure function `readStateOf`, in `shared/read-state.ts`, into a three-variant union:

```ts
type ReadState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly value: T };
```

The value is nested on `ready`, so it exists only on the variant that has it. `readStateOf` maps a failed first load to `failed`, and a failed refetch (TanStack keeps the old data and sets `isLoadingError: false`) to `ready` with the kept value. So a reload that fails keeps the data on screen and shows nothing. There's no separate refresh state.

`StorageData`, in `storage/ui/StorageData.svelte`, is the plain case. The settings page shows what the origin stores, and `StorageData` reads it:

```svelte
<script lang="ts">
  let { storage, children }: Props = $props();

  const account = readQuery(() => storageAccountQuery(storage));
  const state = $derived(account.state);
</script>

{#if state.kind === 'loading'}
  <div class="surface bordered rounded-container col gap-3 p-5" aria-busy="true">
    <EmptyState live message="Reading what is stored…" />
    …
  </div>
{:else if state.kind === 'failed'}
  <Alert variant="danger" title="Storage could not be read">{state.message}</Alert>
{:else if state.kind === 'ready'}
  {@render children(state.value)}
{:else}
  {unreachable(state)}
{/if}
```

`unreachable(value: never): never` lives in `shared/unreachable.ts`. svelte-check narrows `state` through the `{#if}` chain, so in the last branch its type is `never`, and a new variant of `ReadState` fails to compile on that line. I checked it by adding a scratch variant: svelte-check failed at `StorageData.svelte` 30:16 with "Argument of type … is not assignable to parameter of type 'never'".

Naming the value `state` works here, but only because this script never calls the `$state` rune. Svelte reads `$name` as a subscription to a store called `name`, so a component that declares `const state` and also calls `$state(…)` fails svelte-check. `LibraryShelfData` holds both, so its value is named `held`.

## The kinds of data component

Every read in Dokseo starts in a data component. What sets them apart is where the result is drawn.

**One that owns its read and draws it.** `StorageData` above, and `EngineSetupData`. The caller fills the `children` snippet with the resolved value only:

```svelte
<StorageData {storage}>
  {#snippet children(account)}
    <StorageSummary {account} />
  {/snippet}
</StorageData>
```

**One that passes its children a named union.** `BookData`, in `library/ui/BookData.svelte`, reads the book for the read route:

```svelte
<script lang="ts">
  let { library, id, children }: Props = $props();

  const reading = readQuery(() => bookQuery(library, id));
  const read = $derived(bookReadOf(reading.state));
</script>

{@render children(read)}
```

It draws nothing for loading or failure, because the route has to choose a reader first: `FlowViewer` when `flowingBook(read)` returns a book whose text flows, and `ReaderScreen` otherwise. `ReaderScreen` then draws loading and failure inside its own frame, so the frame stays mounted from the first load to the book and across a switch between image books. `BookRead` is `loading | failed | missing | ready`, built from the use case's union by `bookReadOf`; that flattening is on [use cases and failure](/projects/dokseo/architecture/use-cases-and-failure/). `LibraryShelfData` is the other one of this kind: its `ShelfRead` lets the tags screen draw the library's failure next to its own content. `ModelStorageData` is a variation: the engine page can draw without knowing what a model occupies, so instead of drawing in place of its children, it passes them a described value, `ShownStorage`, with the snapshot or `null` and a message.

**One that draws nothing and is read through `bind:this`.** The tags route builds its view model, `TagView`, in its script, and a script can't see a snippet's argument. So the route binds the data components and the view model reads them through an exported `read()` method (`routes/tags/+page.svelte`):

```svelte
<script lang="ts">
  let shelf = $state<ReturnType<typeof LibraryShelfData> | null>(null);
  let tagged = $state<ReturnType<typeof TagPageData> | null>(null);
  const view = new TagView(
    () => ({ books: shelf?.read().searched ?? [], wanted, tagged: tagged?.read() ?? null }),
    comparePassages,
  );
</script>

<LibraryShelfData bind:this={shelf} library={container.library}>
  {#snippet children(read)}
    <TagPageData bind:this={tagged} recognition={container.recognition}>
      <TagScreen {view} covers={read.covers} libraryFailure={read.failure} onretrylibrary={read.reload} />
    </TagPageData>
  {/snippet}
</LibraryShelfData>
```

The bindings are `$state`, so the closure is reactive once the components mount, and each read falls back (`?? []`, `?? null`) because a binding is `null` until then. `TagPageData` draws nothing of its own; `BookCapturesData` on the read route has no children at all, and `ReadSession` reads it through `() => listed?.read()`.

`EngineGateData` (`recognition/ui/engine/EngineGateData.svelte`) is the same kind, on the read route. It reads three things for the reading language: the recognizer setup, which gives the chosen model; the stored consent; and what the chosen model occupies in storage. The language is `null` until the book's language is known, and the model id is `null` until the setup read has given a model, so each query takes `null` and passes `skipToken` until there's something to read. The route binds it as `engine`, and `CaptureView` turns `() => engine?.read()` into a source that `ConsentGate` and `EngineWarmup` call with a language, so neither of them reads storage. Pure functions in `recognition/ui/engine/engine-gate.ts` turn the read states into the next step: `readingFor` gives the reads for the language asked about (or "not read yet" for another language), `readsSettled` is true once they've come back, and `consentStep` and `warmStep` give the gate's and the warm-up's next step. What each step does is on [the model's lifecycle](/projects/dokseo/recognition/model-lifecycle/).

Both `BookCapturesData` and `EngineGateData` also take an `onread` callback and call it when their reads stop loading, because a command on the read route sometimes has to wait for them. Arriving at a search result needs the book's captures, so `ReadSession` waits for `BookCapturesData`'s `onread(book)` and runs the arrival in `capturesRead`. A capture started before the engine reads have come back is held, and `EngineGateData`'s `onread(language)` resumes it through `CaptureView.engineRead`. Each receiving method ignores a call it isn't waiting for, so a second call does nothing. svelte-query has no callback for a settled read, so both data components call `onread` from an `$effect` over a `$derived` that holds a primitive; the mechanics are on [a command that runs before its read settles holds its request](/svelte/svelte-query/#a-command-that-runs-before-its-read-settles-holds-its-request). How the read route shares one lazy `CaptureFindData` between its search and the tag counts is on [composing domains at the routes](/projects/dokseo/architecture/composing-screens/).

**One that mounts its children only once its read has settled.** Opening an ebook needs the reading settings before foliate draws the first chapter, and `FlowView.open` can't wait on a reactive read. So the read route wraps `FlowViewer` in `ReadingSettingsData` (`flowing/ui/ReadingSettingsData.svelte`):

```svelte
<script lang="ts">
  let { flowing, children }: Props = $props();

  const stored = readQuery(() => readingSettingsQuery(flowing));
  const opening = $derived(openingSettings(stored.state));
</script>

{#if opening.kind === 'read'}
  {@render children(opening.settings)}
{/if}
```

`openingSettings`, in `opening-settings.ts` beside it, is pure: `loading` means keep waiting, `ready` gives the stored settings, and `failed` gives `DEFAULT_READING_SETTINGS`, so a failed read still opens the book with the defaults. `FlowViewer` gets the settings as its `storedSettings` prop and passes them to `FlowView.open(book, settings, …)`. The opening of an ebook is on [chapters](/projects/dokseo/ebook-reader/chapters/).

**One that only draws a state it's given.** `LibraryBooksData`, `CaptureListData` and `ReaderBookData` own no query. `ReaderBookData` takes the image reader's open state, `ReaderOpening`, and swaps only the stage:

```svelte
{#if opening.kind === 'images'}
  {@render children(opening)}
{:else}
  <ReaderCurtain {opening} />
{/if}
```

It sits in `ReaderFrame`'s `page` slot, so a book switch replaces the stage while the frame, its bars, the dock with the capture panel and the focus stay mounted. That's on [reader chrome](/projects/dokseo/image-reader/reader-chrome/).

## Writes

`BookChanges`, in `library/ui/book-changes.svelte.ts`, owns the library's removes, edits and marks (finished or unread). It builds each mutation from a factory and adds what happens after:

```ts
constructor(library: LibraryWrites, notify: Notify, uploading: () => boolean) {
  const client = useQueryClient();
  this.#notify = notify;
  this.#uploading = uploading;
  this.#removal = writeQuery(() => ({
    ...removeBookMutation(library),
    onSettled: () => refreshLibrary(client),
    onError: (cause) => this.#fail(REMOVE_FAILED, failureMessage(cause)),
  }));
  …
}
```

`writeQuery`, in `shared/write-query.svelte.ts`, wraps `createMutation` and gives the owner `state`, `submit`, `run` and `reset`. `run` returns the mutation's promise, because a write with steps waits for the result: after a mark, `BookChanges` offers an Undo toast only if the marked book left the shelf being shown.

The refresh is in `onSettled`, not `onSuccess`, because it has to follow every outcome. When `editBook` returns `not-found` (another tab removed the book), the mutation still succeeds as far as TanStack is concerned, and when the use case throws, `onSuccess` doesn't run at all. In both cases the shelf has to be read again, or a removed book stays on it.

TanStack's `Mutation.execute` (query-core 5.104) awaits `onSuccess` and `onSettled` before the mutation leaves pending, and `invalidateQueries` resolves once the active queries are read again. So `run()` resolves after the shelf has been read again. It also awaits `onMutate` before calling `mutationFn`, so the use case runs a few microtasks after `run(…)`, which matters to a spec that checks the use case's fake right after triggering the write.

`BookChanges` keeps one union for what it's doing, instead of a busy flag per write:

```ts
type BookChange =
  | { readonly kind: 'idle' }
  | { readonly kind: 'removing'; readonly id: BookId }
  | { readonly kind: 'editing'; readonly id: BookId };
```

Its getters `removing` and `editing` derive from that union, so a book can't be shown as removed and edited at once.

A write that puts a value into the cache before the store confirms it cancels the key's reads first. The engine settings page shows the chosen OCR model, read by a setup query with `staleTime: 0`. When the page mounts again, that query reads the store again behind the cached value. If someone picks a model while that read is in flight, the save puts the new choice into the cache, and then the read lands with the old stored choice and overwrites it. `EngineSettingsView` cancels the read first:

```ts
onMutate: async ({ setup }) => {
  const queryKey = recognitionKeys.setup(setup.language);
  await client.cancelQueries({ queryKey });
  const held: LanguageSetupRead = { kind: 'success', setup };
  client.setQueryData<LanguageSetupRead>(queryKey, held);
},
```

The `held` binding is there because passing the object literal straight to `setQueryData` failed to compile: TypeScript checked it against the wrong member of the updater union (a value or a function). `FlowAppearance` does the same for the ebook's reading settings. Removing a capture takes the row out of the cache in `onMutate` and puts back only that row if the removal fails; that's on [captures](/projects/dokseo/recognition/captures/).

The image reader and the ebook reader save the reading place and edit the book too, but `viewing` and `flowing` are leaf domains and [may not import](/projects/dokseo/architecture/domains/) `library`, its queries included. So each has its own factories: `viewing/queries/viewing-queries.ts` holds `editBookMutation` and `saveReadingPlaceMutation`, generic over the use case's types so that it imports nothing from `library`, and `flowing-queries.ts` has the ebook's. The shelf still has to refresh after these writes, so they take a `bookChanged` callback, and `ReadSession`, the read route's glue, implements it with `refreshLibrary`.

## What a view model still holds

Once reads moved to data components, two kinds of view model were left:

- **A write view model** owns a write's mutation, a write with steps, or a live resource, and calls use cases only through its mutations: `BookChanges`, `BookUpload`, `CaptureRemoval`, `EngineSettingsView`, `ReaderView` with its open book.
- **A UI view model** holds UI state with real logic and never calls a use case: `ShelfArrangement`, `TagSelection`, `SearchPalette`, `PagedViewport`.

A toggle with no logic stays a `$state` in its component.

A large view model is split into parts. The parent builds the parts in its constructor and exposes them as readonly fields, so a component calls `reader.navigation` directly and the parent keeps only the methods that join two parts. `ReaderView`, in `viewing/ui/reader-view.svelte.ts`:

```ts
class ReaderView {
  opening = $state.raw<ReaderOpening>(NOT_OPENED);
  readonly selection: RegionSelection;
  readonly grouping: PageGrouping;
  readonly navigation: PageNavigation;
  readonly preferences: BookPreferences;
  …
}
```

A part that needs the parent's state takes getters, not values. `ReaderView` passes `PageGrouping` a getter for the open book and one for its generation counter (`() => this.#generation`), `PageNavigation` the book getter, `BookPreferences` a getter for the open state and the generation getter, and its `PlaceKeeper` the generation getter. So each part reads the current book, and an async result that arrives after another book opened is still dropped by comparing generations. A closure also lets a part built early reach one built later: `PlaceKeeper` is built before `grouping`, and its `onSettle` callback calls `this.grouping.groupHolding(…)`, which works because the callback runs only after the constructor finished. A smaller example is `LibraryView`: it builds `BookUpload` and `BookChanges`, and passes the second one `() => this.upload.busy`, so a change is skipped while an upload runs.

A choice saved in `localStorage` is a `RememberedChoice<T>` (`shared/remembered-choice.svelte.ts`). It reads once when built and saves on `choose`:

```ts
class RememberedChoice<T> {
  #chosen: T;
  #save: (value: T) => void;

  constructor(read: () => T, save: (value: T) => void) {
    this.#chosen = $state.raw(read());
    this.#save = save;
  }

  get value(): T {
    return this.#chosen;
  }

  choose(next: T): void {
    this.#chosen = next;
    this.#save(next);
  }
}
```

`ReaderScreen` builds `touchTurns` with it when it mounts, so the stored choice is read then, and an app-wide choice such as the book matching setting is one module-level instance.

A view model doesn't reach outside effects itself; whoever builds it passes them in as functions. The read route builds `ReadSession` with the toast function, a `ReadAddress` of getters and callbacks over SvelteKit's `page`, `goto` and `replaceState`, and the clipboard write `(text) => navigator.clipboard.writeText(text)`. `ReadSession` passes the clipboard write and the toast function on to each `CapturePanelView`. So no view model reads the toast context or `navigator`, and each one runs in a unit spec. The component keeps only the DOM: `tick()`, `focus()`, `scrollIntoView`. When a method ends in a focus move, it returns the element to focus and the component moves focus after `tick()`: `CapturePanelView.closeTags()` returns a `FocusTarget | null`.

## Viewer view models measure through a port

The viewers have logic of their own: zoom and pan in the paged viewer, the zoom hold in the continuous strip, the pencil offered over an ebook selection. That logic lives in view models that never hold an element: `PagedViewport`, `StripZoom`, `GrabPan`, `HintLines`, `LiftOffer`, and the `EdgeScroll` loop. Each takes getters for what the DOM reports, such as the surface `GrabPan` captures the pointer on. `PagedViewport` takes a `ViewportFrame`:

```ts
type ViewportFrame = {
  readonly boxes: () => FrameBoxes | null;
  readonly offset: () => FrameOffset | null;
};
```

`PagedViewer.svelte` builds it with closures over its elements, and `paged-viewport.spec.ts` with closures over plain test values, so the geometry is unit-tested in Node. Animation frames come through a `FrameClock` (`shared/frame-clock.ts`), a `request` and a `cancel` function that `EdgeScroll` and `LiftOffer` take instead of calling `requestAnimationFrame`. The component keeps the elements, the observers, `preventDefault`, pointer capture and the scroll writes, and the pure arithmetic sits in a rune-free module beside the view model: `strip-hold.ts` for the strip's hold, `liftSpot` in `flow-lift.ts` for the pencil. The viewers themselves are on [the paged viewer](/projects/dokseo/image-reader/paged-viewer/) and [the continuous strip](/projects/dokseo/image-reader/continuous-strip/).

## What stays out of the cache

A query cache keeps a value for every reader of its key, for as long as `gcTime` allows. Some things in Dokseo must have exactly one owner, so they stay out:

- **Opening an image book.** `ReaderView.open` gets a live `PageSource` from `openForReading`, which must be closed, and the decoded pages it shows must be released. A cache could keep or share a resource that one viewer owns.
- **Opening an ebook.** `FlowView.open` needs the host element, and the foliate surface must be destroyed when the book closes.
- **The recognizer.** `EngineWarmup` and `ModelDownload` hold a worker session and progress streams.
- **Consent.** `ConsentGate` holds sets that last for the session and a recognition waiting for consent.
- **Progress over a write.** `BookUpload`'s upload progress and `CaptureRecording`'s OCR steps live in the write view model beside the write's state. A model download's progress callback goes into the mutation as one of its variables, so it reaches the use case without passing through the cache.
- **Choices in `localStorage`.** A `RememberedChoice` reads synchronously and calls no use case.

## Rifty's files and Dokseo's

[Rifty](/projects/rifty/), my Riftbound card app, uses the same pattern in React. It has no data hooks either: a Rifty data component calls `useQuery` itself through `useReadState`, and a presentation hook never holds a read. This is which Dokseo file does the job of which Rifty file. The comparison, with the costs of each choice, is on [Dokseo and Rifty, side by side](/projects/dokseo/architecture/compared-with-rifty/).

| Rifty | Job | Dokseo |
| --- | --- | --- |
| `features/<f>/presentation/data/<x>-data.tsx` | starts its read, matches the lifecycle, passes `children` the value | `domains/<d>/ui/<Thing>Data.svelte`, with `children: Snippet<[T]>`, plus the union-passing and `bind:this` kinds above |
| `features/<f>/queries/<f>-queries.ts` | query and mutation options: a key and the use-case call | `queries/<d>-keys.ts` and `<d>-queries.ts`, taking a structural `<D>Reads` type |
| `hooks/use-read-state.ts`, `use-write-state.ts` | TanStack's result to a `ReadState` or `WriteState` union | `shared/read-query.svelte.ts` (`readQuery`) and `write-query.svelte.ts` (`writeQuery`, with `run`) over the pure `readStateOf` and `writeStateOf` |
| `features/<f>/presentation/hooks/use-<x>.ts` | UI state (`useDeckDraft`) or a write (`useNoteEditing`), never a read | `ui/<thing>.svelte.ts`, a view model class: UI state, a write with steps, or a live resource, never a read |
| `presentation/<x>-format.ts`, `deck-build-steps.ts` | pure labels, messages, transitions | a rune-free `<thing>.ts` in `ui/` or `domain/` (`book-read.ts`, `capture-read.ts`) |
| `presentation/screens/<x>-screen.tsx`, components | values and slot props in, markup out | `ui/<Thing>Screen.svelte`, `ui/<Thing>.svelte` with snippet props |
| `app/<route>.tsx` | nests data components, composes features, invalidates after a write | `routes/**/+page.svelte`, plus `read-session.svelte.ts` (`ReadSession`) on the read route, which has no Rifty counterpart |
| `composition/dependencies.ts`, `app-dependencies-provider.tsx` | builds the ports and provides them by context | `src/lib/container.ts` (exposes use cases only) and `src/lib/context.ts` |
| `composition/query-client.ts` | the cache's global policy | `src/lib/query-client.ts`, provided in `routes/+layout.svelte` |
| `application/ports`, `features/<f>/use-cases` | ports and use cases, a named union per use case | `domains/<d>/domain/` and `domains/<d>/use-cases/<op>.ts`, a named union per use case on `kind` |
| `components/ui/` | base components | `src/lib/components/` |

In Dokseo each file kind has one job:

- `<Thing>Data.svelte` loads: it owns one read and its lifecycle.
- `<Thing>.svelte` shows: markup, handlers, element bindings and DOM measurement, with no logic that needs a test.
- `<thing>.svelte.ts` holds state: UI state, a write with steps, or a live resource. Its effects arrive through its constructor, and it's unit-tested in plain Node.
- `<thing>.ts` holds pure functions and discriminated unions, with no runes.
- `queries/<d>-keys.ts` and `<d>-queries.ts` name the cache entries and call the use cases they're given.
- `use-cases/<op>.ts` is one operation returning its own named union. A data component or a write view model calls it through a query or a mutation, never through a port.
