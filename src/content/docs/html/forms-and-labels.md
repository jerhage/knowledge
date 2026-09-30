---
title: "Form Controls: File Inputs, Labels and Search Fields"
description: "Live `FileList`s, dropped folders, labels with two inputs, accessible names from content, and search-field quirks."
tags: [html, files, accessibility, safari, mobile]
sidebar:
  order: 5
---

These are gotchas in native form controls: getting files in through a file input or a drop, naming buttons and inputs, and search fields. What I do with the files once I have them is on [large files](/files/large-files/).

## `input.files` is live, and clearing the value empties it

Say a change handler on a file input keeps a reference to the chosen files, then resets the input by setting its value to an empty string, and only then works through the files. The list it kept is empty by then:

```ts
const chosen = input.files;   // a live FileList
input.value = '';             // clears the input AND this list
chosen.length;                // 0
```

What someone sees: they choose a file, and nothing happens at all. There's no error anywhere, because the code ran correctly over a list with nothing in it.

That's what happens in Chromium and WebKit, which clear the same `FileList` object in place. Firefox returns a new list and leaves the old one unchanged. The spec only says the same object comes back until the selection changes, so it allows both. Copy the files out into your own array before you clear the value. That's the right move in every engine.

## Dropping a folder gives you a directory entry, not its contents

A drop zone that accepts files can also receive a folder, if someone drags one in. For a dropped folder, `dataTransfer.files` holds one zero-byte entry that stands for the folder, not the files inside it. Walking `webkitGetAsEntry()` is the cross-browser way to get at those files (Chromium also has `getAsFileSystemHandle()`). A file you find that way has an empty `webkitRelativePath` unless you set one yourself.

## The `accept` attribute does not apply to a drop

The `accept` attribute on a file input lists the file types it takes, but it only filters what the file picker offers. A file dropped onto the same zone skips the picker, so a dropped `.rar` still reaches your code. Check the type yourself on a drop.

## A second file input inside a `label` is not the label's control

Say a drop zone is a `label` wrapped around a file input, so clicking anywhere on the zone opens the file picker. Say I also want a folder picker in the same zone, so I put a second hidden input for it after the file input inside the same label.

A `label` names its first labelable descendant, and only that one. So clicking the label always opens the file picker and never activates the folder picker. And because the folder input is `aria-hidden`, it adds nothing to the name the file input gets from the label's text.

The folder picker has to be opened from script instead, from a separate control. Calling `click()` on it does open the folder chooser. That click bubbles up to the label, but a click whose target is interactive content doesn't trigger the label's activation again, so the file picker doesn't open as well.

## A glyph in a button named by its content is part of the name

Say an icon button shows a text glyph (`i`, `+`, `読`) and is named with `aria-label`. A button with `aria-label` ignores its content when computing its name, so the glyph never reaches a screen reader, which is what I want.

Now switch the button to take its name from its content, with the words in a `.visually-hidden` text node. Then every text node inside the button counts, including the glyph. For an info button, a bare `i` makes the name "i About the server".

Wrap the glyph in `<span aria-hidden="true">`. An icon component that's already `aria-hidden` doesn't need anything; only text glyphs do. The span becomes a flex item where the bare text used to be an anonymous one, but the box and the pixels come out the same.

## A drawn clear button and the native search cancel button

`<input type="search">` gets a native clear button (✕) from `::-webkit-search-cancel-button` in Chromium (desktop and Android) and in desktop Safari. iOS Safari doesn't draw one. So a clear button I draw myself is only worth it on a coarse pointer (a primary pointer with limited accuracy, like a finger on a touchscreen), where iOS would otherwise have none. There, the native one has to be hidden (`display: none` on the pseudo-element), or Android shows two.

What makes the drawn button work:

- The base rule that hides my drawn button must come *before* the `@media (pointer: coarse)` block that shows it. Both selectors have the same specificity, so whichever comes later wins everywhere.
- Prevent `mousedown` on the button. Otherwise a tap on it moves focus off the field, and the iOS keyboard closes.

Other phone-only control fixes (the 16 px focus zoom, touch targets) are on [phones](/html/touch-devices/).

## Escape in a search input clears it before it closes the dialog

Pressing Escape in a modal `dialog` normally fires the dialog's cancel and closes it. But when an `input type="search"` has focus and text in it, the first Escape clears the text instead, and the `dialog`'s cancel doesn't fire.

This bites browser probes. A probe types into a modal's search field and presses Escape once to close the modal, but the modal stays open. The rest of the page is still inert, so the probe's next click times out with an error that says nothing about the dialog. Have the probe keep pressing Escape until `dialog[open]` is gone. (Other modal focus gotchas: [dialog focus](/html/dialog-focus/).)

## WebKit puts the caret at the start of a refocused field

Say a search field keeps its text between opens, and a probe reopens it and types more. In Playwright WebKit, focusing a text input that already had a value put the caret at position 0, so typing went in front of the old text (`Man` + `ga` read `gaMan`). Chromium put it at the end.

So a probe that types after reopening has to set the selection first, or it ends up testing a different query than the one I wrote it for. Typing through an IME has its own gotcha, an Enter that confirms the composition and still reaches `keydown`: see [keyboard shortcuts](/interaction/keyboard/).
