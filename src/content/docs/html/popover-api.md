---
title: The Popover API
description: The popover states and what an invalid value falls back to, the trigger attributes and methods, the toggle events, light dismiss, and the UA styles every popover starts with.
tags: [html, popover, accessibility, css]
sidebar:
  order: 2
---

`popover` is a global attribute, meaning any element can have it. It hides the element until something shows it (a trigger button or a script call). Then it puts the element in the top layer, above every stacking context and outside every `overflow` clip. Popovers are never modal. For a modal, use a `<dialog>` with `showModal()`. How I use the top layer for overlays in general is in [the top layer](/html/top-layer/), and the menu pattern I built on this is in [dropdown menus](/html/dropdown-menus/).

## The three states, and what a bad value means

```html
<div popover>…</div>            <!-- auto -->
<div popover="auto">…</div>
<div popover="manual">…</div>
<div popover="hint">…</div>
```

| State | Closes other popovers when shown | Light dismiss and Escape |
| --- | --- | --- |
| `auto` | other `auto` popovers that aren't its ancestors, and every open `hint` popover | yes |
| `hint` | other `hint` popovers that aren't its ancestors, never `auto` ones | yes |
| `manual` | nothing | no |

The state comes from the attribute's value, and the HTML spec defines what each kind of value means:

- **missing**: no popover at all
- **empty** (`popover` or `popover=""`): `auto`
- **invalid** (anything else, like `popover="true"`): `manual`

The invalid case is the gotcha. Say a framework writes a valueless attribute as `popover="true"`. Someone opens the popover from its trigger, which still works, then presses Escape or clicks outside, and it stays open, because it's now `manual`. No error or warning appears. Svelte does this when the element also has a spread: see [the top layer](/html/top-layer/). Writing `popover="auto"` avoids it. The `popover` IDL property only reflects known values, so `el.popover` reads `"manual"` in that case. That's a quick way to check.

The table's "closes other popovers" column works through two stacks: the open `auto` popovers form one, and the open `hint` popovers form another. `manual` popovers aren't part of either stack. They only show and hide when I tell them to, and several can be open at once. If I show an `auto` popover inside a `hint` popover, it gets downgraded to `hint`.

## Triggers: `popovertarget` and `popovertargetaction`

```html
<button popovertarget="menu">Menu</button>
<div id="menu" popover>…</div>

<button popovertarget="menu" popovertargetaction="show">Open</button>
<button popovertarget="menu" popovertargetaction="hide">Close</button>
```

A trigger is a button that opens the popover without any script. `popovertarget` goes on a `<button>` or an `<input type="button">`, set to the popover's id. The popover has to be in the same tree. Inside a `<form>`, the button has to be `type="button"`, because the spec ignores `popovertarget` on a submit button that has a form owner, and a `<button>` is a submit button by default. So my base `Button` component defaults to `type="button"`, and my base `Popover` component puts `type: 'button'` in the props it passes to its trigger, which makes even a plain `<button {...popover}>` safe inside a form. `popovertargetaction` is `toggle`, `show` or `hide`. Missing and invalid both mean `toggle`.

According to MDN, a trigger set up this way also gets:

- **Focus order**: while the popover is shown, it comes right after the trigger in the Tab order. Closing it from the keyboard sends focus back to the trigger.
- **An implicit ARIA relationship**: `aria-expanded` on the trigger and an `aria-details` link to the popover, without me writing either one.
- **An implicit anchor**: the trigger becomes the popover's anchor for CSS anchor positioning.

The spec also recommends putting the popover right after its trigger in the DOM, so assistive technology reads things in a sensible order.

The newer `command`/`commandfor` attributes set up a trigger too, and do the same thing with `command="show-popover"`, `"hide-popover"` or `"toggle-popover"`. MDN lists them in Chrome 135, Firefox 144 and Safari 26.2.

## Methods

From script, three methods on the element show and hide it:

```js
menu.showPopover();
menu.hidePopover();
menu.togglePopover();           // returns true if now showing
menu.togglePopover(true);       // force: same as { force: true }
menu.showPopover({ source: trigger });
```

- Calling `showPopover()` on an open popover, or `hidePopover()` on a closed one, does nothing. It doesn't throw.
- They throw `NotSupportedError` on an element with no `popover` attribute, and `InvalidStateError` if the element is disconnected, is a modal `<dialog>`, or is fullscreen.
- Showing a popover while another one is in the middle of showing or hiding (from inside a `beforetoggle` handler, say) throws `InvalidStateError`. MDN says `hidePopover()` throws in that case too, but the spec's hide steps don't have that check.
- The `source` option sets up the focus-order link without a `popovertarget` button. MDN notes that it doesn't create the implicit ARIA relationship, though.

