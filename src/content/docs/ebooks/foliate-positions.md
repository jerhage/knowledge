---
title: "foliate-js: Anchors, Relocations and Reading Position"
description: 'How foliate-js keeps the place across a re-flow, what its relocate reasons mean, and how to judge navigation, order and "finished".'
tags: [foliate-js, javascript]
sidebar:
  order: 1
---

Dokseo, my manga and book reader, shows EPUB books with foliate-js, a library that lays a book out in pages, and it saves the place someone has reached so the book reopens there. foliate reports that place as a CFI (EPUB Canonical Fragment Identifier, a string that points to a location in the book). These are the parts of foliate that determine whether the saved place is right. Checked against foliate-js 1.0.1.

## foliate re-anchors to the last visible range, so a re-flow keeps the place

The app injects its own styles into each chapter through foliate, for the theme colors and the text settings. Changing an injected style, like a bigger font, re-paginates the chapter. The obvious worry is that the reader gets thrown somewhere else. They don't, and the host doesn't have to save or restore anything. I traced it through foliate-js:

1. `Paginator.setStyles` (`paginator.js`) rewrites the `textContent` of the two `<style>` elements it prepended and appended to the *current* chapter document. It stores them in `#styles` for the next chapter load, and ends with `#view.document.fonts.ready.then(() => this.#view.expand())`.
2. The inner `View` also holds `new ResizeObserver(() => this.expand())` on the chapter body, so the re-flow triggers the same call on its own.
3. `View.expand()` ends with `this.onExpand()`.
4. `onExpand` is bound once, at `#createView()`, to `() => this.#scrollToAnchor(this.#anchor)`.
5. `#anchor` is the last visible `Range`. `#afterScroll` assigns it for every relocation whose reason isn't `selection`, `navigation` or `anchor`.

So the anchor is a live DOM range in the chapter. It isn't a CFI and it isn't a page number, and re-anchoring to it after a re-layout is foliate's own job. So a CFI round trip written "to be safe" would be *coarser* than what foliate already holds, and would make things worse. And one `setStyles` call covers both the chapter on screen and every chapter after it. A settings change doesn't need a re-open or a second mechanism. (Getting theme colors in through `setStyles` is on [foliate-js chapter styles](/ebooks/foliate-chapters/).)

The relocate that follows has a new CFI, so a debounced position save records where the reader is now, which is correct.

## foliate relocates without the reader moving, and reports the reason only on the renderer

foliate fires a `relocate` event whenever the visible place changes, and the app saves the position from it. Code like that often has to check whether the reader actually moved. foliate-js's paginator (1.0.1) dispatches `relocate` with a `reason`:

| reason | when |
| --- | --- |
| `page` | a paginated turn |
| `snap` | a swipe settling |
| `scroll` | scrolled mode, debounced |
| `navigation` / `selection` | a `goTo` |
| `anchor` | the default of `#scrollToAnchor` |
| `null` | a scrolled-mode page turn |

The fixed-layout renderer adds `page` and `undefined` from `goTo`.

`anchor` fires without the reader doing anything. It comes from fonts ready → `expand()` → `onExpand`, from a `ResizeObserver` on the chapter body or on the paginator (→ `render()`), and from every `setStyles`. Its CFI is the CFI of the visible range, so a re-layout of the same page can report a different CFI. Never read "a different CFI" as "the reader moved".

`View.#onRelocate` *drops* the reason from its own `relocate` event. To read it, listen on `view.renderer` (it only exists after `view.open()`), and take the place from `view.lastLocation`. The view registered its renderer listener first, so by the time yours runs, `lastLocation` already describes this event.

## foliate's "not found" results are null and -1, not undefined

The app sends the reader to places in a book: a link's href, or a stored CFI. It has to check whether the jump happened. In foliate-js, `book.resolveHref` returns `null` for an href the book doesn't have. `resolveCFI` for a CFI past the end of the spine gives `index: -1` (it's a `findIndex`). The paginator then does nothing, but `view.goTo` still returns the target. So a caller that only checked for `undefined` either threw on `resolved.index` or counted a non-move as an arrival.

Return a union from your navigate wrapper (`arrived | unresolved | no-body | refused`), and treat `null`, `undefined` and an index outside `[0, sections)` as `unresolved`. The rule: never trust what a foliate call returns as proof that you arrived. Check the resolved section index first.

## A CFI does not sort as a string; foliate's `compare` does, and runs in Node

The app keeps passages saved from a book, each with a CFI, and lists them in book order. Sorting the CFIs as strings gets that order wrong. `epubcfi(/6/14!…)` is chapter 7 and `epubcfi(/6/4!…)` is chapter 2, but as text, `/6/14` sorts first. `compare` from `foliate-js/epubcfi.js` parses both and compares the steps as numbers, then the character offset. A range CFI is compared by its start, then its end. It's pure string work with no DOM, so a plain Node unit test can import it. It never threw on anything I tried (an empty string or garbage sorts first). If I keep foliate imports to one module, pass the comparer to the others as a function. (Other comparators that aren't quite orders are on [JavaScript gotchas](/javascript/gotchas/).)

A CFI stored from a selection is only as good as the moment it was read. A click dooms a selection before the browser clears it: see [selections and ranges](/text/selection-and-ranges/).

## Finished means "the last page was shown", not "the saved index is last"

The library shows whether each book is finished, and the obvious test is whether the saved place is the last page. That test fails. Say a reader reopens at a stored index (the first page of a spread, or the image at the top of a strip). It can never store `n-1` for a closing spread, or for a short last image in a vertical strip. So store two fields: where to reopen, and how far the reader saw (`index` and `shownThrough`). Judge "finished" by the second one.

foliate's fraction is the *end* of the page (`progress.js` adds the page size), but floating point can make the last page `0.9999999999999999`. Compare with a small epsilon (1e-9).

The two fields still can't distinguish a one-page book that was just imported from one that was read (`{ index: 0, shownThrough: 0 }` is both). So "started" also needs a last-read timestamp, and anything that resets the place (mark unread) has to clear it too.
