---
title: "Custom Property Gotchas: Substitution, initial and Shorthands"
description: "Where a `var()` resolves, how `initial` makes a fallback switch, and why a `none` from a variable breaks the `animation` shorthand."
tags: [css, custom-properties, design-tokens, motion]
sidebar:
  order: 8
---

These are all about plain, unregistered custom properties. A registered one computes like a typed property instead, and `initial` means its declared initial value: see [registered custom properties](/css/registered-custom-properties/).

## A `var()` in a custom property resolves on the element, not in its rule

My design system declares its tokens on the root, and many of them refer to other tokens. For example, `:root { --ds-bg: var(--ds-slate-25) }` sets the background from a palette color. That rule doesn't lock in the slate value where it's written. The browser substitutes the reference when it works out the root's computed value, using whatever `--ds-slate-25` the root has at that point.

That bites with themes. They're switched with an attribute on the root, so each theme has a scoped block like `:root[data-theme='x']` with its own palette. Say theme x's block declares a name the default palette also declares. While theme x is active, the root's value for that name is theme x's, so every default rule that reads it (like the background rule above) picks up theme x's color instead, with no error or warning. So a scoped palette name must not repeat a name that exists under every theme. A test can enforce that. Two scoped palettes can share a name freely, because only one of their selectors matches at a time. My [theme setup](/design-systems/cascade-layers/#theme-identity-and-color-scheme) follows this rule for the `--ds-*` primitives of the [token pipeline](/design-systems/token-pipeline/).

The same behavior makes a token refactor measurable. Say I rename tokens. The computed value of every primitive and semantic token on the root is the substituted token stream, so it shows the final value, not the chain of names that produced it. So I read them all with `getPropertyValue`, in every theme and scheme, before and after. If they match, the rename changed no value. Collapse whitespace before comparing, because a multi-line value that got reflowed serializes its line break as a space. More on those checks in [proving a CSS refactor changed nothing](/testing/css-refactor-checks/).

## A custom property set to `initial` makes a token a fallback switch

Some tokens exist so that one theme can replace a color that each component otherwise sets itself. A component reads such a token through a `var()` with its own color as the fallback. Set the primitive behind it to `initial` and it becomes the guaranteed-invalid value. Every `var()` that reads it inherits the invalidity, and any reader with a fallback uses the fallback. My [treatment primitives](/design-systems/cascade-layers/#theme-identity-and-color-scheme) use this so one theme can override a per-component color (`--ds-hover-text`), while every other theme keeps each component's own color, with the computed style identical to before.

The fallback has to be part of the reader itself. Without one, the declaration is invalid at computed-value time, and the property reverts to its inherited or initial value. A component without the fallback doesn't get its own color back under the default theme: it gets whatever color its parent has, or the property's initial value.

## A `none` from a variable in the `animation` shorthand becomes the fill mode

A panel's enter animation takes its keyframe name from a motion token, and that token's value can be `none`:

```css
animation: var(--motion-panel-in) 180ms ease-out both;
```

With the variable set to `none`, Chromium computes `animation-name: both` and `animation-fill-mode: none`. When a keyword in the shorthand could belong to another longhand, the shorthand assigns it to that longhand first. `none` is a valid fill mode, so it goes there, and `both` is what's left for the name. Nothing animates, since no keyframes are called `both`. But the fill mode is lost and the computed style is wrong.

So in a component that takes its keyframe name from a token, I write the shorthand with only the timing and fill, and name the keyframes in the `animation-name` longhand after it. An `animation: none` in a later reduced-motion layer still resets the longhand.
