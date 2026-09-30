---
title: "@scope"
description: How @scope limits rules to a subtree, how its specificity works, and where scope proximity sits in the cascade.
tags: [css, scope, specificity, cascade-layers]
sidebar:
  order: 2
---

`@scope` limits a set of rules to part of the DOM. The rules inside only match elements between a scope root and, if you give one, a scope limit. My design system uses it for feature CSS: see [`@layer features`](/design-systems/cascade-layers/#layer-features).

## Scope root and scope limit

```css
@scope (.card) {
  img { border-radius: 50%; }
}
```

`.card` is the scope root. `img` only matches images inside a `.card`, and the root itself counts as in scope.

Add `to (...)` and you get a scope limit, a lower bound. Elements inside the limit are out of scope. People often call this a donut scope:

```css
@scope (.article-body) to (figure) {
  img { border: 5px solid black; }
}
```

That styles images in `.article-body`, but not images inside a `<figure>` in it. An element is in scope when it's an inclusive descendant of the root (the root itself or anything inside it) and not an inclusive descendant of a limit. So the root is included and the limit element itself is excluded. Adding `> *` flips either end:

| Prelude                               | Root     | Limit    |
| ------------------------------------- | -------- | -------- |
| `(.root) to (.limit)`                 | included | excluded |
| `(.root) to (.limit > *)`             | included | included |
| `(.root > *) to (.limit)`             | excluded | excluded |

Both preludes take selector lists, and each matching root makes its own scope. A limit can use `:scope` to require a relationship with the root:

```css
/* .content is only a limit when it is a direct child of the root */
@scope (.media) to (:scope > .content) { /* ... */ }
```

Only the subject of a selector (the rightmost compound) has to be in scope. The rest of the selector can match ancestors outside it. Something like `:scope + p` never matches, because a sibling of the root is outside the scope.

## `:scope` and `&`

Inside `@scope`, `:scope` matches the scope root:

```css
@scope (.card) {
  :scope { padding: 1rem; }       /* the .card itself */
  :scope > h2 { margin: 0; }      /* direct child headings */
}
```

A selector without `:scope` or `&` is relative to the root, with a descendant combinator implied. So `img` matches like `:scope img`. A selector that starts with a combinator is relative too: `> p` means `:scope > p`.

## Inline `<style>` with no prelude

If you write `@scope` with no root selector inside a `<style>` element, the root is the `<style>` element's parent:

```html
<div class="promo">
  <style>
    @scope {
      p { color: darkred; }
    }
  </style>
  <p>red</p>
</div>
<p>not red</p>
```

`@scope to (...) { }`, with a limit but no root, works this way too.

## Specificity inside `@scope`

The root selector doesn't add to specificity. Plain selectors and `&` act as if `:where(:scope)` were in front of them, which adds zero. `:scope` written out is a pseudo-class, so it adds 0-1-0.

```css
@scope (#hero) {
  img { }           /* 0-0-1: same as :where(#hero) img */
  & img { }         /* 0-0-1 */
  :scope img { }    /* 0-1-1 */
}
```

That's the big difference from nesting. `#hero { img { } }` gives `img` the id's weight, and `@scope (#hero) { img { } }` doesn't. MDN warns that the specificity of `&` inside `@scope` has differed between engines and versions.

## Scope proximity in the cascade

`@scope` adds a step to the cascade, after specificity and before order of appearance. If two declarations tie on everything up to specificity, the one whose scope root is fewer hops up the tree from the element wins. Rules that aren't in a `@scope` count as infinitely far away.

Say a page has light and dark sections, marked with classes, and they can nest inside each other. Text should follow the nearest section around it:

```html
<div class="light">
  <div class="dark">
    <div class="light">
      <p>should be black</p>
    </div>
  </div>
</div>
```

```css
/* without @scope: both match, .dark p is later, so the text is white */
.light p { color: black; }
.dark p { color: white; }

/* with @scope: .light is one hop away, .dark is two, so black wins */
@scope (.light) { p { color: black; } }
@scope (.dark) { p { color: white; } }
```

Proximity only breaks ties. A more specific selector still beats a closer scope. So does anything the cascade compares earlier: origin, importance, layers.

## With `@layer`

Layers come before specificity and proximity in the cascade. So a rule in a later layer beats a scoped rule in an earlier layer, no matter how close its root is. The usual way to split the jobs:

- [`@layer`](/css/cascade-layers/) sets priority: which group of rules wins a conflict.
- `@scope` sets reach: which elements a rule can match at all.

```css
@layer features {
  @scope (.book-card) {
    .cover { aspect-ratio: 2 / 3; }
  }
}
```

Short class names like `.cover` are safe here. The scope keeps them inside `.book-card`, and the layer sets how they rank against components and utilities.

At-rules inside `@scope` (`@keyframes`, `@font-face`, `@layer`) are valid, but they aren't scoped themselves. Style rules inside a nested `@layer` block are still scoped.

## Compared to naming and `:where()`

**BEM and other naming schemes** scope by convention. `.card__title` can't collide with `.modal__title` because the names are unique. But nothing stops `.card__title` from matching inside a nested card, and there's no lower bound. Class names also have to include the component name. My design system's [naming conventions](/design-systems/naming-conventions/) take this route for library components, and feature CSS uses `@scope`.

**`:where(.card) .title`** keeps the root out of specificity, same as `@scope`. But it has no lower bound and no proximity. A `.title` in a card nested inside another card is matched through both cards, so if the two cards' rules set different values, the later rule in source order wins, not the closer card.

**`@scope (.card) to (.card) { .title { } }`** stops at the next nested card, and you get proximity on top.

## Things to know

- Inheritance ignores scope. A `color` or `font-family` set on the root, or on an element in scope, gets inherited past the limit like any other inherited value. `@scope` limits which elements selectors match, not where values end up.
- Pseudo-elements can't be scope roots or limits.
- You can nest `@scope` rules. The inner root is found relative to the outer one, and proximity is measured from the innermost root.

## Browser support

MDN lists `@scope` in Chrome 118, Firefox 146 and Safari 17.4. It also notes that Safari 26.0 to 26.3 didn't apply rules inside `@scope` to `<input>` and `<textarea>` elements, and 26.4 fixed that.

## References

- [MDN: `@scope`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@scope)
- [MDN: `:scope`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:scope)
- [CSS Cascading and Inheritance Level 6: `@scope`](https://drafts.csswg.org/css-cascade-6/#scope-atrule)
- [CSS Cascading and Inheritance Level 6: Cascade Sorting Order](https://drafts.csswg.org/css-cascade-6/#cascade-sort)
