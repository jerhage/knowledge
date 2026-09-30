---
title: "Icons as Svelte Components (Lucide)"
description: "Owning Lucide icons as per-icon Svelte components over a shared base, with a stroke width a theme can set."
tags: [design-systems, components, svelte, svelte-5, theming, accessibility]
sidebar:
  order: 9
---

I keep icons as my own Svelte components in the base component library instead of depending on an icon package. Their props follow the same conventions as every other component ([Svelte with a global design system](/design-systems/svelte/)).

## Icons: your own Lucide components, with a stroke a theme can set

Each icon is a Svelte component in the base component library, one file per icon I actually use. Lucide's shapes are copied byte-exact, and the API matches `@lucide/svelte` (`size`, `color`, `strokeWidth`, `absoluteStrokeWidth`, `class`, rest attributes). No package, and no `url()` data-URI masks. The rules and how they work:

- **Only used icons ship.** Each icon has its own import path, and nothing re-exports them through an `index.*`, so an icon only ends up in the app when some code imports its file. A spec is worth adding that fails if an icon file has no importer outside the icons folder, the specs and any demo or playground page, or if an `index.*` shows up. So is a [dependency-cruiser](/tooling/dependency-cruiser/) rule that forbids importing an icon through anything but its own file.
- **Stroke from the theme, unless the caller fixes it.** Every theme sets a role token `--ds-icon-stroke` (2 by default, heavier for themes with 2-3px borders), mapped to `--icon-stroke`. (The icon tokens sit in `icons.css`, see [directory structure](/design-systems/directory-structure/). Icon sizes are in the [semantic token reference](/design-systems/semantic-tokens/#component-sizes).) An icon stylesheet applies it:

  ```css
  :where(.lucide:not([data-fixed-stroke])) {
    stroke-width: var(--icon-stroke);
  }
  ```

  CSS beats an SVG presentation attribute (an SVG attribute that maps to a CSS property). So when a caller passes an explicit `strokeWidth` prop, the component adds `data-fixed-stroke`, the rule stops matching, and the attribute applies. No inline style. `:where` keeps the rule at zero specificity, so any component rule overrides it no matter the import order.
- **An icon can't live in a pseudo-element.** Each icon is now a component that renders an `<svg>` element, and a pseudo-element can't hold markup. So components that used to draw masks in `::before` now render the icon in markup and style the `<svg>` instead. A checkbox's check and dash become absolutely positioned siblings of the input, and states swap by scaling one down as the other scales up.
- **Decorative by default,** like Lucide: `aria-hidden="true"` unless the icon gets an `aria-*`, `role`, `title` or children. Controls keep their own accessible names.
- **Forced colors:** I checked that the icons still show in forced-colors mode. Chromium keeps author colors on an SVG that sets its own `color`. With forced colors emulated, every icon still showed.
- **License:** ship Lucide's ISC and Feather's MIT notices.

## Pulling a Lucide icon into your system: the `iconNode` technique

An icon takes two files: a shared base `Icon.svelte` (written once) and one tiny component per icon. The per-icon component holds only data, the icon's name and its shapes as an `iconNode`, and passes them to the base, which draws the `<svg>`. That's how `@lucide/svelte` is built, which is why my components can have the same API. (In the 1.x releases each icon passes its name and shapes to the base together as one `icon` object, `{ name, size, node, aliases }`. The base still accepts a bare `iconNode`, and that's the form I use here.)

**1. Get the SVG from Lucide.** Either from lucide.dev ("Copy SVG") or `github.com/lucide-icons/lucide/blob/main/icons/<name>.svg`. For `circle-check` it's:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
     viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
     class="lucide lucide-circle-check">
  <circle cx="12" cy="12" r="10" />
  <path d="m16 9-5.5 5.5L8 12" />
</svg>
```

**2. Split it into what's shared and what's the icon.** Everything on the outer `<svg>` is the same for every Lucide icon (the 24 grid, `fill="none"`, `stroke="currentColor"`, width 2, round caps and joins). `Icon.svelte` renders that part, and its props (`size`, `color`, `strokeWidth`, `absoluteStrokeWidth`, `class`, rest attributes) change it. Only the child elements are the icon.

**3. Turn each child element into an `iconNode` entry:** a tuple of the element name and an object of its attributes, with every value a string, in the same order as the SVG:

| SVG child | `iconNode` entry |
| --- | --- |
| `<circle cx="12" cy="12" r="10" />` | `['circle', { cx: '12', cy: '12', r: '10' }]` |
| `<path d="m16 9-5.5 5.5L8 12" />` | `['path', { d: 'm16 9-5.5 5.5L8 12' }]` |

Copy the attribute values byte for byte. Don't round or reformat path data. Hyphenated SVG attributes keep their names as quoted keys (e.g. `'stroke-width'`). Type the allowed element names as a union (`circle`, `ellipse`, `g`, `line`, `path`, `polygon`, `polyline`, `rect`). A new kind of element means widening that union.

**4. Write the component** `CircleCheck.svelte` (PascalCase of the Lucide name, as `@lucide/svelte` exports it):

```svelte
<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconProps } from './icon';

  let props: IconProps = $props();
</script>

<Icon
  {...props}
  name="circle-check"
  iconNode={[
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm16 9-5.5 5.5L8 12' }],
  ]}
/>
```

`name` is the Lucide kebab-case name. It becomes the class `lucide-circle-check`, and a spec can check that it matches the file name. The caller's props spread first, so a caller can't override `name` or `iconNode`.

**5. How the base renders it.** `Icon.svelte` draws the shared `<svg>` and loops over the tuples with `<svelte:element this={element} {...attributes}>`, so what comes out is the original SVG again:

```svelte
{#each iconNode as [element, attributes], index (index)}
  <svelte:element this={element} {...attributes} />
{/each}
```

It also:

- computes the stroke. The theme's `--icon-stroke` applies unless `strokeWidth` or `absoluteStrokeWidth` is passed, which adds `data-fixed-stroke`.
- sets `aria-hidden="true"` unless the icon gets an `aria-*`, `role`, `title` or children.
- can add `vector-effect="non-scaling-stroke"` to each child through a prop. (`@lucide/svelte` 1.x calls this prop `nonScalingStroke` and marks `absoluteStrokeWidth` as deprecated in its favor.)

**6. Use it** by its own path, never through an index file:

```svelte
<script lang="ts">
  import CircleCheck from '$lib/components/icons/CircleCheck.svelte';
</script>

<CircleCheck size={20} />                       <!-- decorative, theme stroke -->
<CircleCheck class="text-success" />            <!-- colour from a semantic token -->
<CircleCheck strokeWidth={1.5} aria-label="Done" />  <!-- fixed stroke, labelled -->
```

Color follows `currentColor`. So a text-color class, or the parent's color (a semantic token), colors the icon in every theme and scheme.

**7. Keep the checks passing.** If you add the optional checks above, three things. Import a new icon from real code in the same change, or the unused-icon spec fails (and use in a demo page alone shouldn't count). Keep `name` equal to the file's kebab-case name. And don't put the shapes anywhere else. A spec that checks every class in markup exists is a close relative: see [checking that markup only uses classes that exist](/design-systems/in-practice/#checking-that-markup-only-uses-classes-that-exist).
