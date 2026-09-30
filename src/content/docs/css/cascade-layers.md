---
title: Cascade Layers (@layer)
description: How @layer orders groups of rules in the cascade, how that order gets fixed, and where it goes wrong.
tags: [css, cascade-layers, specificity]
sidebar:
  order: 1
---

A cascade layer is a named bucket of rules. Say two declarations set the same property on the same element, and they come from different layers. The later layer wins, and the browser never compares specificity or source order. The layer order my design system uses is in [its layer strategy](/design-systems/cascade-layers/#layer-strategy).

## Where layers sit in the cascade

The cascade compares things in this order: origin and importance, then context (shadow DOM), then the `style` attribute, then **layers**, then specificity, then [scope proximity](/css/scope/#scope-proximity-in-the-cascade), then order of appearance. That gives two rules:

- Between layers, specificity doesn't matter. A type selector in a later layer beats an id selector in an earlier one.
- Inside one layer, specificity and source order work like they always have.

```css
@layer base, components;

@layer components {
  a { color: green; }          /* wins: later layer */
}
@layer base {
  #nav a.active { color: red; } /* 1-1-1, but earlier layer */
}
```

## Order is fixed by first appearance

A layer gets its position the first time its name shows up, whether that's in a statement, a block or an `@import ... layer()`. Later blocks with the same name add rules to that layer but don't move it. Once a layer exists, you can't reorder it.

```css
@layer reset { /* ... */ }        /* reset is created: position 1 */
@layer base { /* ... */ }         /* base: position 2 */
@layer base, reset, components;   /* only components is new: position 3 */
@layer reset { /* ... */ }        /* appended to reset, still position 1 */
```

So I put the whole order in one statement, and that statement has to be the first CSS the browser parses:

```css
@layer reset, base, components, utilities;
```

Layer order is global to the document (per origin, and separately per shadow tree). It isn't per stylesheet. The browser reads stylesheets in document order, so "first" means first across every `<style>` and `<link>` on the page.

A layer declared inside `@media` or `@supports` only joins the order if the condition is true. That means the order can depend on the viewport:

```css
@media (width >= 50em) {
  @layer site { /* ... */ }  /* on wide screens site is created first */
}
@layer page, site;           /* on narrow screens page comes first */
```

## Unlayered styles beat all layers

Any rule that isn't in a layer goes into an implicit final layer. For normal declarations, that layer beats every named and anonymous layer. Specificity doesn't matter, and neither does where the rule sits in the source.

```css
p { color: purple; }  /* unlayered, 0-0-1: wins */

@layer type {
  .box p { color: green; }  /* 0-1-1, but layered */
}
```

## `!important` reverses the order

For important declarations the layer order flips. The earliest layer wins, and unlayered important styles lose to every layered important style. Origins work the same way (user-agent `!important` beats author `!important`). This lets me put a declaration in an early layer that later layers can't override.

```css
@layer reset, utilities;

@layer reset {
  [hidden] { display: none !important; }
}
@layer utilities {
  .flex { display: flex !important; }  /* loses to reset's !important */
}
```

The full order, lowest to highest, for the author origin with two layers A and B declared in that order: A normal, B normal, unlayered normal, inline `style` normal, animations, unlayered important, B important, A important, inline `style` important, transitions.

## `@import` into a layer

An `@import` can put a whole stylesheet into a layer. Add `layer(...)` with a name after the URL, or the bare keyword for a new anonymous layer:

```css
@layer reset, vendor, base;
@import url("reset.css") layer(reset);
@import url("vendor.css") layer(vendor);
@import url("theme.css") layer;          /* new anonymous layer */
@import url("widgets.css") layer(base.widgets);
```

- `@import` has to come before every other rule in the file except `@charset` and `@layer` statements. An `@import` after a style rule or an `@layer` block is invalid, and the browser ignores it.
- `@layer` statements can go before the imports, but not between them. Per the spec, an `@layer` rule after an `@import` makes any later `@import` rules invalid.
- `@import` can't go inside `@layer`, `@media` or any other block. Conditions go on the import itself: `layer(...)`, then `supports(...)`, then a media query list.
- The imported rules cascade as if you'd written them where the `@import` is.
- The layer gets created even if the file fails to load, but only if the import's conditions match.
- Any layers the imported file declares end up nested inside the layer it was imported into.

## Anonymous layers

`@layer { ... }` with no name, or `@import url(...) layer` with the bare keyword, creates an anonymous layer. It takes a place in the order like any other layer. But nothing can add rules to it later, and each one is a separate layer.

```css
@layer { p { margin-block: 1rem; } }  /* layer 1 */
@layer { p { margin-block: 0; } }     /* layer 2, separate */
```

## Nested layers

A layer declared inside another layer is nested. So is a layered file imported into a layer. From outside, you reach a nested layer with dot notation:

```css
@layer components {
  @layer button, card;
}

@layer components.button {
  .btn { padding: 0.5rem 1rem; }
}
```

- `components.button` is a different layer from a top-level `button`. Nesting stops third-party layer names from colliding with mine.
- Nested layers are ordered among themselves by first appearance, inside their parent.
- Rules sitting directly in `components` (not in a sub-layer) act as an implicit last sub-layer. So they beat `components.button` for normal declarations and lose to it for `!important`.
- A nested layer can't get out of its parent. Everything in `components.*` stays between the layers before and after `components`.

## `revert-layer`

`revert-layer` is a CSS-wide keyword (one that works on every property). It rolls the property back to the value it would have had if the current layer had no rules for it on this element. If no lower layer sets it, it falls back to the previous origin (user or user-agent styles), like `revert` does.

```css
@layer base, special;

@layer base {
  .feature { color: green; }
}
@layer special {
  .item { color: red; }
  .feature { color: revert-layer; }  /* green, from base */
}
```

It works on `all` too: `all: revert-layer` drops everything the current layer did to an element.

## Layers set priority, not reach

A layer sets which rule wins when two rules match the same element. It has no effect on which elements a rule matches. A rule in `features` still matches everything its selector matches, anywhere on the page. Limiting where rules apply is the job of [`@scope`](/css/scope/). The two work together: layer first, then scope proximity.

## Footguns

**A component stylesheet shows up before the entry point.** Say the entry stylesheet, `index.css`, holds the order statement, and each component has its own stylesheet that puts its rules in a layer. A framework bundles a component's CSS and injects it ahead of the main stylesheet:

```css
/* item-card.css, injected first */
@layer features {
  .item-card .cover { aspect-ratio: 2 / 3; }
}

/* index.css, arrives second */
@layer reset, base, components, features, utilities;
```

The browser reads the card's stylesheet first, so `features` gets named first, and that makes it the lowest layer. When the order statement in `index.css` arrives, it only creates the four layers that don't exist yet. Now every rule in `components` beats every rule in `features`, and the card's styles lose to generic component styles for no visible reason. The fix is to put the order statement in an inline `<style>` in the HTML shell, ahead of anything the framework injects. My design system does this: [layer strategy](/design-systems/cascade-layers/#layer-strategy), [the entry point](/design-systems/directory-structure/#the-entry-point).

**A third-party stylesheet is unlayered.** Say a widget library is loaded with a plain `<link>`:

```css
/* vendor.css */
button { background: #eee; }
```

That `button` rule is unlayered, so it beats `.btn-primary` in my `components` layer, even though the class is more specific. A primary button renders with the vendor's gray background, and raising the specificity of my rule doesn't help. HTML has no attribute to put a `<link>` into a layer, so the fix is to import the file into a low layer instead:

```css
@layer vendor, reset, base, components;
@import url("vendor.css") layer(vendor);
```

**`!important` in a low layer beats everything above it.** Important declarations reverse the layer order, as described above. So a reset like `* { animation: none !important; }` in `reset` beats `!important` in `utilities`, and every normal declaration everywhere. Adding `!important` in a higher layer to fight it won't work, because the higher layer is the one that loses. Either change the reset or accept that important declarations from early layers are final.

**Unlayered "quick fixes".** Someone fixes a bug fast with a one-off rule in a `<style>` tag, or in a stylesheet outside any layer. That rule is unlayered, so it beats the whole layered system for normal declarations, and later changes in any layer can't override it. Every rule needs a layer, or the order means nothing. Same for token declarations: [unlayered tokens can shadow layered ones](/design-systems/in-practice/).

## Browser support

MDN lists `@layer`, `@import ... layer()` and `revert-layer` in Chrome 99, Firefox 97 and Safari 15.4.

## References

- [MDN: `@layer`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer)
- [MDN: Cascade layers (Learn)](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Cascade_layers)
- [MDN: `@import`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@import)
- [MDN: `revert-layer`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/revert-layer)
- [CSS Cascading and Inheritance Level 5: Cascade Layers](https://drafts.csswg.org/css-cascade-5/#layering)
- [CSS Cascading and Inheritance Level 5: `revert-layer`](https://drafts.csswg.org/css-cascade-5/#revert-layer)
- [CSS Cascading and Inheritance Level 6: Cascade Sorting Order](https://drafts.csswg.org/css-cascade-6/#cascade-sort)
