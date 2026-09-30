---
title: "Same-Origin Iframes: Events, Coordinates and Realms"
description: "What does not cross an iframe boundary (events, `instanceof`), mapping frame coordinates to the host, and relaying keys out."
tags: [html, iframes, keyboard, foliate-js]
sidebar:
  order: 7
---

My case is an ebook renderer (foliate-js) that shows each chapter in a same-origin iframe loaded from a `blob:` URL. The page around those frames (I'll call it the host) has its own menus, shortcuts and click handling, and some of what the host relies on doesn't make it across the frame boundary on its own. Getting styles into those frames is on [foliate-js chapters](/ebooks/foliate-chapters/). What the frames inherit from the page's CSP is on [CSP for blob documents and workers](/security/csp-blobs-and-workers/).

## A click inside an iframe never reaches the host document; the window blurs instead

A menu usually closes when someone clicks outside it. The usual way to detect that click is an outside-click rule written as `document.addEventListener('pointerdown', ...)` on the host.

A pointer event inside an iframe goes to the iframe's own document and bubbles up to the iframe's own window. It never reaches the parent `document`, so that rule doesn't fire. Neither does a `popover="auto"` light dismiss, because that also only applies to its own document. In Dokseo, my manga and book reader, someone opens a [dropdown](/html/dropdown-menus/), clicks into the chapter to get back to reading, and the dropdown stays open on top of the text.

What the host does receive: the click moves focus into the frame, and the top `window` fires `blur`. `blur` on `window` only fires when the document as a whole loses focus (to a child frame, another window, or the browser UI). It never fires when focus moves between elements inside the page. That makes it a safe second signal for closing.

`focusout` on the overlay looks like another candidate, but it isn't enough. When focus leaves for a frame, its `relatedTarget` is `null`, so the rule has no way to read where focus went. And if focus was on the trigger rather than inside the menu, the overlay's `focusout` rule never even runs. So while a dropdown or popover is open, close it on `window` `blur`.

## A keydown in a chapter frame never leaves it, and a re-dispatched copy lands on the host's own target

The host has global keyboard shortcuts, bound with `<svelte:window onkeydown>`. An event dispatched inside an iframe doesn't cross into the parent document, so that handler never receives pointer or key events from a foliate chapter. Once someone clicks into a chapter, focus is in the frame, and every shortcut bound only on the host window stops working. So bind `keydown` on every chapter document as it loads.

To get the key back out to the host, the chapter's handler dispatches a copy of the event on the host. About the copy:

- **Its `target` is whatever you dispatch it on**, not the element someone typed in. Dispatch it on `window` and `event.target` is the window. Any host code that checks the target ("is someone typing in a field", "does this element handle its own keys") then tests the press against the host page, not the chapter. Write the rule so the host's target-sensitive code gives the same answer for a relayed key no matter what target it gets, and lock that down with a test. (A key from a field with an IME composition in progress isn't a shortcut either: see [keyboard shortcuts](/interaction/keyboard/).)
- **`dispatchEvent` returns false when a listener canceled it**, but only if the copy was created with `cancelable: true`. The host's shortcut handler calls `preventDefault()` on the copy, not on the original key press, and that return value is the only way to pass it back to the original. That's what stops the browser from also running its own ⌘K.
- **`instanceof` is useless as a marker across the boundary.** The relay needs a way to identify the copies it sent. `isTrusted === false` marks every synthetic event, not just the ones you made, so a test harness that dispatches keys would switch the relay off without any error. Use a module-level `WeakSet` of the copies you sent. It checks identity, works across realms, and doesn't keep anything in memory after an event is garbage collected.

The chapter frame can also have its own key handler, and the relay has to detect whether that handler already handled the key. `defaultPrevented` is already set to mean "somebody has handled this". On a single target, listeners fire in the order they were added. So a relay registered after the frame's own handler reads `defaultPrevented` after that handler has run, and doesn't need any second channel.

