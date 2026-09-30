---
title: "Dialogs, Popovers and the Top Layer"
description: "Using `showModal()` and `popover` to escape clipping and z-index, their UA-style costs, and ordering toasts above a modal."
tags: [html, dialog, popover, css, accessibility, svelte-5]
sidebar:
  order: 1
---

An overlay is anything drawn on top of the page: a modal, a menu, a sheet, a toast. I open every overlay in the top layer, a layer the browser draws above the whole page. The details of the popover attribute itself are on [the Popover API](/html/popover-api/). Placing a menu is on [dropdown menus](/html/dropdown-menus/), and focus around a modal is on [dialog focus](/html/dialog-focus/).

## An ancestor clips an absolutely positioned child; the top layer escapes it

Say a card has a button that opens a dropdown menu, and the menu is an absolutely positioned child inside the card. An element positioned inside a subtree gets clipped by *any* ancestor that sets up clipping: `overflow: hidden` or `auto`, a `clip-path`, `contain: paint`. So if the card (or anything around it) clips, the part of the menu that hangs outside the card is cut off. (Which ancestors count depends on the [containing block](/css/containing-block/). The cases where a box escapes by accident are on [overflow and stacking](/css/overflow-and-stacking/).)

The obvious fixes don't work:

- `z-index` only changes paint order. It can't lift a box out of a clip.
- Removing the ancestor's `overflow` breaks whatever it was clipping on purpose.

The way out is the top layer. There, the containing block is the viewport, and no ancestor's overflow, flex sizing or `z-index` can reach the element. A `<dialog>` opened with `showModal()` gets there, and so does an element with the `popover` attribute.

## `<dialog>` with `showModal()` is free accessibility

`showModal()` gives you focus handling, Escape, an inert background, a backdrop and the top layer, and you don't need any `z-index`. A hand-rolled overlay has to rebuild all of that, and usually does it badly.

Closing on a backdrop click needs one check. A click whose `target` is the dialog element itself is a backdrop click, as long as the dialog's content covers its whole box. The condition is there because a click on the dialog's own padding also targets the dialog, so padding that the content doesn't cover would count as backdrop.

A modal in the top layer also lets a dialog live inside a deeply nested panel instead of being moved up to the route. The component that owns the state also owns the dialog, and no ancestor needs a reference to it. A closed `<dialog>` is `display: none`, so it doesn't take up any flex space in that panel either.

## `popover` for a non-modal sheet

A non-modal sheet is a small panel that opens from a trigger while the rest of the page stays usable. The `popover` attribute, with `popovertarget` on the trigger, gives you the top layer, light dismiss (closing on a click outside), Escape, focus going back to the trigger, and an implicit `aria-expanded` on the trigger. A hand-rolled `open` flag plus a window `pointerdown` listener plus a `focusout` handler has to rebuild all of those, and does it badly.

