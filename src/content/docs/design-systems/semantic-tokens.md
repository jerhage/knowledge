---
title: Semantic Token Reference
description: The fixed semantic token names every system implements for color, typography, sizing and spacing, elevation and motion.
tags: [css, design-systems, design-tokens, theming, typography, motion]
sidebar:
  order: 4
---

## Semantic Token Reference

This is tier 3 of the [token pipeline](/design-systems/token-pipeline/).

> **These names are fixed.** Every design system built on this architecture implements every token below, with exactly these names. Values change from system to system; names never do. A component library that references `--color-primary` works in any system that follows the contract, because that token name is guaranteed to exist.
>
> Tokens marked **★** are extended. Some systems have them and they add to the core set where they're defined, but the core contract doesn't require them. Use them when they're there, and fall back to core tokens for components that have to work everywhere.

### Color Tokens

#### Surfaces

| Token                      | Role                                               |
| -------------------------- | -------------------------------------------------- |
| `--color-bg`               | Page background                                    |
| `--color-surface`          | Base container background                          |
| `--color-surface-raised`   | Elevated element background (cards, dropdowns)     |
| `--color-surface-sunken`   | Recessed background (inputs, wells)                |
| `--color-bg-raised` ★      | Raised page-level surface (between bg and surface) |
| `--color-surface-bright` ★ | Bright surface above surface-raised                |

#### Brand (Primary)

| Token                     | Role                                               |
| ------------------------- | -------------------------------------------------- |
| `--color-primary`         | Primary action color (buttons, links, focus rings) |
| `--color-primary-subtle`  | Very light primary tint (hover backgrounds)        |
| `--color-primary-soft`    | Soft primary fill (selected state backgrounds)     |
| `--color-primary-muted`   | Muted primary (disabled or de-emphasized states)   |
| `--color-primary-hover` ★ | Explicit hover state of primary                    |
| `--color-primary-glow` ★  | Glow / halo effect for glowing systems             |

#### Accent (Secondary)

| Token                    | Role                                  |
| ------------------------ | ------------------------------------- |
| `--color-accent`         | Secondary action color                |
| `--color-accent-surface` | Accent-tinted surface                 |
| `--color-accent-border`  | Accent border                         |
| `--color-accent-mid`     | Mid-weight accent (icons, indicators) |
| `--color-accent-text`    | Accent-colored text                   |
| `--color-accent-hover` ★ | Explicit hover state of accent        |
| `--color-accent-glow` ★  | Glow / halo for accent                |

#### Brand Scale

| Token                      | Role                                     |
| -------------------------- | ---------------------------------------- |
| `--color-brand-tint`       | Lightest brand tint (badges, highlights) |
| `--color-brand-border`     | Subtle brand border                      |
| `--color-brand-border-mid` | Mid-weight brand border                  |
| `--color-brand-text`       | Brand-colored text                       |

#### Status

| Token                     | Role                          |
| ------------------------- | ----------------------------- |
| `--color-success`         | Success foreground            |
| `--color-success-bg`      | Success background            |
| `--color-success-border`  | Success border                |
| `--color-warning`         | Warning foreground            |
| `--color-warning-bg`      | Warning background            |
| `--color-warning-border`  | Warning border                |
| `--color-danger`          | Danger/error foreground       |
| `--color-danger-bg`       | Danger/error background       |
| `--color-danger-border`   | Danger/error border           |
| `--color-info`            | Info foreground               |
| `--color-info-bg`         | Info background               |
| `--color-info-border`     | Info border                   |
| `--color-success-muted` ★ | Semi-transparent success fill |
| `--color-warning-muted` ★ | Semi-transparent warning fill |
| `--color-danger-muted` ★  | Semi-transparent danger fill  |
| `--color-info-muted` ★    | Semi-transparent info fill    |

#### Text

| Token                       | Role                                           |
| --------------------------- | ---------------------------------------------- |
| `--color-text`              | Primary body text                              |
| `--color-text-muted`        | Secondary / supporting text                    |
| `--color-text-faint`        | Placeholder, disabled text                     |
| `--color-text-inverse`      | Text on dark or filled surfaces                |
| `--color-text-link`         | Hyperlink color                                |
| `--color-text-link-hover`   | Hyperlink hover color                          |
| `--color-text-on-primary` ★ | Text placed directly on the primary color fill |
| `--color-text-on-accent` ★  | Text placed directly on the accent color fill  |

