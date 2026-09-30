---
title: Utilities and Layout Patterns in Dokseo
description: Dokseo's own utilities, the app-shell and layout patterns, and how file order settles ties between utilities.
tags: [dokseo, css, design-systems, layout, naming-conventions]
sidebar:
  order: 24
---

Utilities are the small single-purpose classes (`.row`, `.truncate`, `.p-4`) that pages and components put beside a component's own class. In Dokseo, my manga and book reader, they live in `src/lib/styles/utilities/`, and `index.css` imports all of them into `@layer utilities`, which comes after `components` and `features`, so a utility wins over both. The naming rules are on [utility pattern](/design-systems/naming-conventions/#utility-pattern) and [class conventions](/design-systems/naming-conventions/#class-conventions). Dokseo adds its own utilities, layout patterns, and narrow-screen helpers for the app shell.

## Dokseo's own utilities

| Utility | Class / effect |
| --- | --- |
| `.callout-top-start`, `.callout-top-center` | floats a callout a step below `--pin-drop`, set by an ancestor, at the start or centered |
| `.text-center` | `text-align: center` |
| `.eyebrow` | the small upper-case caption over a group: `text-xs`, `--ls-wider`, `uppercase`, nothing else; face and weight come from the utilities beside it, and its color is always `text-faint` (`eyebrow text-faint`, `eyebrow mono text-faint`; the component eyebrows set `--color-text-faint` in their own rule). First rule in `text.css`, so a size, face, weight or color utility on the same element wins. `Card`'s eyebrow, `ListGroup`'s title, `Stat`'s label, `DropdownLabel`, a labeled `Divider` and `TableHeaderCell` apply it |
| `.truncate` | one line cut with an ellipsis: `overflow: clip visible`, `text-overflow: ellipsis`, `white-space: nowrap`, `min-inline-size: 0`, `min-block-size: 0`. `overflow` takes physical x and y, so in horizontal text this clips the inline axis only, and a descender below a line-height-1 line box (a `Button` or `Tag` label) is drawn in full, where `overflow: hidden` clipped it. `clip` makes no scroll container, so the two `min-*-size: 0` keep a flex or grid item shrinking below its text as a scroll container would. Works on the element that is the flex item or block; a `Button` label is `<span class="truncate">` inside it, with `min-w-0` on the `Button` |
| `.indent` | pads the inline start by `--sp-4` per level: `calc(var(--sp-4) * var(--indent-depth, 0))`, the depth set by the caller with `style:`; declared before the padding utilities, so one beside it wins |
| `.scrim` | covers its nearest positioned ancestor (`position: absolute`, `inset: 0`) with `--color-overlay` and sets `--color-text-on-scrim` for the text on it; stacking comes from a `z-*` utility beside it |
| `.layout-overlay-bare` | stacks its children in one grid cell like `.layout-overlay`, without its minimum height, corners and clip; `.layout-overlay-fill`, `-top-start`, `-top-end` and `-bottom` place a layer in either |
| `.pass-through` | pointer events pass through an element floated over content, except to its links, buttons, form controls and `[tabindex]` elements |
| `.is-grabbable`, `.is-grabbing` | the `grab` and `grabbing` cursors of a hand-drag pan; in `state.css` (utilities layer), so they win over a domain's own cursor in `@layer features` |

`state.css` also holds `.is-busy`, `.hushable` and `.is-hushed`. `ChromeBar` sets `hushable` and `is-hushed` from its `shown` prop, together with `inert` ([reading components](/projects/dokseo/design-system/reading-components/)).

