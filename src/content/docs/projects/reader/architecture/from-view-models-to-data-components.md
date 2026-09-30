---
title: How Dokseo Moved from View Models to Data Components
description: The storage screen at three stages, why one view model held too much, the half-step that kept reads in view models, and what the children gained.
tags: [dokseo, architecture, svelte, svelte-5, tanstack-query]
sidebar:
  order: 16
---

Dokseo, my manga and book reader, started out with one view model per screen. Every screen now gets its data from data components instead: components that start a read from a TanStack Query cache and pass the result to what they render. A view model holds only UI state, a write, or a live resource such as an open book. The way it works now is on [data components and view models in Dokseo](/projects/dokseo/architecture/data-components-and-view-models/), and the general idea is on [data components](/architecture/data-components/). The storage settings screen is one of the smallest, so it shows each step of the change most clearly, with the code as it was at each stage.

## The starting point

The storage settings screen shows what Dokseo keeps on the device: books, captures, model weights, and how that compares with what the browser reports. It reads all of that through one use case, `readStorageAccount`.

The route built a view model, `StorageSettingsView`, called its `load()` when the page mounted, and passed the whole view model to the screen. The view model ran the read and kept its result in two fields:

```ts
// src/lib/domains/storage/ui/storage-view.svelte.ts, before
class StorageSettingsView {
  account = $state.raw<StorageAccount | null>(null);
  message = $state.raw<string | null>(null);

  #container: Container;
  #generation = 0;

  async load(): Promise<void> {
    const generation = this.#bump();
    try {
      const read = await this.#container.storage.readStorageAccount();
      if (generation !== this.#generation) return;
      if (read.ok) {
        this.account = read.value;
        this.message = null;
      } else {
        this.account = null;
        this.message = failureNote(read.error);
      }
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.account = null;
      this.message = `What this app stores could not be read: ${describeCause(cause)}`;
    }
  }

  dispose(): void { this.#bump(); }
}
```

The `#generation` counter is there for stale results. Each `load()` bumps it, and a result that comes back after a newer load (or after `dispose()`) no longer matches the counter and is dropped. Without it, a slow first read could overwrite a newer one.

```svelte
<!-- src/routes/settings/storage/+page.svelte, before -->
const view = new StorageSettingsView(useContainer());
onMount(() => {
  void view.load();
  return () => view.dispose();
});
…
<StorageScreen {view} />
```

The screen then had to work out which of three states it was in from the two nullable fields, with `screenState(view.account, view.message)`, and branch on the result itself.

Storage has no writes and no UI state, so it only shows part of what a view model held. `LibraryView` held the read (`status`, `loadFailure`, `books`, covers, the stored size) and the upload, remove, edit and mark writes with their busy flags, all in one class. `TagView`, the tags screen's view model, held its read (`tags`, `captures`, `status`) beside a piece of UI state, the `filter` text.

## Why I moved away from it

One view model owned too much. It could hold the read, the writes, the lifecycle of each, and some of the screen's UI state, all in one class.

The read and the UI state also need different handling. State that comes from outside the app, which I call boundary state, has a lifecycle: it's loading, it failed, it's ready, a result can arrive late, it can be reloaded, and it could be cached. UI state, like a sort order or the open sheet, is synchronous and local to the screen.

So I split them. A data component owns the boundary state, and a view model holds only UI state. In Rifty, my React Native app for a trading card game, the second job belongs to a hook; in Svelte it's a class in a `.svelte.ts` file. The split makes each piece easier to read, and each one has one concern.

## The half-step

My first version of the split kept the read in the view model. The view model held the read as one union, `ReadState<StorageAccount>`, instead of two nullables, and a new `StorageData` component drew it:

```ts
// storage-view.svelte.ts, at the half-step
class StorageSettingsView {
  state = $state.raw<ReadState<StorageAccount>>(LOADING);
  #generation = 0;
  async load(): Promise<void> {
    const generation = this.#bump();
    try {
      const read = await this.#container.storage.readStorageAccount();
      if (generation !== this.#generation) return;
      this.state = read.ok ? readReady(read.value) : readFailed(failureNote(read.error));
    } catch (cause) { … }
  }
}
```

