---
title: Component Contract
description: The baseline components and base class names every system implements, and the patterns for options a system adds on top.
tags: [css, design-systems, components, architecture]
sidebar:
  order: 6
---

## Component Contract

A component library written for this architecture has to run in any system built on it. It can only do that if two things are the same everywhere: the token names it reads, and the class names its markup uses. The token names are fixed in the semantic token reference. The component baseline below is the other half of that stable API. Components are built only from [semantic tokens](/design-systems/semantic-tokens/), never from `--ds-*` primitives or raw values.

Every design system built on this architecture has to implement every component listed below. A system can style them in any way, but the class names in this table are guaranteed to exist. **Component base class names are fixed.**

| Component      | Base class          | Required structure                   | Standard variants / states                                                                                                                                 |
| -------------- | ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**     | `.btn`              | Base + variant modifier              | Filled (`.btn-primary`), ghost/outline (`.btn-ghost`), destructive (`.btn-danger`), loading (`.btn-loading`); size scale min 2 (e.g. `.btn-sm`, `.btn-lg`) |
| **Badge**      | `.badge`            | Base + color modifier                | `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-info`, `.badge-primary`, `.badge-accent`, `.badge-neutral`                                    |
| **Tag**        | `.tag`              | Base + interactive state             | `.is-active` toggle; `.tag-remove` affordance                                                                                                              |
| **Form field** | `.field`            | Label + control + hint/error wrapper | `.field-label`, `.field-control`, `.field-hint`, `.field-error`                                                                                            |
| **Input**      | `.input`            | Inside `.field-control`              | Default, focus, disabled, error states                                                                                                                     |
| **Select**     | `.select`           | Inside `.field-control`              | Default, focus, disabled states                                                                                                                            |
| **Textarea**   | `.textarea`         | Inside `.field-control`              | Default, focus, disabled states                                                                                                                            |
| **Checkbox**   | `.checkbox-wrapper` | Custom appearance over native        | Unchecked, checked, indeterminate, disabled                                                                                                                |
| **Radio**      | `.radio-wrapper`    | Custom appearance over native        | Unselected, selected, disabled                                                                                                                             |
| **Toggle**     | `.toggle`           | Custom switch appearance             | Off, on, disabled                                                                                                                                          |
| **Card**       | `.card`             | Body wrapper + internal sub-elements | `.card-body`, `.card-eyebrow`, `.card-title`, `.card-description`, `.card-footer`; at least one named variant (`.card-[name]`)                             |
| **Alert**      | `.alert`            | Icon + content + optional dismiss    | `.alert-success`, `.alert-warning`, `.alert-danger`, `.alert-info`; `.alert-close`                                                                         |
| **Tabs**       | `.tabs`             | Tab list + tab panels                | `.tab-list`, `.tab`, `.tab-panel`; active state via `.is-active`                                                                                           |
| **Accordion**  | `.accordion`        | Trigger + collapsible body           | `.accordion-item`, `.accordion-trigger`, `.accordion-body`; open state                                                                                     |
| **Table**      | `.table`            | Semantic `<table>`                   | Header row, data rows; optional stripe via `--color-table-stripe`                                                                                          |
| **Modal**      | `.modal`            | Backdrop + dialog + sub-elements     | `.modal-backdrop`, `.modal-header`, `.modal-body`, `.modal-footer`, `.modal-close`                                                                         |
| **Toast**      | `.toast`            | Notification with entry animation    | `.toast-success`, `.toast-warning`, `.toast-danger`, `.toast-info`; auto-dismiss                                                                           |
| **Dropdown**   | `.dropdown`         | Trigger + menu                       | `.dropdown-menu`, `.dropdown-item`, `.dropdown-separator`; open state                                                                                      |
| **Breadcrumb** | `.breadcrumb`       | Ordered link trail                   | `.breadcrumb-item`, `.breadcrumb-separator`                                                                                                                |
| **Pagination** | `.pagination`       | Page number navigation               | `.pagination-item`; active and disabled states                                                                                                             |
| **Avatar**     | `.avatar`           | Image or initial placeholder         | Size variants (e.g. `.avatar-sm`, `.avatar-lg`); stacked overflow                                                                                          |
| **Progress**   | `.progress-track`   | Track + fill bar                     | Percentage via CSS variable or inline style; at least one status variant fill                                                                              |
| **Skeleton**   | `.skeleton`         | Placeholder loading shape            | Shimmer animation via `--color-skeleton-base` and `--color-skeleton-shine`                                                                                 |
| **Divider**    | `.divider`          | Horizontal rule                      | Default; optional labeled variant                                                                                                                          |