## `beforetoggle` and `toggle`

A popover fires two events around every change: `beforetoggle` before it and `toggle` after it. Both are `ToggleEvent`s with `oldState` and `newState` (`"open"` or `"closed"`).

```js
menu.addEventListener("beforetoggle", (e) => {
  if (e.newState === "open" && !allowed) e.preventDefault();
});
menu.addEventListener("toggle", (e) => {
  trigger.classList.toggle("is-active", e.newState === "open");
});
```

- **`beforetoggle`** fires synchronously, before the change. In the spec it's only cancelable when opening: `preventDefault()` can stop a popover from showing, but not from hiding. (MDN's guide says it can prevent either one. MDN's own `beforetoggle` page and the spec say opening only.)
- **`toggle`** fires afterwards, as a queued task. If several changes happen before that task runs, they get merged into one event, with `oldState` from the first change and `newState` from the last. So opening and then closing in one task can show up as a single `toggle` from `closed` to `closed`.
- `toggle` reports every change, including the browser's own light dismiss and Escape. That makes it the one place to keep outside state in sync.

`ToggleEvent.source` (the element that triggered the change) is newer. MDN lists it in Chrome 140, Firefox 145 and Safari 26.5.

## Light dismiss

Light dismiss is the browser closing a popover when someone interacts with something else. For `auto` and `hint` popovers, a click outside closes every open popover that isn't an ancestor of the clicked element. Escape (a close request) closes the topmost one. Nesting defines what "ancestor" means. In the spec, a popover is nested in another one if it's a DOM descendant of it, or if its trigger (`source`) is inside it. (MDN also lists an `anchor` attribute, which isn't in the HTML standard.) So a click inside a submenu leaves its parent menu open, because the menu is the submenu's ancestor. A click on the menu's own items closes the submenu, because the submenu isn't an ancestor of anything clicked.

Open `auto` and `hint` popovers also close when another element opens as a `<dialog>` (`show()` or `showModal()`) or goes fullscreen, unless they're its ancestors.

Light dismiss only applies to its own document. A click inside an iframe doesn't count as a click outside: see [iframes](/html/iframes/).

## `:popover-open` and the UA styles

`:popover-open` matches a popover while it's shown. The rendering section of the HTML spec gives every popover these UA (browser default) styles:

```css
[popover]:not(:popover-open):not(dialog[open]) {
  display: none;
}

[popover] {
  position: fixed;
  inset: 0;
  width: fit-content;
  height: fit-content;
  margin: auto;
  border: solid;
  padding: 0.25em;
  overflow: auto;
  color: CanvasText;
  background-color: Canvas;
}

:popover-open::backdrop {
  position: fixed;
  inset: 0;
  pointer-events: none !important;
  background-color: transparent;
}
```

What that means in practice:

- **An author `display` wins over the UA `display: none`.** `.sheet { display: flex; }` makes a closed popover visible. Put the layout's `display` under `:popover-open`.
- **It's centered by `inset: 0` and `margin: auto`.** To put a popover anywhere else, set `inset: auto; margin: 0` first, then its own position. MDN also points to `margin` and `inset` as the usual things that clash with anchor positioning.
- **`color: CanvasText` and `background-color: Canvas`** replace the inherited colors, so a themed popover has to reset them (`color: inherit` or my own tokens).
- **It's `position: fixed`**, so its containing block is the viewport, not the element it sits in: see [containing blocks](/css/containing-block/).
- **The backdrop ignores pointer events** and is transparent. Unlike with a modal `<dialog>`, clicks go through to the page.

## Browser support

MDN lists the Popover API (the attribute, the three methods, `:popover-open`, the toggle events on popovers, `popovertarget` and `popovertargetaction`) in Chrome 114, Firefox 125 and Safari 17. On iOS and iPadOS before 18.3, MDN marks it partial, because a tap outside didn't light-dismiss.

`popover="hint"` is recent. MDN lists full support in Chrome 151 and Firefox 153. Earlier versions (Chrome 133 to 150, Firefox 149 to 152) implement an older version of the spec, and Safari only has it in Technology Preview. An unknown value means `manual`, so in a browser that doesn't support it, `hint` gives you a popover that doesn't light-dismiss.

## References

- [MDN: Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)
- [MDN: Using the Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)
- [MDN: `popover` global attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover)
- [MDN: `beforetoggle` event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/beforetoggle_event)
- [HTML Standard: the `popover` attribute](https://html.spec.whatwg.org/multipage/popover.html)
- [HTML Standard: rendering, flow content](https://html.spec.whatwg.org/multipage/rendering.html#flow-content-3)
