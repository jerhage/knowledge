---
title: Design System Directory Structure
description: How the layered CSS design system is laid out on disk, how fonts are self-hosted, and how the entry point orders the layers.
tags: [css, design-systems, project-structure, fonts, cascade-layers]
sidebar:
  order: 7
---

## Structure

This is the layered CSS design system as a folder of plain CSS files. `[system]` is
wherever the stylesheets live, for example `src/lib/styles/` in a SvelteKit
app. The token and component files named below are just examples of how to
split the work. What stays fixed is the folders and the rule of one concern per file.

```
[system]/
│
├── index.css                  ← layer declaration + ordered imports, nothing else
│
├── reset.css                  ← a modern CSS reset, such as Josh Comeau's
│
├── base/
│   ├── fonts.css              ← @font-face for self-hosted theme fonts (see Fonts below)
│   ├── primitives.css         ← all --ds-* raw values
│   ├── scheme.css             ← color-scheme switch + colors every theme shares
│   ├── themes/
│   │   ├── base.css           ← default theme: palette on bare :root + role primitives
│   │   ├── forest.css         ← one file per theme: palette + the same role primitives, on :root[data-theme]
│   │   └── ...
│   └── elements.css           ← element defaults (body, :focus-visible, a, etc.)
│
├── tokens/
│   ├── colors.css             ← --color-*, --border-color-*, --focus-ring*, page backdrop
│   ├── typography.css         ← --font-*, --text-*, --weight-*, --ls-*, --lh-*, underline offset
│   ├── spacing.css            ← --sp-*, the page gutter, named gaps components share
│   ├── radius.css             ← --radius-*
│   ├── borders.css            ← --border-width, a strong width, focus/glow ring widths
│   ├── layout.css             ← --container-*, --layout-*, grid minimum columns, --ratio-*, --breakpoint-*
│   ├── sizes.css              ← --control-h-*, handle sizes, modal/toast/popover/menu widths
│   ├── motion.css             ← --dur-*, --ease-*, --transition-*, --scale-*, --motion-*
│   ├── elevation.css          ← --shadow-*, --z-*
│   ├── opacity.css            ← --opacity-*
│   └── icons.css              ← --icon-stroke, --icon-size-* (the icons themselves are components)
│
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
│   │   └── ...                ← fieldset, radio, textarea, dropzone, search field, settings row
│   └── ...                    ← one file per base component (dock.css, table.css, …)
│
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
│   └── state.css              ← .is-busy, .is-grabbable, .is-grabbing, …
│
└── overrides/
    └── overrides.css
```

Each top-level folder maps to one of the [cascade layers](/design-systems/cascade-layers/), and `reset.css` fills the `reset` layer. The split between `base/primitives.css`, the theme files and `tokens/` follows the [token pipeline](/design-systems/token-pipeline/). The full list of what goes in `tokens/` is in [semantic tokens](/design-systems/semantic-tokens/).

## Fonts

I serve every theme's fonts from my own origin. Nothing loads from a font CDN,
so a strict CSP's `font-src` can be `'self' blob: data:`.

- The files live in the static folder, for example `static/fonts/`, served
  at `/fonts/`. A variable face is one file named for the family
  (`outfit.woff2`, `dm-sans.woff2`); a static face is one file per weight
  (`dm-mono-400.woff2`).
- Each family ships its SIL Open Font License beside it,
  `<family>.OFL.txt`, with the family's own copyright line.
- Ship only the weights a theme uses, as the Latin subset from Google Fonts.
  A CJK face (for example Zen Maru Gothic or M PLUS Rounded 1c) can ship just
  its Latin subset. CJK glyphs then fall through, character by character, to the
  next family in the theme's stack, and then to the system face.
- `base/fonts.css` declares one `@font-face` per file: `font-family`,
  `src: url('/fonts/<file>.woff2') format('woff2')`, `font-weight` (the
  range of a variable file, or the one weight), `font-style: normal` and
  `font-display: swap`. No `unicode-range`, and nothing is preloaded. The
  browser only fetches a file when the current theme's font stack uses its family.
