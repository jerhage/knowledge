---
title: Naming Conventions
description: How component, part, modifier, state and utility classes are named.
tags: [css, design-systems, naming-conventions, components]
sidebar:
  order: 5
---

## Naming Conventions

### Component Pattern

Component classes come in three kinds: **base**, **subcomponent** and **variant**. All three start with the component name.

```
.component                    → shared structure and defaults
.component-subcomponent       → named slot or internal part
.component-variant            → style or size modifier
.component.is-state           → JavaScript-driven state
```

**Example:**

```css
.btn {
  /* shared structure */
}
.btn-icon {
  /* icon slot inside a button */
}
.btn-primary {
  /* filled primary color variant */
}
.btn-ghost {
  /* outline-only variant */
}
.btn-sm {
  /* small size variant */
}
.btn-loading {
  /* loading spinner state */
}
.btn.is-active {
  /* JS-toggled active state */
}
```

Variants are independent of each other and combine freely: `.btn.btn-primary.btn-sm` is valid and nothing conflicts.

### Generic Scoping

Every class name describes what the thing **does**, not which design system it belongs to. Names have to work in any system:

- `.card`, `.card-header`, `.card-body`, `.card-footer`, not `.brand-card`
- `.alert`, `.alert-success`, `.alert-danger`
- `.badge`, `.badge-success`
- `.modal`, `.modal-backdrop`, `.modal-header`

So the same component HTML works in any system that implements the semantic token contract.

### Class Conventions

These rules build on the Component Pattern above and apply to every class the system defines. They're numbered because other pages refer to them by number.
1. **A part is named for its role, never its content.** The caller passes what goes in it. So `.selection-label` and `.file-item-detail`, not `-size`, `-dimensions`, `-shortcut` or `-browse`.
2. **One name per role, library-wide.**

   | Part           | Role                                                                                  |
   | -------------- | ------------------------------------------------------------------------------------- |
   | `-title`       | heads a container                                                                     |
   | `-label`       | names a control or a value                                                            |
   | `-description` | secondary text under a title                                                          |
   | `-hint`        | guides a control, or a muted trailing aside                                           |
   | `-content`     | the text column                                                                       |
   | `-body`        | the padded main region                                                                |
   | `-panel`       | a region that is shown or hidden                                                      |
   | `-actions`     | holds buttons                                                                         |
   | `-action`      | the words in a title that say what activating the container does (`.dropzone-action`) |
   | `-footer`      | the bottom band                                                                       |
   | `-icon`        | a glyph                                                                               |
   | `-close`       | dismisses a container                                                                 |
   | `-remove`      | deletes an item                                                                       |
   | `-clear`       | empties a field                                                                       |

3. **A modifier is picked when the markup is written; a part is an element.** One name is never both. A part `.card-media` and a root modifier `.card-media` must not share a name.
4. **A modifier sits on the element it changes and has that element's prefix.** A modifier of a part is `.component-part-modifier` (`.selection-handle-north`). Never put one component's modifier on another component's element.
5. **Sizes are `-sm` and `-lg` (`-xs`, `-xl` when needed); the default has no class.** Never `-compact`, never an explicit `-md`.
6. **Tone and emphasis are separate axes that combine.** (Worked examples are under [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline).) Tone: `-primary`, `-accent`, `-neutral`, `-info`, `-success`, `-warning`, `-danger`. Emphasis: `-solid`, `-outline`, `-ghost`, `-quiet`. One class never encodes both.
7. **`.is-*` is only for state that changes while the component is alive, and each word has one meaning:** `is-active` chosen (pressed, current, checked), `is-selected` the highlighted row in a list or menu, `is-open`, `is-leaving`, `is-invalid` invalid input, `is-error` a failed operation, `is-disabled` non-native elements only. A state set once when the markup is written is a modifier.
8. **Every component has a base class on its root.** Utilities can sit next to it, but never replace it. A component that only renders a run of inline text inside its caller's flow (a search-match highlighter, say) has no root, so it has no base class.
9. **No app or domain words in library classes.** Name what it does visually (`.region-box-accent`, not `.region-box-note`).
10. **A container may place and size a child component, but never restyle its internals.** If a child has to look different, it exposes a part or a modifier of its own.
11. **Utilities never name a component class.** If a layout has to adjust a component, it sets a custom property the component reads, or the component has a modifier for it.
12. **Helpers that show something in only one context end in `-only`**, scoped to the context that controls it (`.layout-shell-narrow-only`, `.modal-fill-only`).

### Utility Pattern

Utilities don't depend on context, they combine freely, and each one does one thing:

```css
.row {
  display: flex;
  gap: var(--sp-3);
}
.col {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.uppercase {
  text-transform: uppercase;
}
.mono {
  font-family: var(--font-mono);
}
.grid-2-col {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
}
.flex-1 {
  flex: 1;
}
```

No utility has logic specific to a component. Utilities only reference [semantic tokens](/design-systems/semantic-tokens/).

A layout pattern is `.layout-<pattern>`, and its parts and placements use that full prefix: `.layout-split-pane`, `.layout-split-left`, `.layout-mosaic-lead`, `.layout-bento-col-2`, `.layout-overlay-content`. Grid utilities pair the same way: `.col-span-2`, `.row-span-2`.

Some utilities bundle several properties, and sometimes I want a bundle with one property changed where I use it. The natural way to get that is to put a single-purpose utility next to the bundle, one that sets the property differently. Whether that works depends on file order. Utilities share one layer, and single-class selectors tie on specificity, so when two utilities sit on one element, the later rule in the file wins. If the bundle came after the single-purpose utility, the bundle would win and the caller's tweak would do nothing. So a utility that bundles several properties is declared before the single-purpose utilities that set any of those same properties. A component that uses the same bundle applies the utility in its markup instead of copying its declarations into its own rule.

Bundles worth copying:

- **`.eyebrow`**: the small upper-case caption above a group. It sets an extra-small size, wide tracking and `uppercase`, and nothing else. Face, weight and color come from utilities next to it (`eyebrow mono text-faint`). It's the first rule in its file, so any of those wins. Component captions (a card eyebrow, a list-group title, a table header cell, a menu label) apply it in markup instead of repeating it.
- **`.truncate`**: one line, cut off with an ellipsis. It sets `overflow: clip visible`, `text-overflow: ellipsis`, `white-space: nowrap`, `min-inline-size: 0`, `min-block-size: 0`. Only the inline axis is clipped, because of descenders (the part of a letter like g or y that hangs below the line). In a line-height-1 line box a descender drops below the box. `overflow: hidden` would cut it off, and clipping only the inline axis still draws it. `clip` doesn't create a scroll container, though, and a scroll container is what normally lets a flex or grid item shrink smaller than its text. So the two `min-*-size: 0` do that job instead. Put it on the element that is the flex item or the block. For a button label, that's a `<span class="truncate">` inside the button plus `min-w-0` on the button.

A utility can also take a runtime value through a custom property that the caller sets with an inline style (`style:--name` in [Svelte](/design-systems/svelte/)). The utility declares a fallback:

```css
.place-rect {
  left: var(--rect-left, 0px);
  top: var(--rect-top, 0px);
  width: var(--rect-width, 0px);
  height: var(--rect-height, 0px);
}
.indent {
  padding-inline-start: calc(var(--sp-4) * var(--indent-depth, 0));
}
```
