---
title: App Shells with an Inner Scroller
description: Keyboard scrolling, focus hand-off, position restore and scrollbar reflow when the document does not scroll.
tags: [scrolling, focus, keyboard, sveltekit, svelte-5, css]
sidebar:
  order: 3
---

The setup: a `100dvh` shell where an inner area is the scroll container and the document itself doesn't scroll. Making sure the window really stops scrolling (absolutely positioned descendants can escape the scroller) is covered in [overflow, containing blocks and stacking](/css/overflow-and-stacking/).

## Keyboard scrolling into an inner scroller

When the root doesn't scroll and focus is on `<body>` (after a fresh load, or after SvelteKit resets focus on navigation), Chromium's Page Down, Space and arrow keys scroll nothing. Chromium only scrolls the scroller that holds focus or got the last click.

Don't reimplement scrolling. Forward the key instead. On a window `keydown`:

- whose target is `<body>`,
- whose key scrolls (Space, Page Up/Down, arrows up/down, Home, End; Shift allowed; not with Ctrl, Alt or Meta; not already handled),

focus the scroller (`tabindex="-1"`, `{ preventScroll: true, focusVisible: false }`). Chromium then applies that same event's default scroll to it, with the native amounts and smoothing.

Do *not* forward Tab, or focus would skip the header. `tabindex="-1"` is needed because a scroller that contains links isn't focusable by default. I only tested Chromium. In other browsers the first press may only focus the scroller.

## Handing focus to the page when chrome hides

Say a click on the content hides the toolbars, and hidden toolbars are `inert`. A toolbar button that had focus loses it, and the browser drops focus to `<body>`. From there, arrow keys don't work on the content anymore, and a screen reader loses its place.

So blur the control and focus the main surface with `{ preventScroll: true, focusVisible: false }`. That gives no scroll jump and no focus ring after a pointer click.

- A frame that doesn't scroll gets `tabindex="-1"` (focusable by script, not in the tab order).
- A scroller gets *no* tabindex. Chromium (since 132) and Firefox already make a scroller focusable and tabbable when it has no focusable content. `-1` would remove that tab stop, and `0` warns in Svelte. Safari doesn't do this. And a scroller that holds links isn't focusable in any of them, which is the case above that needs `tabindex="-1"`.

One limit: on touch, the mousedown a browser synthesizes after a tap blurs a scroller that has no tabindex. So after a tap in it, focus is on `<body>`.

More on focus timing around `inert` and modals is in [focus around modal dialogs](/html/dialog-focus/).

## Restoring an inner scroller's position

In Dokseo, my manga and book reader, the library is a list of books inside the scroller, and opening a book goes to the book's own route. Coming back to the library should return to where the list was, not to the top.

When an inner area scrolls instead of the window, SvelteKit's own scroll restoration doesn't help anymore. A page can export a `snapshot` that captures the scroller's `scrollTop` and restores it. (The snapshot is taken before the old page is removed, so reading it there is safe.) But SvelteKit *only* restores a snapshot on Back/Forward and reload, never on a link.

A "back to the list" link, like Dokseo's link to the library, is a new navigation. So I also keep a per-tab memory that restores the position when an `afterNavigate` of type `link` comes from the detail route (the book's route). Any other arrival starts at the top. (How `afterNavigate` behaves on reused routes is in [SvelteKit navigation](/svelte/sveltekit-navigation/).)

If the list only fills in after an async load, the offset is held in the view model, and an `$effect` applies it once the list has rendered (a pure step function: wait / scroll / none).

## `scrollbar-gutter: stable` stops a measurement oscillating

Some layouts size their content from the width they have, for example a grid that picks its column count from the container's width. A container that measures its content width from its own `clientWidth` can flip back and forth. The content grows, a scrollbar appears, `clientWidth` shrinks, the content shrinks, the scrollbar goes away, and around again. Reserving the gutter makes the measurement constant.

## A scroll lock can reflow the page

While a modal is open, the page behind it shouldn't scroll, so the page gets locked. Setting `overflow: hidden` on `html` while a modal is open removes a classic scrollbar (one that takes up space). So the page gets wider (by 15px on macOS with "always show scrollbars"), and an `auto-fill` grid can gain a column.

Have the modal record whether the page showed a scrollbar just before `showModal()`, and keep `scrollbar-gutter: stable` with a rule like:

```css
html:has(.modal-backdrop[open][data-page-scrollbar]) {
  scrollbar-gutter: stable;
}
```

Headless Chromium hides scrollbars, so no browser test can reproduce this. Whether the modal is a native `<dialog>` also determines whether closing it can trip Svelte's `state_unsafe_mutation`; see [Svelte 5 rendering gotchas](/svelte/rendering-gotchas/).
