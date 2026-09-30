---
title: "Tokens Where var() Cannot Reach: Queries and Script"
description: "Breakpoints kept as tokens, reading a token in pixels, and resolving a theme color from script."
tags: [css, custom-properties, design-tokens, color-scheme]
sidebar:
  order: 9
---

Media and container size conditions can't take a custom property as a length. And when script reads a custom property, it gets text instead of a value. These are my workarounds for both. My breakpoints live in the [breakpoint scale](/design-systems/semantic-tokens/#breakpoint-scale).

## A breakpoint from a token without a query

`var()` isn't allowed in `@media` or `@container` size conditions, so a breakpoint kept as a token can't drive them. (Container style queries can test a custom property's value, `@container style(--x: y)`, but they can't compare a width against it.) Instead, a padding utility can step at a breakpoint token (say 700px) with a clamp:

```css
padding-inline: clamp(var(--sp-4), (100% - var(--breakpoint-compact)) * 1000, var(--sp-6));
```

Percentage padding resolves against the containing block's width. So below the breakpoint the middle term is hugely negative, and the clamp pins it to the small step. Above the breakpoint it's hugely positive, and the clamp pins it to the large step. It doesn't need a container ancestor. Use it for a value with two steps. For anything more involved, add a real container.

## Showing and hiding by a container breakpoint

Some elements should only show when a container (the app shell here) is narrow, and others only when it's wide. The catch is the boundary. `@container shell (max-width: 48rem)` *includes* 48rem, so if the wide side is written the same way, the two rules overlap at exactly 48rem and both apply. Use the complementary pair `(width < 48rem)` / `(width >= 48rem)`, so exactly one side applies at every width.

- Make a "narrow only" utility hide the element on the wide side, instead of showing it on the narrow side. That way it never has to restore the element's own `display`.
- Watch specificity inside one layer. You need selectors like `.shell .x` (0,2,0) when a single-class utility that loads later in the same layer would otherwise win.
- A `nowrap` row holding a scroller plus fixed tools needs `flex-shrink: 0` on the tools. Otherwise both shrink, and the tools' own wrap stacks their buttons.

## A breakpoint token measured by a probe

Some layouts have to switch structure (side dock ↔ bottom sheet) at a breakpoint token, and a container or media size query can't take a token as its length. So I render an invisible, zero-height probe whose width is `var(--breakpoint-compact)`. A `ResizeObserver` watches it and the screen, and a pure function `isNarrow(screen, probe)` compares them. Exactly at the breakpoint counts as wide. Before the first measurement also counts as wide.

For a two-step value instead of a structural switch, I'd use the clamp trick in [a breakpoint from a token without a query](#a-breakpoint-from-a-token-without-a-query). The hidden probe is also written down as a pattern in my [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline).

## A dvh token in pixels comes from a probe, not getComputedStyle

Say script needs a sheet-height token in pixels, and the token is a viewport length in dvh units. An unregistered custom property computes to its text. So `getPropertyValue('--sheet-height')` returns `40dvh`, not pixels. Registering the token as a `<length>` with `@property` would resolve it, but it would also change a shared token's behavior for everything that reads it.

What works: a hidden, zero-width element whose block size is the token, read with `bind:clientHeight`. That gives the pixels, and it follows viewport changes through its resize observer. The same trick works for widths and breakpoints.

## A registered custom property reads back in pixels

If script needs a spacing token as a number, an ordinary custom property won't do. `getPropertyValue('--sp-1')` returns the substituted tokens, `"0.25rem"`. Register a property like `--overlay-gap` as a `<length>` and the same call returns `"4px"` (I checked this in Chromium and WebKit). How that works is on [registered custom properties](/css/registered-custom-properties/#computed-values).

The declaration is still an ordinary token (`--overlay-gap: var(--ds-space-1)`), so tooling that checks tokens treats it like any other. [Dropdown menus](/html/dropdown-menus/#placing-a-popover-menu-next-to-its-trigger) read their gap and edge margin this way.

## Measuring a theme color means resolving it on an element

I check a theme's contrast with a script that reads each color token, measures it, and computes WCAG contrast ratios. The obvious way to read a token doesn't work. `getComputedStyle(root).getPropertyValue('--color-text')` returns the declared text with its `var()`s substituted. For a theme, that's a [`light-dark(…, …)`](/css/color-scheme/#light-dark) string. A canvas can't parse it, so a contrast script reads every color as black and every ratio comes out 1.

Instead, set the token on a probe element and read the computed color:

```ts
probe.style.color = 'var(--color-text)';
const resolved = getComputedStyle(probe).color;
```

That's the resolved color for the element's `color-scheme`. Draw it on a 1×1 canvas and read the pixel to get sRGB for the WCAG formula. If the color has alpha, blend it over its surface before measuring.

Probe elements like this are also how theme colors get into a chapter iframe, where custom properties don't reach: see [foliate-js chapters](/ebooks/foliate-chapters/).
