---
title: "Selections and Ranges: Ruby, Timing and Cost"
description: Reading ruby-free text from a range, when a click clears a selection, what rects include, costs, and `lang` for CJK.
tags: [selection, i18n, unicode, html]
sidebar:
  order: 3
---

I measured all of this in Chromium against real Japanese books, mostly inside the chapter iframes of an EPUB reader (foliate-js; see [foliate-js positions](/ebooks/foliate-positions/)).

## `Range.toString()` includes the ruby reading, and a cloned fragment does not

If you select `<ruby>鍵<rt>かぎ</rt></ruby>` and call `toString()` on the range, you get `鍵かぎ`: the base *and* the furigana, run together. I measured this in Chromium against a real Japanese novel. Every Japanese EPUB is full of ruby, so anything that stores `range.toString()` as a passage ends up storing words nobody can look up.

`Range.cloneContents()` returns a `DocumentFragment` that you can edit before reading it:

```ts
for (const reading of fragment.querySelectorAll('rt, rp')) reading.remove();
return fragment.textContent ?? '';
```

That handles a partial selection inside a ruby for free, because the clone is already trimmed to the range. Use the same function for the surrounding context as for the selection itself. Otherwise the quote and the text don't match.

Build the context ranges with `selectNodeContents(doc.body)` and then `setEnd(range.startContainer, range.startOffset)`, and the mirror image of that for the suffix. That way you don't need a special case for a boundary that's an *element* plus a child index. That's what a triple click produces, and a backwards `TreeWalker` has to handle it by hand.

## A click collapses a selection after `pointerup`, so anything read there is already condemned

When someone selects text in a chapter, my reader shows a button that offers to save the selection as a passage. The question is when to read the selection, and when to take the offer away again. A click elsewhere clears a selection, but not at the moment it looks like it does.

Measured in Chromium against a real document, with capturing listeners:

```text
pointerdown:     "あざの耕平…" collapsed=false
pointerup:       "あざの耕平…" collapsed=false
selectionchange: ""           collapsed=true
```

A plain click doesn't clear the selection while its own pointer events are being dispatched. The clearing comes in a `selectionchange` task that runs after them. So code that calls `getSelection()` on `pointerup` reads a selection the browser is about to throw away. Anything it stores from that looks perfectly valid (a real range, a real CFI, a real quote), for a passage the reader can't see highlighted anymore.

Don't try to spot a dying selection when you read it. Instead, let the same `selectionchange` that collapses the selection also take the save button away. Drive the UI from the selection, never from the gesture that happened to come before it.

The same measurement also showed:

- Chromium coalesces `selectionchange`. Thirty keyboard extensions sent back to back produced one event, and the same thirty at 33 ms intervals produced eleven.
- A selection inside an iframe survives a real click on the host page, through `pointerdown`, `mousedown`, `pointerup` and `click` on a host button. So a control in the host can read the frame's selection when it's pressed. (What else does and doesn't cross the frame boundary is in [same-origin iframes](/html/iframes/).)

## Building a text quote costs 69 ms per call, and the rects cost 0.015 ms

A saved passage includes a text quote: the selected text plus some of the text before and after it. Building a quote (prefix, exact text, suffix) means cloning the range from the start of `<body>` to the selection, and from the selection to the end. That's expensive. Measured in Chromium over a real 25,061-character chapter, twenty calls each:

| work | per call |
| --- | --- |
| the two context clones plus the selection's own | **69.2 ms** |
| `range.getClientRects()` | **0.015 ms** |

That's fine once per gesture and out of the question on every keystroke. Anything that follows a live selection should only read rects, and leave the quote until the reader commits. That's also the right moment for it, because then the quote comes from the selection that's actually there.

## `range.getClientRects()` returns the lines the reader cannot see, too

To place something next to a selection, you take the bounding box of the selection's rects. In a paginated layout built from columns, a selection that runs past the bottom of the visible page continues into the next column, which has scrolled out of the frame. Every one of those lines is still in `getClientRects()`. So a bounding box over all of them spans hundreds of pixels of nothing, and anything positioned from it ends up off the screen.

Filter down to the rects that overlap the stage (the visible area the chapter is shown in) on both axes *before* you span them. That also drops a non-finite rect (the kind a frame that can't be placed produces) without needing its own branch.

The rects also get split within a single line wherever an inline element such as ruby interrupts it; see [`getClientRects()` splits one line into several](/text/client-rects-and-ruby/).

## Han characters are unified in Unicode

Unicode gives a unified Han character one code point, even when Chinese and Japanese draw it differently, so the code point alone doesn't determine which form to draw. Without `lang`, a browser may render Japanese text with Chinese glyph forms, and a learner reads that as the wrong character. Every element that holds CJK text needs `lang` and a matching font stack.
