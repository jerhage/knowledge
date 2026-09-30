---
title: Dokseo's Token Values and Where They Are Used
description: App-specific primitives and semantic tokens, registered lengths read from script, the breakpoint scale and which container collapses where, and the motion tokens per component.
tags: [dokseo, design-tokens, design-systems, css, custom-properties, motion, layout]
sidebar:
  order: 21
---

Dokseo, my manga and book reader, implements the whole [semantic token reference](/design-systems/semantic-tokens/). What the general reference leaves as a role or an example, Dokseo fills in: its primitive values, which class reads which token, and the tokens that exist because of Dokseo (lift button, carousel, dock, arrival ring). The names and the three tiers are on the [token pipeline](/design-systems/token-pipeline/#tier-2---ds--primitives).

## Primitives Dokseo adds

Container and layout primitives, in `base/primitives.css`:

| Primitive | Value or role |
| --- | --- |
| `--ds-layout-sheet-height` | Bottom sheet height (`40dvh`) |
| `--ds-layout-sheet-height-tall` | Tall bottom sheet height (`75dvh`) |
| `--ds-size-handle` | Side of a selection handle |
| `--ds-size-touch` | Touch target side (`2.75rem`) |
| `--ds-size-compact` | Compact breakpoint (`43.75rem`, 700px) |
| `--ds-size-narrow` | Narrow breakpoint (`48rem`) |
| `--ds-size-sidebar` | Sidebar width (`15rem`) |
| `--ds-size-list` | Width of a list beside content (`18rem`) |
| `--ds-size-list-height` | Height of a scrolling list (`18rem`) |

Component size primitives. Each role gets its own primitive even where two roles share a value, so a theme can change one without the other, and no spacing primitive backs a size:

| Primitive | Value |
| --- | --- |
| `--ds-size-control-xs` · `-sm` · `-md` · `-lg` | 1.25rem · 2rem · 2.5rem · 3rem |
| `--ds-size-icon-sm` · `-md` · `-lg` | 0.75rem · 1rem · 1.25rem |
| `--ds-size-icon-tile-sm` · `-lg` | 2.5rem · 3rem |
| `--ds-size-avatar-sm` · `-md` · `-lg` | 2rem · 2.5rem · 4rem |
| `--ds-size-indicator` · `--ds-size-indicator-dot` | 1rem · 0.5rem |
| `--ds-size-toggle-track-w` · `-h` | 2rem · 1.25rem |
| `--ds-size-track-sm` · `-md` · `-lg` | 0.25rem · 0.5rem · 0.75rem |
| `--ds-size-thumbnail-sm` · `-md` · `-lg` | 1.5rem · 2.5rem · 4rem |
| `--ds-size-textarea-min` | 4rem |
| `--ds-size-label` | 9rem |
| `--ds-size-hint` | 10rem |
| `--ds-size-skeleton-line-sm` · `-md` · `-lg` | 0.75rem · 1rem · 1.25rem |
| `--ds-size-width-sm` · `-md` · `-lg` | 1.5rem · 2.5rem · 4rem |
| `--ds-size-swatch` · `--ds-size-swatch-bar` | 3rem · 0.75rem |
| `--ds-underline-offset` | 0.25rem |
| `--ds-scale-shrink-sm` · `-md` · `-lg` | 0.98 · 0.97 · 0.96 |
| `--ds-share-indeterminate` | 0.4 |

## Hover and chosen

A hovered item shows a fill that sweeps in from the inline start, and a chosen item can keep that look; the mechanism and the token roles are on [hover and chosen](/design-systems/semantic-tokens/#hover-and-chosen). In Dokseo the sweep is drawn by a button, nav link, tab, accordion trigger, menu item, command row, segmented item, interactive tag (`button.tag`, `a.tag`) and pagination item. Button, segmented item and tag have their own border, so they start the fill at the border box. The chosen look applies to `.is-active`, `aria-current`, a menu item's `:focus-visible` and a command row's `.is-selected`.

Several of these tokens (the hover text, the chosen fill and text, the hover glow) are unset in every theme but YoRHa, and each component reads them with a fallback to its own color. The fallbacks: the chosen fill and text fall back to each item's own (`--color-selected` with the brand text, or the active tint), and the hover glow to `--color-primary-glow` or `--color-accent-glow`. A hovered or chosen tag takes the chosen fill as its border color, falling back to its own border, so no ring of another color shows around the fill. Tabs draw no rule lines, because the tab list scrolls sideways and clips them. Outside YoRHa the plain hover fill and the press fill are the theme's own hover and active tints, the soft and solid sweep fills are `transparent`, and the rule lines are `0px` wide; YoRHa's values are in the [treatment table](/projects/dokseo/design-system/themes/#yorhas-treatment-primitives).

## Component surfaces

| Token | Role | Used by |
| --- | --- | --- |
| `--color-table-stripe` | Alternating row background | `.table-wrapper` |
| `--color-table-row-hover` | Hovered row background | `.table-wrapper` |
| `--color-skeleton-base` | Skeleton placeholder base color | `.skeleton` |
| `--color-skeleton-shine` | Skeleton shimmer highlight | `.skeleton` |
| `--color-code-bg` | Code block background | `.codeblock`, inline `code` |
| `--color-code-text` | Code text color | `.codeblock`, inline `code` |

## Borders, focus, backdrop and underline

- `--border-width` is registered with `@property` as an inherited `<length>`, so it computes to pixels. The EPUB arrival ring reads it that way, in `flow-highlight.ts`, through `pixelLength` (below).
- `--glow-ring-width` is the ring of `.region-box-glow`.
- `--page-backdrop` is a `background-image` over `--color-bg` on the body (with `background-attachment: fixed`), on `.layout-app-shell` and on `.surface-bg`. It's `none` in every theme but YoRHa.
- `--underline-offset` is the `text-underline-offset` of a link and of `.dropzone-action`.

## Border radii

The radius tokens are in `tokens/radius.css`. The two role radii and what reads them:

| Token | Used by |
| --- | --- |
| `--radius-full` | the spinner, `.rounded-full` |
| `--radius-pill` | `.badge`, `.tag`, `.btn-pill`, the toggle track, `.progress-track` |
| `--radius-round` | `.badge-dot`, `.tag-remove`, `.radio-input` and its dot, the toggle thumb, `.avatar`, `.skeleton-circle`, `.window-dropzone-icon-frame` |

YoRHa points both role radii at `--ds-radius-none`, which squares every capsule and circle at once.

## Layout constants

The containers, the `--layout-*` sizes and the breakpoints are in `tokens/layout.css`, with the grid column minimums and the ratios. `--handle-size` and `--lift-size` are in `tokens/sizes.css`, and the gaps in `tokens/spacing.css`. The rows Dokseo adds or fills in:

| Token | Role |
| --- | --- |
| `--layout-sheet-height-tall` | The `tall` detent of a `-sheet` `Dock` |
| `--layout-sidebar-width` | `.layout-sidebar`, `.grid-sidebar`, the app shell nav |
| `--layout-list-width` | A `-side` `Dock`, `.layout-split-view` |
| `--layout-list-height` | Height of a scrolling list (the tag picker's) |
| `--handle-size` | Side of a `.marquee-selection-handle` |
| `--lift-size` ● | Side of Dokseo's lift button (`--ds-size-touch`) |
| `--lift-gap` ● | Distance of the lift button from the selection (`--ds-space-2`) |
| `--carousel-gap` ● | Space between two `Carousel` slides (`--ds-space-4`); the `gap` prop overrides it |
| `--overlay-gap` ● | Distance of a menu or popover from its trigger (`--ds-space-1`) |
| `--overlay-edge` ● | Margin an overlay keeps from the viewport edge (`--ds-space-2`) |
| `--hover-rule-gap` | Space between a hovered or chosen item and its rule lines (`tokens/spacing.css`) |
| `--breakpoint-compact` | Where `.px-responsive` switches to the narrow padding step (`--ds-size-compact`) |
| `--breakpoint-narrow` | The narrow breakpoint (`--ds-size-narrow`), for a `BreakpointProbe` or a `calc()` |

● Registered with `@property` as an inherited `<length>`, so the [computed value is pixels](/css/registered-custom-properties/#computed-values). TypeScript that needs the number reads it with `pixelLength` in `components/css-length.ts`, which reads `getComputedStyle(element).getPropertyValue(name)`, instead of copying the value. A theme or a root font size that changes it is followed. An unregistered token reads back as its text: `--breakpoint-narrow` gives `"48rem"`, which the math would have to convert itself ([a registered custom property reads back in pixels](/css/tokens-at-runtime/#a-registered-custom-property-reads-back-in-pixels)).

## Component sizes

Every size token sits on a size primitive. Icon sizes are in `tokens/icons.css`; the rest are in `tokens/sizes.css`, along with `--handle-size`, `--lift-size`, the modal, toast, popover, menu and stat widths and the command hint's maximum width.

| Token | Role in Dokseo |
| --- | --- |
| `--control-h-xs` · `-sm` · `-md` · `-lg` | Height of a control at each size (buttons, fields, tabs, menu items); `-xs` is the side of `.tag-remove`, `-sm` of a close button |
| `--control-h-touch` | Height of a control in a touch row (`--ds-size-touch`) |
| `--icon-size-sm` · `-md` · `-lg` | Side of a glyph (`-icon` parts) |
| `--icon-tile-sm` · `-lg` | Side of the frame around an icon (`.file-item-icon-frame`, `.dropzone-icon-frame`) |
| `--avatar-size-sm` · `-md` · `-lg` | Side of an `.avatar`; `-md` also sizes `.skeleton-circle` |
| `--indicator-size` | Side of a checkbox or radio box |
| `--indicator-dot` | Side of the radio dot and of `.badge-dot` |
| `--toggle-track-w` · `--toggle-track-h` | Size of a toggle's track; the thumb is the track height less its inset |
| `--track-h-sm` · `-md` · `-lg` | Height of a progress track; `-md` also the slider tick |
| `--thumbnail-width-sm` · `-md` · `-lg` | Width of a `.thumbnail` |
| `--textarea-min-height` | Minimum height of a `.textarea` |
| `--field-label-width` | Width of the label column of `.field-inline`; the control wraps under the label below twice it |
| `--command-hint-max-width` | Widest a `.command-item-hint` grows before it's cut with an ellipsis |
| `--skeleton-line-sm` · `-md` · `-lg` | Height of `.skeleton-text`, `.skeleton` and `.skeleton-title` |
| `--width-sm` · `-md` · `-lg` | Width set by `.w-sm`, `.w-md` and `.w-lg` |
| `--swatch-size` · `--swatch-bar-h` | Side of a token swatch, and the thickness of a spacing sample bar (the playground's token section) |
| `--indeterminate-share` | Share of the track an indeterminate progress bar covers; `kIndeterminate` ends at its reciprocal, so the bar leaves the track exactly |

### Why it's `--indeterminate-share`

An indeterminate progress bar (a `Progress` with no value) draws a fill that covers part of the track and slides across it. The share it covers needed a token, and the obvious name was `--progress-indeterminate-share`.

That name failed a test. Some custom properties are runtime inputs: a caller or an ancestor sets them, like `--progress`. Every stylesheet has to read those with a fallback, because they may not be set. `design-system.spec.ts` lists them in `RUNTIME_INPUTS` and has a test, "reads every runtime input with a fallback", that counts the reads by splitting the stylesheets on `var(<name>` and `var(<name>,`. That matches a prefix, not a whole name. So every `var(--progress-indeterminate-share)` counted as a read of `--progress` with no fallback, and the test failed.

So the token is `--indeterminate-share`, and a new token's name must not start with any name in `RUNTIME_INPUTS`.

## Breakpoint scale

`var()` isn't allowed in a media or container size condition, so every query writes its width as a literal, and every literal is a step of this scale. (A container style query can test a custom property's value, but it can't compare a width with it: see [a breakpoint from a token without a query](/css/tokens-at-runtime/#a-breakpoint-from-a-token-without-a-query).) A spec rejects any query width that isn't on the scale.

| Width | Where |
| --- | --- |
| `24rem` | `bento` container: one column |
| `26rem` | `mosaic` container: one column; a modal's own container: the footer stacks |
| `34rem` | any grid container: `.col-span-2` and `.span-2` span the whole row |
| `40rem` | `z-pattern`, `bento`, `split` and `split-view` containers collapse |
| `44rem` | `mosaic` and `sidebar-layout` containers collapse |
| `48rem` | the narrow breakpoint, `--ds-size-narrow`: the `app-shell` and `hero` containers, and the viewport for the modal and the toast |

The narrow breakpoint is the one width written in more than one kind of query. Every query at it writes the token's value, which the spec checks file by file. TypeScript takes its media query from `NARROW_SCREEN_QUERY` in `components/breakpoints.ts` (`'(width < 48rem)'`), and the same spec checks that constant too. The compact breakpoint is never a query width: `.px-responsive` reads `--breakpoint-compact` in a `clamp()` (see [utilities](/projects/dokseo/design-system/utilities-and-layouts/)).

## Motion

`--transition-exit` is the theme's exit timing, `--ds-dur-exit` plus `--ds-easing-exit`: flash and ease-in by default, moderate and the sharp in-out in YoRHa. `--transition-sweep` is `0s` outside YoRHa, so the fill appears at once, and `--transition-hover-text` is the `--transition-ui` timing there.

The entrance tokens and their readers:

| Token | Read by |
| --- | --- |
| `--motion-overlay-in` · `-out` | `.modal` entering and leaving |
| `--motion-menu-in` | `.dropdown-menu:popover-open` |
| `--motion-toast-in` · `-out` | `.toast` entering and leaving |
| `--motion-item-in` | `.file-item` |
| `--motion-panel-in` | a shown `.tab-panel`, an open accordion's `.accordion-body` |

Each component writes the `animation` shorthand with only the timing and fill mode, and names the keyframes in the `animation-name` longhand after it. That's because `--motion-panel-in` is `none` outside YoRHa, and a `none` from a variable placed ahead of the fill keyword in the shorthand is read as the fill mode ([the gotcha](/css/custom-property-gotchas/#a-none-from-a-variable-in-the-animation-shorthand-becomes-the-fill-mode)).

Every keyframe lives in `utilities/animation.css`, named for the motion. YoRHa's are `kScanIn` and `kScanOut`, which open and close a box from a hairline across its middle, `kGlitchIn` and `kGlitchOut`, which flicker it in and out with a small sideways jitter, and `kFlicker`, which flickers its opacity.

Reduced motion stops all of them in `overrides.css`, the panels included. The same block sets every transition's duration and delay to `0s`, so a style change jumps and no `transitionend` fires. Two pieces of script are written for that: the `Carousel` ends a settle at once when the slot's duration reads as zero (`SETTLES_AT_ONCE`), and `animationsSettled` (used by `Modal` and `Toast`) finds nothing running. The spinners (`kSpin`) and the indeterminate progress (`kIndeterminate`) keep turning, since they report work in progress.
