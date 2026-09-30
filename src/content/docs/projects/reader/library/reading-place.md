---
title: Reading Place, Links and Arrivals
description: What the reader saves as a place, how "finished" and "started" are decided, and how the read route mirrors the place into its URL and arrives at a linked capture.
tags: [reader, sveltekit, svelte, svelte-5, storage]
sidebar:
  order: 32
---

A reading place is where a book reopens. It's the `ReadingPlace` type in `shared/reading-place.ts`: `viewing` and `flowing` produce it, and `library` saves it on the book. This page is the reader's side of [finished versus saved index](/ebooks/foliate-positions/#finished-means-the-last-page-was-shown-not-the-saved-index-is-last) and of [SvelteKit navigation](/svelte/sveltekit-navigation/): the place, how the read route keeps it in the address bar, and how a link to a capture lands.

## A place is two fields, plus a timestamp on the book

When a book opens again, it should open where you left off, and the library also needs each book's started or finished state. Both come from the saved place.

The image reader reopens at `index`, which is the first page of a spread or the image at the top of the strip. That index can never reach `n-1` for a closing spread or a short last webtoon image, so an image place also records `shownThrough`, the last image the reader actually showed. `showsTheEnd` compares that with `n-1`.

For EPUBs the place holds foliate's fraction, which is the end of the page. The last page can come out as `0.9999999999999999`, so `ROUNDING_SHORT_OF_THE_END` (1e-9) absorbs it.

That still leaves one hole. For a one-image book, `{ index: 0, shownThrough: 0 }` means both "just imported" and "read to the end". So "started" also checks whether a reader ever saved a place, which is the book's `lastReadAt`.

## Mark unread resets all three

The use case is small, and it has to clear `lastReadAt` along with the place. If it didn't, a one-image book would count as finished again the moment it was marked unread.

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

The repository returns a missing book as `null` inside its success, and the use case is where that absence gets a name, `not-found`. A blocked store comes back as `storage-unavailable` and passes straight through. Anything else the store throws isn't in the union at all ([a named union per use case](/projects/dokseo/architecture/use-cases-and-failure/#a-named-union-per-use-case)).

So "mark unread" isn't the inverse of "mark finished", because it also sends the place back to the start. The library's Undo keeps the book as it was before the mark and writes back its `finishedAt` and `position` through `editBook` ([why a snapshot, not the inverse](/ui-patterns/saving-and-undo/#an-undo-toast-restores-the-snapshot-not-the-inverse-action)). The toast only shows when the book was on the current shelf before and isn't after (`onShelf`), so the "All" shelf never toasts. Undo and Open toasts get `ACTION_NOTICE_MS`, which is 10 s.

## Saving on every turn

Both readers save the place as you turn pages. `ReaderView` (the image reader) and `FlowView` (the ebook reader) each save through a `PlaceKeeper` from `shared/place-keeper.ts`. A turn schedules a save 500 ms out, and a newer turn replaces the waiting one, so a fast run of turns writes once. The save itself is a mutation from the reader's own `queries/` folder (`saveReadingPlaceMutation` in `viewing/queries/viewing-queries.ts` and in `flowing/queries/flowing-queries.ts`), run through `writeQuery` ([writes](/projects/dokseo/architecture/data-components-and-view-models/#writes)).

A saved place changes what the library shows: the started and finished states, the progress, and the order of the books under continue reading. So when a save succeeds, the reader calls a `bookChanged` callback, and `ReadSession` (the read route's glue) implements it by invalidating every library query. The next time the library shows, it reads the new place.

Every read and write in Dokseo goes to IndexedDB, OPFS or the Cache API on the device. TanStack Query's default network mode, `'online'`, holds a fetch or a mutation while the browser reports that it's offline, so in airplane mode reads would hang in loading and place saves would wait for a network they never use. The query client in `src/lib/query-client.ts` sets `networkMode: 'always'` for queries and mutations, so saves run offline too ([svelte-query](/svelte/svelte-query/)).

When a storage write fails, saving on every turn would stack a `role="alert"` toast per turn. So `PlaceKeeper` toasts the first failure of a run and stays quiet until a save succeeds or another book opens ([one toast per run](/ui-patterns/saving-and-undo/#one-toast-for-a-run-of-failed-background-saves)).

## A missing book goes back to the library

If the book isn't there, the reader sends you to `/?missing=book`. The library shows the warning from `afterNavigate` and then drops the parameter with `replaceState` (`missingBookArrival`), so a reload or Back doesn't show it again ([clearing a one-time parameter](/svelte/sveltekit-navigation/#clearing-a-one-time-query-parameter-after-arrival)). What counts as missing on the storage side is on [What the Reader Stores](/projects/reader/library/storage/).

## The read route is reused between books

`/read/[fileId]` keeps its component instance when only the param or the query changes, so `/read/a` to `/read/b`, or `?image=3` to `?image=7`, remounts nothing. Only the effects that read a value that changed run again. Anything seeded once from the book keeps its value from book A under book B, so those children need a key on the book's id ([seeded children need a key](/svelte/state-and-props/#a-child-seeded-once-from-a-prop-needs-a-key-to-be-reseeded)). In the image reader, that's the paged viewer: `ReaderScreen` wraps `PagedViewer` in `{#key ready.book.id}` inside the ready branch of `ReaderBookData`. A save replaces the book object but keeps its id, so it leaves the viewer alone.

The data components above it are the opposite case. `BookData` passes its children a `BookRead`, and the route picks `FlowViewer` or `ReaderScreen` with an `{#if}` inside that snippet. When the read changes from loading to ready, or from one image book to another, the condition is evaluated again, the branch stays the same, and the component in it stays mounted with its frame and focus. Only a change of branch remounts. That also means a switch between two cached ebooks keeps `FlowViewer` mounted, so anything in it that must restart per book has to key on the book's id ([composing screens](/projects/dokseo/architecture/composing-screens/)).

The route used to open the item the URL named from an effect keyed on the param. It now does it from an `afterNavigate` callback, which runs for `/read/a` to `/read/b` and for `?image=` changes alike. The callback stores the last request it received, and `readerNavigation` compares the new request with it, so an unchanged one does nothing. The old effect never needed that check, because the derived value it read only re-ran it when the value changed ([afterNavigate](/svelte/sveltekit-navigation/#afternavigate-follows-a-same-route-param-change)).

## The place is mirrored into the address bar

While you turn pages, the route writes the place into the URL with a shallow `replaceState`. That doesn't move `page.url` (checked on SvelteKit 2.70.3), and the reader relies on it. The image arrival, `readArrival`, derives from `page.url`, so the mirror's writes never re-derive the arrival glow. A probe that turned three pages from a bare open saw zero glows. Reloading the mirrored address is a real navigation, so that one does glow ([replaceState and page.url](/svelte/sveltekit-navigation/#a-shallow-replacestate-leaves-pageurl-where-the-navigation-put-it)).

The mirror itself starts every rewrite from `new URL(location.href)`. Built from `page.url`, each rewrite would restart from the arrival's URL and bring back a `region` an earlier rewrite had dropped.

## Arriving at a capture

A capture link is `?capture=` on the read route. Opening one in the book that's already open is a same-route `goto` that changes only the query, and the route's loads are keyed on the book id, so no load starts and nothing hooked onto a load's end runs. The navigating side does `goto(href).then(…)` and calls a callback the route supplies. Inside it, `page.url` has already moved, and a prop read there has the route's current value, so comparing it with the value noted before the `goto` separates a same-page jump from a new one ([same-route goto](/svelte/sveltekit-navigation/#a-same-route-goto-starts-no-load-so-follow-it-with-a-callback)).

An image capture's link also names its region as `region=x,y,w,h`. The stored `ImageRect` is a float in the image's own pixels (`toImageRect` scales the selection by natural over frame size), so the link rounds each number to two decimals. `readRegion` takes exactly four non-negative decimals or returns `null`. `regionDistance` is the largest of the four absolute differences, and a stored capture matches when its first region is on the same image and within `REGION_TOLERANCE` (0.01). Among several matches the nearest wins, then the first in book order ([floats in a URL](/javascript/gotchas/#a-float-rectangle-in-a-url-round-to-a-hundredth-match-by-distance)).
