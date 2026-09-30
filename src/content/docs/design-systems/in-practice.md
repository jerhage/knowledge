---
title: "Design System Mechanics in Practice"
description: "Collisions and techniques met while running a layered system: unlayered tokens, utility order, custom-property hooks, tone × emphasis tiers."
tags: [design-systems, css, cascade-layers, custom-properties, design-tokens, components]
sidebar:
  order: 10
---

These are things I ran into once the layered system was in real use. Each one either backs up a rule from the other pages or explains why the rule exists.

## Unlayered tokens can shadow layered tokens

Moving an existing app onto a layered system means a stretch of time when two token files are loaded. The app's old token file is loaded unlayered, as it always was, and the new design tokens sit in their layers. Both declare custom properties on the page.

An unlayered stylesheet beats every `@layer` ([unlayered styles beat all layers](/css/cascade-layers/#unlayered-styles-beat-all-layers)), and that includes custom property declarations. So if the old file declares a custom property with the same name as a layered design token, the old one wins, and everything that reads the token gets the old value. I had one name collide, `--z-modal`: 40 in the legacy file and 400 in the new one. A fixed overlay that stacked itself at `--z-modal` got 40, and it drew under a sticky header at 200.

The fixes depend on which stage the move is at:

- While an old token file and a new layered one both exist, a new token must not reuse a legacy name. `comm` over the two sets of declared names finds any overlap.
- Once the legacy file is gone, a spec that fails on the legacy name prefixes anywhere in the source keeps them from coming back.
- Overlays skip the whole question by opening in the [top layer](/html/top-layer/) (`<dialog>`, `popover`), where no z-index is involved.

## Between two utilities, the later rule in the file wins

An element often has several utility classes, and two of them can set the same property. Two single-class utilities on one element tie on layer and on specificity. So the later rule in the imported CSS wins. That's why a bundle like `.eyebrow`, which sets several properties, goes first in its file: a single-purpose utility next to it then wins, and the caller can adjust the bundle. That rule and the bundles are written up under [utility pattern](/design-systems/naming-conventions/#utility-pattern). It works the same way across files: the import order of the utility files determines which one wins.

A component rule never ties with a utility. `components` is an earlier layer, so the utility always wins. That means a component that applies a utility in its markup can't undo any of it from its own CSS. The whole arrangement rests on the order of rules in the files, which nothing else enforces, so a test that checks the order is cheap insurance.

## A utility adjusts a component through a custom property the component reads

Sometimes a layout utility has to change a component inside it. For example, a narrow layout might raise every button's minimum height to a touch-target size. The direct way is a selector like `.utility .btn`, but utilities never name a component class ([rule 11](/design-systems/naming-conventions/#class-conventions)). So the utility sets a custom property on its own element instead. The component reads that property, with a fallback equal to its own value:

```css
.layout-narrow-touch { --btn-min-block-size: …; }
.btn { min-block-size: var(--btn-min-block-size, var(--control-h-md)); }
```

The property inherits, so it reaches every descendant the old `.utility .btn` selector reached. Replacing that selector with a hook should change nothing on screen. To keep the output identical:

- Every rule that set the property has to read the hook, not just the base rule. The size modifiers set `min-block-size` too, and the old utility used to beat them by layer. If only the base rule read the hook, a sized button inside the layout would keep its own height. So the size modifiers need the hook as well.
- The fallback has to be the value the rule had before, even when that was an initial or inherited value. Write it out (`justify-content: … normal`, `text-align: … start`).

How the `var()` resolves on the element is on [custom property gotchas](/css/custom-property-gotchas/#a-var-in-a-custom-property-resolves-on-the-element-not-in-its-rule). This hook pattern is listed with the other options in the [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline).

## An inherited offset moves only the elements with a rule that reads it

A screen can have several elements pinned to the bottom, and sometimes some of them have to be lifted by an offset. The screen sets `--pin-lift` on an ancestor of those elements. Only the ones with a class that reads it (`.pin-lift`) move, because a custom property does nothing until a rule reads it. So a screen can lift every element that has the class without naming a descendant's class or reaching into another component's scope.

The reading rule and the rule that pins the element sit in the same layer with the same specificity, so the later one wins. Put the reading rule after the one it overrides (`.pin-lift` after `.pin-bottom`).

## Tone and emphasis as two tiers of private custom properties

A button has two separate choices. Its tone is the color family, like primary or danger. Its emphasis is how the color is drawn, like solid, outline or ghost. Tone and emphasis are separate axes that combine ([rule 6](/design-systems/naming-conventions/#class-conventions)), so any tone class can sit next to any emphasis class. The obvious way to style that is a rule per combination. Instead, two independent sets of modifiers on one component work as long as neither set paints anything itself:

- a tone class sets only tone inputs (`--_btn-tone-fg`, `-bg`, `-border`, `-hover-bg` …);
- the base rule and each emphasis class map those to painting inputs (`--_btn-fg`, `--_btn-bg`, `--_btn-hover-bg` …);
- only `.btn` and `.btn:hover` paint.

A custom property that reads another one on the same element resolves against that element's own values. So putting a tone class next to an emphasis class changes the result, and no compound rule is needed.

To keep this identical to writing a rule per combination:

1. A state that has to win over hover (disabled) must reset the hover inputs too, because hover now paints from them. Setting `color` directly would beat a loading state's `transparent` and show the label under the spinner.
2. Some behavior only exists while two pseudo-classes both apply: a pressed primary button shows no overlay while hovered, but a keyboard press shows one. That's a variable set in the `:hover` rule and read in `:active` with a fallback:

   ```css
   .btn:hover { --_btn-press-image: …; }
   .btn:active { background-image: var(--_btn-press-image, <default>); }
   ```

The one thing that can't be kept is a bug caused by a compound selector's extra specificity. With a rule per combination, `.btn-ghost.btn-danger:hover` (0,3,0) outranked `.btn:disabled` (0,2,0). So when someone hovered over a disabled ghost danger button, it got the danger fill as if it were enabled. The tiered version fixes that. How to prove a restyle like this renders the same is on [CSS refactor checks](/testing/css-refactor-checks/).

## Checking that markup only uses classes that exist

Markup refers to design-system classes by name, and the browser ignores a class that no stylesheet defines. So a class written in markup but defined nowhere fails silently. I had a `justify-center` that didn't exist, and it left a loading curtain off-center with nothing reporting an error.

A spec can scan every class in `src/**/*.svelte` (attributes, `class={[…]}` expressions and `class` props). It fails when a class whose first segment belongs to a design-system family (`justify-`, `min-`, `layout-`, …) isn't defined by any stylesheet. Marker names local to one screen, outside those families, don't get flagged. Skip string literals after `===`/`!==`, so a comparison like `kind === 'text'` isn't read as a class.

A base component's part classes count too. A part class written as a hook, with no rule of its own, fails the spec. A part class needs a selector that names it, or it gets removed.