```svelte
<!-- StorageData.svelte, at the half-step -->
type Props = {
  readonly state: ReadState<StorageAccount>;
  readonly children: Snippet<[StorageAccount]>;
};
…
{#if state.kind === 'loading'} … {:else if state.kind === 'failed'} …
{:else if state.kind === 'ready'}{@render children(state.value)}
{:else}{unreachable(state)}{/if}
```

The route still built the view model and called `load()` and `dispose()`. The screen took `state={view.state}` and wrapped the account's children in `StorageData`. The read became one union, and the screen stopped branching.

It was still the wrong split. `StorageData` drew a state but started nothing, so every read still lived in a view model. That's a data hook in all but name: an object that owns a read and gets passed to whatever needs the data. Data components exist to avoid exactly that. I took the half-step because Dokseo had no cache yet, so two components had no way to share one read, and keeping the read in a view model looked like the only option. The fix was to add the cache and move the read into the data component.

## The end

Now the route doesn't build anything for storage. It passes the storage group of use cases down:

```svelte
<!-- src/routes/settings/storage/+page.svelte, the whole file -->
<script lang="ts">
  import { useContainer } from '$lib/context';
  import StorageScreen from '$lib/domains/storage/ui/StorageScreen.svelte';
  import SettingsShell from '../SettingsShell.svelte';

  const container = useContainer();
</script>

<SettingsShell current="storage">
  <StorageScreen storage={container.storage} />
</SettingsShell>
```

`StorageScreen` passes that group to `StorageData`, and `StorageData` starts the read itself through `readQuery`, Dokseo's small wrapper over svelte-query's `createQuery`:

```svelte
<!-- src/lib/domains/storage/ui/StorageData.svelte -->
type Props = {
  readonly storage: StorageReads;
  readonly children: Snippet<[StorageAccount]>;
};
let { storage, children }: Props = $props();

const account = readQuery(() => storageAccountQuery(storage));
const state = $derived(account.state);
…the same {#if} chain as before…
```

The query factory lives in the domain's `queries/` folder. It names the cache key and calls the use case it's given:

```ts
// src/lib/domains/storage/queries/storage-queries.ts
function storageAccountQuery(storage: StorageReads) {
  return queryOptions({
    queryKey: storageKeys.account(),
    queryFn: async () => {
      const read = await storage.readStorageAccount();
      return read.account;
    },
    staleTime: 0,
  });
}
```

`StorageSettingsView` is gone, along with its generation counter, `load`, `dispose`, and its specs: the account it held, a failed read, a thrown failure, and a read dropped after `dispose()`. TanStack Query does that work now. The pure functions that format the figures stayed in `storage-view.svelte.ts` with their specs. The file kept its name, even though it holds no rune any more.

| Stage | Who starts the read | Who holds its state | Who draws loading and failure | What the screen takes |
| --- | --- | --- | --- | --- |
| One view model per screen | the route, `view.load()` in `onMount` | the view model, as `account \| null` and `message \| null` | the screen, after rebuilding a union | the whole view model |
| The half-step | the route, `view.load()` | the view model, as `ReadState<StorageAccount>` | `StorageData` | `state`, the read's union |
| Now | `StorageData`, through `readQuery` | the query cache | `StorageData` | `storage`, the use-case group it passes to `StorageData` |

## What the children gained

The data component owns the read's lifecycle: loading, failed, ready, and a reload. So a child it renders only gets resolved values and callbacks. It never checks a loading flag, an error or a retry. That keeps the child pure in the sense I care about: the same props always draw the same thing, and I can read, reuse and test it without knowing where its data came from.

Before, the storage screen took the whole view model and worked out the read's state itself:

