---
title: Cascade Layers
description: How the cascade is split into ordered layers, what each layer may contain, and how themes and color schemes are switched in the base layer.
tags: [css, design-systems, cascade-layers, theming, architecture]
sidebar:
  order: 2
---

## Layer Strategy

The design system's CSS is split into eight cascade layers. One `@layer` statement lists them all, and the order in that statement fixes the precedence for the whole system:

```css
@layer open-props, reset, base, tokens, components, features, utilities, overrides;
```

For normal declarations from the same origin, a later layer beats an earlier one before selector specificity is even looked at. So a utility class always beats a component rule, however specific the component's selector is. `!important` reverses layer precedence, so it shouldn't be used as a routine specificity fix. Keep overrides deliberate.

That statement only works if the browser parses it first. A browser [orders layers by where each name first appears](/css/cascade-layers/#order-is-fixed-by-first-appearance), and later statements can't move a layer that already exists. The risk comes from components that import their own stylesheet. Say a feature component imports a stylesheet that wraps its rules in a `features` layer. That stylesheet can reach the page before the design system's entry point. If it's the first to name `features`, it fixes where `features` sits: ahead of every layer the entry point names later, so every one of those layers beats it. So I put the statement in an inline `<style>` in the app's HTML shell, ahead of the framework's head placeholder (`%sveltekit.head%` in SvelteKit), and repeat it at the top of the entry stylesheet. Repeating an identical statement changes nothing. The inline `<style>` holds the order statement and nothing else.

**Rule: the order is declared before any stylesheet loads.**

The ordering also breaks if some design-system CSS sits outside every layer. For normal declarations, unlayered author CSS beats layered author CSS, so one unlayered rule would win over every layer in the statement. The top-level `@layer` statement and the `@import` statements are organizational directives, not unlayered style rules, so they're fine. External stylesheets get assigned to a layer too.

**Rule: no unlayered design-system CSS.** Every design-system style rule goes in a named layer.

Each file still has to end up in the right layer. Design-system stylesheets hold bare rules and never an `@layer` block. The entry point (see [directory structure](/design-systems/directory-structure/)) puts each file in its layer with `@import "…" layer(name)`, so I can check the layer of every design-system file in one place. The code examples below name their file and the layer it's imported into.

**Rule: layers are assigned at import time.**

The one exception is feature CSS (see [`@layer features`](#layer-features)). The design system must never import from a feature, so the entry point can't assign a feature stylesheet to its layer. Instead, a feature stylesheet wraps itself in `@layer features { … }` and its own component imports it.

### Layer-by-Layer Breakdown

#### `@layer reset`

**Purpose:** Normalize browser defaults. It only removes things.

**Rules:** No tokens, no classes. Only element selectors, pseudo-classes and pseudo-elements. It gives a clean, neutral starting point before any design-system values apply.

**Source:** Josh W. Comeau's "A Modern CSS Reset" (joshwcomeau.com/css/custom-css-reset). I use it as published, with one change for non-React frameworks. The reset has a `#root, #__next { isolation: isolate; }` rule. Those ids are React and Next.js mount points, the elements those frameworks render the app into. SvelteKit mounts into a `display: contents` wrapper instead, and `isolation` has no effect there. So the rule stays in the file but commented out, with the reason next to it. Uncomment it in a React or Next.js project. Anything the reset leaves alone (button chrome, list bullets, dialog borders) gets styled by the component that uses the element. It isn't stripped globally.

```css
/* reset.css — imported with layer(reset) */
*,
*::before,
*::after {
  box-sizing: border-box;
}
*:not(dialog) {
  margin: 0;
}
@media (prefers-reduced-motion: no-preference) {
  html {
    interpolate-size: allow-keywords;
  }
}
body {
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
img,
picture,
video,
canvas,
svg {
  display: block;
  max-width: 100%;
}
input,
button,
textarea,
select {
  font: inherit;
}
p,
h1,
h2,
h3,
h4,
h5,
h6 {
  overflow-wrap: break-word;
}
p {
  text-wrap: pretty;
}
h1,
h2,
h3,
h4,
h5,
h6 {
  text-wrap: balance;
}
/*
  Disabled for SvelteKit: #root and #__next are React and Next.js mount
  points. SvelteKit mounts into a display: contents wrapper, where
  isolation has no effect. Uncomment in a React or Next.js project.

#root,
#__next {
  isolation: isolate;
}
*/
```

#### `@layer base`

**Purpose:** Define every raw value primitive (`--ds-*`, see the [token pipeline](/design-systems/token-pipeline/)) and set sensible element defaults using [semantic tokens](/design-systems/semantic-tokens/).

**Rules:** All raw values and `--ds-*` primitives are defined on `:root`, and theme and color-scheme selectors inside `@layer base` reassign them. Element defaults use semantic tokens, not raw primitives. The [`color-scheme`](/css/color-scheme/) property is a rendering hint to the browser, and it's managed here along with the effective color scheme.

```css
/* base/primitives.css — imported with layer(base) */
:root {
  --ds-fz-lg: 1.25rem;
  --ds-space-4: var(--size-4); /* from Open Props */
}
```

```css
/* base/elements.css — imported with layer(base) */
body {
  font-family: var(--font-body);
  background-color: var(--color-bg);
  color: var(--color-text);
}
:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

#### Theme identity and color scheme

Theme and color scheme are independent. A **theme** (picked with `data-theme`, like `forest` or `violet`) is a visual identity. It can include typography, spacing, radii and palette. **Light and dark are color-scheme variations of each theme**, not separate themes. Each theme provides both schemes for the color primitives that differ between them.

By default the effective color scheme follows `prefers-color-scheme`. An optional `data-color-scheme="light"` or `data-color-scheme="dark"` attribute on `:root` overrides that preference. **Automatic mode is the absence of `data-color-scheme`.** Removing the attribute goes back to following the system, with no JavaScript. Picking a theme doesn't change this.

All primitive definitions and reassignments stay in the base layer, so no unlayered `:root` rules are needed. Semantic token names and component rules are the same in both schemes.

**One source of truth per value.** A scheme gets picked by the OS preference or by the attribute that pins it. The obvious way to cover both is to write each palette twice, once in a `@media (prefers-color-scheme)` block and again in a `[data-color-scheme]` block. Instead, each theme declares every scheme-dependent color exactly once, as a [`light-dark(<light>, <dark>)`](/css/color-scheme/#light-dark) pair. The only thing that switches is the CSS `color-scheme` property on `:root`, and `light-dark()` resolves against it:

- `color-scheme: light dark` on `:root` follows the OS preference (automatic mode).
- `[data-color-scheme="light"]` or `[data-color-scheme="dark"]` pins it.
- Controls and scrollbars that the browser draws follow the same property, so the page and the browser UI always use the same scheme.

So never repeat a palette in both kinds of block.

`light-dark()` takes a pair of `<color>` values. A second form, added in the CSS Color 5 draft, takes a pair of images (`<image>` or `none`). MDN's compat data lists the image form only from Chrome 150, Firefox 150 and Safari 27, so for now I treat it as colors-only. Lengths, whole shadows and other values have no form at all. A composite value that differs between schemes, like a shadow, varies through its color parts (`0 1px 2px light-dark(#0001, #0005)`), not through a second declaration. Non-color primitives (spacing, radii, typography) belong to the theme and stay the same in both schemes. `light-dark()` with colors is Baseline 2024.

**Role primitives.** Each semantic token maps to exactly one `--ds-*` name, once, for every theme (`--color-primary: var(--ds-primary)`). A theme never touches a semantic token or a component. It changes the look by assigning **role primitives**: `--ds-*` names for what a value is used for (`--ds-primary`, `--ds-surface`, `--ds-text-muted`, `--ds-border`, `--ds-font-body`, `--ds-radius-control`, `--ds-shadow-2`, `--ds-border-width`…). Since a theme can only reach a value through one of those names, any value that some theme needs to change has to be a role primitive. A value no theme changes stays a plain primitive in `base/primitives.css`. Role primitives are the same names in every theme. If a theme skipped one, the default theme's value would leak through. So **every theme file assigns the full set of role primitives**.

**One file per theme.** The scheme switch and the colors every theme shares live in `base/scheme.css`. Each theme is one file in `base/themes/` with two blocks: first its palette (raw colors as `light-dark()` pairs), then the role primitives assigned from that palette. Selectors stay on `:root` because the theme and color-scheme attributes are set on the HTML element. The example shows two themes and three role primitives. A real theme assigns every one.

**A palette lives in its theme's selector.** A theme's palette block is `:root[data-theme='<name>']`, the same selector as its role primitives. So a palette only exists while its theme is active, and two themes can use the same palette name without clashing. The default theme's palette is the one exception. It sits on a bare `:root`, because a root with no `data-theme` renders the default theme. A theme's palette names never repeat a name from the shared primitives, the scheme file, the role primitives or the default palette, since those are present under every theme.

**Palette names are generic.** A palette primitive is named for the color, never for a theme or a feature: `--ds-<hue>-<step>`. The hue is a plain color word (`slate`, `khaki`, `rust`, `copper`, `lime`). The step is one of:

- a number on the scale (`50` to `900`, lighter to darker in the light scheme)
- an alpha (`a12`, a translucent step at about that percent)
- a translucent overlay (`tint-5`)
- a word for what the value is (`canvas`, `paper`, `raised`, `sunken`, `well`, `ink`, `ink-muted`, `ink-faint`, `line`, `line-strong`, `glow`, `neon`, `shadow`, `on-<hue>` for text on a fill of that hue)

A value that isn't tied to one color is named for what it is (`--ds-grid-line`). No palette name contains a theme's name.

```css
/* base/primitives.css — imported with layer(base) */
/* Non-color primitives shared by every theme and scheme. */
:root {
  --ds-fz-lg: 1.25rem;
  --ds-space-4: var(--size-4);
}
```

```css
/* base/scheme.css — imported with layer(base) */
/* Color scheme: automatic unless pinned. Colors every theme shares. */
:root {
  color-scheme: light dark;
  --ds-danger-600: light-dark(#b42318, #f97066);
}
:root[data-color-scheme='light'] {
  color-scheme: light;
}
:root[data-color-scheme='dark'] {
  color-scheme: dark;
}
```

```css
/* base/themes/forest.css — imported with layer(base) */
/* The default theme also matches a root with no data-theme. */
:root {
  --ds-pine-500: light-dark(#4c6654, #a1c7a7);
}
:root,
:root[data-theme='forest'] {
  --ds-bg: light-dark(#f6f2e8, #19251e);
  --ds-text: light-dark(#293b30, #e2ebdf);
  --ds-primary: var(--ds-pine-500);
}
```

```css
/* base/themes/violet.css — imported with layer(base) */
:root[data-theme='violet'] {
  --ds-iris-500: light-dark(#7455ae, #b49be5);
}
:root[data-theme='violet'] {
  --ds-bg: light-dark(#f2f0f8, #211a2d);
  --ds-text: light-dark(#392b56, #eee6fa);
  --ds-primary: var(--ds-iris-500);
}
```

**Treatment primitives.** Some role primitives hold a treatment instead of a color or a size: a page backdrop, the keyframes an overlay enters with, a hover fill, the width of a hover marker. (Their semantic tokens are in the [semantic token reference](/design-systems/semantic-tokens/).) Most themes leave them at a value that changes nothing, and one stylized theme replaces them. Every theme file still assigns every one, so each file has the same set. Some example rows:

| Role primitive                 | Semantic token                 | Default in most themes  | A stylized theme                           |
| ------------------------------ | ------------------------------ | ----------------------- | ------------------------------------------ |
| `--ds-page-backdrop`           | `--page-backdrop`              | `none`                  | a faint grid of `repeating-linear-gradient`s |
| `--ds-motion-overlay-in` · `-out` | `--motion-overlay-in` · `-out` | `kModalIn` · `kModalOut` | its own scan-in and scan-out keyframes    |
| `--ds-hover-text`              | `--color-hover-text`           | `initial`               | the paper color                           |
| `--ds-radius-pill` · `--ds-radius-round` | `--radius-pill` · `--radius-round` | `--ds-radius-full` | `--ds-radius-none`                    |

**A primitive set to `initial` is unset.** The hover text row above uses this. Setting a custom property to `initial` turns it into the guaranteed-invalid value, and every `var()` that reads it gets that too. So a component reading `var(--color-hover-text, <its own colour>)` falls back to its own color. That's how a theme that sets nothing keeps every component's own hover and chosen colors exactly as they are, while a stylized theme swaps them all for one pair. This only works when the component supplies that fallback, so a component only reads these tokens with a fallback like that.

The default theme's palette is on a bare `:root`, and the selector list for its role primitives includes one too. So if `data-theme` is missing or hasn't been applied yet, the page still renders a complete palette in both schemes. Other themes win by specificity (`:root[data-theme]` beats `:root`), and every theme declares the full set of color primitives so nothing leaks through from the default.

**Adding a theme** touches only these places:

1. A new file `base/themes/<name>.css`, plus its import in the entry stylesheet. The file has a `:root[data-theme="<name>"]` block holding the palette under generic names, then a second `:root[data-theme="<name>"]` block that assigns every role primitive.
2. If the theme needs to change a value that's still a plain primitive, promote it to a role primitive: add it to every existing theme file with that theme's current value, and point its semantic token at it. Component CSS never changes.
3. Its fonts, if it has any (see [directory structure](/design-systems/directory-structure/)): the font files and their licenses, and `@font-face` rules, each with the `ascent-override` and `descent-override` that center the face's cap height in its line box.
4. The list of theme names the app accepts. For example, a pre-paint script in the HTML shell (whose CSP hash then changes) and the settings control.

| Color-scheme attribute | OS preference | Effective scheme |
| ---------------------- | ------------- | ---------------- |
| Absent (automatic)     | Light         | Light            |
| Absent (automatic)     | Dark          | Dark             |
| `light`                | Either        | Light            |
| `dark`                 | Either        | Dark             |

**Implementation contract:** Set `data-theme` on the HTML element, and set `data-color-scheme` there only for an explicit override. Saving someone's choice and applying it before first paint are the app's job. CSS alone handles later automatic preference changes. `light-dark()` resolves against the `color-scheme` of the element that uses the color, and `color-scheme` inherits. So a subtree can set its own `color-scheme` and render in the other scheme without any new primitives. If I ever support themes on nested subtrees, I'll define semantic aliases in the same scope, and not assume aliases resolved at the root will re-evaluate against a descendant's primitives.

#### `@layer tokens`

**Purpose:** Map `--ds-*` primitives to readable semantic token names (the full list is in the [semantic token reference](/design-systems/semantic-tokens/)). Theme and color-scheme selection happen in the base layer.

**Rules:** The tokens layer is the only layer _downstream of base_ that references `--ds-*` variables directly. All component and utility styles use semantic tokens only. Light, dark and theme-specific values come from reassigning primitives in base, so don't duplicate semantic mappings per scheme. If a composite token needs a scheme-specific value, first add a matching `--ds-*` primitive in base.

```css
/* tokens/colors.css, tokens/typography.css, tokens/spacing.css — imported with layer(tokens) */
:root {
  --color-primary: var(--ds-primary);
  --text-lg: var(--ds-fz-lg);
  --sp-4: var(--ds-space-4);
}
```

#### `@layer components`

**Purpose:** All named UI patterns.

**Rules:** Class selectors only. Components build their colors, borders and transitions from semantic tokens. Never reference `--ds-*` primitives or raw values. Container queries (`@container`) for a component's responsive internals live here.

A common need in a component is a stack: children one above the other with a `gap` between them. `display: grid` gives that `gap` in one line, and it looks harmless. But a grid with no `grid-template-columns` has one implicit `auto` column, and that column grows to its widest child's min-content. So one wide child (a `nowrap` title, a row that can't wrap) widens every sibling and overflows the page. A flex column has no such column, so for a stack use `display: flex; flex-direction: column`. When a grid really is a grid, every `display: grid` in components and utilities declares its columns, and a single column is `minmax(0, 1fr)`. A test that scans the stylesheets can enforce this.

**Rule: a stack is a flex column; a grid declares its columns.** Never use `display: grid` just to get `gap` between stacked children.

A component's container queries need a floor to design against, so the system sets a minimum supported viewport width (for example 380px). At that width the content column comes out to roughly the minimum minus the page gutters. Component container queries have to stay usable down to that content width. That doesn't mean queries are only needed near the minimum. A multi-column layout may need to collapse as early as `800px` or wider so it doesn't get squished.

**Set a minimum supported viewport width (for example 380px).** Never assume the container is wider than the minimum content column unless a query handles the narrower case.

```css
/* components/btn.css — imported with layer(components) */
.btn-primary {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}
```

#### `@layer features`

**Purpose:** Styles that belong to one feature component and that the design system can't express. It's the last resort.

**Order of preference.** When a screen doesn't fit the library:

1. Redesign the screen from the existing components and utilities.
2. If that doesn't work, add a variant, utility or component to the design system. It must have a name with no feature in it, and it must appear in the component playground.
3. Only then write feature CSS, and record the file and the reason wherever the team tracks exceptions.

**Rules:**

- The file sits next to the component that owns it (`item-card.css` beside the `ItemCard` component), and that component imports it (`import './item-card.css';`). The entry stylesheet never imports feature CSS.
- The file is exactly one `@layer features { … }` block holding one [`@scope (<root class>) { … }`](/css/scope/) block. No other layer name, no unlayered rule.
- `@scope` limits the rules to the component's root element, so the file can use short class names and they can't leak onto the rest of the page. Every current browser supports `@scope`.
- Semantic tokens only: no `--ds-*` primitives and no raw design values. Structural values (`0`, `100%`, `1fr`, `2 / 3`, `auto`) are fine.
- A feature rule may place and size a library component (grid area, width, alignment). It must not restyle its internals (colors, padding, borders). That's a library change.
- `features` comes after `components`, so a feature rule beats a component's layout. It comes before `utilities`, so a utility class on the same element still wins.

```css
/* a feature folder's item-card.css — imported by the ItemCard component */
@layer features {
  @scope (.item-card) {
    .cover {
      aspect-ratio: 2 / 3;
      border-radius: var(--radius-container);
    }
  }
}
```

Some values only exist at runtime: a position, size or percentage the script computes (selection rectangles, virtualized heights, progress fills). They don't exist when the stylesheet is written, so the component passes each one as a custom property, and a class in the library or a feature file reads it. In Svelte that's a `style:` binding, `style:--rect-left="{x}px"` (see [Svelte](/design-systems/svelte/)). The binding only passes a measurement. Every design value stays in a layered stylesheet.

**Runtime values are data. Design values stay in stylesheets.**

#### `@layer utilities`

**Purpose:** Context-free helper classes, layout grids, and **all `@keyframes`**.

**Rules:** Short classes that compose, with no component-specific logic (see the [utility pattern](/design-systems/naming-conventions/#utility-pattern)). They beat `components` by layer order. Every animation keyframe definition goes here.

```css
/* utilities/animation.css — imported with layer(utilities) */
@keyframes kFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.a-fade-in {
  animation: kFadeIn var(--dur-moderate) var(--ease-smooth) both;
}
```

```css
/* utilities/flex.css, utilities/text.css — imported with layer(utilities) */
.row {
  display: flex;
  gap: var(--sp-3);
}
.uppercase {
  text-transform: uppercase;
}
```

**Page layout:** `.page-wrap` is the standard full-width page container. It's a three-column CSS Grid that centers content in one column, with fluid gutters on each side:

```css
/* utilities/layout.css — imported with layer(utilities) */
.page-wrap {
  display: grid;
  grid-template-columns: 1fr min(1440px, 100% - 3rem) 1fr;
}
.page-wrap > * {
  grid-column: 2;
}
.page-wrap > .full-bleed {
  grid-column: 1 / -1;
}
```

The max width (`1440px`) and the gutter subtraction (`3rem`) can change per system, but the three-column structure is fixed. Don't use `max-width + margin-inline: auto` to contain a page.

#### `@layer overrides`

**Purpose:** Narrow fixes for a specific context and edge cases. Highest cascade precedence.

**Rules:** Narrowly scoped rules (`.btn.btn-pill`, accessibility resets, `@media (prefers-reduced-motion: reduce)`, `@media (forced-colors: active)`, `@media print`). Use it sparingly. What the reduced-motion block stops is covered under [entrance keyframes](/design-systems/semantic-tokens/#entrance-keyframes).
