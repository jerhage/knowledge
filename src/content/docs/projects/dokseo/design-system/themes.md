---
title: Dokseo's Eight Themes
description: The eight themes and how each assigns the same role primitives, YoRHa's treatment primitives, the self-hosted theme fonts and their metric overrides, and adding a theme.
tags: [dokseo, design-systems, theming, design-tokens, fonts, custom-properties, color-scheme]
sidebar:
  order: 20
---

Dokseo, my manga and book reader, has eight themes, each one file that assigns the same set of role primitives, and each with a light and a dark scheme. The mechanism (theme vs scheme, role primitives, scoped palettes) is on [theme identity and color scheme](/design-systems/cascade-layers/#theme-identity-and-color-scheme) and [color primitives](/design-systems/token-pipeline/#color-primitives).

## The theme files

They live in `src/lib/styles/base/themes/`:

| File | What it is |
| --- | --- |
| `base.css` | The default theme. Its palette sits on a bare `:root`, and the selector list of its role primitives includes a bare `:root` too, so a page with no `data-theme` yet still renders complete. |
| `ember.css` | A theme: palette, then role primitives, both on `:root[data-theme='ember']` |
| `mono.css` | Same structure |
| `forge.css` | Same structure |
| `crayon.css` | Same structure |
| `moss.css` | Same structure |
| `petal.css` | Same structure |
| `yorha.css` | Same structure, and the one theme that sets the treatment primitives (below) |

`index.css` imports them into the base layer, after the shared primitives and the scheme file and before the element defaults:

```css
@import "base/primitives.css"     layer(base);
@import "base/scheme.css"         layer(base);
@import "base/themes/base.css"    layer(base);
@import "base/themes/ember.css"   layer(base);
@import "base/themes/mono.css"    layer(base);
@import "base/themes/forge.css"   layer(base);
@import "base/themes/crayon.css"  layer(base);
@import "base/themes/moss.css"    layer(base);
@import "base/themes/petal.css"   layer(base);
@import "base/themes/yorha.css"   layer(base);
@import "base/elements.css"       layer(base);
```

Every scheme-dependent color is one [`light-dark()`](/css/color-scheme/#light-dark) pair. I only use the color form, which is Baseline 2024. An image form exists too, but it's only now shipping, so I don't count on it.

## Palettes and role primitives

Each theme file has two blocks. The first is the theme's palette: its raw colors, as `light-dark()` pairs. The second assigns the role primitives (`--ds-bg`, `--ds-primary` and the rest) from that palette. Components never read either; they read semantic tokens, which read the role primitives.

Palette names are generic hues, never a theme's name: `slate`, `khaki`, `rust`, `copper`, `lime`, with a scale step or a word for the value (`--ds-slate-25`, `--ds-khaki-on-ink`, `--ds-khaki-glow`). A value that isn't one color is named for what it is, like `--ds-grid-line` for YoRHa's backdrop.

A theme's palette block uses the theme's own selector, `:root[data-theme='<name>']`, so it only exists while that theme is on. Names that exist under every theme are a different matter: the default palette on bare `:root`, `primitives.css`, `scheme.css` and the role primitives. Say the default theme has `:root { --ds-bg: var(--ds-slate-25) }`, and some other theme's scoped block also declares a `--ds-slate-25` of its own. That `var()` isn't frozen where the default rule is written. It's resolved on the root element from whatever `--ds-slate-25` the root has at that moment, so while the other theme is on, the default's `--ds-bg` silently takes the other theme's slate ([a `var()` in a custom property resolves on the element, not in its rule](/css/custom-property-gotchas/#a-var-in-a-custom-property-resolves-on-the-element-not-in-its-rule)). Two scoped palettes can share a name freely, because only one of their selectors matches at a time. So the rule is: a scoped palette name never repeats a name that is present under every theme, and `design-system.spec.ts` checks it.

The same behavior gave me a way to prove the palette-scoping refactor changed nothing. The computed value of each role primitive and semantic token on the root is its token stream with every `var()` substituted. So I read all of them with `getPropertyValue` in every theme and scheme, before and after the refactor, and compared the two dumps. Collapse whitespace first: a value that got reflowed over several lines serializes its line break as a space.

One role primitive that differs by theme outside color: `--ds-icon-stroke` is 2, and 2.5 in mono and crayon to match their 2 to 3px borders. How icons read it is on [icons](/design-systems/icons/).

## YoRHa's treatment primitives

Some role primitives hold a treatment instead of a color or a size. Seven themes leave them at a value that changes nothing, and YoRHa replaces them. Every theme file still assigns every one.

| Role primitive | Semantic token | Default in every other theme | YoRHa |
| --- | --- | --- | --- |
| `--ds-page-backdrop` | `--page-backdrop` | `none` | a faint grid: two `repeating-linear-gradient`s, 1px lines every 4px at `0deg` and at `90deg`, both in `--ds-grid-line` |
| `--ds-motion-overlay-in` · `-overlay-out` | `--motion-overlay-in` · `-out` | `kModalIn` · `kModalOut` | `kScanIn` · `kScanOut` |
| `--ds-motion-menu-in` | `--motion-menu-in` | `kDropIn` | `kScanIn` |
| `--ds-motion-toast-in` · `-toast-out` | `--motion-toast-in` · `-out` | `kToastIn` · `kToastOut` | `kGlitchIn` · `kGlitchOut` |
| `--ds-motion-item-in` | `--motion-item-in` | `kSlideUp` | `kGlitchIn` |
| `--ds-motion-panel-in` | `--motion-panel-in` | `none` | `kFlicker` |
| `--ds-dur-exit` · `--ds-easing-exit` | `--transition-exit` | `--ds-dur-flash` · `--ds-ease-in` | `--ds-dur-moderate` · `--ds-ease-in-out-sharp` |
| `--ds-hover-fill` | `--color-hover-fill` | the theme's hover tint (`--ds-hover`'s value) | ink |
| `--ds-hover-fill-soft` | `--color-hover-fill-soft` | `transparent` | ink |
| `--ds-hover-fill-solid` | `--color-hover-fill-solid` | `transparent` | paper (`--ds-khaki-on-ink`) |
| `--ds-hover-text` · `-text-solid` | `--color-hover-text` · `-text-solid` | `initial` | paper · ink |
| `--ds-press-fill` | `--color-press-fill` | the theme's active tint (`--ds-active`'s value) | the darker ink |
| `--ds-chosen-fill` · `--ds-chosen-text` | `--color-chosen-fill` · `-text` | `initial` | ink · paper |
| `--ds-hover-glow` | `--color-hover-glow` | `initial` | the ink glow (`--ds-khaki-glow`) |
| `--ds-dur-sweep` · `--ds-easing-sweep` | `--transition-sweep` | `0s` · `linear` | `220ms` · `--ds-ease-in-out-sharp` |
| `--ds-dur-hover-text` · `--ds-easing-hover-text` | `--transition-hover-text` | `--ds-dur-flash` · `--ds-ease-smooth` (the `--transition-ui` timing) | the sweep's |
| `--ds-marker-width` · `--ds-marker` | `--hover-marker-width` · `--color-hover-marker` | `0px` · the theme's accent | `0px` · ink (no marker bar) |
| `--ds-hover-rule-width` · `--ds-hover-rule-gap` · `--ds-hover-rule` | `--hover-rule-width` · `--hover-rule-gap` · `--color-hover-rule` | `0px` · `0px` · `transparent` | `--ds-border-1` · `3px` · ink |
| `--ds-radius-pill` · `--ds-radius-round` | `--radius-pill` · `--radius-round` | `--ds-radius-full` | `--ds-radius-none` |

