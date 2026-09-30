---
title: "Focus Around Modal Dialogs"
description: "`inert` timing, WebKit's focus restore, Tab leaving a modal, and focusing a control on open without an effect."
tags: [html, dialog, focus, accessibility, safari, svelte-5]
sidebar:
  order: 4
---

A modal dialog opened with `showModal()` takes care of most of the focus work for me: it moves focus into the dialog, makes the rest of the page inert, and gives focus back when it closes (see [the top layer](/html/top-layer/)). It still leaves gaps. A native dialog also moves focus back before its `close` event fires, which matters when I write Svelte state around it (see [rendering gotchas](/svelte/rendering-gotchas/)).

## `inert` and `document.activeElement` are out of sync for a moment

Say a reading app has toolbars that hide when you click the page, and a hidden toolbar is made `inert`, so nothing in it can be clicked or focused. The toolbars shouldn't hide while someone is using one of them. So there's a rule that treats a bar as busy when it holds focus: `bar.contains(document.activeElement)`. If that check returns true, the bar stays visible.

The timing breaks that rule. When I make an ancestor `inert` while something inside it has focus, `document.activeElement` doesn't update in the same tick. The browser drops the focus and fires `focusout` a moment later. So right after the bar goes inert, the rule still finds focus inside it and treats the bar as busy. Someone clicks a toolbar button, then clicks the page to hide the bars, and the bar they just used comes straight back.

The fix is to read a property of the element instead of the focus. `bar.inert` is a plain boolean property that's already true at that moment. Skip an inert bar before the `contains` check, and the check can only be true for a bar someone can actually use.

## WebKit's dialog focus restore lands on `<body>` after a tap

When a modal dialog closes, `dialog.close()` gives focus back to whatever element had it when `showModal()` ran. That's normally the button that opened the dialog, because clicking a button focuses it.

WebKit (Safari on macOS and iOS) is different: it doesn't focus a `<button>` when you click or tap it. So when someone opens a dialog from a button in Safari, no button has focus at the moment `showModal()` runs, and closing the dialog gives focus back to `<body>`, not to the button. A keyboard user (or someone using VoiceOver on an iPhone) ends up at the top of the page after the dialog closes. Chromium does focus the button, so it gets this right.

The fix records the opener itself and restores it when the browser didn't:

1. Record the opener when the dialog opens: the focused element, or if there isn't one, the last `button`/`a` seen by a `pointerdown` listener on window in the capture phase.
2. On the dialog's `close` event, focus that opener if `document.activeElement` is still `<body>`.

This works because the `close` event is queued after the close steps run. By the time it fires, the native restore has already happened, so the check reads where focus really ended up and only moves focus when that's `<body>`.

## A native modal dialog does not keep Tab inside it

`showModal()` makes the rest of the page inert, so you might expect Tab to cycle through the dialog's controls and nothing else. It doesn't. When someone presses Tab on the dialog's last focusable element, focus leaves the document. In a normal browser it goes to the browser's own UI. In a test browser it goes to `body` (`document.activeElement === document.body`). The next Tab comes back to the dialog's first stop. The HTML spec allows this.

So if a dialog has to cycle, it handles Tab itself, but only at the two ends. Tab on the last stop goes to the first, and Shift+Tab on the first goes to the last. Every other step is left to the browser, so the order in between stays the browser's own.

Escape has its own gotcha when a search field in the dialog has focus: see [Escape in a search input](/html/forms-and-labels/#escape-in-a-search-input-clears-it-before-it-closes-the-dialog).

## Focus on open without an effect

When something opens (a dialog, an inline editor), one of its controls often needs focus straight away. I'd rather not do that with an effect that watches for the open state. I use one of three approaches, depending on what opens it.

- **Inside a modal component** that calls `showModal()` and then focuses the first `[autofocus]` descendant (before its close button): put `autofocus` on the control, and always render the modal's children so the control exists at that moment. Svelte also handles `autofocus` itself, by queuing a microtask that only focuses while `document.activeElement` is `body`. So here Svelte's handling does nothing, and the modal's own focusing is what puts focus on the control. A component that spreads `rest` onto its element passes the attribute through. svelte-check's `a11y_autofocus` warning doesn't fire on a component prop.
- **Mounted by something the person did outside a dialog**, with the trigger still focused (say, an inline editor that appears after clicking an Edit button): `autofocus` fails here, because Svelte's handling only focuses while `activeElement` is `body`, and the Edit button still has focus. Use an attachment that calls `node.focus()` instead. An attachment runs in an ordinary effect after the element is in the document, so the focus sticks.
- **A reveal that needs more than focus** (`scrollIntoView({ block: 'center' })`), when a known handler opens the dialog: export a method from the dialog and call it from that handler after `await tick()`. `tick()` resolves after the flush that ran `showModal()` and the modal's own focus, so the method runs last and its focus wins.

For the second approach, the attachment often has to reach an element inside a child component. An attachment on a component travels in its props under a symbol key, and it reaches the element through the child's `{...rest}` spread. The compiler writes it as a plain property that's created once, so even an inline arrow stays the same function and runs once:

```ts
[$.attachment()]: (node) => node.focus()
```

`attach` only runs again when it gets a different function, or when the function itself reads `$state` (more in [attachments and listeners](/svelte/attachments-and-listeners/)).
