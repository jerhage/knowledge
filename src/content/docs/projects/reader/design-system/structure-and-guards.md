---
title: How the Reader's Design System Is Laid Out and Guarded
description: "The real `src/lib/styles` tree, where feature CSS lives, the icon components, and the specs that keep the rules from drifting."
tags: [reader, design-systems, css, cascade-layers, project-structure, testing]
sidebar:
  order: 25
---

The reader's design system is plain CSS in `src/lib/styles/`, loaded once from the root layout, plus Svelte components in `src/lib/components/` that apply its classes. It follows the general [directory structure](/design-systems/directory-structure/#structure). This page shows the real tree, where CSS that belongs to one screen goes, how the icons are built, and the specs that fail when a change breaks one of its rules.

## The tree

```text
src/lib/styles/
├── index.css                  ← layer declaration + ordered imports, nothing else
├── reset.css                  ← Josh Comeau's modern CSS reset
├── base/
│   ├── fonts.css              ← @font-face for the self-hosted theme fonts
│   ├── primitives.css         ← all --ds-* raw values
│   ├── scheme.css             ← color-scheme switch + colors every theme shares
│   ├── themes/
│   │   ├── base.css           ← default theme: palette on bare :root + role primitives
│   │   ├── ember.css          ← palette + the same role primitives, both on :root[data-theme]
│   │   ├── mono.css
│   │   ├── forge.css
│   │   ├── crayon.css
│   │   ├── moss.css
│   │   ├── petal.css
│   │   └── yorha.css
│   └── elements.css           ← element defaults (body, :focus-visible, a, etc.)
├── tokens/
│   ├── colors.css             ← all --color-*, --border-color-*, --focus-ring*, --page-backdrop
│   ├── typography.css         ← --font-*, --text-*, --weight-*, --ls-*, --lh-*, --underline-offset
│   ├── spacing.css            ← --sp-*, --page-gutter, the overlay, lift and carousel gaps, --hover-rule-gap
│   ├── radius.css             ← --radius-*
│   ├── borders.css            ← --border-width, --border-width-strong, --glow-ring-width, --hover-marker-width, --hover-rule-width
│   ├── layout.css             ← --container-*, --layout-*, --grid-min-col*, --ratio-*, --breakpoint-*
│   ├── sizes.css              ← --control-h-*, --handle-size, --lift-size, component sizes, the modal, toast, popover, menu and stat widths, the field label width, the command hint's maximum width
│   ├── motion.css             ← --dur-*, --ease-*, --transition-*, --scale-*, --motion-*
│   ├── elevation.css          ← --shadow-*, --z-*
│   ├── opacity.css            ← --opacity-*
│   └── icons.css              ← --icon-stroke, --icon-size-* (the icons themselves are components)
├── components/
│   ├── btn.css
│   ├── btn-group.css
│   ├── badge.css
│   ├── card.css
│   ├── modal/
│   │   ├── modal.css
│   │   └── modal-transitions.css
│   ├── nav/
│   │   ├── breadcrumb.css
│   │   ├── nav-link.css
│   │   └── pagination.css
│   ├── forms/
│   │   ├── field.css
│   │   ├── control.css        ← .input, and what .select and .textarea share with it
│   │   ├── input-group.css
│   │   ├── select.css
│   │   ├── checkbox.css
│   │   ├── toggle.css
│   │   ├── slider.css
│   │   └── ...                ← fieldset, radio, textarea, dropzone, search-field, settings-row
│   └── ...                    ← one file per base component (dock.css, chrome-bar.css, command.css, table.css, …)
├── utilities/
│   ├── layout.css             ← page-wrap, full-bleed, app shell, sidebar, hero, split
│   ├── layout-patterns.css    ← stats grid, z-pattern, overlay, bento, tiles, mosaic
│   ├── grid.css               ← grid-2, grid-3, col-span-*, etc.
│   ├── flex.css               ← flex-1, align-*, justify-*, etc.
│   ├── spacing.css            ← p-*, px/py/ps/pe/pt/pb-*, m-*, mx-auto, gap-*, stack-*
│   ├── surface.css            ← .surface*, .bordered*, .rounded-*
│   ├── text.css               ← size, color, weight, tracking, leading utilities
│   ├── animation.css          ← @keyframes + all .a-* and .entry-* classes
│   ├── shadow.css             ← .shadow-sm, -md, -lg, -xl
│   ├── media.css              ← .aspect-portrait, -square, -video, .object-cover
│   └── state.css              ← .is-busy, .hushable, .is-hushed, .is-grabbable, .is-grabbing
└── overrides/
    └── overrides.css
```

