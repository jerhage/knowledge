---
title: "Grid Tracks and Flex Bases That Leak Width"
description: "How content-sized grid tracks and flex bases let a child's intrinsic width widen a page, and how to stop it."
tags: [css, layout]
sidebar:
  order: 6
---

When a grid track or flex basis is sized by its content, a child's intrinsic width (the width its own content gives it) can leak upwards and widen the page. The first two sections are the same kind of bug. The rest are about where a flex line breaks.

## A content-sized track swallows percentages

If a grid has no `grid-template-columns`, its single implicit column gets the `grid-auto-columns` size. That's `auto` by default, and a track sized that way never shrinks below its widest child's min-content. Inside a track like that, a child with a percentage width (`min(100%, …)`) can't resolve the percentage while the track is being sized. So it reports its full content width. (More on percentages and the [containing block](/css/containing-block/) they resolve against.) In my case, a horizontal scroll strip reported every card at full title width (~1466px), and that widened the whole page.

Fix: give the track `minmax(0, 1fr)` (or put `min-inline-size: 0` on the item). On a scroller that must never size its container, add `contain: inline-size`.

## A tab container that was a grid broke a screen below ~570px

**What I saw.** At phone widths a page scrolled sideways. A cover grid laid out three ~165px columns in a ~410px viewport. The tab row and the tools next to it ran off the right edge. The page background stopped at the viewport while the content kept going. It started at about 570px and got worse below that.

**The cause.** The tabs stylesheet had this:

```css
.tabs { display: grid; gap: var(--sp-4); min-inline-size: 0; }
```

`display: grid` + `gap` is a common shortcut for stacking children with spacing. But a grid with no `grid-template-columns` gets one implicit column sized `auto`, and an `auto` track grows to its widest child's min-content.

- The widest child was the tab panel, and its min-content came from the longest item title. Each title is truncated with `white-space: nowrap`, so its min-content is the whole title plus a menu button (490px for a long Japanese title).
- The cover grid's columns are `minmax(min(100%, var(--grid-min-col)), 1fr)`. While the grid's own width is being measured, that `100%` counts as `auto`, so the grid reported the title width upwards.
- The tab panel (`min-inline-size: auto`) passed it on, and the template-less `.tabs` column grew to fit it.

So `.tabs` kept its correct outer width, but its one column became ≈490px, and the panel and grid were laid out at that width. There was no fixed breakpoint. "≈570px" was just the longest title plus the main area's padding. Large images weren't the cause: an `<img>` at `inline-size: 100%` adds no minimum width.

**How to find it.** Start at the overflowing element and walk up, comparing each ancestor's width with its parent's. The first box that's wider than its parent is where the leak starts.

**The fix.** `.tabs` became `display: flex; flex-direction: column`. A flex column stretches its children to its own width, so a wide child can't widen it. Then I audited every template-less grid, and:

- turned most stacks into flex columns;
- gave the rest `grid-template-columns: minmax(0, 1fr)` (grids that get stretched in a row and share extra height, stack children with `grid-area: 1 / 1`, scroll, or have a two-column variant);
- allow-listed a few harmless ones, each with a reason (fixed-size icon boxes, a modal backdrop).

A spec now fails on any new grid without a column declaration.

**What I take from it.**

- A stack is a flex column. A real grid always declares its columns, and a single column is `minmax(0, 1fr)`. That's now a rule in my design system's [components layer](/design-systems/cascade-layers/#layer-components). A spec enforces it over every `display: grid` in components and utilities, with an allow-list (and a reason) for harmless cases like icon centering.
- Structure copied from a design example isn't neutral. Port its values, but question how it does layout.
- Test layout with realistic content (many items, long titles, large natural image sizes). Sweep widths, for example every 10px from 400 to 800, and measure `scrollWidth` against `clientWidth`, in every theme.
- This is the same kind of bug as [a content-sized track swallows percentages](#a-content-sized-track-swallows-percentages): content-sized tracks let a child's intrinsic width leak upwards.

## A flex item's basis sets whether its neighbor wraps

Say a wrapping flex row holds a text column and something next to it: a trailing figure, or an action button. When the row gets narrow, either the text column shrinks or the neighbor moves onto a new line. Which one happens depends on the text column's basis, because in a wrapping flex row the line breaks based on each item's hypothetical size, which starts from `flex-basis`.

- A text column at `flex: 1` (basis 0) doesn't push the next item onto a new line because of long text. It shrinks and wraps its own words instead. Its automatic minimum size (`min-inline-size: auto`) still keeps it from going below its min-content width. So only a single word, or an unbreakable run, that's too wide for the row can push the next item down.
- At `flex: 1 1 <min column width>`, the column takes its full basis first. A button next to it drops under the text once the row is narrower than basis + gap + button.

Use the first for a trailing figure that has to stay at the end. Use the second for actions that can move underneath.

## A flex basis on the control sets when an inline label wraps above it

An inline field puts its label and its control on one line when there's room, and stacks the label above the control when there isn't. The question is where that switch happens, and the flex bases set it. For an inline field, give the label `flex: 1 0 var(--field-label-width)` and the control `flex: 999 1 calc(2 * var(--field-label-width))`. A wrapping flex line breaks by the items' bases. So the pair stays on one line only while the field is at least three label widths plus the gap wide. Any narrower, and the control starts its own line and grows to the full width, and the label above it takes the full width too. While they share a line, the big grow factor gives the control nearly all the spare room.

When I set the control's basis equal to the label width, the pair only needed two label widths to stay on one line, so a phone kept a cramped input next to the label. That's why it's twice the label width. This is the `.field-inline` option in my [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline).

## An SVG under the reset's `max-width: 100%` shrinks with a squeezed container

A common reset gives `img, svg, video, canvas, picture` a `max-width: 100%`. A replaced element with a percentage max size is "compressible": its min-content contribution is 0, whatever its `inline-size`. You don't see anything until something sizes an ancestor to min-content, like a table column with `inline-size: 0`, a `min-content` grid track or a shrink-to-fit float. Then two things go wrong:

- an SVG that's a flex item, with the default `flex-shrink: 1`, shrinks, all the way down to 0 px;
- the `max-width: 100%` cap resolves against the squeezed parent, and `flex: none` doesn't lift a `max-width`. Icons in a table column shrunk to its content drew only a few pixels wide, even with `flex: none` on them.

So the fix is to never size a control's container to min-content. Align the cell to the end and leave the width automatic. If no container gets squeezed, no icon shrinks.

A headless probe with a copy of the markup may not reproduce what the live page does. Check a squeeze like this in the real page. More box-level surprises are in [layout quirks](/css/layout-quirks/).
