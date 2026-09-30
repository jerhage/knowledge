---
title: CSS Design System Architecture
description: The rules behind a layered, token-driven CSS design system and why the tokens and structure form a fixed contract.
tags: [css, design-systems, architecture, design-tokens]
sidebar:
  order: 1
---

My apps get their look from a design system written as plain CSS. It has two parts: tokens, which are custom properties holding values like colors, sizes and durations, and component classes, like the one for a button, that build their styles from those tokens. The CSS is split into cascade layers so that it's always clear which rule wins. Different apps get different systems, with their own colors, fonts and spacing.

This is my reference for building those layered, token-driven systems. It covers the architecture rules, the naming conventions, and a **fixed set of semantic token names** that every system built on it implements. Values and visual details change from system to system. The token names and the component structure don't, because components written against them have to work in any system. So token names and component structure are a contract: values change, names and structure never do. Where an example needs a framework it uses SvelteKit, but nothing here depends on it.

## The pages

- [Cascade layers](/design-systems/cascade-layers/): the `@layer` order, what each layer may hold, and how themes and light/dark schemes switch in the base layer.
- [Token pipeline](/design-systems/token-pipeline/): the three tiers a value goes through (raw value, `--ds-*` primitive, semantic token) and the standard primitive names.
- [Semantic token reference](/design-systems/semantic-tokens/): the fixed token names for color, typography, sizing and spacing, elevation and motion.
- [Naming conventions](/design-systems/naming-conventions/): how component, part, modifier, state and utility classes are named.
- [Component contract](/design-systems/component-contract/): the baseline components every system implements, and the patterns for options added on top.
- [Directory structure](/design-systems/directory-structure/): where the CSS files, fonts, entry point and feature CSS live.
- [Using it from Svelte](/design-systems/svelte/): using the global CSS from Svelte components, with props that follow the class conventions.
- [Icons](/design-systems/icons/): Lucide icons kept in the project as one Svelte component per icon over a shared base, with a stroke width a theme can set.
- [In practice](/design-systems/in-practice/): collisions and techniques I ran into while running a layered system: unlayered tokens, utility order, custom-property hooks, tone and emphasis tiers.

## Why This Architecture Works

**The cascade is predictable.** Every design-system style rule sits in a named cascade layer, and one [`@layer`](/css/cascade-layers/) declaration lists the layers in order. When two normal declarations in different layers compete, that order determines which one wins. Inside one layer, specificity still matters. `!important` would turn the layer order around, so I keep every design-system style rule in a layer and don't reach for `!important` as a routine fix. (See [Layer Strategy](/design-systems/cascade-layers/#layer-strategy).)

**Themes and schemes don't duplicate component CSS.** A theme or a light/dark scheme changes the look by reassigning primitives, the `--ds-*` custom properties that hold raw values, in the `base` layer. Semantic tokens read those primitives, and components read the semantic tokens. So reassigning a primitive updates every token and component that depends on it, and no component CSS gets copied per theme. A new visual theme supplies its light and dark primitive palettes. High contrast is a different case: it may need its own accessibility tokens or rules, so it isn't just another color-scheme value. (See [Theme identity and color scheme](/design-systems/cascade-layers/#theme-identity-and-color-scheme).)

**A change reaches only what it should.** Dependencies always point one way: primitives → semantic tokens → components. So each kind of change has one place to make it. To change a theme's primary color, I edit the right primitive palette. To change everything that uses a shared semantic token, I edit that token.

**The contract makes it portable.** Components only reference semantic tokens. They never use `--ds-*` primitives or raw values. So the whole component library can move to any project that implements the same semantic token names and component baseline. Together, the token names in the [Semantic Token Reference](/design-systems/semantic-tokens/) and the component class names in the [Component Contract](/design-systems/component-contract/) are the stable API of this architecture.
