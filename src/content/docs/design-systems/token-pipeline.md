---
title: Token Pipeline
description: How a value travels from a raw value through a --ds-* primitive to a semantic token, with the standard primitive names.
tags: [css, design-systems, design-tokens, architecture]
sidebar:
  order: 3
---

## Token Mapping: The Three-Tier Pipeline

A component never holds a color, size or duration itself. It reads a custom property, and that property gets its value through a chain of other custom properties. A value goes through exactly three tiers before it reaches a component: it starts as a raw value, gets a `--ds-*` primitive name, and then a semantic token name for what it's used for. No tier can be skipped.

```
Raw Value / Open Props  →  --ds-* primitive  →  Semantic token  →  Component consumes
     (Tier 1)                 (Tier 2)              (Tier 3)
```

### Tier 1: Raw Values

These are defined on `:root` in the [base layer](/design-systems/cascade-layers/#layer-base). Custom hex values, px values and any references to third-party variables (Open Props, for example) live here. Nothing outside Tier 1 uses raw values.

### Tier 2: `--ds-*` Primitives

This tier is a set of 1:1 aliases, on the same `:root` in the base layer, that puts everything under the `--ds-` prefix. Every layer after this one only references `--ds-` names, so nothing in those layers depends on whether a value came from Open Props or was written by hand.

```css
/* base/primitives.css — imported with layer(base) */
:root {
  /* From Open Props */
  --ds-space-4: var(--size-4);
  --ds-ease-spring: var(--ease-spring-3);

  /* Custom precision */
  --ds-fz-lg: 1.25rem;
  --ds-radius-md: 8px;
}
```

Theme palettes and role primitives such as `--ds-primary` are declared per theme in `base/themes/<name>.css` (see [Theme identity and color scheme](/design-systems/cascade-layers/#theme-identity-and-color-scheme)).

The tables below list the standard `--ds-*` names every system defines. Every category except color uses the names listed here. **Color primitive names are system-specific**: palette names and weights differ from system to system.

#### Color Primitives

Each system defines its own color primitive names, and they're not part of the contract shared across systems. They follow these patterns:

| Pattern                 | Examples                                                 |
| ----------------------- | -------------------------------------------------------- |
| `--ds-[color]-[weight]` | `--ds-yellow-500` · `--ds-cyan-200` · `--ds-khaki-ink`   |
| `--ds-[role]-[weight]`  | `--ds-brand-400` · `--ds-accent-300` · `--ds-danger-300` |
| `--ds-[name]`           | `--ds-ink` · `--ds-white` · `--ds-paper`                 |

Some systems also define short primitives named for a role (`--ds-primary`, `--ds-border`, `--ds-text`) that map straight onto the semantic layer.

#### Font Families

| Token               | Role                       |
| ------------------- | -------------------------- |
| `--ds-font-display` | Display / heading typeface |
| `--ds-font-body`    | Body / UI typeface         |
| `--ds-font-mono`    | Monospace typeface         |

#### Font Sizes

Most systems use `--ds-fz-*`, and some use `--ds-text-*`. Both map to the same semantic tokens further down.

| Token          | Approx. Size |
| -------------- | ------------ |
| `--ds-fz-xxs`  | ~9px         |
| `--ds-fz-xs`   | ~11px        |
| `--ds-fz-sm`   | ~13px        |
| `--ds-fz-base` | ~15-16px     |
| `--ds-fz-md`   | ~18px        |
| `--ds-fz-lg`   | ~20px        |
| `--ds-fz-xl`   | ~25px        |
| `--ds-fz-2xl`  | ~30px        |
| `--ds-fz-3xl`  | ~36px        |
| `--ds-fz-4xl`  | ~48px        |
| `--ds-fz-5xl`  | ~60px        |

#### Font Weights

Font weights have numbered steps (`--ds-fw-*`) and names (`--ds-weight-*`). Both end up at the same values further down.

| Numeric                           | Named                  | Value   |
| --------------------------------- | ---------------------- | ------- |
| `--ds-fw-1`                       | (none)                 | 100     |
| `--ds-fw-2`                       | (none)                 | 200     |
| `--ds-fw-3` · `--ds-fw-light`     | (none)                 | 300     |
| `--ds-fw-4` · `--ds-fw-normal`    | `--ds-weight-normal`   | 400     |
| `--ds-fw-5`                       | `--ds-weight-medium`   | 500     |
| `--ds-fw-6` · `--ds-fw-semibold`  | `--ds-weight-semibold` | 600     |
| `--ds-fw-7` · `--ds-fw-bold`      | `--ds-weight-bold`     | 700     |
| `--ds-fw-8` · `--ds-fw-extrabold` | (none)                 | 800     |
| `--ds-fw-9` · `--ds-fw-black`     | `--ds-weight-black`    | 800-900 |

#### Letter Spacing

| Token            | Approx. Value      |
| ---------------- | ------------------ |
| `--ds-ls-tight`  | −0.04em to −0.02em |
| `--ds-ls-normal` | 0                  |
| `--ds-ls-wide`   | 0.03em to 0.05em     |
| `--ds-ls-wider`  | 0.08em to 0.1em      |
| `--ds-ls-widest` | 0.16em to 0.2em      |

#### Line Height

| Token             | Approx. Value |
| ----------------- | ------------- |
| `--ds-lh-none`    | 1             |
| `--ds-lh-tight`   | 1.1-1.2       |
| `--ds-lh-snug`    | 1.3-1.4       |
| `--ds-lh-normal`  | 1.35-1.65     |
| `--ds-lh-relaxed` | 1.6-1.85      |
| `--ds-lh-loose`   | 1.8+          |

#### Spacing

A 10-step scale. Some systems go up to `--ds-space-12` and `--ds-space-16`.

| Token           | Approx. Value |
| --------------- | ------------- |
| `--ds-space-1`  | 0.25rem       |
| `--ds-space-2`  | 0.5rem        |
| `--ds-space-3`  | 0.75rem       |
| `--ds-space-4`  | 1rem          |
| `--ds-space-5`  | 1.25-1.5rem   |
| `--ds-space-6`  | 1.5-2rem      |
| `--ds-space-7`  | 2-3rem        |
| `--ds-space-8`  | 2.5-4rem      |
| `--ds-space-9`  | 3-6rem        |
| `--ds-space-10` | 4-8rem        |

#### Border Radius

| Token              | Approx. Value |
| ------------------ | ------------- |
| `--ds-radius-none` | 0             |
| `--ds-radius-xs`   | 2-3px         |
| `--ds-radius-sm`   | 3-5px         |
| `--ds-radius-md`   | 6-8px         |
| `--ds-radius-lg`   | 8-12px        |
| `--ds-radius-xl`   | 10-18px       |
| `--ds-radius-2xl`  | 18px          |
| `--ds-radius-full` | 999px         |

#### Container & Layout

| Token                           | Role                                   |
| ------------------------------- | -------------------------------------- |
| `--ds-container-prose`          | Narrow readable content width          |
| `--ds-container-wide`           | Full layout max-width                  |
| `--ds-layout-hero-height`       | Hero section height                    |
| `--ds-layout-row-height`        | Mosaic / grid row height               |
| `--ds-layout-sheet-height`      | Bottom sheet height                    |
| `--ds-layout-sheet-height-tall` | Tall bottom sheet height (e.g. 75dvh)  |
| `--ds-size-touch`               | Touch target side (e.g. 2.75rem)       |
| `--ds-size-compact`             | Compact breakpoint                     |
| `--ds-size-narrow`              | Narrow breakpoint (e.g. 48rem)         |
| `--ds-size-sidebar`             | Sidebar width                          |
| `--ds-size-list`                | Width of a list beside content         |

#### Component Sizes

A component size, like a control's height or an avatar's side, often has the same value as another size or as a step on the spacing scale. Each role still gets its own primitive, even when two roles share a value. That way a theme can change one without the other, and without touching the spacing scale. So no size is built on a spacing primitive. Example values:

| Token                                             | Value                          |
| ------------------------------------------------- | ------------------------------ |
| `--ds-size-control-xs` · `-sm` · `-md` · `-lg`    | 1.25rem · 2rem · 2.5rem · 3rem |
| `--ds-size-icon-sm` · `-md` · `-lg`               | 0.75rem · 1rem · 1.25rem       |
| `--ds-size-icon-tile-sm` · `-lg`                  | 2.5rem · 3rem                  |
| `--ds-size-avatar-sm` · `-md` · `-lg`             | 2rem · 2.5rem · 4rem           |
| `--ds-size-indicator` · `--ds-size-indicator-dot` | 1rem · 0.5rem                  |
| `--ds-size-toggle-track-w` · `-h`                 | 2rem · 1.25rem                 |
| `--ds-size-track-sm` · `-md` · `-lg`              | 0.25rem · 0.5rem · 0.75rem     |
| `--ds-size-thumbnail-sm` · `-md` · `-lg`          | 1.5rem · 2.5rem · 4rem         |
| `--ds-size-textarea-min`                          | 4rem                           |
| `--ds-size-label`                                 | 9rem                           |
| `--ds-size-skeleton-line-sm` · `-md` · `-lg`      | 0.75rem · 1rem · 1.25rem       |
| `--ds-size-width-sm` · `-md` · `-lg`              | 1.5rem · 2.5rem · 4rem         |
| `--ds-underline-offset`                           | 0.25rem                        |
| `--ds-scale-shrink-sm` · `-md` · `-lg`            | 0.98 · 0.97 · 0.96             |
| `--ds-share-indeterminate`                        | 0.4                            |

#### Duration

| Token               | Approx. Value |
| ------------------- | ------------- |
| `--ds-dur-instant`  | 0-50ms        |
| `--ds-dur-flash`    | 80-90ms       |
| `--ds-dur-quick`    | 150-180ms     |
| `--ds-dur-moderate` | 240-500ms     |
| `--ds-dur-slow`     | 420-750ms     |
| `--ds-dur-crawl`    | 600-720ms     |
| `--ds-dur-long`     | 900-1100ms    |

#### Easing

| Token               | Role                   |
| ------------------- | ---------------------- |
| `--ds-ease-smooth`  | General UI transitions |
| `--ds-ease-in`      | Accelerating curve     |
| `--ds-ease-out`     | Decelerating curve     |
| `--ds-ease-in-out`  | Balanced ease          |
| `--ds-ease-spring`  | Bouncy interactions    |
| `--ds-ease-bounce`  | Exaggerated bounce     |
| `--ds-ease-elastic` | Elastic overshoot      |

### Tier 3: Semantic Tokens (`@layer tokens`)

The last tier gives each value a readable name for what it's used for, whatever the value is. Components read only these names. The semantic names in the [semantic token reference](/design-systems/semantic-tokens/) are fixed. They're the shared interface between all systems.
