---
title: Containing Blocks
description: How the containing block is found for each position value, which properties create one for fixed and absolute boxes, what percentages resolve against, and how it sets what overflow clips.
tags: [css, layout]
sidebar:
  order: 11
---

The containing block is the rectangle a box gets sized and positioned against. Percentages, insets and the edge an `absolute` box sits against all come from it. A lot of the time it's the parent's content box, but not always. When it isn't, things "escape". A dropdown doesn't get clipped by the card it's in, or a hidden input makes the document taller instead of the scroller around it.

## How it's found

It depends on the box's own `position`:

| `position` | Containing block |
| --- | --- |
| `static`, `relative`, `sticky` | the **content box** of the nearest ancestor that is a block container or establishes a formatting context (a flex or grid container, a table, a block) |
| `absolute` | the **padding box** of the nearest ancestor that establishes an absolute positioning containing block: any `position` other than `static`, or one of the properties below. None: the initial containing block |
| `fixed` | the viewport (on screen) or the page area (in print), unless an ancestor has one of the properties below |

The initial containing block is the one the root element lives in. On screen it's the size of the viewport and sits at the canvas origin, so it scrolls with the document. A `fixed` box's default containing block is the layout viewport, which doesn't scroll. CSS Positioned Layout 3 says that viewport matches the dynamic viewport size.

If an `absolute` box's containing block is a grid container, the box can use a grid area as its containing block instead (`grid-area` on the absolute box). CSS Positioned Layout 3 calls that out as an exception to the padding-box rule. The other exception is an inline ancestor, like a positioned `<span>`. Then the rectangle comes from the content edges of the span's first and last fragments.

## Properties that capture `fixed` and `absolute`

Any of these makes an element the containing block for both `absolute` and `fixed` descendants, even when it's `position: static`. This is MDN's list:

- `transform`, `translate`, `rotate`, `scale` or `perspective` other than `none`
- `filter` or `backdrop-filter` other than `none`
- `contain: layout`, `paint`, `strict` or `content`
- `content-visibility: auto`
- `will-change` naming any property that would create one (`will-change: transform`)

CSS Transforms 2 adds `transform-style: preserve-3d`, which MDN's list leaves out.

```css
.zoom-surface {
  transform: translate(var(--pan-x), var(--pan-y)) scale(var(--zoom));
}
.zoom-surface .overlay {
  position: fixed; /* not the viewport: it is placed and scaled with the surface */
  inset: 0;
}
```

This is the classic `position: fixed` bug. You put a modal or toast inside an animated or transformed wrapper. The wrapper's `transform` makes it the modal's containing block, so the modal gets placed (and scaled) against the wrapper and stops being fixed to the viewport. It cuts the other way too. An absolute overlay inside a zoomed surface uses the surface's own coordinates, and that's exactly what I want for a [selection marquee](/interaction/selection-marquee/) drawn over a zoomed image.

Details from the specs:

- `filter` on the root element doesn't create one (Filter Effects 1). `transform` has no such exception.
- CSS Transforms 1 says a transformed element's padding box becomes the containing block for its fixed and absolute descendants, and for fixed background attachments too. So `background-attachment: fixed` inside a transform stops being fixed.

MDN notes that browsers have been inconsistent about `perspective` and `filter` here.

## Percentages resolve against it

- `width`, `left`, `right`, **`padding`** and **`margin`** (all four sides) use the containing block's **width**.
- `height`, `top` and `bottom` use its **height**.

So `padding-top: 50%` is half the containing block's width. That's how the old aspect-ratio box trick worked. It's also how a `clamp()` can step a value at a breakpoint without a container query (see [tokens at runtime](/css/tokens-at-runtime/)).

For an `absolute` box, the base is the containing block's padding box, so the ancestor's padding counts. MDN's example: an absolute section of 400 × 160 with 30px/20px padding gives a child with `width: 50%` a width of 220px, not 200px.

**Percentage heights often do nothing.** From CSS 2.1 §10.5: if the containing block's height isn't set explicitly (it depends on its content) and the box isn't absolutely positioned, a percentage `height` computes to `auto`. So `height: 100%` on a child of an auto-height block is just `auto`. Flex and grid have their own rules for when an item's size counts as definite, and that's where it starts working again: see [grid and flex sizing](/css/grid-and-flex-sizing/).

