---
title: color-scheme and light-dark()
description: What the color-scheme property and meta tag change, how light-dark() picks a value, and how to follow the OS preference with a manual override.
tags: [css, color-scheme, theming, custom-properties]
sidebar:
  order: 3
---

`color-scheme` declares which color schemes an element can be rendered in. `light-dark()` picks one of two values, depending on which scheme the element ends up with. Put them together and you write each color once, with no `@media (prefers-color-scheme)` blocks. My design system's version of this is in [theme identity and color scheme](/design-systems/cascade-layers/#theme-identity-and-color-scheme).

## The property

```css
:root {
  color-scheme: light dark;
}
```

| Value        | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `normal`     | Initial value. Use the page's color scheme (from the meta tag), or the browser default, which is light. |
| `light`      | Only light is supported.                                                           |
| `dark`       | Only dark is supported.                                                            |
| `light dark` | Both; the OS or browser preference sets which one. The first one listed is used if there is no preference. |
| `only light` | Light, and the browser must not auto-darken it (for example Chrome's Auto Dark Theme). |

The browser checks that list against the OS or browser preference, and the result is the element's used color scheme. With `light dark` and a dark OS setting, you get dark. With just `light`, you get light no matter what the OS setting is.

`color-scheme` is inherited. Set it on `:root` and it covers the page. Set it on an element and it covers that subtree:

```css
.code-sample { color-scheme: dark; }  /* always dark, even on a light page */
```

## The meta tag

```html
<meta name="color-scheme" content="light dark" />
```

The meta tag sets the page's color scheme. The property sets or overrides it per element. The spec suggests setting the page scheme (the meta tag, in HTML) and not only the property, so that `prefers-color-scheme` stays consistent with the elements on the page. A `color-scheme` property on an element changes that element's scheme. It doesn't change what `@media (prefers-color-scheme)` reports, which MDN describes as the OS or browser setting.

## What it changes

When an element's used color scheme changes, so do:

- system colors (`Canvas`, `CanvasText`, `ButtonFace`, `Field`, ...), which resolve to their light or dark versions
- the result of `light-dark()`
- UI the browser draws itself: form controls, scrollbars, spellcheck underlines

On the root element it also changes the canvas (the page background behind everything) and the viewport scrollbars.

It doesn't touch any color I set myself. `body { background: white; }` stays white in dark mode. A page that only uses system colors gets both schemes for free. A page with its own palette needs `light-dark()` or media queries for every color.

## `light-dark()`

```css
:root { color-scheme: light dark; }

body {
  color: light-dark(#333b3c, #efefec);
  background-color: light-dark(#efedea, #223a2c);
}
```

It returns the first value when the element's used color scheme is light, and the second when it's dark. With no `color-scheme` and no meta tag, the used scheme is the default (light), so `light-dark()` always returns the first value. `color-scheme: dark` on its own is enough to get the second.

It resolves against the color scheme of **the element the declaration applies to**. Where a custom property holding it was defined doesn't matter. An unregistered custom property stores `light-dark(...)` as plain text, and it only becomes a color when a real property uses it:

```css
:root {
  color-scheme: light dark;
  --surface: light-dark(white, #1b1b1b);
}
.panel { background: var(--surface); }
.inverted { color-scheme: dark; }
```

A `.panel` inside `.inverted` gets `#1b1b1b` even on a light page. `light-dark()` is evaluated on the `.panel`, and the scheme it inherits there is dark. For the same reason, reading a token like that from script gives you the `light-dark(...)` text, not a color: [tokens at runtime](/css/tokens-at-runtime/).

It takes two `<color>` values. The spec and MDN also define an image form, `light-dark(url(a.png), url(b.png))` (with `none` allowed), but MDN's compat data only lists that in very recent releases: Chrome 150, Firefox 150, Safari 27. It doesn't accept anything else (lengths, whole shadows, keywords). For a shadow, vary the color inside it:

```css
box-shadow: 0 1px 2px light-dark(#0001, #0005);
```

## Following the OS, with an override

What I want: automatic by default, pinned by an attribute on `:root`, and every color written once.

```css
:root {
  color-scheme: light dark;              /* follow the OS */
  --bg: light-dark(#f6f2e8, #19251e);
  --text: light-dark(#293b30, #e2ebdf);
}
:root[data-color-scheme="light"] { color-scheme: light; }
:root[data-color-scheme="dark"]  { color-scheme: dark; }
```

- No attribute: the OS preference sets the scheme, and the page follows it live when it changes.
- `data-color-scheme="dark"`: dark, whatever the OS setting is. Remove the attribute and it goes back to automatic.
- Form controls and scrollbars follow the same property, so they always match the page.

Before `light-dark()`, you had to write each palette twice: once in `@media (prefers-color-scheme: dark)` for the OS preference, and once under `[data-color-scheme="dark"]` for the override. The attribute can't change what the media query matches, so neither copy could stand in for the other.

Saving the choice and setting the attribute before first paint is the app's job. CSS only does the switching.

## Footguns

**Custom properties are resolved where they're declared.** Say a system token, `--ds-bg`, feeds a semantic token, `--color-bg`, on `:root`, and a rule on one section of the page gives `--ds-bg` a new value to re-theme that section. A `var()` inside a custom property gets substituted on the element that declares it. So this doesn't re-theme the section:

```css
:root {
  --ds-bg: light-dark(white, black);
  --color-bg: var(--ds-bg);       /* substituted here, on :root */
}
.brand-section {
  --ds-bg: light-dark(ivory, navy); /* --color-bg on descendants is still white/black */
}
```

`--color-bg` inherits the value that was already substituted on `:root`. The `light-dark()` inside it still follows a subtree's `color-scheme`, because that part is evaluated where the color is used. But reassigning `--ds-bg` further down never reaches it. Redeclare `--color-bg` in the same rule as the new `--ds-bg`.

**Inherited colors are resolved on the parent.** `light-dark()` computes to one color on the element where it's declared, and inheritance passes that color down, not the `light-dark()` that produced it. If `body` sets `color: light-dark(black, white)` on a light page, a child with `color-scheme: dark` inherits the color the body already resolved, and its text stays black on what may now be a dark background. A subtree with its own scheme has to set `color` again, and anything else inherited.

**Registered `<color>` properties resolve early.** An `@property` with `syntax: "<color>"` computes its value. So `light-dark()` in it gets resolved on the declaring element, and descendants inherit a plain color, just like the `color` case. Keep tokens that depend on the scheme unregistered. More in [registered custom properties](/css/registered-custom-properties/#footguns).

**No `color-scheme`, no dark.** Without `color-scheme` (or the meta tag), the used scheme is the default, light. So `light-dark()` always returns the light value, whatever the OS preference is, and someone with a dark OS setting still gets the light page.

**`color-scheme` doesn't recolor my colors.** It only switches system colors, `light-dark()` and browser UI. A hard-coded `#fff` background on a `color-scheme: dark` element stays white.

## Browser support

MDN lists `color-scheme` in Chrome 81, Firefox 96 and Safari 13, and `light-dark()` with colors in Chrome 123, Firefox 120 and Safari 17.5.

## References

- [MDN: `color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)
- [MDN: `<meta name="color-scheme">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/color-scheme)
- [MDN: `light-dark()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/light-dark)
- [MDN: `prefers-color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme)
- [MDN: `<system-color>`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/system-color)
- [CSS Color Adjustment Level 1: Preferred Color Schemes](https://drafts.csswg.org/css-color-adjust-1/#preferred)
- [CSS Color Level 5: `light-dark()`](https://drafts.csswg.org/css-color-5/#light-dark)
- [CSS Custom Properties Level 2: computed value of custom properties](https://drafts.csswg.org/css-variables-2/#defining-variables)
