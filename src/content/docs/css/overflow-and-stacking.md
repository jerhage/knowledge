---
title: "Overflow, Containing Blocks and Stacking"
description: "Why an absolutely positioned box escapes a scroller, what `z-index: auto` leaves alone, and how clipping and backgrounds treat edges."
tags: [css, layout]
sidebar:
  order: 5
---

Most of these come down to two questions: which box is the [containing block](/css/containing-block/) (the box an element is positioned and sized against), and which box clips or paints what.

## An absolutely positioned descendant escapes a scroller that is not its containing block

A box only clips a descendant if that descendant's containing block is the box itself or something inside it. A `position: absolute` element with no positioned ancestor gets laid out against the initial containing block, the viewport-sized box at the root of the page. So an `overflow: auto` ancestor doesn't clip it, and doesn't count it as its own scrollable overflow either. The document grows instead.

That means you can make an inner area the scroll container (`overflow-y: auto` in a `100vh` or `100dvh` shell) and still end up with the whole window scrolling. In my case the shell had a scrolling body region but still showed a page scrollbar. The cause was visually hidden elements inside list items (a `.visually-hidden` file input, a span). They're `position: absolute`, and their nearest positioned ancestor was outside the scroller, or there wasn't one at all between them and `<html>`. Each one got laid out at its static position (where it would sit in normal flow), deep in the scrolled content. With a long list, that's thousands of pixels down, and it still counted toward the document's scrollable overflow. `document.body.scrollHeight` measured a correct 900, while `document.documentElement.scrollHeight` measured 5251. That split is how you recognize this bug: the escaped element is in the document's overflow but not the body's.

The fix is `position: relative` on the scroll container. That fixes every one of those descendants at once and doesn't cost anything else.

To find the culprits, go through every absolute or fixed element whose rect ends below the viewport and whose `offsetParent` is outside the scroller.

If the element is supposed to escape (say, a menu that must not get clipped), use the [top layer](/html/top-layer/) instead. For an app shell where the document never scrolls, see [inner scrollers](/scrolling/inner-scrollers/).

## An absolutely positioned wrapper with `z-index: auto` does not reorder its children

Say an overlay is made of several positioned children, each with its own `z-index`, and you wrap them in a `position: absolute; inset: 0` layer to group them. You might expect the wrapper to start a new layering order for them. It doesn't: the paint order of its positioned children doesn't change. A stacking context is a group the browser layers as one unit, and `z-index` values only compete inside the same group. A positioned element with `z-index: auto` is treated as if it creates a stacking context for itself. But its positioned descendants, and descendants that create their own stacking context, still count as part of the parent's stacking context. So a positioned child's `z-index` compares against its old siblings' exactly like it did before the wrapper existed. The exception is the wrapper's non-positioned content. That now paints with the wrapper, in the positioned layer, above the parent's in-flow content.

## A scroll strip clips what an item draws outside itself

Setting `overflow-x: auto` makes `overflow-y` compute to `auto` too. So a horizontally scrolling tab list clips anything a tab draws above or below its own box. If a tab draws a rule line outside its box on hover, someone hovers the tab and the line is cut off at the strip's edge. You can't fix that by making the vertical axis visible, because it computes to `auto` next to a scrolling axis. In a strip like that, don't draw outside the item.

`overflow: clip` is the only value that can pair with `visible` on the other axis. That's the fix for clipped descenders (the parts of letters like g and y that hang below the line) in [font metrics](/css/font-metrics/#a-line-height-1-box-with-overflow-hidden-cuts-off-descenders).

## A child that fills a rounded, clipping parent changes its corners

A card with `border-radius` and `overflow: hidden` anti-aliases its own corners, blending the edge pixels so the curve looks smooth. Put a child inside that fills the box, and the corner pixels change, even when the child is the same color as the card. The parent's rounded edge clips the child's background separately, so the child bleeds into the anti-aliased edge, by up to 6 in a channel. A child with its own `overflow: hidden` (even at radius 0) around an image moved the covered corners by up to 2.

If a wrapper has to leave a rounded parent pixel-identical, it can't paint anything or clip anything: `background-color: transparent; overflow: visible`.

## A `no-repeat` fill does not reach under a transparent border

A ghost button has a transparent 1px border, and on hover I tint it with a background gradient. By default a background image is positioned in the padding box, the area inside the border. A `repeat`ing gradient tiles out into the border area too. So a hover tint drawn as `linear-gradient(tint 0 0)` covered the transparent border. The same gradient with `no-repeat` left a 1px ring with no tint. I needed `no-repeat` so a sweep could grow from `0% 100%`.

`background-origin: border-box` sizes and places the image from the border box instead, and the tint covers everything again.
