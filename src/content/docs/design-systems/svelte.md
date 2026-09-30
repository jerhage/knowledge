---
title: Svelte with a Global CSS Design System
description: How to use a layered global CSS design system in a SvelteKit app, with Svelte owning structure and behavior and CSS owning presentation.
tags: [css, design-systems, svelte, svelte-5, sveltekit, components, theming, cascade-layers]
sidebar:
  order: 8
---

## 1. Keep your existing CSS architecture

The directory structure stays as it is: primitives, themes, tokens, components, utilities and overrides (the full layout is in [directory structure](/design-systems/directory-structure/)).

```
src/lib/
├── styles/
│   ├── index.css
│   ├── base/
│   ├── tokens/
│   ├── components/
│   ├── utilities/
│   └── overrides/
│
└── components/
    ├── Button.svelte
    ├── Card.svelte
    └── Modal.svelte
```

The CSS files don't depend on Svelte, and nothing needs to move into `.svelte` files.

## 2. Import your design system once

In the root SvelteKit layout:

```svelte
<!-- src/routes/+layout.svelte -->

<script lang="ts">
  import '$lib/styles/index.css';

  let { children } = $props();
</script>

{@render children()}
```

A component's own stylesheet can load before `index.css`, and the first stylesheet to name a layer fixes where that layer sits. So declare the layer order first, in `src/app.html`, ahead of `%sveltekit.head%`:

```html
<style>@layer open-props, reset, base, tokens, components, features, utilities, overrides;</style>
```

