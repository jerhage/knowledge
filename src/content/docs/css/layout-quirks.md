---
title: "Layout Quirks: Struts, Ratios and Collapsing Panels"
description: "Box-level surprises: line-box struts, `aspect-ratio` on bordered and flex boxes, `display: contents`, and panels that keep their height."
tags: [css, layout, safari]
sidebar:
  order: 7
---

Small box-level things that each cost me a pixel diff or a Safari-only bug. Width leaking through grid tracks and flex bases is on [grid and flex sizing](/css/grid-and-flex-sizing/).

## An inline-flex label in a block adds the parent's strut to the row

Say a list has one block `li` per row, and each row holds a label that's `inline-flex` (in my case, the label of a radio option). Because the label is inline-level, it sits on a line box inside the `li`.

That line box also holds the `li`'s own strut. The strut is the invisible, zero-width inline box that every line box starts with, and it has the block's font (16 px here) and line height (24 px). It reaches higher above the baseline than a smaller label's first line does. So the line box ends up about 5 px taller than the label, and all of the extra is above it. You see a row with more space above the label than you asked for, and no rule on the label explains it.

Make the label itself the padded box (a block flex tile) and the strut goes away: the row shrinks and the text moves up. If the same label is a flex or grid item, it's blockified (its display becomes block-level) and has no strut. That's why padding can move onto a label like that pixel for pixel in a flex or grid list, but not in a block list.

## A `kbd` as a flex item is taller than an inline `kbd`

Say a hint like "⌘K to search" is a line of text with the key in a `kbd`. An inline `kbd` draws its padding and border around the font's content area (17 px at a 14 px font size, for example).

Now put the same hint in a flex row. The `kbd` becomes a flex item, which makes it a block box, as tall as its line height plus the border (21.5 px). A space between it and the next word also turns into a flex gap.

So if you move an inline "⌘K to search" into a flex hint row, it visibly changes, even with identical CSS on the `kbd`.

## A component that joins its caller's row has a `display: contents` root

I have a page-header component that draws a back link and a title column. The caller places it inside its own wrapping flex row, and those two parts have to stay items of that row. If the component's wrapper is a box of its own, the row gets one item instead of two, and that changes where the row wraps and how the row's gap and `flex: 1` apply.

Give its root one rule, `display: contents`. The element then has no box, and its children get laid out as the caller's items, while the component still has a base class on its root.

The element is still in the DOM, though. A probe that walks the tree finds a 0 × 0 `DIV` with `display: contents`, so skip it before comparing rects. For a generic `div`, it adds nothing to the accessibility tree.

## A ratio on a bordered box is the border box's ratio

Say a card has a 1 px border and a portrait ratio, and uses `box-sizing: border-box`. With that box sizing, `aspect-ratio` sizes the border box, so the card is 1.5 × its width tall, border included.

Put the same ratio on a media box inside that border instead, and the card gets 1 px shorter. The inner width loses 2 px, times 1.5, then the 2 px border is added back. So when you swap which element has the ratio, check it with a pixel diff.

More from the same work:

- A rendered `<legend>` is laid out by the fieldset, not as a flex or grid item, so it can't share a row with a control. A floated legend stops being the rendered legend, and that's engine-dependent enough that I'd build a settings row with `role="group"` and `aria-labelledby` instead.
- A utility on a base component's root (`class="gap-1"`) overrides the component's own gap, because `utilities` is a later layer than `components`. More on that in [design system mechanics in practice](/design-systems/in-practice/#between-two-utilities-the-later-rule-in-the-file-wins).

## WebKit sizes an `aspect-ratio` box with a percentage height by its content

Take a box with `block-size: 100%` and an `aspect-ratio`, inside a flex row whose width comes from its content (`flex-shrink: 0`). Inside the box is an in-flow `<img>` or `<canvas>` at `width: 100%`. Both engines give the box the ratio's width.

The row's own width is a different calculation. To size the row, the engine computes the box's max-content contribution. In that step, WebKit doesn't resolve a percentage height through the ratio. It uses the box's content instead, and here that's the picture's natural pixel width. So the flex row gets laid out as wide as the image file (1000 px on a 541 px page), and every size you read from the row is wrong. Chromium does resolve it through the ratio, so a test in Chromium never catches this.

The row's width also depends on the state of the picture. A 0 × 0 placeholder canvas contributes 0, and a loaded image contributes its natural width. So measuring the row at two different moments can give different results, with nobody changing the layout in between.

It takes two changes together to fix it. Neither works alone:

1. Take the picture out of flow (`position: absolute; inset: 0`).
2. Give the box a length height instead of a percentage. `100cqb` inside a `container-type: size` ancestor is a length with the same value.

Taking only the picture out of flow gives a 0 px row. So does `contain: size` on the box.

## A dock that hides must be sized by its content, not by a class

On phones, my reader has a panel at the bottom of the screen: a toggle, and under it a list that the toggle shows and hides. The panel is a flex item in a column, and its open size came from `block-size: 40%` on the panel element itself. Hiding swapped a class on the panel, so the panel's own block size went from a percentage of its flex container back to `auto`.

On iOS Safari, the panel kept its open height after I hid it. Someone taps the toggle to hide the list: the toggle still shows and the list is gone, but a blank band about 40% of the screen tall stays below the toggle, so the page area never grows back. Chromium redoes the layout correctly after the class change. I couldn't reproduce the stale height outside Safari, so the cause here is a deduction: a flex item loses its own percentage block size through a class change, next to a sibling whose size depends on it.

Fix: move the size onto the part that gets shown and hidden, for example

```css
.dock-sheet .dock-panel { block-size: 40dvh }
```

and take `flex: 1` off that child. Its `flex-basis: 0%` in an auto-height column resolves as content, and would override the block size. (And if `flex-1` is a utility in a later layer than the component rule, the component can't reset the basis.) Now the container is `auto` everywhere it's placed. Hiding sets `display: none` on the child, which removes its box, so the container shrinks the ordinary way it does when content is removed. `dvh` is a viewport length resolved at style time, so nothing depends on the flex container's height being definite.

The rule: when a panel collapses, give the size to the child that collapses and leave its parent `auto`. Don't toggle a percentage block size on a flex item. And remember that a utility `flex-1` on that child sets a basis that a component rule in an earlier layer can't override.

The dock as a bottom sheet over the page is one of the options in my [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline). Why the sheet should sit over the page instead of shrinking it is on [reading-app layout](/ui-patterns/reader-layout/#a-bottom-sheet-that-shrinks-the-page-costs-a-reflowing-viewer-a-relayout).