The `initial` entries are what let seven themes keep every component's own hover and chosen colors untouched while YoRHa swaps them all for one ink and paper pair. `--ds-hover-text: initial` makes the primitive guaranteed-invalid, `--color-hover-text` inherits that, and a component's `color: var(--color-hover-text, var(--color-text))` falls back to its own color. The computed style in the other themes is identical to before the tokens existed. Why it works, and why the fallback is required: [a custom property set to `initial` makes a token a fallback switch](/css/custom-property-gotchas/#a-custom-property-set-to-initial-makes-a-token-a-fallback-switch).

Where the hover tokens and the keyframes are read is on [token values](/projects/dokseo/design-system/tokens/).

## Fonts

All theme faces are self-hosted, as on [directory structure: fonts](/design-systems/directory-structure/#fonts). Dokseo's specifics:

- The files are in `static/fonts/`, served at `/fonts/`. A variable face is one file named for the family (`outfit.woff2`, `dm-sans.woff2`); a static face is one file per weight (`dm-mono-400.woff2`, `zen-kaku-gothic-new-500.woff2`). Each family has its `<family>.OFL.txt` beside it.
- The CSP's `font-src` is `'self' blob: data:` (see [security policy](/projects/dokseo/engineering/security-policy/)).
- The three Japanese faces (Zen Maru Gothic, M PLUS Rounded 1c, Zen Kaku Gothic New) ship their Latin subset only. Japanese glyphs fall through, character by character, to the next family in the theme's stack and then to the system face.
- The subsets come from the Google Fonts CSS API fetched with a current Chrome user agent ([how](/css/font-metrics/#fetching-a-fonts-latin-subset-from-google-fonts)). They're small: Zen Kaku Gothic New's Latin subset is under 10 KB a weight, where the whole face is megabytes.
- A theme names its faces in `--ds-font-display`, `--ds-font-body` and `--ds-font-mono`, each ending in a generic family.

### Metric overrides

Badges, tags and buttons set their text at `line-height: 1`, and in Moss and YoRHa the capitals sat 0.7 to 1.9 px low in every pill, in Chromium and WebKit alike. The fix is `ascent-override` and `descent-override` on every `@font-face` in `base/fonts.css`, computed so the cap height sits in the middle of the line box ([centering text in pills and buttons](/css/font-metrics/#centering-text-in-pills-and-buttons-font-metric-overrides-not-padding)). `A` and `D` come from the face's hhea table and the cap height `C` from OS/2 `sCapHeight`.

What I measured (ascent and descent, cap height, and how far the capitals sat below center, all in em):

| Face | Asc / desc | Cap | Drop |
| --- | --- | --- | --- |
| Zen Kaku Gothic New, Zen Maru Gothic | 1.160 / 0.288 | 0.700 | +0.086 (low) |
| Literata | 1.177 / 0.308 | 0.701 | +0.084 (low) |
| Newsreader | 0.735 / 0.265 | 0.676 | −0.103 (high) |
| Courier Prime | 0.781 / 0.342 | 0.580 | −0.070 (high) |
| system-ui (base) | 0.967 / 0.211 | 0.705 | +0.026 |
| the other faces | (none) | (none) | −0.03 to +0.03 |

The values in `base/fonts.css`:

| Face | ascent-override | descent-override |
| --- | --- | --- |
| Zen Kaku Gothic New, Zen Maru Gothic | 107.4% | 37.4% |
| Literata | 109.3% | 39.2% |
| M PLUS Rounded 1c | 106.25% | 33.25% |
| M PLUS 1 Code | 98.25% | 25.25% |
| Newsreader | 83.8% | 16.2% |
| Courier Prime | 85.15% | 27.15% |
| Share Tech Mono | 91.35% | 21.35% |
| Archivo | 88.7% | 20.1% |
| Bricolage Grotesque | 93% | 27% |
| Figtree | 95% | 25% |
| Outfit | 98% | 28% |
| DM Sans, DM Mono | 100.1% | 30.1% |
| IBM Plex Mono | 99.9% | 30.1% |
| Geist, Geist Mono | 100.5% | 29.5% |
| JetBrains Mono | 102.5% | 29.5% |

A new face gets its two numbers from a small script that reads the woff2's head, hhea and OS/2 tables and prints the percentages. The base theme uses `system-ui`, which can't be overridden and is already close to centered.

After the change every pill is within ±0.5 px of center in Chromium and ±0.64 px in WebKit, the same residue base has, and no pill or button changed height. One side effect I accepted: a line mixing the body face with inline `code` or `kbd` used to be taller than its line height, and now drops back to it (1 to 4 px shorter), while the code and kbd chips grow 1 px.

What I tried and rejected: `text-box: trim-both cap alphabetic` does nothing on these `inline-flex` components. It only works with the label in its own block span, which changes every component's markup and its height per face (a badge went from 21 to about 18 px). Extra padding per theme only fixes one face.

## Adding a theme

What a ninth theme touches:

1. A new `src/lib/styles/base/themes/<name>.css`: a `:root[data-theme="<name>"]` block with the palette under generic names that clash with nothing shared, then a second one assigning every role primitive, treatment primitives included. Plus its `@import` in `index.css`.
2. If it needs to change a value that is still a plain primitive, promote that value to a role primitive in all eight existing files first, each with its current value, and point the semantic token at it. No component CSS changes.
3. Its fonts, if any: the woff2 files and OFL notices in `static/fonts/`, and `@font-face` rules in `base/fonts.css` with the two metric overrides.
4. The list of accepted theme names in two places. One is the pre-paint script in `src/app.html` that applies the stored theme before first paint. Its CSP hash changes with it, so the policy needs the new hash. The other is the theme control in settings.