## Overflow clips along the containing block chain

CSS 2.1 §11.1.1 says `overflow` clips the element's content "except any descendant elements … whose containing block is the viewport or an ancestor of the element". So a box only clips (and only scrolls) descendants whose containing block is that box or something inside it.

```html
<div class="scroller" style="overflow: auto; height: 300px">
  <!-- … a long list … -->
  <input type="file" class="visually-hidden"> <!-- position: absolute -->
</div>
```

There's no positioned ancestor between the hidden input and the root, so its containing block is the initial containing block. The scroller doesn't clip it, and doesn't count it as its own scrollable overflow either. The input sits at its static position (where it would be in normal flow) deep in the list, and makes the whole document scroll. Adding `position: relative` to the scroller makes it the containing block, and that fixes every descendant like this at once. The full story, and how to find the culprits, is in [overflow and stacking](/css/overflow-and-stacking/).

The same rule explains why an absolute dropdown inside a card with `overflow: hidden` gets clipped when the card is positioned, and escapes when it isn't. Relying on that breaks easily: the escape works only as long as nothing between the dropdown and the root becomes its containing block, and any ancestor that later gets a `position` or one of the capturing properties above ends it. The reliable way out is the top layer.

## The top layer

An element in the top layer ([dialogs, popovers](/html/top-layer/)) is laid out as if it were a sibling of the root. CSS Positioned Layout 4 gives it the viewport as its containing block if its `position` is `fixed`, and the initial containing block otherwise (any `position` other than `absolute` or `fixed` computes to `absolute`). The `overflow`, `transform` and so on of its ancestors stop applying. The popover UA styles (the browser's built-in stylesheet) use `position: fixed`: see [the Popover API](/html/popover-api/).

## Footguns

**A `transform` for animation breaks `fixed` children.** Say a slide-in wrapper keeps `transform: translateX(0)` after the animation ends. That transform doesn't move anything, but it isn't `none`, so the wrapper is still a containing block for every `fixed` element inside it. Remove it at rest (`transform: none`), or move the fixed element out of the wrapper.

**`will-change: transform` does it too,** even when no transform is applied, because `will-change` naming a property that would create a containing block creates one itself.

**`contain: paint` or `content`**, added for performance, also captures fixed descendants and clips them. Both are on the list above, so a fixed toast inside such an element gets placed against it and cut off at its edges.

**`offsetParent` is close to the containing block, but not the same.** CSSOM View defines it as the nearest ancestor that's a containing block for absolute descendants (including the capturing properties above). But it also stops at `<body>`, and for a static element, at a `td`, `th` or `table`. It's still a good way to hunt for escaped elements: if an absolute element's `offsetParent` is outside the scroller, it escaped.

## References

- [MDN: Layout and the containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Display/Containing_block)
- [CSS 2.1 §10.1: Definition of "containing block"](https://www.w3.org/TR/CSS2/visudet.html#containing-block-details)
- [CSS 2.1 §10.5: the `height` property](https://www.w3.org/TR/CSS2/visudet.html#the-height-property)
- [CSS 2.1 §11.1.1: Overflow](https://www.w3.org/TR/CSS2/visufx.html#overflow)
- [CSS Positioned Layout 3: Containing Blocks of Positioned Boxes](https://drafts.csswg.org/css-position-3/#def-cb)
- [CSS Positioned Layout 4: Top Layer](https://drafts.csswg.org/css-position-4/#top-layer)
- [CSS Transforms 1: the `transform` property](https://drafts.csswg.org/css-transforms-1/#transform-property)
- [Filter Effects 1: the `filter` property](https://www.w3.org/TR/filter-effects-1/#FilterProperty)
- [CSS Containment 2: layout containment](https://drafts.csswg.org/css-contain-2/#containment-layout)
- [CSSOM View: `offsetParent`](https://drafts.csswg.org/cssom-view/#dom-htmlelement-offsetparent)