Why `.truncate` clips only one axis is on [a line-height-1 box with `overflow: hidden` cuts off descenders](/css/font-metrics/#a-line-height-1-box-with-overflow-hidden-cuts-off-descenders). `.callout-top-*` and `.pin-lift` both read an offset an ancestor sets, which is the pattern in [an inherited offset moves only the elements with a rule that reads it](/design-systems/in-practice/#an-inherited-offset-moves-only-the-elements-with-a-rule-that-reads-it).

## Names, with Dokseo's examples

The class conventions come with examples from Dokseo's own library:

- A part is named for its role, not its content: `.marquee-selection-label` and `.file-item-detail`, not `-size`, `-dimensions`, `-shortcut` or `-browse`.
- A modifier of a part keeps the part's whole prefix: `.marquee-selection-handle-north`.
- A component that renders only a run of inline text in its caller's flow has no root, so no base class: `Highlight`.
- No app words in library classes: `.region-box-accent`, not `-note`, even though Dokseo uses it for notes.
- A helper that shows something in one context only ends in `-only`, scoped to the context that controls it: `.layout-app-shell-narrow-only`, `.modal-fill-only`.

## Layout patterns

The page-level layouts are split over two files: `utilities/layout.css` holds the page wrap, full bleed, app shell, sidebar, hero and split, and `utilities/layout-patterns.css` holds the stats grid, z-pattern, overlay, bento, tiles and mosaic. A layout pattern is `.layout-<pattern>`, and its parts and placements keep that whole prefix: `.layout-split-pane`, `.layout-split-left`, `.layout-mosaic-lead`, `.layout-bento-col-2`, `.layout-overlay-content`.

`.layout-bento` is a four-column grid of tiles, each sized by the placement classes on it and nothing else. `.layout-bento-col-1`, `-col-2`, `-col-3` and `-col-full` set a tile's columns, `.layout-bento-row-2` its rows, and a lead tile takes both (`.layout-bento-col-2.layout-bento-row-2`). The grid is a container, and it collapses in two steps from the [breakpoint scale](/projects/dokseo/design-system/tokens/#breakpoint-scale): below `40rem` every tile spans two columns and a `-col-2`, `-col-3` or `-col-full` tile the full width, and below `24rem` every tile is full width. The general grid utilities pair the same way: `.col-span-2`, `.row-span-2`.

## The app shell on a narrow screen

The library and settings screens sit in `.layout-app-shell`, a container named `app-shell` with a nav column and a main area. Below the narrow breakpoint (`48rem`) the shell changes layout, and a few utilities let a screen show, hide or resize things on one side of that width only.

**Showing and hiding.** A query written `@container app-shell (max-width: 48rem)` includes 48rem itself, so next to a wide-side query that also includes it, both sides apply at exactly that width. The compact utilities use the complementary pair `(width < 48rem)` and `(width >= 48rem)`, so exactly one side applies at every width. `.layout-app-shell-narrow-only` is hidden on the wide side, instead of being shown on the narrow side, so it never has to restore the element's own `display` value.

Those selectors are written `.layout-app-shell .x`, with specificity (0,2,0). They need the extra class because `utilities/flex.css` loads after `layout.css` in the same layer, so a single-class rule like `.row` would otherwise win. The mechanism is on [showing and hiding by a container breakpoint](/css/tokens-at-runtime/#showing-and-hiding-by-a-container-breakpoint).

In these rows, watch for a `nowrap` row that holds a scrolling strip and a group of fixed tools. Without `flex-shrink: 0` on the tools, both shrink as the row narrows, the tools' own wrap kicks in, and their buttons stack: the group went from 40 to 88px tall.

**Touch targets.** On phones I want 44px buttons in the library, but other shells (settings) should keep their header layout. So touch targets are opt-in: `--control-h-touch` is 2.75rem (from `--ds-size-touch`), and only a shell with `.layout-app-shell-narrow-touch` gets it, below the breakpoint. The utility doesn't name `.btn`. It sets a custom property that `Button` reads with a fallback equal to its own value:

```css
.layout-app-shell-narrow-touch { --btn-min-block-size: … }
.btn { min-block-size: var(--btn-min-block-size, var(--control-h-md)) }
```

The property inherits, so it reaches every button the old `.utility .btn` selector did. To keep the result identical, `.btn-sm` and `.btn-lg` read the hook too, since they set `min-block-size` themselves. The hook is registered in `RUNTIME_INPUTS` in `design-system.spec.ts`, or the spec's unresolved-property test fails. The general pattern: [a utility adjusts a component through a custom property the component reads](/design-systems/in-practice/#a-utility-adjusts-a-component-through-a-custom-property-the-component-reads).

**The library's header.** On a phone the library's "Your uploads" heading and summary stay in `main` for screen readers but are visually hidden. A copy of the summary shows as a one-line `aria-hidden` subtitle under "Library" (full text in `title`). It sits next to a button group with `.layout-app-shell-narrow-fit`, which sizes the group to its content, so the subtitle gets the rest of the row (`min-w-0`). See [opt-in touch targets](/html/touch-devices/#opt-in-touch-targets-and-a-heading-that-moves-into-the-header).

Two more shell helpers adjust components the same way: `.layout-app-shell-narrow-nowrap` sets `--tabs-header-wrap` so a tab header stays on one line, and `.layout-app-shell-nav-compact` sets the `--nav-link-*` properties that stack and center the nav links.

## Padding that steps at 700px without a query

The reader bars need a side padding that's smaller on narrow screens, at the compact breakpoint (`--breakpoint-compact`, 700px). A media or container query can't use it, because `var()` isn't allowed in a size condition, and the bars have no container ancestor anyway. So `.px-responsive` steps with a clamp:

```css
clamp(var(--sp-4), (100% - var(--breakpoint-compact)) * 1000, var(--sp-6))
```

Percentage padding resolves against the containing block's width. Below 700px the middle term is hugely negative and the clamp pins it to `--sp-4`; above, it's hugely positive and pinned to `--sp-6`. Why this works and when to use a container instead: [a breakpoint from a token without a query](/css/tokens-at-runtime/#a-breakpoint-from-a-token-without-a-query).

## Between two utilities, the later one in the file wins

Every utility is in the same layer and most are one class, so two of them on one element tie on layer and on specificity, and the one later in the imported CSS wins ([the general rule](/design-systems/in-practice/#between-two-utilities-the-later-rule-in-the-file-wins)).

`.eyebrow` is the case that matters. It bundles a size, tracking and a transform. A caption written `eyebrow text-sm` should come out `text-sm`, as anyone reading the class list expects. That only happens if `.eyebrow` is the first rule in `text.css`, before the single-purpose size utilities. Put it last, and the bundle silently beats every utility beside it. `design-system.spec.ts` pins that order.

The same holds across files. `index.css` imports `text.css` after `layout.css`, so a `text.css` rule beats a `layout.css` one. A component rule never ties with a utility, because `components` is an earlier layer. That's why a component that applies `.eyebrow` in its markup can't undo any of it from its own CSS.