The font files themselves are in `static/fonts/`, not here ([themes](/projects/reader/design-system/themes/#fonts)).

## Where the layer order is declared

The files in this tree hold bare rules and never an `@layer` block. `index.css` assigns each one to its layer with `@import "…" layer(name)`, so the layer of every design-system file can be checked in one place ([the entry point](/design-systems/directory-structure/#the-entry-point)).

The order of the layers is a different matter. A browser fixes it the first time it parses each layer name ([order is fixed by first appearance](/css/cascade-layers/#order-is-fixed-by-first-appearance)). A screen's own stylesheet (feature CSS, below) is imported by its component and can reach the page before `index.css`. If that stylesheet were first to name `features`, it would put `features` ahead of every layer `index.css` names later. So the authoritative order statement is an inline `<style>` in `src/app.html`, ahead of `%sveltekit.head%`, and it holds nothing else:

```html
<style>@layer open-props, reset, base, tokens, components, features, utilities, overrides;</style>
```

`index.css` repeats the statement at its top, with a comment saying why. An identical second statement changes nothing and keeps the file readable on its own.

## Feature CSS

Some screens need a style the library can't express. Before writing one, I go through an order of preference: first redesign the screen from the existing components and utilities; if that doesn't work, add a variant, utility or component to the library under a domain-free name and show it in the playground; only then write domain CSS. The rules are on [feature CSS](/design-systems/directory-structure/#feature-css-layer-features) and [`@layer features`](/design-systems/cascade-layers/#layer-features).

The file sits beside the component that owns it and is imported by it, never by `index.css`, because the design system must never import from a domain. The reader has three kinds of location:

- in a domain's `ui/` folder: `src/lib/domains/library/ui/book-card.css` beside `BookCard.svelte`
- in `src/lib/shared/` for a reader part both readers share: `swipe-line.css` beside `SwipeLine.svelte`
- in `src/routes/playground/` for a playground section

Each file is one `@layer features` block holding one [`@scope`](/css/scope/) block for the component's root class:

```css
/* src/lib/domains/library/ui/book-card.css — imported by BookCard.svelte */
@layer features {
  @scope (.book-card) {
    .cover {
      aspect-ratio: 2 / 3;
      border-radius: var(--radius-container);
    }
  }
}
```

```svelte
<!-- src/lib/domains/library/ui/BookCard.svelte -->
<script lang="ts">
  import './book-card.css';
</script>
```

## Components must work at 380px

The narrowest viewport the reader supports is 380px wide. At that width the content column is about 380px minus the `.page-wrap` gutters, and every component's container queries have to leave it usable there. That doesn't mean queries are only needed near 380px: a multi-column layout may need to collapse at 800px or wider to avoid squeezing.

### The `.tabs` grid that broke the library below 570px

The library screen shows the books as a grid of covers inside a tab panel, and each cover has a title that's one line cut with an ellipsis (`.truncate`, so `white-space: nowrap`). On `/preview/b`, a preview of the library screen, the page scrolled sideways at phone widths. The cover grid laid out three columns of about 165px in a viewport of about 410px, the shelf tabs and the Sort, Covers and List tools ran off the right edge, and the page background stopped at the viewport while the content kept going. It started at about 570px and got worse below that. Two earlier fixes (the main area's track and the scroll strip) hadn't cured it, and measurements taken with a few tiny seeded images showed it gone when it wasn't.

The cause was one rule in `components/tabs.css`, copied from an example design library:

```css
.tabs { display: grid; gap: var(--sp-4); min-inline-size: 0; }
```

A grid with no `grid-template-columns` gets one implicit `auto` column, and an `auto` track grows to its widest child's min-content. The widest child was the tab panel, and its min-content came from the longest book title: a `nowrap` title's min-content is the whole title plus the ⋯ button, 490px for a long Japanese title in the reproduction. The cover grid passed that width up, because while a grid's own width is being measured the `100%` in its `minmax(min(100%, var(--grid-min-col)), 1fr)` columns counts as `auto`. `.tab-panel` passed it on too. So `.tabs` kept its right outer width, but its one column became about 490px and everything inside was laid out at that width. The "570px" was just the longest title plus the main area's 40px padding. The pill tab row and the large cover images weren't involved: `.tabs-header` already had `min-inline-size: 0`, and the covers are downscaled and sized at `inline-size: 100%`.

It was found by hand in devtools, narrowing from the width near 570px to the `section`, then to `div.tabs.tabs-pill`, while reading the CSS showed the template-less grid. Walking up from the overflowing element and comparing each ancestor's width with its parent's finds the first box that escapes, which here was `.tab-panel`. The general write-up is [a tab container that was a grid broke a screen below 570px](/css/grid-and-flex-sizing/#a-tab-container-that-was-a-grid-broke-a-screen-below-570px).

The fix made `.tabs` a flex column, which stretches its children to its own width, so a wide child can't widen it. Then I audited all 29 template-less grids: 13 stacks became flex columns, 10 stayed grids with `grid-template-columns: minmax(0, 1fr)` (they're stretched in a row and share extra height, stack children with `grid-area: 1 / 1`, scroll, or have a two-column variant), and 6 are allow-listed with a reason (fixed-size icon boxes, the modal backdrop). Afterwards a sweep from 320 to 800px showed no overflow, and so did 126 runs (3 pages × 6 themes × 7 viewports).

That gave the component rule: a stack is a flex column, and every `display: grid` in components and utilities declares its columns, a single column being `minmax(0, 1fr)`. A spec asserts `.tabs` stays a flex column, and another fails on any grid without a column declaration outside the allow-list.

## Legacy tokens

Before the design system, the app had its own token file, `src/lib/styles/tokens.css`, loaded unlayered. Unlayered CSS beats every layer, so any custom property it shared a name with shadowed the layered contract token ([unlayered tokens can shadow layered tokens](/design-systems/in-practice/#unlayered-tokens-can-shadow-layered-tokens)). One name collided: `--z-modal`, 40 in the legacy file and 400 in the contract. A fixed overlay then sat under the sticky header, which is at `--z-sticky` (200). Nothing in the old screens read the legacy `--z-modal`, so I deleted the line, and until the file went, a new token had to avoid every legacy name (checked with `comm` over the two sets of declared names).

Later `tokens.css` and the unlayered `<style>` block in the root layout were removed for good. `source-styling.spec.ts` now fails on any `--c-`, `--f-`, `--s-` or `--r-` name anywhere under `src/`, the legacy prefixes.

## Icons

Icons follow [icons as Svelte components](/design-systems/icons/). In the reader:

- Every icon is a file in `src/lib/components/icons/`, named in PascalCase after the Lucide name (`CircleCheck.svelte`), holding only the icon's name and `iconNode` and passing them to the shared `Icon.svelte`.
- `icons/icon.ts` has the `IconElement` union (`circle`, `ellipse`, `g`, `line`, `path`, `polygon`, `polyline`, `rect`), `iconStroke`, which computes whether the theme's `--icon-stroke` applies, and `isDecorative`, which sets `aria-hidden`.
- The props mirror `@lucide/svelte`, including `absoluteStrokeWidth` and `nonScalingStroke`. In `@lucide/svelte` 1.x, `nonScalingStroke` is the prop and `absoluteStrokeWidth` is deprecated in its favor.
- Lucide's ISC and Feather's MIT notices ship in `static/licenses.txt`, which already covers every Lucide icon.

Three checks keep the folder honest. A spec fails if an icon file has no importer outside the playground, the specs and the icons folder, so a new icon has to be imported from real app code in the same change; playground-only use doesn't count. The same spec fails if an `index.*` appears in the folder, and another checks each icon's `name` matches its file name. The dependency-cruiser rule `icons-are-imported-one-by-one` forbids importing an icon through anything but its own file ([dependency rules](/projects/reader/architecture/dependency-rules/)).

## Markup that uses classes nobody defined

`justify-center` was written in two reader components but defined in no stylesheet, so the loading curtain was silently not centered. Nothing failed, because an unknown class is just ignored.

`markup-classes.spec.ts` now scans every class in `src/**/*.svelte` (attributes, `class={[…]}` expressions and `class` props) and fails when a class whose first segment belongs to a design-system family (`justify-`, `min-`, `layout-` and so on) is defined by no stylesheet. Screen-local marker names outside those families aren't flagged. String literals after `===` or `!==` are skipped, so `kind === 'text'` isn't read as a class. A base component's part class counts too: `.marquee-selection-box` was written in `MarqueeSelection.svelte` as a hook with no rule of its own, and the spec failed. A part class either gets a selector that names it or goes. The general version: [checking that markup only uses classes that exist](/design-systems/in-practice/#checking-that-markup-only-uses-classes-that-exist).

## What `design-system.spec.ts` checks

`design-system.spec.ts` reads the stylesheets and holds several rules that are easy to break without noticing:

- **Every runtime input is read with a fallback.** A runtime input is a custom property a caller or an ancestor sets, like `--btn-min-block-size`. Each is listed in `RUNTIME_INPUTS`. The test matches a name as a prefix, which is why one token had to be renamed ([tokens](/projects/reader/design-system/tokens/#why-its---indeterminate-share); the hook itself is on [utilities](/projects/reader/design-system/utilities-and-layouts/#the-app-shell-on-a-narrow-screen)).
- **A scoped palette name doesn't repeat a shared name** ([themes](/projects/reader/design-system/themes/#palettes-and-role-primitives)).
- **`.eyebrow` is the first rule in `text.css`** ([utilities](/projects/reader/design-system/utilities-and-layouts/#between-two-utilities-the-file-order-decides)).

Other specs cover the breakpoint scale and `NARROW_SCREEN_QUERY` ([tokens](/projects/reader/design-system/tokens/#breakpoint-scale)) and `KeyHints`' markup ([components](/projects/reader/design-system/components/#keyhints-and-pageheader)). How the specs run is on [checks and tests](/projects/reader/engineering/checks-and-tests/).