#### Interactive States

Generic state overlays that every interactive component uses: buttons, list items, nav links, table rows, tree nodes, tabs, chips, dropdown items. They're semi-transparent, so they layer correctly over any surface color.

| Token                 | Role                                                              |
| --------------------- | ----------------------------------------------------------------- |
| `--color-hover`       | Hover overlay                                                     |
| `--color-active`      | Active / pressed overlay                                          |
| `--color-selected`    | Selected state background (list items, option rows, active tabs) |
| `--color-disabled`    | Disabled element text / icon color                                |
| `--color-disabled-bg` | Disabled element background                                       |

#### Hover and Chosen

Many items react when the pointer is over them: buttons, nav links, tabs, accordion triggers, menu items, command rows, segmented items, interactive tags and pagination items. They share one hover pattern, and a theme can restyle it through the tokens below.

The hover is a fill that sweeps in from the inline start. It's a `linear-gradient` of the fill color, `no-repeat` at `left center`, growing from `background-size: 0% 100%` to `100% 100%` over [`--transition-sweep`](#composite-transitions). The sweep duration is zero by default, so the fill shows up at once, the way a plain tint would. A background image is normally positioned and sized inside the border (`background-origin` defaults to `padding-box`), so on an item with a transparent border of its own, a `no-repeat` fill doesn't reach under that border. So an item with its own border starts the fill at the border box (`background-origin: border-box`).

