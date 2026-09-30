---
title: "Keyboard Shortcuts: Modifiers, Case and IME"
description: Which keys a focused button owns, reading shift from its flag, and skipping an IME's confirming Enter.
tags: [keyboard, i18n, safari, accessibility]
sidebar:
  order: 4
---

## `space` activates a focused button; arrows do not

In my reader, the arrow keys turn pages. The page also has on-screen buttons that turn pages, including a next-page button. One key handler on the window reads the keys.

Some elements already do something with certain keys, and the handler has to leave those presses alone. So before it acts on a key, it checks whether the element that has focus handles this key on its own.

For space, a focused button does. Pressing space on a focused button activates it, because that's standard browser behavior. If the handler also acted on that press, one press would do two things. So when a button has focus, the handler skips space.

For the arrow keys, it doesn't. Browsers give arrow keys no meaning on a button, so a focused button ignores them. If the handler skips buttons for the arrows too, nothing handles the press at all. Someone clicks the next-page button, the button keeps focus, and from then on the arrow keys stop turning pages.

So the "does this element handle its own keys" test has a different result for each key. A check that skips buttons for space must *not* skip them for arrows.

When the page itself doesn't scroll, keys also have to be forwarded to the scroller. See [keyboard scrolling into an inner scroller](/scrolling/inner-scrollers/).

## `event.key` does not show that shift is held, and a shortcut that reads shift from it will misfire

Say ⌘K does one thing and ⌘⇧K does another. A handler written as `if (event.key === 'k' && event.metaKey)` looks like it can't match the shifted chord at all, because the browser is supposed to report `'K'` while shift is held. That reasoning is wrong.

The same physical chord reaches `keydown` as `'k'` on one browser and platform combination and as `'K'` on another. It depends on how the engine applies shift to `key` while a command modifier is down. macOS is the one that catches people out: someone presses ⌘⇧K, it arrives as lowercase `'k'`, matches the unshifted branch, and runs the wrong action.

What I measured: against a handler testing `event.key === 'k'`, a chord reported as `'K'` did nothing at all, and the same chord reported as `'k'` ran the unshifted action. That's two different failures from one binding.

So you can't use the letter's *case* as evidence of shift. It's unreliable, and engines differ. The event reports shift separately: `event.shiftKey` is a boolean flag, while the case of `event.key` is a derived presentation detail.

The rule: match the letter case-insensitively, and read the modifier from its own flag.

```ts
if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
  const scope = event.shiftKey ? 'all' : 'current';
  // …
}
```

This goes for every shifted-letter shortcut.

## An IME's confirming Enter reaches keydown

An IME (input method editor) is what you type Japanese, Chinese or Korean through. When you press Enter to confirm a conversion, that Enter still fires `keydown` with `key === 'Enter'` on the field.

That matters for any field whose key handler acts on Enter, Escape or the arrows. Someone types Japanese into the field, presses Enter to confirm the text, and the handler treats that Enter as a command and runs it. So the handler has to detect the confirming Enter and skip it.

Browsers mark that press differently. Chromium and Firefox set `event.isComposing` on it. Safari doesn't. It fires `compositionend` first, then the keydown with `isComposing` false and `keyCode` 229, the "IME process" code. So check both, in one shared helper:

```ts
function isComposingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
```

Every key handler on a text field has to call it. Put it in the handler's pure classifier if there is one, otherwise make it the first thing in the handler.

- A copied event (one [relayed out of an iframe](/html/iframes/)) has to include both `isComposing` and `keyCode`, or the Safari case gets lost on the way.
- Escape during a conversion cancels the conversion. A handler that also closes something on Escape will close it too.
- A form's implicit submission is safe. It rides on `keypress`, and no composing key fires that.
- To reproduce this in Playwright, dispatch a synthetic `new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })` (or `keyCode: 229`) on the field. There's no real IME there.

A related case is a search field in a modal that keeps its query between opens, like the one in my reader's ⌘K palette. When the modal reopens and focuses the field, WebKit can put the caret at the start of the old text, so what someone types next goes in front of it (see [WebKit putting the caret at the start of a refocused field](/html/forms-and-labels/)). Calling the field's `select()` after the modal has shown and focused it is how the kept query survives that refocus. With the whole value selected, typing replaces it and an arrow key keeps it, whatever the engine did with the caret.