```svelte
<!-- StorageScreen.svelte, before -->
type Props = { readonly view: StorageSettingsView; readonly engineHref?: string };
const state: StorageScreenState = $derived(screenState(view.account, view.message));
…
{#if state.kind === 'reading'} …skeleton…
{:else if state.kind === 'failed'} <Alert …>{state.message}</Alert>
{:else if state.kind === 'ready'}
  <StorageSummary account={state.account} />
  <StorageBreakdown account={state.account} />
{/if}
```

The tags screen was worse, because it took another domain's lifecycle. It needs the library's books to group the tagged captures under their books, and its `shelf` prop was a slice of the library's view model:

```ts
// recognition/ui/tag/tag-screen.ts, before
type Shelf = {
  readonly status: ShelfStatus;          // 'idle' | 'loading' | 'ready' | 'failed'
  readonly loadFailure: string | null;
  load(): Promise<void>;
};
// TagScreen took { view, covers, shelf }, and the route passed LibraryView as `shelf`
```

After, the children that draw take only the value:

```svelte
<StorageData {storage}>
  {#snippet children(account)}
    <StorageSummary {account} />
    <StorageBreakdown {account} />
  {/snippet}
</StorageData>
```

`StorageSummary` and `StorageBreakdown` each have one prop, `account: StorageAccount`. A spec can render them from a fixture account with no query, client or container: `storage-breakdown.spec.ts` renders `StorageBreakdown` with `render` from `svelte/server`, in bare Node.

A data component passes its children the resolved value by default. It may pass a child the loading or failed state when that child really needs it, and Dokseo does that in a few places, each for a reason:

- **The tags screen** draws its tag list without the library's books, so a failed library read shouldn't replace the list. `TagScreen` now takes `libraryFailure: string | null` and `onretrylibrary: () => void`, a described value and a callback, and shows the failure as a note beside the list.
- **`LibraryShelfData`** passes its children a `ShelfRead` that includes the shelf's state. The home route draws the shelf inside `LibraryScreen`'s frame, through `LibraryBooksData`, and the upload strip in that frame has to work even when the first read failed.
- **`BookData`** passes the read route a `BookRead` (`loading | failed | missing | ready`). The route picks the ebook reader or the image reader from the book, and the image reader draws every other state behind its own curtain so its frame stays mounted. That's on [picking the reader from the book](/projects/dokseo/architecture/composing-screens/#picking-the-reader-from-the-book).
- **`ModelStorageData`** passes the engine page a `ShownStorage`: what the model occupies, `null` while that read loads, or `null` with a message when it failed or the browser exposes no cache. The page can draw without that figure, so a failed read shouldn't replace it.

## The second half: `Result` to named unions

The reads moved first. Then I looked at what each use case returned. Dokseo's use cases used a generic `Result<T, E>`, and after comparing it with Rifty's named unions I decided `Result` was too rigid. Every use case now returns its own union, discriminated on `kind`:

- One flat match lists every outcome once, instead of matching `ok` and then the error.
- The success names what it holds, and an operation can have several successes: `openFile` returns `added` or `already-held`.
- A union holds only what that one use case can produce, not a domain-wide error type.
- It's already the flat list of outcomes a data component needs to place beside `loading` and `failed`.

The cost is a type per use case, and a caller that maps a callee's outcomes variant by variant. What the unions look like, what a port returns, and where an unexpected failure goes are on [use cases, results and failure](/projects/dokseo/architecture/use-cases-and-failure/#a-named-union-per-use-case).

## What changed for someone using the app

Moving every read into the cache changed a few things on screen. I accepted all of them:

1. A reload that fails keeps the data on screen and shows nothing. Before, it put a failure alert above the data.
2. Going back to a screen shows the cached data at once and refreshes it in the background. Before, the screen showed its loading state first.
3. On the OCR engine page, a failed read of the stored recognizer setup shows a failure alert. Before, it showed the default choice as if it were the stored one.
4. The capture list has its own loading text, "Reading captures…", in the style of the storage screen's "Reading what is stored…". Before, it showed the empty list's invitation while it loaded.
5. Saving a reading place or a reader setting refreshes the library shelf. Nothing shows this on the read route, because the shelf isn't on screen there, but the library is up to date when I go back to it.
