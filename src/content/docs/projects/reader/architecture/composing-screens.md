---
title: Composing Domains at the Reader's Routes
description: How the read route puts recognition's capture panel inside both readers, and hands functions across domains, without any domain importing another's UI.
tags: [reader, architecture, svelte, svelte-5, sveltekit]
sidebar:
  order: 12
---

The read route is where the reader's domains meet. Both readers show recognition's capture panel, and recognition sorts ebook captures with a function only `flowing` can write, yet no domain imports another's `ui/`. The route does it with the three mechanisms from [composing two domains at a route](/architecture/sveltekit/#composing-two-domains-at-a-route). Why a view mustn't import the feature it hosts is on [two domains meet at the route](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other).

## The capture panel: a snippet

Beside the page, both the image reader and the ebook reader show recognition's capture panel: the captures taken from the open book. The readers themselves have no reference to captures. Each one exposes a slot, and `src/routes/read/[fileId]/+page.svelte` fills it with recognition's panel. That's [a slot filled with a snippet](/architecture/sveltekit/#a-slot-filled-with-a-snippet):

```svelte
<ReaderScreen view={reader} …>
  {#snippet panel(visible)}
    <CapturePanel view={captures} panel={session.imagePanel} {language}
                  source="images" {visible} />
  {/snippet}
</ReaderScreen>
```

`ReaderScreen` (in `viewing`) declares `panel?: Snippet<[boolean]>`, and passes in whether the panel is showing. The same route passes `CapturePanel` into `FlowViewer` (in `flowing`) the same way, with `source="text"`.

The panel builds nothing itself. `CapturePanelView` is the view model behind it, and `ReadSession`, the route's glue class (described [below](#the-read-routes-glue-readsession)), builds one for the image reader and one for the ebook reader. It gives each one the clipboard write and the toast function that the route passed in, so neither the panel nor its view model reaches into Svelte context or a browser API.

The settings screens do it too. `routes/settings/SettingsShell.svelte` takes an `aside` snippet, and the engine page fills it with recognition's `EngineAside.svelte`.