A chosen item (`.is-active`, `aria-current`, a menu item's `:focus-visible`, a selected command row) keeps the look of a hovered one, if the theme sets the chosen tokens. A hovered or chosen item can also draw lines above and below itself. They're a `::before` layer whose border color changes to `--color-hover-rule` over `--transition-sweep`. That layer is absolute, with `inset-block` covering the gap plus the item's border width, `inset-inline: 0`, a `border-block` of the rule width, and `pointer-events: none`. A disabled item draws no rule. An item inside a horizontally scrolling strip (tabs) draws no rule lines either, because the strip clips anything an item draws above or below itself.

| Token                                         | Role                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-hover-fill`                          | Sweep fill of a plain item                                                                                                                            |
| `--color-hover-fill-soft`                     | Sweep fill over an item whose hover already shows a tinted background (a toned outline or ghost button, a danger menu item)                           |
| `--color-hover-fill-solid`                    | Sweep fill over a solid-filled button (primary, accent, danger), also kept while it is pressed                                                        |
| `--color-hover-text`                          | Text of a hovered plain or soft item; unset by default, so the item keeps its own                                                                     |
| `--color-hover-text-solid`                    | Text of a hovered solid button; unset by default                                                                                                      |
| `--color-press-fill`                          | Fill of a pressed neutral or soft neutral button                                                                                                      |
| `--color-chosen-fill` · `--color-chosen-text` | Background and text of a chosen item; unset by default, so each keeps its own. A hovered or chosen tag also takes the chosen fill as its border color |
| `--color-hover-glow`                          | Glow ring of a hovered primary or accent button; unset by default, so each keeps its own                                                              |
| `--color-hover-marker`                        | Color of the inline-start marker bar on a hovered nav link, accordion trigger or menu item                                                           |
| `--color-hover-rule`                          | Color of the lines above and below a hovered or chosen item                                                                                          |

#### Component Surfaces

Surface tokens for specific components that can't cleanly reuse the general surface scale.

| Token                     | Role                            |
| ------------------------- | ------------------------------- |
| `--color-table-stripe`    | Alternating row background      |
| `--color-table-row-hover` | Hovered row background          |
| `--color-skeleton-base`   | Skeleton placeholder base color |
| `--color-skeleton-shine`  | Skeleton shimmer highlight      |
| `--color-code-bg`         | Code block background           |
| `--color-code-text`       | Code text color                 |

#### Borders & Focus

| Token                   | Role                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `--border-color`        | Default border                                                                  |
| `--border-color-strong` | Emphasized border                                                               |
| `--border-color-focus`  | Focus ring color                                                                |
| `--focus-ring`          | Complete focus ring shorthand (`outline` value)                                 |
| `--focus-ring-offset`   | `outline-offset` spacing                                                        |
| `--border-width` ●      | Width of a border; script that draws with it reads it in pixels                 |
| `--border-width-strong` | Width of an emphasized border                                                   |
| `--glow-ring-width`     | Width of a glow ring                                                            |
| `--hover-marker-width`  | Width of the inline-start marker bar of a hovered item (an inset `box-shadow`) |
| `--hover-rule-width`    | Width of the lines above and below a hovered or chosen item                     |

● Registered with [`@property`](/css/registered-custom-properties/) as an inherited `<length>`. So it computes to pixels, and script can read it (see [Layout Constants](#layout-constants)).

#### Utility

| Token                     | Role                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-overlay`         | Semi-transparent modal backdrop                                                                                                          |
| `--color-scrim`           | Full-coverage scrim                                                                                                                      |
| `--color-spinner-track`   | Loading spinner track (semi-transparent)                                                                                                 |
| `--color-overlay-heavy` ★ | Heavier backdrop variant                                                                                                                 |
| `--page-backdrop`         | `background-image` over `--color-bg` on the body (`background-attachment: fixed`) and on app-shell surfaces; `none` unless a theme sets one ([treatment primitives](/design-systems/cascade-layers/#theme-identity-and-color-scheme)) |

---

### Typography Tokens

#### Font Families

| Token            | Role                                    |
| ---------------- | --------------------------------------- |
| `--font-display` | Headings, numerics, prominent UI labels |
| `--font-body`    | Prose, descriptions, general UI text    |
| `--font-mono`    | Code, timestamps, data values           |

#### Font Sizes

An 11-step scale from smallest to largest:

| Token          | Approximate Size |
| -------------- | ---------------- |
| `--text-xxs`   | ~9px             |
| `--text-xs`    | ~11px            |
| `--text-sm`    | ~13px            |
| `--text-base`  | ~15-16px         |
| `--text-md`    | ~18px            |
| `--text-lg`    | ~20px            |
| `--text-xl`    | ~25px            |
| `--text-2xl`   | ~30px            |
| `--text-3xl`   | ~36px            |
| `--text-4xl`   | ~48px            |
| `--text-5xl`   | ~60px            |
| `--text-2xs` ★ | ~9.6px           |

#### Font Weights

| Token                  | Role                                  |
| ---------------------- | ------------------------------------- |
| `--weight-light` ★     | Thin emphasis (300)                   |
| `--weight-normal`      | Body text weight (400)                |
| `--weight-medium`      | Slightly emphasized (500)             |
| `--weight-semibold`    | Labels, subheadings (600)             |
| `--weight-bold`        | Bold emphasis (700)                   |
| `--weight-extrabold` ★ | Heavy emphasis (800)                  |
| `--weight-black`       | Maximum weight, display use (800-900) |

#### Letter Spacing

| Token         | Role                                   |
| ------------- | -------------------------------------- |
| `--ls-tight`  | Condensed tracking                     |
| `--ls-normal` | Default tracking                       |
| `--ls-wide`   | Slightly open                          |
| `--ls-wider`  | Open tracking (labels)                 |
| `--ls-widest` | Maximum tracking (all-caps, monospace) |

#### Line Height

| Token          | Role                                   |
| -------------- | -------------------------------------- |
| `--lh-none`    | Solid leading (display headings)       |
| `--lh-tight`   | Condensed leading (multi-line titles)  |
| `--lh-snug` ★  | Slightly condensed (subheadings)       |
| `--lh-normal`  | Default leading (standard UI text)     |
| `--lh-relaxed` | Open leading (long-form body text)     |
| `--lh-loose`   | Maximum leading (small text, captions) |

#### Text Decoration

| Token                | Role                                                   |
| -------------------- | ------------------------------------------------------ |
| `--underline-offset` | `text-underline-offset` of a link and link-like action |

---

### Sizing & Spacing Tokens

#### Spacing Scale

A 10-step scale mapping to `--ds-space-*` primitives:

| Token     | Maps to         |
| --------- | --------------- |
| `--sp-1`  | `--ds-space-1`  |
| `--sp-2`  | `--ds-space-2`  |
| `--sp-3`  | `--ds-space-3`  |
| `--sp-4`  | `--ds-space-4`  |
| `--sp-5`  | `--ds-space-5`  |
| `--sp-6`  | `--ds-space-6`  |
| `--sp-7`  | `--ds-space-7`  |
| `--sp-8`  | `--ds-space-8`  |
| `--sp-9`  | `--ds-space-9`  |
| `--sp-10` | `--ds-space-10` |

#### Border Radii

| Token            | Role                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `--radius-none`  | No rounding (sharp / brutalist systems)                                       |
| `--radius-xs`    | Minimal rounding                                                              |
| `--radius-sm`    | Subtle rounding (inputs, small cards)                                         |
| `--radius-md`    | Standard rounding (cards, modals)                                             |
| `--radius-lg`    | Prominent rounding (panels)                                                   |
| `--radius-xl` ★  | Large rounding                                                                |
| `--radius-2xl` ★ | Extra-large rounding                                                          |
| `--radius-full`  | Fully round, by name (a spinner, `.rounded-full`)                             |
| `--radius-pill`  | Capsules: badges, tags, pill buttons, a toggle track, a progress track        |
| `--radius-round` | Circular marks: a badge dot, a radio and its dot, a toggle thumb, an avatar  |

`--radius-pill` and `--radius-round` are role tokens over `--radius-full`. That lets a sharp-cornered theme square off every capsule and circle at once without touching `--radius-full`.

#### Layout Constants

Containers, `--layout-*` sizes and breakpoints live in a layout tokens file, along with the grid column minimums and the ratios. Gaps live with spacing.

| Token                        | Role                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `--container-prose`          | Max-width for reading-focused content                              |
| `--container-wide`           | Max-width for full-layout containers                               |
| `--layout-hero-height`       | Standard hero section height                                       |
| `--layout-row-height`        | Standard grid/mosaic row height                                    |
| `--layout-sheet-height`      | Height of a docked bottom sheet                                    |
| `--layout-sheet-height-tall` | Tall height of a docked bottom sheet (its second detent)           |
| `--layout-sidebar-width`     | Width of a sidebar and of an app shell's nav column                |
| `--layout-list-width`        | Width of a list beside content (a side dock, a split view)         |
| `--overlay-gap` ●            | Distance of a menu or popover from its trigger                     |
| `--overlay-edge` ●           | Margin an overlay keeps from the viewport edge                     |
| `--carousel-gap` ●           | Space between two carousel slides                                  |
| `--hover-rule-gap`           | Space between a hovered or chosen item and the lines around it     |
| `--breakpoint-compact`       | Width below which a responsive padding utility uses the narrow step |
| `--breakpoint-narrow`        | The narrow breakpoint, for a breakpoint probe element or a `calc()` |

● Registered with `@property` as an inherited `<length>`, so it computes to pixels. When TypeScript code uses the number, it reads it with `getComputedStyle(element).getPropertyValue(name)` through one small helper instead of copying the value. That way, if a theme or the root font size changes it, the script picks up the change.

#### Component Sizes

Every size token is built on a size primitive, never a spacing one. Icon sizes can live in their own tokens file. The rest (control heights, and modal, toast, popover and menu widths) go in a sizes file.

| Token                                    | Role                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--control-h-xs` · `-sm` · `-md` · `-lg` | Height of a control at each size (buttons, fields, tabs, menu items); `-xs` also sizes a tag's remove button, `-sm` a close button |
| `--control-h-touch`                      | Height of a control in a touch row (`--ds-size-touch`)                                                                     |
| `--icon-size-sm` · `-md` · `-lg`         | Side of a glyph                                                                                                            |
| `--icon-tile-sm` · `-lg`                 | Side of the frame around an icon                                                                                           |
| `--avatar-size-sm` · `-md` · `-lg`       | Side of an avatar; `-md` also sizes a circular skeleton                                                                    |
| `--indicator-size`                       | Side of a checkbox or radio box                                                                                            |
| `--indicator-dot`                        | Side of the radio dot and a badge dot                                                                                      |
| `--toggle-track-w` · `--toggle-track-h`  | Size of a toggle's track; the thumb is the track height less its inset                                                     |
| `--track-h-sm` · `-md` · `-lg`           | Height of a progress track; `-md` also a slider tick                                                                       |
| `--thumbnail-width-sm` · `-md` · `-lg`   | Width of a thumbnail                                                                                                       |
| `--textarea-min-height`                  | Minimum height of a textarea                                                                                               |
| `--field-label-width`                    | Width of the label column of an inline field; the control wraps under the label below twice it                            |
| `--skeleton-line-sm` · `-md` · `-lg`     | Height of skeleton text, block and title lines                                                                             |
| `--width-sm` · `-md` · `-lg`             | Width set by `.w-sm`, `.w-md` and `.w-lg` utilities                                                                        |
| `--indeterminate-share`                  | Share of the track an indeterminate progress bar covers; its keyframes end at the reciprocal so the bar leaves the track exactly |

#### Breakpoint Scale

A media or container query can't read `var()`. So a query writes its width as a literal, and every literal has to be a step on one fixed scale. A test that scans the stylesheets rejects any query width that isn't on it. An example scale: `24rem`, `26rem`, `34rem`, `40rem`, `44rem`, `48rem`. The small steps are for container queries where a grid collapses to one column or a span covers the whole row. The largest is the narrow breakpoint, where an app shell and the viewport-level overlays switch.

The narrow breakpoint is the only width that shows up in more than one kind of query. Every query at that width writes the token's value, and the same test checks that file by file. TypeScript takes its media query from one exported constant (for example `'(width < 48rem)'`), and the test checks that too. A breakpoint that no query uses can be read as a token inside a `clamp()` instead.

---

### Elevation Tokens

#### Shadows

These show layering between components. Each step matches one visual elevation level. Values differ per system; names are fixed.

| Token            | Role               | Used by                                        |
| ---------------- | ------------------ | ---------------------------------------------- |
| `--shadow-sm`    | Subtle lift        | Focused inputs, small cards                    |
| `--shadow-md`    | Standard elevation | Cards, dropdowns, select menus                 |
| `--shadow-lg`    | High elevation     | Modals, drawers, sheets                        |
| `--shadow-xl`    | Maximum elevation  | Floating command palette, full-screen overlays |
| `--shadow-inset` | Recessed / sunken  | Inset inputs, wells, sunken surfaces           |

#### Z-index Scale

A locked stacking scale. Every stacked component uses one of these values, never a raw integer, so what stacks over what is predictable across the system. Overlays opened in the browser's top layer (`showModal()`, `showPopover()`) don't use it.

| Token          | Value | Used by                                                     |
| -------------- | ----- | ----------------------------------------------------------- |
| `--z-base`     | 0     | Normal document flow                                        |
| `--z-raised`   | 1     | Sticky elements within a component                          |
| `--z-dropdown` | 100   | Dropdowns, combobox list, date-picker calendar, select menu |
| `--z-sticky`   | 200   | Sticky nav, topbar, sidenav                                 |
| `--z-overlay`  | 300   | Backdrops, overlays                                         |
| `--z-modal`    | 400   | Modals, drawers, sheets                                     |
| `--z-toast`    | 500   | Toast notifications                                         |
| `--z-tooltip`  | 600   | Tooltips, popovers (always topmost)                         |

---

### Motion Tokens

#### Durations

A 7-step scale from fastest to slowest:

| Token            | Value   | Use                                    |
| ---------------- | ------- | -------------------------------------- |
| `--dur-instant`  | ~50ms   | Micro-interactions, immediate feedback |
| `--dur-flash`    | ~90ms   | Button state changes, border shifts    |
| `--dur-quick`    | ~180ms  | Most UI transitions                    |
| `--dur-moderate` | ~300ms  | Entrances, exits                       |
| `--dur-slow`     | ~480ms  | Large element transitions              |
| `--dur-crawl`    | ~720ms  | Deliberate, dramatic reveals           |
| `--dur-long`     | ~1100ms | Ambient loops, complex sequences       |

#### Easing

| Token                    | Use                                      |
| ------------------------ | ---------------------------------------- |
| `--ease-smooth`          | General UI transitions, default          |
| `--ease-in`              | Accelerating curve (exit animations)     |
| `--ease-out`             | Decelerating curve (enter animations)    |
| `--ease-crisp` ★         | Sharp deceleration (snappy interactions) |
| `--ease-in-out`          | Balanced ease (standard transitions)     |
| `--ease-in-out-sharp` ★  | Sharper in-out                           |
| `--ease-spring`          | Bouncy / springy interactions            |
| `--ease-spring-gentle` ★ | Mild spring                              |
| `--ease-spring-bouncy` ★ | Maximum spring bounce                    |
| `--ease-bounce`          | Exaggerated bounce                       |
| `--ease-elastic` ★       | Elastic overshoot                        |
| `--ease-elastic-max` ★   | Maximum elastic                          |
| `--ease-squish` ★        | Squish / compression feel                |
| `--ease-squish-max` ★    | Maximum squish                           |

#### Scales

| Token               | Use                                                       |
| ------------------- | --------------------------------------------------------- |
| `--scale-shrink-sm` | Start or end scale of a small entrance (menu, modal exit) |
| `--scale-shrink-md` | Start scale of a modal entrance                           |
| `--scale-shrink-lg` | Start scale of a toast entrance                           |

#### Composite Transitions

Ready-made duration and easing pairs. Components use these instead of putting a duration and an easing together themselves, so motion feels the same across the whole system.

| Token                     | Definition                                                                    | Use                                                    |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `--transition-ui`         | `--dur-flash` + `--ease-smooth`                                               | Color, border, opacity shifts                          |
| `--transition-spring`     | `--dur-quick` + `--ease-spring`                                               | Layout changes, size shifts                            |
| `--transition-enter` ★    | `--dur-quick` + `--ease-out`                                                  | Element entering the DOM                               |
| `--transition-exit` ★     | the theme's exit duration + easing (`--ds-dur-exit`, `--ds-easing-exit`)      | Element leaving the DOM                                |
| `--transition-bounce` ★   | `--dur-moderate` + `--ease-bounce`                                            | Playful entrances                                      |
| `--transition-elastic` ★  | `--dur-slow` + `--ease-elastic`                                               | Elastic reveals                                        |
| `--transition-sweep`      | `--ds-dur-sweep` + `--ds-easing-sweep`                                        | The hover fill's growth, the marker and the hover rule |
| `--transition-hover-text` | `--ds-dur-hover-text` + `--ds-easing-hover-text`                              | The text color of a swept item                        |

#### Entrance Keyframes

A component doesn't name its entrance keyframes directly. It reads the name from a token, so a theme can swap in its own motion. Where that name goes matters. If the `animation` shorthand held the name as a `var()`, and the token resolved to `none`, the `none` would sit ahead of the fill keyword. The shorthand would read it as the fill mode, and that pushes the fill keyword into the name. So the name never goes in the shorthand. It goes in the `animation-name` longhand, after an `animation` shorthand that holds only the timing and fill mode.

| Token                          | Read by                                        |
| ------------------------------ | ---------------------------------------------- |
| `--motion-overlay-in` · `-out` | a modal entering and leaving                   |
| `--motion-menu-in`             | a popover menu (`:popover-open`)               |
| `--motion-toast-in` · `-out`   | a toast entering and leaving                   |
| `--motion-item-in`             | a list item arriving                           |
| `--motion-panel-in`            | a shown tab panel, an opened accordion body    |

Every keyframe lives in the utilities animation file ([`@layer utilities`](/design-systems/cascade-layers/#layer-utilities)) and is named for the motion (`kFadeIn`, `kSlideUp`, `kModalIn`). Reduced motion stops all of them in the [overrides layer](/design-systems/cascade-layers/#layer-overrides). The same block sets every transition's duration and delay to `0s`. So under reduced motion a style change jumps straight to the end, and no `transitionend` fires. A script that waits for `transitionend` or for running animations before it moves on would wait forever. So it has to handle "nothing is running" right away. Spinners and indeterminate progress keep turning, because they show that work is in progress.