- Each face places its glyphs in the line box according to its own
  metrics, and faces differ a lot. Left alone, a face with a tall ascent
  (Zen Kaku Gothic New, Zen Maru Gothic, M PLUS Rounded 1c, Literata) draws
  its capitals low in every pill and button, and a face with a short ascent
  (Newsreader, Courier Prime) draws them high. So every `@font-face` also
  sets `ascent-override` and `descent-override`, picked so the face's cap
  height (the height of its capital letters) sits in the middle of its line
  box. Take the face's own ascent `A`, descent `D` (hhea) and cap height `C`
  (OS/2 `sCapHeight`), all as fractions of the em. Then
  `ascent-override: (A + D + C) / 2` and
  `descent-override: (A + D − C) / 2`. The sum `A + D` doesn't change, so
  `line-height: normal` keeps its height. Only the glyphs' position in the
  box moves. I read `A`, `D` and `C` from the woff2's head, hhea and OS/2
  tables with a small script that prints the two overrides. The system face
  (`system-ui`) can't be overridden, and it's already balanced. The
  measured values and the method are in [font metrics](/css/font-metrics/).
- A theme names its faces in its role primitives, `--ds-font-display`,
  `--ds-font-body` and `--ds-font-mono`, each ending in a generic family.

## When to use a directory vs. a single file

Use a **single file** when the component and all its sub-elements fit together cleanly. Sub-elements like `.card-body` and `.card-footer` depend on each other closely, and splitting them gains nothing.

Use a **directory** when a component has parts that really do stand apart: complex entry and exit transitions, responsive behavior big enough for its own file, or sub-components large enough to get lost in one file.

| Approach | Good candidates |
|---|---|
| Single file | `.btn` `.badge` `.card` `.divider` `.avatar` `.tag` `.tooltip` |
| Directory | `modal/` `nav/` `forms/` `dropdown/` `drawer/` |

## The entry point

Everything hangs on `index.css`. It repeats the `@layer` declaration and controls the import order, and nothing else should touch that order. Each imported file holds bare rules with no `@layer` wrapper, and the entry point assigns each file to its layer. That keeps the individual files clean, and I can check the whole layer stack in one place.

The `@layer` declaration in `index.css` isn't the copy that counts, though. [Layer order is fixed by where each name first appears](/css/cascade-layers/#order-is-fixed-by-first-appearance), and a component's own stylesheet (a feature file in the `features` layer) can load before `index.css`. If it did, it would fix where `features` sits before `index.css` loaded. So the copy of the order statement that counts is an inline `<style>` in the app's HTML shell (in SvelteKit, `src/app.html`, ahead of `%sveltekit.head%`). That makes it the first CSS the browser parses (see the layer strategy in [cascade layers](/design-systems/cascade-layers/)). With the order declared first in the shell, no import order can move a layer. The copy in `index.css` changes nothing. It's there so the file makes sense on its own.

```css
/* index.css */
@layer open-props, reset, base, tokens, components, features, utilities, overrides;

@import "reset.css"               layer(reset);

@import "base/primitives.css"     layer(base);
@import "base/scheme.css"         layer(base);
@import "base/themes/base.css"    layer(base);
@import "base/themes/forest.css"  layer(base);
/* ... one line per theme ... */
@import "base/elements.css"       layer(base);

@import "tokens/colors.css"       layer(tokens);
@import "tokens/typography.css"   layer(tokens);
@import "tokens/spacing.css"      layer(tokens);
@import "tokens/radius.css"       layer(tokens);
@import "tokens/borders.css"      layer(tokens);
@import "tokens/layout.css"       layer(tokens);
@import "tokens/sizes.css"        layer(tokens);
@import "tokens/motion.css"       layer(tokens);
@import "tokens/elevation.css"    layer(tokens);

@import "components/btn.css"      layer(components);
@import "components/card.css"     layer(components);
@import "components/modal/modal.css"             layer(components);
@import "components/modal/modal-transitions.css" layer(components);
/* ... */

@import "utilities/layout.css"    layer(utilities);
@import "utilities/grid.css"      layer(utilities);
@import "utilities/flex.css"      layer(utilities);
@import "utilities/spacing.css"   layer(utilities);
@import "utilities/text.css"      layer(utilities);
@import "utilities/animation.css" layer(utilities);
@import "utilities/shadow.css"    layer(utilities);

@import "overrides/overrides.css" layer(overrides);
```

## Feature CSS (`@layer features`)

Feature CSS isn't part of this tree. It lives next to the component that owns it, in that feature's UI folder. That component imports it, and the file wraps itself in `@layer features { @scope (…) { … } }`. `index.css` never reaches into a feature. The rules and the order of preference are under `@layer features` in [cascade layers](/design-systems/cascade-layers/#layer-features). For how that looks in a Svelte component, see [Svelte with a global CSS design system](/design-systems/svelte/#4-compose-components-using-your-global-utilities).