## A chapter frame's `innerWidth` is the whole columnized section, and `frameElement.getBoundingClientRect()` is the only bridge back to the screen

Sometimes the host needs to know where on the screen something in a chapter happened, for example where a click landed. The frame reports positions in its own coordinates, and the question is how to turn those into host coordinates. With foliate, that's harder than it looks, because of how it paginates.

foliate paginates by making the chapter iframe *as wide as the whole section*, then scrolling a one-screen slice of it into view. `View.expand` (`paginator.js`) sets `iframe.style.width = pageCount * size` and the wrapper to `expandedSize + size * 2`. `#container` has `overflow: hidden` and gets scrolled by `scrollLeft`. So inside a chapter:

- `defaultView.innerWidth` is the section's width, not the page's. I measured it with a real mouse. In a 414 px viewport, a two-chapter probe book reported **8471 px**, and 3571 px at 1280 px. There's no constant ratio. It's `Math.ceil(contentSize / size) * size`.
- `event.clientX` is relative to that same frame viewport. So it goes past the screen width and keeps growing as the reader turns pages.
- Nothing foliate exposes maps a point in the frame back to the host. `renderer.size`, `viewSize`, `start`, `page` and `pages` are all about the *scroll* axis. `#getRectMapper` maps a rect into coordinates relative to the page, not to the viewport.

The bridge is the iframe element itself. `doc.defaultView.frameElement` is reachable because the frame is same-origin (`sandbox="allow-same-origin allow-scripts"` over a blob URL the host created). The element it returns belongs to the *host* realm, so there's no `instanceof` and no cast involved. Its `getBoundingClientRect().left` is where the frame's viewport starts, in host coordinates, and

```ts
hostX = event.clientX + frameElement.getBoundingClientRect().left
```

holds exactly. I checked it against real mouse clicks at 10 %, 50 % and 90 % of the stage: `26 + 15`, `192 + 15`, `358 + 15` on the first page, and `796 - 755`, `962 - 755`, `1128 - 755` two pages in, where the rect's left has gone negative. Read the rect when the event happens, because it moves with every page turn.

Gotchas if you measure this again:

- A **vertically set book hides the bug**. Its columns run down the page, so the frame is tall instead of wide, and `innerWidth` is within a few pixels of the visible width. Test with a horizontal book.
- In the Vitest browser project, the test page is an iframe of its own, about 414x896. If the stage is bigger than that, `userEvent.click(host, { position })` lands outside the real page, and the click hits nothing at all without any error. Size the stage from `window.innerWidth`.

## `role` is a reflected IDL property, so `'role' in target` reads it across a realm

Host code that classifies an event's target ("does this element handle its own keys") can receive an element from a chapter frame. An element from an iframe has its own realm (its own global object and its own copies of the built-in constructors), so it fails `instanceof HTMLElement` against the host page's constructor. The check needs something that doesn't depend on the host's constructors.

ARIA reflection gives every element a `role` property that mirrors the `role` content attribute. It's a string when the attribute is there, and `null` when it isn't. Safari has had it since 12.1, Chromium since 103, and Gecko since Firefox 119 (2023), so every engine has had it since 2023.

That gives two results.

**A raw `EventTarget` exposes its role with no cast and no `instanceof`.**

```ts
function controlRole(target: EventTarget): string | null {
  if (!('role' in target)) return null;

  const named = target.role;
  return typeof named === 'string' ? named : null;
}
```

`in` walks the object's own prototype chain (`role` is an accessor on that realm's `Element.prototype`). It never touches the host page's constructors, so it gives the right answer for an element from an iframe. `getAttribute` would work too, but narrowing with `in` leaves it typed `unknown`, and calling an `unknown` needs a type assertion.

**It's the attribute, never the implicit role.** `<button>.role` is `null`, not `'button'`, because a `<button>` gets its role from the tag, not from an attribute. So a rule about buttons has to check the tag name *and* the role. A rule that only read the role would miss every real `<button>` on the page.
