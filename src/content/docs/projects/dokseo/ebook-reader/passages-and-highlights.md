---
title: Ebook Passages and Highlights
description: How a text selection in a chapter becomes a passage, why the quote is built at the commit, how highlights merge rectangles per line, and how passages are ordered.
tags: [dokseo, selection, foliate-js, unicode, i18n]
sidebar:
  order: 51
---

In an image book, a capture is a box drawn over a page. In an ebook, a capture is a passage: I select some text in a chapter and save it. Dokseo, my manga and book reader, stores the passage's text and its place in the book, draws saved passages as highlights in the chapter, and can take me back to one later. The chapters come from foliate-js, each in its own iframe (see [chapters](/projects/dokseo/ebook-reader/chapters/)). The general side is in [selections and ranges](/text/selection-and-ranges/) and [client rects and ruby](/text/client-rects-and-ruby/). The measurements here were taken in Chromium against real Japanese books.

## Where a passage lives

Captures belong to the `recognition` domain, and the ebook reader is the `flowing` domain. They meet in a small shared type, `Anchor`, in `shared/anchor.ts`, one of the shared kernel files. `recognition` produces an `Anchor` as a capture's place, and `flowing` reads it to find the passage in the chapter and highlight it. The domains are on [domains](/projects/dokseo/architecture/domains/).

## The text of a passage

Japanese books are full of ruby: small readings (furigana) printed beside a character, written in HTML as `<ruby>鍵<rt>かぎ</rt></ruby>`. If you get a selection's text with `range.toString()`, you get the base and the reading run together, `鍵かぎ`, which is a word nobody can look up.

So Dokseo clones the range with `cloneContents()`, removes the `rt` and `rp` elements from the clone, and reads its `textContent`. The clone is already trimmed to the selection, so a selection that starts or ends inside a ruby works too. A passage also stores some text before and after the selection, as context, and Dokseo uses the same function for those, so the quote and the passage always hold the same chapter text. The context ranges run from `selectNodeContents(doc.body)` to the selection's start, and from its end to the end of the body. See [`Range.toString()` includes the ruby reading](/text/selection-and-ranges/#rangetostring-includes-the-ruby-reading-and-a-cloned-fragment-does-not).

## The stale pencil

While text is selected in a chapter, a pencil button appears for saving the selection as a passage. The first version showed or hid it on `pointerup`, after reading `getSelection()`.

That went wrong when you select some text, then click somewhere else in the chapter to deselect it. The highlight disappears, but the pencil stays, and pressing it saves a passage you can't see any more. Everything saved from it would look valid: a real range, a real CFI, a real quote.

The cause is timing. A plain click doesn't clear the selection while its own pointer events are dispatched. The clearing comes in a `selectionchange` task that runs after them. The log from capturing listeners on the chapter document:

```text
pointerdown:     "あざの耕平…" collapsed=false
pointerup:       "あざの耕平…" collapsed=false
selectionchange: ""           collapsed=true
```

So on `pointerup`, the selection is still there, and it's already doomed. Now the same `selectionchange` that clears the selection also takes the pencil away. The UI follows the selection, not the gesture that happened before it.

The offer itself is a view model, `LiftOffer` (`flowing/ui/lift-offer.svelte.ts`). Each `selectionchange` calls its `ask` method, which schedules one fresh read of the selection on the next animation frame. The frames come from a `FrameClock` passed to the constructor, so its spec can step them by hand. Where the pencil goes is a pure function, `liftSpot` in `flow-lift.ts`.

The same measurement showed that Chromium coalesces `selectionchange`: thirty keyboard extensions of the selection back to back gave one event. And a selection inside the chapter's iframe survives a real click on a button in the host page, so a host control can read the chapter's selection when it's pressed. See [a click collapses a selection after `pointerup`](/text/selection-and-ranges/#a-click-collapses-a-selection-after-pointerup-so-anything-read-there-is-already-condemned).

## The quote is built at the commit

A saved passage has a `TextQuote`: the selected text plus the context before and after it. `quoteAround` in `flow-passage.ts` builds it by cloning the range from the start of `<body>` to the selection, the selection itself, and from the selection to the end. That's a lot of cloning. Over a 25,061-character chapter, twenty calls each:

