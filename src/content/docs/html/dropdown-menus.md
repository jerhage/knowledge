---
title: "Dropdown Menus: Placement and Dismissal"
description: "Placing a top-layer menu from its trigger's rect, and wiring open and close in handlers rather than effects."
tags: [html, popover, svelte-5, i18n]
sidebar:
  order: 3
---

A dropdown menu is a list of actions that opens from a trigger button. I open mine in the [top layer](/html/top-layer/), where nothing on the page can clip it or paint over it. The price is that the browser no longer positions it relative to the trigger, so I have to position it myself. The attribute's states and events are on [the Popover API](/html/popover-api/).

## Placing a popover menu next to its trigger

An element in the top layer has no positioned ancestor, so CSS offsets can't place it next to its trigger. Instead, the component reads the trigger's position with `getBoundingClientRect()` and computes where the menu goes. It passes in only values it computes at runtime: custom properties such as `--menu-top`/`--menu-left`, plus an anchor width and a max width. Every kind of overlay (a menu, a small sheet) needs the same calculation, so have them all share *one* pure placement function that only sets `top` and `left`.

The placement function works like this:

- **Horizontally:** convert the rect to distances from the inline-start edge (mirrored for `rtl`), so one rule works in both directions. Align to the trigger's start (or its end, if the caller passes that option). If that crosses an edge margin and the opposite alignment fits inside both margins, switch to it. Then clamp into `[edge, viewport − edge]`. The clamp alone sets where it goes when neither alignment fits. An overlay wider than that gets capped at `viewport − 2 × edge` and pinned to the edge. Convert the result back to a physical `left`, and the stylesheet doesn't need any `:dir(rtl)` inset rules.
- **Vertically:** put it one gap below the trigger. Put it above instead when the overlay plus gap plus edge doesn't fit below and there's more room above. Then clamp into `[edge, viewport − edge]`.
- **Viewport:** use `document.documentElement.clientWidth/clientHeight`. `innerWidth/innerHeight` include a classic scrollbar (one that takes up layout space), so an overlay clamped to them can end up under it.
- **Gap and edge come from tokens**, read from the overlay's computed style as pixels: see [a registered custom property reads back in pixels](/css/tokens-at-runtime/#a-registered-custom-property-reads-back-in-pixels).
- **Measure after showing:** call `showPopover()` first, then read `offsetWidth`/`offsetHeight`, because a hidden menu has no size to measure. The menu needs `inline-size: max-content`. Otherwise the UA's `fit-content` makes the measured width depend on where the menu was last opened.
- **Place it again when things move.** While it's open, place it again on `scroll` (in the capture phase, so nested scrollers count) and on `resize`, because the trigger's rect is out of date as soon as either happens. Remove both listeners on close.

## A handler-driven overlay: a guarded global handler, and an attachment as the destroy hook

A dropdown or popover can do its open and close work in two places. One is an effect that watches an `open` flag and reacts when it changes. The other is the event handlers themselves: the click that opens the menu also shows it, and the handler that closes it also hides it. I moved mine to handlers. The effect had been covering a few jobs I hadn't noticed, jobs that the handlers don't do, and each one needs its own replacement:

- **A global listener that only matters while open.** Closing on a click outside needs a listener on the whole document. Put it in the markup, `<svelte:document onpointerdown={outside} />`, and have it return early while closed. It stays registered for the component's whole life. That costs one cheap check per event, and Svelte removes it on destroy.
- **Cleanup when the component is destroyed while open.** If the component goes away with the menu still showing, nothing calls the close handler. Use an attachment with no reactive reads, placed as `{@attach release}` on the overlay element:

  ```ts
  const release: Attachment = () => conceal;
  ```

  It runs once on mount, and the function it returns runs on unmount. Keep it a stable function that reads no `$state`. Otherwise it runs again every time that state changes (see [attachments and listeners](/svelte/attachments-and-listeners/)).
- **A `$bindable` prop can't be intercepted when the parent writes it.** There's no setter, so an effect would be the only way to react when the parent changes `open`. If no caller needs to set `open`, make it `$state` the component owns instead of a prop, and the last effect goes away with it.
- **Changes the browser makes on its own.** A `popover="auto"` element can close without any of my handlers running: the browser closes it on light dismiss and on Escape. It reports every open and close through its `toggle` event, including those. So `ontoggle` with `event.newState` is the callback that keeps track of it.

One case slips past all of these. A `document` listener for outside clicks never receives a click inside an iframe, so someone who clicks into an iframe under an open menu leaves the menu open. A menu that sits over an iframe also needs to close on `window` `blur`: see [iframes](/html/iframes/#a-click-inside-an-iframe-never-reaches-the-host-document-the-window-blurs-instead).