With the order declared in `app.html`, [no import order can move a layer](/css/cascade-layers/#order-is-fixed-by-first-appearance) (more in [cascade layers](/design-systems/cascade-layers/)).

`index.css` is still the one entry point. It imports the design-system stylesheets and puts each one in its layer (see [the entry point](/design-systems/directory-structure/#the-entry-point)).

After that, every global CSS class and custom property is available across the whole app.

## 3. Build Svelte components using global CSS classes

Svelte components handle structure, behavior and accessibility. The CSS design system handles how they look. For example:

```svelte
<!-- Button.svelte -->

<script lang="ts">
  import type {
    HTMLButtonAttributes
  } from 'svelte/elements';

  type Props = HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary';
  };

  let {
    variant = 'primary',
    class: className = '',
    children,
    ...rest
  }: Props = $props();
</script>

<button
  {...rest}
  class={`btn btn-${variant} ${className}`}
>
  {@render children?.()}
</button>
```

Its styles stay in `styles/components/btn.css`. No `<style>` block needed.

## 4. Compose components using your global utilities

Pages and feature components use the same CSS classes.

```svelte
<script lang="ts">
  import Button from '$lib/components/Button.svelte';
  import Card from '$lib/components/Card.svelte';
</script>

<main class="page-wrap">
  <section class="stack-md">
    <h1>Dashboard</h1>

    <Card>
      <h2>Welcome back!</h2>

      <Button variant="primary">
        Create project
      </Button>
    </Card>
  </section>
</main>
```

`src/lib/components/` holds the base UI library: building blocks with nothing app-specific in them. Feature components are built from them and live in their feature's UI folder.

Sometimes a screen doesn't fit the library. When that happens, I first try to redesign it from the library. Next I consider adding something to the library that isn't tied to the app's domain. Only as a last resort does the feature component get its own stylesheet, sitting next to it and imported by it:

```svelte
<!-- a feature's ui/ItemCard.svelte -->
<script lang="ts">
  import './item-card.css';
</script>
```

```css
/* the same folder's item-card.css */
@layer features {
  @scope (.item-card) {
    .cover {
      aspect-ratio: 2 / 3;
    }
  }
}
```

The file declares its own layer, because the design system never imports from a feature. The rules are under `@layer features` in [cascade layers](/design-systems/cascade-layers/).

Values computed at runtime go in as custom properties through `style:` bindings. Design values never do:

```svelte
<div class="selection-rect" style:--rect-left="{x}px" style:--rect-top="{y}px"></div>
```

## 5. Keep themes, color schemes, and design tokens in CSS

Primitives and semantic tokens are still CSS custom properties, set up as described under theme identity and color scheme in [cascade layers](/design-systems/cascade-layers/) and in the [token pipeline](/design-systems/token-pipeline/).

A **theme** (`data-theme`) is a visual identity. **Light and dark are color schemes of each theme**, not themes. Each theme color is declared once, as a [`light-dark()`](/css/color-scheme/#light-dark) pair, and the [`color-scheme`](/css/color-scheme/) property selects which half applies.

```css
/* base/scheme.css — imported with layer(base) */
:root {
  color-scheme: light dark;
}
:root[data-color-scheme="light"] {
  color-scheme: light;
}
:root[data-color-scheme="dark"] {
  color-scheme: dark;
}
```

```css
/* base/themes/forest.css — imported with layer(base) */
:root,
:root[data-theme="forest"] {
  --ds-surface: light-dark(#f6f2e8, #19251e);
  --ds-text: light-dark(#293b30, #e2ebdf);
}
```

Each theme is one file in `base/themes/` that assigns the same set of role primitives. What adding a theme touches is listed in [cascade layers](/design-systems/cascade-layers/#theme-identity-and-color-scheme).

```css
/* tokens/colors.css — imported with layer(tokens) */
:root {
  --color-surface: var(--ds-surface);
  --color-text: var(--ds-text);
}
```

When `data-color-scheme` is absent, the color scheme follows `prefers-color-scheme`. Svelte only sets attributes. It never writes colors or scheme-specific classes:

- `data-theme` on `<html>` picks the theme.
- `data-color-scheme="light"` or `"dark"` on `<html>` pins the scheme. Removing it goes back to automatic.
- A small inline script in `src/app.html` applies a saved choice before first paint. It's not in a component, so the page never renders in the wrong scheme first.

Svelte components pick up these variables through the global classes. Changing either attribute updates every inherited CSS variable, and no component has to change.

Nothing Svelte-specific is needed for styling.

## 6. Component props follow the class conventions

A base component turns its props into classes on its markup, like the `variant` prop on the button above. So the props need conventions that line up with the classes they produce. These rules apply the [class conventions](/design-systems/naming-conventions/#class-conventions) to Svelte component props. They only apply to Svelte. The rest of the design system doesn't depend on any framework. The components themselves follow the [component contract](/design-systems/component-contract/).

- A prop that picks a class maps 1:1 to it through one small helper module: `variant`, `size`, `tone`, `emphasis`. `size` takes `'sm' | 'md' | 'lg'`, or whatever part of that scale a component offers. Its default is `'md'`, which adds no class. A size prop never takes a value that isn't a size (no `size="fill"`; use a boolean `fill`).
- Use a boolean for a single non-default option, named for what it turns on (`flushBody` adds `.modal-body-flush`, `infoFooter` adds `.modal-footer-info`). Use a string union when the caller picks between equal options, named for what it controls (`emphasis="solid"`, `missingStep="hidden"`). Two booleans that can't both be true become one union (a badge's `emphasis`: `'tinted' | 'solid' | 'quiet'`).
- A snippet is named after the part it fills (`label`, `title`, `actions`, `icon`), and `children` is the main content. Content that belongs to a feature comes in through a snippet or a prop. It's never written inside the base component.
- Words that people read on screen are props with an English default (`closeLabel`, `clearLabel`, `moreLabel`), never fixed text inside the component.
- A prop that names a label is a string (`label`, `title`, `expandLabel`, `collapseLabel`, `removeLabel`). A boolean that hides one is `hideLabel`. The same name never means both. A list that labels each of its items takes a function of the item's name, named after the item's prop plus `For` (a file list's `removeLabelFor(name)` sets each item's `removeLabel`).
- A controlled value is `value` with `on<prop>change` (`onvaluechange`, `onselectedchange`). Other callbacks are `on<verb>` in lower case, and they receive the values the caller uses, not the DOM event, unless the event is the point. The value is `$bindable`. A caller that owns the value passes it in and sets it in the handler, because a press shows right away and holds until the caller's value next changes. Use `onvaluechange` when pressing the already-chosen value again does something (a segmented control whose "fit" option gets applied again after a zoom). It reports every press, including the chosen value. Use `onselectedchange` when pressing it again does nothing (tabs). It only reports a change.
- Payloads with the same name match. `onfiles` receives the same file-selection type from an inline dropzone and from a window-wide one, and a feature component that forwards it passes that same type on.
- An element choice is a union of the allowed tags, never a boolean. `element` picks the root's tag (`element="div"` for a static row), and `heading` picks the level of a title part (a card, a list group). A component whose parts go into a caller's description list takes `listed` and renders them as `dt` and `dd` (a stat, a list row).
- Native attributes keep their native names (`aria-labelledby`, not `labelledby`) and pass through with `...rest`. `class` goes on the root, and there's no class prop for a part. If a layout has to change a part, it sets a custom property the part reads (`--tabs-header-wrap`).
- Prop names are spelled the way the class names are, in one spelling (for example American English): `color` picks `.badge-color-*` and `.tag-color-*`.
- For an optional prop, "nothing" is `undefined`. A required prop that can have nothing takes `null`, so the caller has to pass `null` explicitly when there's none (a thumbnail's `src`, a stepper's `steps`). A prop is never both optional and nullable, except a bound element.
- A bound element (`ref`) is typed `ref?: HTMLInputElement | null | undefined`. It's `undefined` until it's bound, and `null` once Svelte tears the element down (Svelte writes `null` to the binding). Every variable bound with `bind:this` or to a child's `ref`, inside the base library or outside it, is typed with `null` the same way, including a bound component instance. A function that receives one accepts `null`, and code that reads one checks it with `?.`. svelte-check only checks that a bound variable can be passed into the prop. It doesn't check that what the component writes back fits the variable, and its types for `bind:this` leave out the `null` by design. So the prop's type is the only place the `null` gets stated.
- Every interactive base component requires an accessible name.

## Guiding principles

- CSS handles how things look. Every visual style lives in the global design system: component styles, layout, responsive behavior and animations.
- Svelte handles structure and behavior. Components define markup, props, state, interactions and accessibility.
- The layer order is declared first, in an inline `<style>` in `src/app.html`. `index.css` repeats it, controls the import order, and puts every design-system file in its layer. Feature stylesheets declare `@layer features` themselves.
- Pages are put together with the global utilities: the existing layout, spacing, typography and other utility classes.
- No Svelte `<style>` blocks, ever. Their CSS is unlayered, so it would beat every layer in `index.css`. None of the components use them anyway.
- Optimize later. Start by loading the whole design system globally. Only split CSS per component or per route once there's a measured benefit.

So the CSS architecture stays as it was, Svelte works as the component and app framework, and the design system never depends on Svelte's own styling features.