| work | per call |
| --- | --- |
| `quoteAround` | 69.2 ms |
| `range.getClientRects()` | 0.015 ms |

69 ms is fine once, when I save. It's far too slow to run on every change while I'm still dragging out a selection. So while a selection is live, anything that follows it only reads its rects, and Dokseo builds the quote when I commit. That's also the right moment, because then the quote comes from the selection that's actually standing. See [building a text quote costs 69 ms](/text/selection-and-ranges/#building-a-text-quote-costs-69-ms-per-call-and-the-rects-cost-0015-ms).

The rects have a catch of their own. foliate lays a chapter out in columns and shows one screen of them at a time, so a selection that runs past the bottom of the visible page continues in the next column, which is off the frame. Those lines are still in `getClientRects()`, and a box spanning all of them reaches far off screen. So anything Dokseo positions from a selection's rects first keeps only the rects that overlap the stage on both axes. That same filter drops the non-finite rect a chapter frame produces when it can't be placed. See [`range.getClientRects()` returns the lines the reader cannot see](/text/selection-and-ranges/#rangegetclientrects-returns-the-lines-the-reader-cannot-see-too).

## One outline per line

Saved passages are drawn by foliate's overlayer, an SVG layer over the chapter. A plain highlight is a translucent fill. When I jump to a passage, it also gets an outline, the arrival ring, so I can see where the jump went.

The first outline drew one box per rectangle from `getClientRects()`, and around a single column of Japanese text it drew three stacked boxes. I noticed it from a screenshot. The cause was ruby again. `getClientRects()` returns one rectangle per layout box, not per line, and a `<ruby>` in the middle of a line splits it into three boxes: before the ruby, the ruby, and after it. Three translucent fills that touch look like one, so the highlight hid this. Three outlines don't.

The fix is `joinedLines` in `flowing/ui/flow-highlight.ts`, which merges the rectangles that share a line and touch. foliate accepts a draw function from Dokseo, and that function receives the rectangles before anything is painted, so the merge goes right there:

```ts
drawing.draw((rects, options) => ring(joinedLines(rects), options), ...)
```

Its tolerance is `SAME_LINE_TOLERANCE_PX = 2`, which soaks up sub-pixel differences between the pieces. How it detects that two rects share a line in both horizontal and vertical text, without reading `writing-mode` from inside the chapter, is in [the fix: union the rectangles that share a line](/text/client-rects-and-ruby/#the-fix-union-the-rectangles-that-share-a-line). A passage over several lines still gets one box per line, which is what the screen really shows.

The ring's stroke width comes from the `--border-width` token. That token is registered with `@property` as an inherited `<length>`, so `flow-highlight.ts` can read it in pixels with `pixelLength`. The token is on [tokens](/projects/dokseo/design-system/tokens/#borders-focus-backdrop-and-underline).

### Checking the paint

For a while I couldn't check any of this from a test, because foliate's `<foliate-view>` and `<foliate-paginator>` attach closed shadow roots, and a script can't reach inside them. A Playwright probe can, if an init script forces `attachShadow` to open them. Then the overlayer's `svg` is reachable. A highlight there is a `g` with `fill` and the group opacity, and the arrival outline is a `g` with `stroke` and `stroke-width`, holding one `rect` per joined line. The technique is in [a probe can open foliate's closed shadow roots](/ebooks/foliate-chapters/#a-probe-can-open-foliates-closed-shadow-roots).

## Ordering passages

The capture list shows an ebook's passages in book order. A passage's place is a CFI, the EPUB position string, and CFIs don't sort as strings (`/6/14` is chapter 7 but sorts before `/6/4`, chapter 2). foliate has a `compare` that sorts them correctly ([the general page](/ebooks/foliate-positions/#a-cfi-does-not-sort-as-a-string-foliates-compare-does-and-runs-in-node)).

The catch is where the code lives. foliate's `compare` is imported only inside `flowing`, but the capture list is in `recognition`, and `recognition` may not import `flowing`. So `recognition` declares the function it needs as a `PassageOrder` type, `flowing/ui/flow-passage-order.ts` implements it as `comparePassages`, and the route passes one to the other. That wiring is on [composing screens](/projects/dokseo/architecture/composing-screens/).
