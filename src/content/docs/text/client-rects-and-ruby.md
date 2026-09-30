---
title: "getClientRects() Splits One Line into Several"
description: Why inline boxes such as ruby split a range's rectangles, and merging them per line in any writing mode.
tags: [selection, i18n, foliate-js]
sidebar:
  order: 4
---

## Ruby is why

My reader marks captured passages in an ebook chapter. A passage gets a highlight, and the passage you arrived at also gets an outline, a border drawn around it. foliate-js, the library that renders the chapter, draws both through its overlayer (an SVG layer over the text), from the rectangles the passage's range reports.

Drawing that border looked simple, and it wasn't. Drawing one box per rectangle gave me *three* stacked boxes around a single column of Japanese text. Other things ranges report are in [selections and ranges](/text/selection-and-ranges/).

### Where the extra rectangles come from

foliate's `Overlayer.add` (`overlayer.js`) builds its rectangles like this:

```ts
this.#splitRangeByParagraph(range).forEach((pRange) => {
    const pRects = Array.from(pRange.getClientRects()).map(...)
})
```

`Range.getClientRects()` gives back one rectangle per *box*, not per line of prose. A range gets a new box every time the inline flow is interrupted, and line breaks aren't the only interruptions:

- a line or column break: really a separate run on screen;
- *an inline element boundary*, such as `<ruby>`.

So 「まるで拳ほど」 with `<ruby>拳<rt>こぶし</rt></ruby>` in the middle gives *three* rectangles for *one* column: the part before the ruby, the ruby, and the part after it. `Overlayer.highlight` hides this, because three translucent fills that touch look like one wash. `Overlayer.outline` shows it: three strokes, three boxes, and text that's hard to read.

### The fix: union the rectangles that share a line

Merge them before drawing. foliate's draw function receives the rectangles, so the merge goes in between foliate measuring and foliate painting:

```ts
drawing.draw((rects, options) => ring(joinedLines(rects), options), ...)
```

Two rectangles get joined when they share a line and touch:

```ts
function sharesALine(one, other) {
  const column = near(one.left, other.left) && near(one.width, other.width);
  const row = near(one.top, other.top) && near(one.height, other.height);
  return column || row;
}
```

That `||` is the whole trick. It's what makes this work in any writing mode. In horizontal text, a line is a *row*: the pieces share a top edge and a height, and they vary along x. In vertical Japanese, a line is a *column*: the pieces share a left edge and a width, and they vary along y. Testing for a shared row or column covers both cases without ever reading `writing-mode`. That matters, because reading the computed style would mean reaching across into the frame's realm.

The other half of the test, `touches`, uses the separating-axis idea in one line: take the largest gap on any axis. Two boxes overlap or touch exactly when that gap isn't positive.

```ts
const apart = Math.max(
  one.left - other.right, other.left - one.right,
  one.top - other.bottom, other.top - one.bottom);
```

A tolerance of about 2 px soaks up sub-pixel layout. Without it, two pieces that look like they touch would be left with a hairline gap between them. The same tolerance is why the line test above compares edges with `near` instead of `===`: a ruby's own box is often a fraction of a pixel narrower than the text next to it.

### What the merge does not do

A passage that spans several *different* lines still draws one box per line. Those really are separate runs on screen. Wrapping them in a single outline means computing a concave polygon around a staircase of boxes, which is a much bigger job. What's gone is the stacking *within* one line.

### The general lesson

The rectangles a range reports describe *layout boxes*, not lines of text. Any drawing code written for one rectangle per line breaks the first time an inline element shows up inside the range. In Japanese that's furigana, so it happens all the time. The merge works whatever writing mode a chapter ends up in. How foliate determines that for each chapter is in [foliate-js chapter styles and writing modes](/ebooks/foliate-chapters/).
