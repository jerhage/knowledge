---
title: Registered Custom Properties (@property)
description: How @property and CSS.registerProperty() give a custom property a type, an initial value and inheritance, and what that changes.
tags: [css, custom-properties, design-tokens]
sidebar:
  order: 4
---

A plain custom property is just a string of tokens. It has no type, it's always inherited, and it has no default. Register it with `@property` and it gets a syntax, an initial value and an inheritance setting, so it acts more like a built-in property. My design system registers a few length tokens this way so script can read them in pixels: see [layout constants](/design-systems/semantic-tokens/#layout-constants).

## `@property`

```css
@property --gap {
  syntax: "<length>";
  inherits: true;
  initial-value: 0px;
}
```

- **`syntax`**: a string that lists the values the property accepts. That can be a type name (`"<length>"`, `"<color>"`, `"<number>"`, `"<percentage>"`, `"<length-percentage>"`, `"<angle>"`, `"<time>"`, `"<integer>"`, `"<image>"`, `"<url>"`, `"<transform-function>"`, ...), keywords (`"auto | none"`), `+` for a space-separated list, `#` for a comma-separated list, `|` for alternatives (`"<length> | auto"`), or `"*"` for anything. You can't combine `"*"` with anything else.
- **`inherits`**: `true` or `false`.
- **`initial-value`**: the value when nothing is set (and nothing is inherited). It has to match `syntax`.

Per MDN (and the 2024 Working Draft), `syntax` and `inherits` are required. `initial-value` is required too, unless the syntax is `"*"`. If a required descriptor is missing or invalid, the browser ignores the whole rule and the property stays unregistered. Unknown descriptors just get ignored, and the rule still works. If several `@property` rules register the same name, the last one wins.

## From JavaScript

```js
CSS.registerProperty({
  name: "--gap",
  syntax: "<length>",
  inherits: true,
  initialValue: "0px",
});
```

This does the same thing as `@property`. If `registerProperty()` already registered a name, registering it again throws `InvalidModificationError`. An invalid name, syntax or initial value throws `SyntaxError`. A `registerProperty()` registration wins over any `@property` rule for the same name. Registrations are global to the document, shadow trees included.

## Type checking

A registered property still parses like any custom property, so a wrong value doesn't get dropped at parse time. The browser checks the syntax at computed-value time. If the value doesn't match, the declaration is invalid at computed-value time, and the property acts as if it were set to `unset`. That means it takes the inherited value if `inherits: true`, or the initial value if `inherits: false`.

```css
@property --accent {
  syntax: "<color>";
  inherits: false;
  initial-value: rebeccapurple;
}
.card {
  --accent: green;
  --accent: 12px;          /* not a color */
  background: var(--accent); /* rebeccapurple, not green */
}
```

The earlier `green` is gone. The second declaration already won the cascade, and the browser only checks its type after that. Unregistered, `--accent: 12px` would be kept as is, and `background: 12px` would be the invalid one instead. Then `background` would fall back to its own initial value (`transparent`).

## Computed values

This is the part I use most. An unregistered custom property's computed value is its text, with any `var()` substituted. A registered one computes like a real property of its type:

| Syntax                  | Computed value                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| `<length>`              | absolute length in px (`1.5rem` becomes `24px` with a 16px root font) |
| `<length-percentage>`   | lengths in px, percentages left as percentages (never resolved)       |
| `<time>`, `<angle>`     | canonical unit (`s`, `deg`)                                           |
| `<color>`               | a resolved color                                                      |
| `<url>`                 | an absolute URL, resolved against the stylesheet it was written in    |

So script can read a token as a number it can actually use:

```css
@property --overlay-gap {
  syntax: "<length>";
  inherits: true;
  initial-value: 0px;
}
:root { --overlay-gap: 0.5rem; }
```

```js
getComputedStyle(document.documentElement).getPropertyValue("--overlay-gap");
// registered: "8px"   unregistered: "0.5rem"
```