It doesn't position anything, though. CSS anchor positioning is the clean answer, but it only reached all three engines recently (Chromium 125, Safari 26, Firefox 147). So a shared placement helper places the sheet from the trigger's `getBoundingClientRect()` on the `toggle` event. It flips the sheet above the trigger when there isn't room below, and clamps it inside the viewport's edge margin. It places it again on scroll (in the capture phase, so scrolling in an inner scroller reaches it) and on resize, because coordinates read once are out of date as soon as anything moves. The full placement function is on [dropdown menus](/html/dropdown-menus/#placing-a-popover-menu-next-to-its-trigger).

## The popover's UA styles catch everyone once

The UA stylesheet (the browser's default styles) gives every popover a few rules, and each of them surprised me once:

- The UA stylesheet hides a closed popover with `display: none`. An author rule that sets `display` on the sheet *wins*, and then the popover never hides: someone closes it and it stays on screen. So put the layout display, the open styles and any animation under `:popover-open`.
- The UA gives popovers `inset: 0; margin: auto; border; padding; color: CanvasText` to center them. A sheet I position myself needs `inset: auto; margin: 0`, plus `color: inherit` to keep `CanvasText` from leaking in. In practice every popover resets `inset`, `margin` and `color`.
- A top-layer element ignored its container's color-scheme pin until I put the pin on the element itself. I haven't confirmed why. By the spec, the top layer only changes where the box is generated, and a top-layer element still inherits from its DOM parent. Pinning it on the element works either way.

## Overlays live in the top layer, not on the z-index scale

The rule that comes out of all this: open every overlay in the browser's top layer.

- a modal or command palette as `<dialog>` + `showModal()`;
- a dropdown menu, a window drop overlay or a small sheet as `popover="manual"` + `showPopover()`.

The top layer sits above every stacking context. No `z-index`, `overflow: hidden` ancestor or sticky header can cover it or clip it. That rules out bugs like these: a card with `overflow: hidden` clipping an absolute dropdown menu, a palette with a low z sitting under a sticky header, and a fixed overlay losing to a shadowing token (see [unlayered tokens can shadow layered tokens](/design-systems/in-practice/#unlayered-tokens-can-shadow-layered-tokens)).

Keep the `--z-*` scale ([z-index scale](/design-systems/semantic-tokens/#z-index-scale)) for in-flow layers only: a sticky header, a floating bar over the page, a marquee.

## A toast above a modal must live inside the modal

Toasts are short messages that show up over the page, and they're overlays too, so they go in the top layer. The trouble starts when a toast has to appear while a modal dialog is open.

Top-layer order is the order things were shown in. So a popover shown after `showModal()` *paints* above the dialog. But it's still inert, because an open modal dialog makes every node outside itself inert, top layer or not. A hit test goes straight through it to the dialog (`elementFromPoint` returns the `<dialog>`), a click never lands on it, and the node drops out of the accessibility tree (its `aria-live` goes quiet). Someone with a modal open sees the toast but can't click it, and a screen reader never announces it.

The fix is to render the toasts from *inside* the topmost open dialog, which isn't inert. The modal component renders a toast region while it's open. The toaster (the code that holds the toasts) keeps a stack of attached regions, and only the last one renders toasts. Opening a modal moves the toasts into it, and closing it moves them back. (Regions targeted by placement are described in the [component contract](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline).)

- Each region is `popover="manual"` and stays open while it's the active region, even when it's empty. That way its live region already exists before any content arrives.
- To stay above popovers opened later (like a dropdown menu), the active region listens for `toggle` in the capture phase on `document` (`<svelte:document ontogglecapture>`, since toggle doesn't bubble). When another element enters the top layer, the region calls `hidePopover()` then `showPopover()`, which puts it back on top. Both are synchronous, so nothing renders in between, and a manual popover doesn't close an open auto popover.
- The toaster's mutators read their own state under `untrack`. A region attaches itself from an `{@attach}`, which runs in an effect, and an effect that reads and writes the same `$state` loops (`effect_update_depth_exceeded`). More on when attachments run again in [attachments and listeners](/svelte/attachments-and-listeners/).

Rendering toasts from their own regions also means a region is a sibling of every screen, so a custom property set on a screen's root never reaches it. A screen with a bottom bar can't lift the toasts above it that way. Let a screen reserve space with a small component (say `<ToastClearance blockEnd={px} />`) that sets how far the toaster lifts the toasts, for example a bottom bar's height plus whatever panel sits below the content.

## A bare `popover` beside a spread renders `popover="true"`

In Svelte, it matters whether the element with `popover` also has a spread. On an element without a spread, Svelte writes a valueless `popover` as `popover=""`. On one with `{...rest}`, attributes go through the runtime attribute setter, and it writes `popover="true"`. `"true"` isn't a keyword, and for an invalid value the attribute falls back to the *manual* state. The sheet still opens from its `popovertarget`, but when someone presses Escape or clicks outside, it stays open.

Write `popover="auto"`. In a probe, check `:popover-open` after pressing Escape. A screenshot of the open sheet wouldn't catch this, because the sheet looks the same whichever state it's in.