### Options a system adds beyond the baseline

Every system ends up with options and components beyond the baseline. I record each one in a table like the ones below (component, option, class and effect), so the class a prop adds is written down right next to the prop (see [Svelte](/design-systems/svelte/) for how props map to classes). These are the patterns that keep coming up, each with an example.

**A native state instead of a class.** If the element has a real state attribute, style that and don't add a class.

| Component | Option     | Class / effect                                                                                                                                                  |
| --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal     | open state | the native `[open]` of the `dialog` (`.modal-backdrop`) shows it, animates it in and locks the page scroll; no class; `.is-leaving` only while it animates out |
| Accordion | open state | the native `[open]` of a `details` item turns `.accordion-icon`; no class                                                                                      |
| Dropdown  | chosen item | a checked `menuitemradio`, or the link to the current page, takes `.dropdown-item.is-active`                                                                 |
| Progress  | no `value` | `.progress-track.is-indeterminate`: a partial fill slides across the track, with no `aria-valuenow`; a value arriving removes the state                         |

**Two axes on one component.** Tone and emphasis stay separate classes ([rule 6](/design-systems/naming-conventions/#class-conventions)).

| Component | Option         | Class / effect                                                                                                                                                                                                                         |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button    | tone × emphasis | a tone class sets the colors (`.btn-primary`, `.btn-accent`, `.btn-danger`; neutral has none) and an emphasis class draws them (`.btn-outline`, `.btn-ghost`; solid has none); any tone composes with any emphasis, and no rule names both |
| Badge     | tone × emphasis | a tone class sets the colors and `.badge-solid` or `.badge-quiet` draws them (tinted, the default, has no class)                                                                                                                      |

**An ancestor adjusts a component through a custom property it reads** ([rule 11](/design-systems/naming-conventions/#class-conventions)). The component declares the property with its default, and a layout sets it for one context.

| Component | Option                  | Class / effect                                                                                                                              |
| --------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Button    | `--btn-min-block-size`  | an ancestor raises every size's minimum height, for example a narrow-layout class setting it to a touch-target token                        |
| Tabs      | `--tabs-header-wrap`    | an ancestor keeps the tab list and its actions on one line (`nowrap`); `wrap` by default                                                    |
| Nav link  | `--nav-link-direction`, `--nav-link-justify`, `--nav-link-gap` | a compact navigation column stacks and centers each link                                         |

**An icon-only control names itself with hidden text.** An icon button is a `Button` (square by default) that holds an icon (`.btn-icon`) and a required label. The label renders as a `.visually-hidden` text node, never as `aria-label`. That way the name is real text, and translation tools and find-in-page can reach it. A `tooltip` option sets the `title`: by default it's the label, or it can be a different string, or `false` for no title. A dropdown with an icon-only trigger takes the same `icon`, `label` and `tooltip` props.

**Joined controls.** A button group is an inline flex row of buttons joined into one bar. Each child drops its resting shadow, the corners the children share are squared, each border after the first is pulled back over its neighbor by `--border-width`, and a hovered, focused or `.is-active` child is raised (`z-index`) so its whole border shows. It's `role="group"` with a required name. A button group is for actions. Picking one choice out of several is a segmented control. An input group uses the same overlap-and-square rule for an input with addons and buttons. It has no role of its own, because the field labels the input.

**A layout that reflows by flex basis, not a media query.**

| Component | Option            | Class / effect                                                                                                                                                                                                                                       |
| --------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field     | `layout="inline"` | `.field-inline`: the label `flex: 1 0 var(--field-label-width)` and the control `flex: 999 1` twice that, so the label moves above the control once the row is narrower than both; hint and error take their own line. The default `stacked` adds no class |

**Parts that pass through to semantic elements.** Table parts (header, body, row, header cell, cell) render `thead`, `tbody`, `tr`, `th`, `td`, and each passes its attributes and `class` through. `.table` styles them by element, so the parts add no class of their own unless an option adds one:

- `numeric` → `.table-numeric`: end-aligned, mono, tabular figures.
- `actions` → `.table-actions`: only `text-align: end`, so an inline control sits at the inline end. The column keeps its automatic width, because a column squeezed to min-content shrinks its icons through a reset's `svg { max-width: 100% }`.

**Runtime geometry as custom properties, with a class and no component.** When only the look is shared, ship a class in its own component stylesheet instead of a component. For example: a zoom surface drawn by `translate(var(--pan-x), var(--pan-y)) scale(var(--zoom))` about `0 0`, which the caller sets with an inline style; and a marked region box with a border, a tint and an accent modifier.

**A hidden probe to read a token in pixels.** A script sometimes has to compare a width against a CSS token, such as a breakpoint. Copying the number into the script would mean two copies to keep in step. Instead, a hidden, zero-height, absolutely placed element (the probe) takes as its width the breakpoint token that a custom property names, and its measured width is bound back to the caller. That lets a script compare its own width against a CSS token without copying the number into the script.

**A bottom sheet over the page, not beside it.** A dock is a panel that sits beside the page on a wide screen and can be opened and closed. On a narrow screen the dock sits below the page instead, and opens as a sheet. If the open sheet took its full height in the flow, opening it would shrink the page above and lay its content out again. So the dock keeps only its closed height in the flow and draws the open sheet absolutely positioned at the bottom, over the page. Opening it never resizes the content, and never triggers a new layout of it. A grab handle with pointer capture resizes it live through a custom property, with no transition while dragging. On release it settles to the nearest detent (a height it snaps to), or to the next one on a flick, with a short eased block-size transition that's instant under reduced motion. Probe elements read the detent tokens in pixels. How it fits a reading layout: [reader layout](/ui-patterns/reader-layout/).

**A carousel of three keyed slots.** A carousel shows one item at a time, with the items on either side ready to slide in. It has a previous, a current and a next slot. Each is the carousel's size and is a size container. The current slot is in flow, the neighbors are absolute and `inert`, and custom properties translate all three. When a move is released, the slots ease into their resting place (the settle), and a settling class eases the settle. The settle normally ends on `transitionend`. If `transitionend` never arrives, a fallback timer ends it: the slot's computed `transition-duration` plus a margin, or right away when that reads as zero, as it does under reduced motion. The Svelte side: [a keyed carousel](/svelte/keyed-carousel/).

**Placement-targeted toasts.** Toasts are shown inside a toast region, an element that attaches itself to the app's toaster. There can be several regions at once. A toast has a placement (`bottom` by default, or `top`). The region attached last at that placement shows it. If there's no region at that placement, the region attached last at any placement shows it, so no toast goes unseen. A modal has its own region. While a modal is open, the page behind it is inert, so a toast shown in the page's region would appear but couldn't be reached. The reason: [the top layer](/html/top-layer/).

**Pure math modules beside components.** Gesture classification (tap, double tap, long press, pan, swipe, pinch, cancel), pan-and-zoom viewport arithmetic and a selection marquee's geometry are pure functions that a component calls. That makes them unit-testable without a DOM. The component forwards pointer events to them and reports named outcomes (for a marquee: `click`, `too-small`, `selection`), never raw events. The marquee itself: [selection marquee](/interaction/selection-marquee/).