A `var()` that references a registered property substitutes its computed value too. With `font-size: 10px`, a registered `<length>` set to `8em` substitutes as `80px`. How I read tokens from script this way is in [tokens at runtime](/css/tokens-at-runtime/).

## Animating and transitioning

Unregistered custom properties animate discretely, meaning they flip from one value to the other with nothing in between. A registered property interpolates by its type. So you can drive gradients, angles and other things that can't be transitioned directly through one:

```css
@property --angle {
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
}
.spinner {
  background: conic-gradient(from var(--angle), red, blue);
  transition: --angle 1s;
}
.spinner:hover { --angle: 180deg; }
```

Without the `@property` rule, `--angle` jumps straight to `180deg`. List syntaxes (`<color>+`, `<length>#`) interpolate item by item, and fail if the lists are different lengths.

## `inherits: false`

With `inherits: false`, children don't inherit the value. Each element gets the initial value unless a rule sets the property on it (or it uses `inherit` explicitly). That's handy for per-element state, like an animated `--progress` that shouldn't leak into descendants. MDN also notes it narrows style recalculation when the value changes, because the browser doesn't need to recheck children.

## Footguns

**`initial-value` must be computationally independent.** It has to compute without reference to any other value. `10px` and `1in` are fine. `2em`, `1rem` and `var(--x)` aren't. An invalid `initial-value` drops the whole `@property` rule, with no error or warning. Say a length token is registered with `1rem` as its initial value, so that script can read it in pixels. The rule is dropped, the property stays unregistered, and script reads back the text it was set to instead of a pixel value. `registerProperty()` throws a `SyntaxError` instead, which is easier to notice.

**Invalid doesn't fall back to the earlier declaration.** Same as above: a later invalid value wins the cascade, then turns into inherit or initial. It never goes back to an earlier valid declaration.

**The `var()` fallback stops working.** `var(--x, fallback)` only uses the fallback when `--x` is the guaranteed-invalid value. A registered property with an `initial-value` always has a value, so the fallback never gets used. A component that reads a registered token with its own color as the fallback never gets its own color. Setting it to `initial` gives you the registered initial value, not "unset". My design system's [treatment primitives](/design-systems/cascade-layers/#theme-identity-and-color-scheme) depend on `initial` producing the guaranteed-invalid value, so those have to stay unregistered.

**Registered colors resolve too early for theming.** A `<color>` property computes on the element where it's declared. So `light-dark()` in it gets resolved there, and descendants inherit a fixed color. Tokens that depend on the color scheme should stay unregistered: see [color-scheme and light-dark()](/css/color-scheme/#footguns).

**`@supports` doesn't check the syntax.** `@supports (--accent: 12px)` is true even when `--accent` is registered as `<color>`, because registered properties parse like any custom property.

**Percentages don't resolve.** A `<length-percentage>` set to `50%` computes to `50%`. So `getComputedStyle` gives you `"50%"`, not pixels.

## Browser support

MDN lists `@property` in Chrome 85, Firefox 128 and Safari 16.4, and `CSS.registerProperty()` in Chrome 78, Firefox 128 and Safari 16.4.

## References

- [MDN: `@property`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@property)
- [MDN: `syntax`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@property/syntax), [`inherits`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@property/inherits), [`initial-value`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@property/initial-value)
- [MDN: `CSS.registerProperty()`](https://developer.mozilla.org/en-US/docs/Web/API/CSS/registerProperty_static)
- [MDN: Registering CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Properties_and_values_API/Registering_properties)
- [CSS Properties and Values API Level 1 (Working Draft, 2024)](https://www.w3.org/TR/css-properties-values-api-1/)
- [CSS Properties and Values API Level 1 (Editor's Draft)](https://drafts.css-houdini.org/css-properties-values-api-1/)
- [CSS Custom Properties Level 2: guaranteed-invalid value](https://drafts.csswg.org/css-variables-2/#guaranteed-invalid)
- [CSS Values Level 5: invalid substitution](https://drafts.csswg.org/css-values-5/#invalid-substitution)
