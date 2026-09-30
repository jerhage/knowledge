---
title: Proving a CSS Refactor Changed Nothing
description: Computed-style snapshots before and after, comparing old and new rules on one page, token noise, unresolved tokens, and pixel tolerance.
tags: [testing, playwright, css, design-tokens, design-systems]
sidebar:
  order: 4
---

A lot of design system work is refactoring CSS that should change nothing on screen: renaming a class, moving a part onto its own rules, adding or registering a token. These checks are how I show that nothing changed. The collisions they guard against are in [design system mechanics in practice](/design-systems/in-practice/).

## Proving a class rename renders identically

Say I rename a class and update every place that uses it. The page should look exactly the same afterwards. To prove that, a probe records how every affected element renders before the rename and after it, and diffs the two records.

The record is a snapshot of every element under the affected roots. Each element is keyed by its path in the tree, never by its class, because the class is the thing that changes. For each one, record its full `getComputedStyle`, `::before`/`::after` when they have content, and its rect with `scrollY` added, so the position doesn't depend on how far the page was scrolled.

The "before" snapshot has to come from the code at HEAD, while the working tree holds the change. To get it, write HEAD's versions of the changed files into the working tree through a temporary index, take the snapshot, and then write the new versions back. Using a temporary index means the real index is never touched:

```sh
GIT_INDEX_FILE=… git read-tree HEAD
GIT_INDEX_FILE=… git checkout-index -f -- <file>
```

One gotcha: a showcase page may print class names as labels. Renaming a class then changes the text of a label, which changes its width, and that can reflow the page below it. The diff fills with position changes that have nothing to do with the CSS. So before measuring, overwrite those labels with one fixed string (or map the new names back to the old ones in every text node).

A snapshot only covers the states the page is in when it's taken, so you have to drive the other states yourself. Open a menu. Dispatch a `dragenter` with a `DataTransfer` holding a file to show a dropzone. Hold the mouse down mid-drag. For `(pointer: coarse)` rules, use a context with `hasTouch` and `isMobile`.

Sort the declarations before you compare. In a `getComputedStyle` walk, the custom properties come back in a different order on each page load. So an unsorted string shows a difference when nothing changed.

## Comparing a restyled part with the rules it replaces, on one page

Sometimes a part of a component used another component's class, and the refactor gives it a class of its own. Now the old rules and the new rules are different CSS, and I want to prove they render the same.

The way to compare them is to have both on one page. Put HEAD's old rules back next to the new ones, in an added style tag wrapped in `@layer components { … }`. Where those rules sit in the cascade matters, since that determines which rules they override. The layer order is already declared, so the added rules join that layer after every imported file, which is where they were before.

Then build the old markup and the new markup side by side. Compare the full computed style of each pair in every state (rest, hover, press, chosen, disabled, disabled and chosen), in each color scheme. The same works for a whole stylesheet: write HEAD's file into the working tree for one run, then restore it.

## A new token shows on every element of a computed-style comparison

A token here is a custom property declared on `:root`. Custom properties inherit, so `getComputedStyle` lists that token on every element and pseudo-element. Add one token, and a before/after dump of the whole page differs everywhere. That buries the differences that matter. So leave the new names (and a component's new private `--_*` inputs) out of the comparison by name, then read what's left.

Registering an existing token is different. A registered token (`@property`) computes to its resolved value. So registering an existing one like `--border-width` changes nothing in the dump, as long as its value was already a plain length. (Where a `var()` inside a custom property gets resolved is in [custom property gotchas](/css/custom-property-gotchas/).)

Hover and press states need a mouse to trigger, and a probe comparing many nodes can't hold a mouse over each one. Instead, force them through the DevTools protocol. Call `CSS.forcePseudoState` with `hover`, `active` or `focus-visible` on each node, after `DOM.getDocument` and `DOM.querySelectorAll`. Turn off the component's `transition` in the probe first. Otherwise a reading taken in the middle of a transition differs from run to run.

## Catching an unresolved token in a browser probe

Tokens often refer to other tokens through `var()`, so one token's value is a chain of names. If the chain ends at a name that isn't defined, the token computes to the guaranteed-invalid value. Then `getComputedStyle(document.documentElement).getPropertyValue('--color-x')` returns `''`.

That gives a direct check. Set each theme and color scheme, and read every declared token name that way. An empty string shows exactly which token is broken.

Checking a computed `color` instead can't catch this. `color` inherits, so when its value is invalid it falls back to the parent's color, and the element looks fine. Run the check over every screen, theme and scheme, at a couple of widths. Reading a token's resolved value from script in general is covered in [tokens where `var()` cannot reach](/css/tokens-at-runtime/).

## A gradient of a translucent color rasterizes a level off a background of it

I painted a 5% hover tint as `background-image: linear-gradient(tint 0 0)` instead of `background-color: tint`. The computed colors were equal, so the two looked like they should render identically. But in Chromium, the pixels came out up to 2 of 255 apart per channel. On a half-covered edge row of a box with a fractional height, it was up to 4.

So a before/after pixel comparison across a change like that needs a tolerance. "Identical" won't pass.