The idea is a slot. The mechanism is a snippet prop, never the deprecated `<slot>` element (see [a snippet prop is the Svelte 5 slot](/svelte/state-and-props/#a-snippet-prop-is-the-svelte-5-slot)).

## A selection: a callback

In the image reader, someone selects a region of a page, and recognition runs OCR on it. `ReaderScreen` reports the selection through `onSelect`, and the route passes it to recognition. That's [a callback](/architecture/sveltekit/#a-callback):

```svelte
onSelect={(regions, laidOut) => captures.capture(reader.source, language, regions, laidOut)}
```

`viewing` has no code that handles the regions after that.

## Passage order: a need declared in recognition, supplied by flowing

A capture from an ebook records its place as an EPUB CFI, the string foliate-js uses to name a position in a book. `recognition` has to order ebook captures by that CFI, but it can't import `flowing`, and only `flowing` has the code that compares CFIs. So `recognition/domain/capture/capture-order.ts` declares the need as a type. That's [a need declared in one domain and supplied by another](/architecture/sveltekit/#a-need-declared-in-one-domain-supplied-by-another):

```ts
type PassageOrder = (earlier: string, later: string) => number;
```

`flowing/ui/flow-passage-order.ts` implements it as `comparePassages`, and the routes pass one into the other. The library and read routes pass `passages={comparePassages}` to recognition's `SearchDialog`. On the read route, `ReadSession` puts `comparePassages` into each `CapturePanelView` it builds, and into the helpers that step through the matching captures after someone follows a search result into the book. The tags routes pass it to `new TagView(…, comparePassages)`.

`comparePassages` stands on foliate's `compare` from `foliate-js/epubcfi.js`, because [a CFI doesn't sort as a string](/ebooks/foliate-positions/#a-cfi-does-not-sort-as-a-string-foliates-compare-does-and-runs-in-node). `compare` needs no DOM, so `flow-passage-order.spec.ts` is a plain unit spec in Node. The foliate import stays inside `flowing`. Every other domain gets the comparer as a `PassageOrder` from the route.

## `inBookOrder`: region before text

`inBookOrder` in `capture-order.ts` sorts a list of captures that can hold two kinds of place: a region on an image page, or a text anchor in an ebook. My first version returned 0 whenever either side was a text anchor. That's [not an order](/javascript/gotchas/#a-comparator-that-returns-0-for-one-kind-against-everything-is-not-an-order) once a list mixes kinds. It only looked safe because a real book never mixes them.

Now every pair of kinds has a fixed answer: a region comes before text. Within each kind, the "no place" values (no regions, an empty CFI) rank last within that kind and are never passed to the inner comparer.

## A data component read through `bind:this`

A route can also join domains through a data component it binds. A data component is a `<Thing>Data.svelte` that starts a read from the query cache and passes the result to its `children` snippet. Usually whatever needs the data is rendered inside it. A view model that a route builds in its script isn't rendered at all, though, so it can't receive the value through a snippet.

The tags route has that problem. `TagView`, recognition's view model for the tags screen, needs the library's books and the captures under a tag. The route binds both data components with `bind:this` and gives `TagView` a function that reads them through their exported `read()` method:

```svelte
const view = new TagView(
  () => ({ books: shelf?.read().searched ?? [], wanted, tagged: tagged?.read() ?? null }),
  comparePassages,
);
…
<LibraryShelfData bind:this={shelf} library={container.library}>
```

`LibraryShelfData` is `library`'s and `TagPageData` is `recognition`'s, and neither imports the other. A bound instance is `null` until the component mounts, which is why every read in that function has a `?? []` or `?? null`. The other kinds of data component in Dokseo are on [data components and view models](/projects/dokseo/architecture/data-components-and-view-models/).

## The read route's glue: `ReadSession`

The read route composes four domains: `library` for the book and the shelf, `viewing` for the image reader, `flowing` for the ebook reader, and `recognition` for the captures, the OCR engine and the search. Some values need more than one of them. When someone follows a search result into a book, the capture they followed glows on the image page. Finding that capture means putting the book's captures in reading order, which takes the captures from `recognition`, the reading direction from `viewing` and the CFI comparer from `flowing`. No domain may hold that join, because `library`, `viewing`, `flowing` and `recognition` are all leaves, and a leaf imports no other domain.

So the join lives beside the route, in `routes/read/[fileId]/read-session.svelte.ts`. Its class, `ReadSession`, builds the view models of the parts (`ReaderView`, `FlowView`, `CaptureView` and the two `CapturePanelView`s), exposes them as readonly properties, and holds the derived values that need more than one of them. `routes-are-thin` covers the file the same way it covers the route, because it sits under `src/routes/`.

SvelteKit's `page`, `goto` and `replaceState` stay in the route. The session gets them as a `ReadAddress`, an object of getters and callbacks:

```ts
type ReadAddress = {
  readonly fileId: () => string | undefined;
  readonly requested: () => URL;
  readonly shown: () => URL;
  readonly replace: (url: URL) => void;
  readonly leave: (path: string) => void;
};
```

That keeps `$app/navigation` and `$app/state` out of the class, so `read-session.spec.ts` builds a `ReadSession` in a plain unit spec with a fake address.

The session also takes care of refreshing another domain. Saving a reading place or a book setting writes through `viewing` or `flowing`, but the shelf that shows the book belongs to `library`, and a leaf can't name `library`'s cache keys. So `ReaderView` and `FlowView` take a `bookChanged` callback, and `ReadSession` implements it with `library`'s `refreshLibrary`:

```ts
this.flow = new FlowView(container, notify, client, () => this.#bookChanged());
…
#bookChanged(): void {
  void refreshLibrary(this.#client);
}
```

`refreshLibrary` invalidates every query under `libraryKeys.all()`.

One mistake I made while writing the session: it builds its two panels in field initializers, `#imagePanel = $state.raw(this.#imagePanelBuilt())`. A class field initializer runs before the constructor body, and the constructor body is where `#counting`, the tag counts the panels show, gets assigned. Passing `this.#counting` to the panel from the initializer passed `undefined`. The fix was to give the panel closures that read the field when they're called, `{ counts: () => this.#counting.counts(), ask: () => this.#counting.ask() }`, the way the clipboard write was already passed.

## Picking the reader from the book

The read route shows one of two readers: `FlowViewer` for a book whose text flows (an EPUB), and `ReaderScreen` for a book of page images. Which one depends on the stored book record, so the route gets it from `BookData`. `BookData` is `library`'s data component for one book. It reads the book through the cache and passes its children a `BookRead`:

```ts
type BookRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'ready'; readonly book: Book };
```

`flowingBook(read)` returns the book when it's ready and its text flows, and `null` in every other state. The route branches on that inside `BookData`'s snippet:

```svelte
<BookData library={container.library} {id}>
  {#snippet children(read)}
    {@const flowing = flowingBook(read)}
    {#if flowing !== null}
      <FlowViewer view={flow} book={flowing} …>…</FlowViewer>
    {:else}
      <ReaderScreen view={reader} …>…</ReaderScreen>
    {/if}
  {/snippet}
</BookData>
```

In every other state, loading and failed included, the route shows `ReaderScreen`, which covers its stage with its own curtain until the book is open. That keeps the image reader's frame mounted from the first load to the ready book, and across a switch from one image book to another.

The branch sits inside the snippet on purpose. The snippet's argument is reactive, so when `BookRead` changes from loading to ready, or from one image book to another, Svelte re-evaluates the `{#if}` and keeps the same branch, and the component in it stays mounted with its frame, sheet and focus. Only a change of branch remounts. The other side of that: switching between two ebooks whose records are both cached goes from ready to ready and keeps `FlowViewer` mounted, so anything that has to restart per book has to key on the book's id.

The search on the read route needs every capture, and so do the tag counts in the capture panel. One `CaptureFindData` serves both. It holds a lazy read of every capture, one that doesn't start until it's first used. The search reaches it through its `children` snippet, and `ReadSession` reaches it through `bind:this`. Whichever reaches it first turns the read on.
