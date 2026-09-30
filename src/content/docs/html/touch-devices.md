---
title: "Phones: Viewport Units, Focus Zoom and Touch Targets"
description: "iOS zoom on small inputs, full-screen dialogs with `dvh` and the keyboard, hover-only controls and opt-in touch targets."
tags: [html, css, mobile, safari, dialog]
sidebar:
  order: 6
---

These are the things that behave differently on a phone. Most of them don't reproduce in a desktop engine, and I test with browser probes (scripted checks in a test browser). So for each one I note what a probe can check and what needs a real phone.

## iOS Safari zooms on focus below 16 px

When a text `input`, `textarea` or `select` gets focus and its *computed* font size is under 16 px, iOS Safari zooms the visual viewport so the text reads at 16 px. It doesn't zoom back out on blur. It checks the control's own font size, not the page's. So someone taps a search field with 14 px text, the page zooms in, and after they're done typing they have to pinch back out themselves.

The fix is a font size of at least 16 px on the control whenever it can take focus on a phone. Set the control classes to `1rem` under `@media (pointer: coarse)`.

- Keep that in the components layer, not an overrides layer. An override would also shrink a control that a utility made *larger*, and you can't write a minimum as a plain declaration.
- Never fix it with `maximum-scale=1` or `user-scalable=no`. That also kills pinch zoom (iOS 10+ ignores it for pinch, but other engines apply it).

No desktop engine reproduces the zoom. Playwright WebKit with `isMobile: true` and `hasTouch: true` keeps `visualViewport.scale` at 1 on focus, even with 13 px controls. Chromium's mobile emulation doesn't zoom either. So a probe can only check the cause, which is the focused control's computed `font-size`. The zoom itself has to be confirmed on a real iPhone.

## A full-screen dialog on a phone: `dvh`, the keyboard, scroll-through

Say a modal dialog fills the whole screen on a phone, sized with viewport units, with a footer at the bottom. What goes wrong with it:

- **`100dvh` follows the browser toolbars, not the on-screen keyboard.** The keyboard only shrinks the visual viewport, so when someone focuses a field in a `100dvh` sheet, the keyboard covers its bottom (the footer). Lifting it needs `visualViewport` resize handling, and Safari has no `interactive-widget`. (Reading a `dvh` token in pixels: [tokens at runtime](/css/tokens-at-runtime/#a-dvh-token-in-pixels-comes-from-a-probe-not-getcomputedstyle).)
- **`showModal()` makes the page inert, but on iOS it doesn't stop a touch drag on the dialog from scrolling the page behind it.** The dialog is in the [top layer](/html/top-layer/), so its scroll chain goes to the root scroller, not to its DOM ancestors. `overscroll-behavior: contain` on the dialog's own scroller stops a scroll that hits its end from passing on to the next scroller. And an app shell whose document never scrolls gives the root nothing to scroll anyway.
- **`env(safe-area-inset-*)` is 0 unless the viewport meta has `viewport-fit=cover`.** Without it, Safari letterboxes the page into the safe area. Padding with `env()` anyway costs nothing and will be correct later.
- **Playwright can't drag a touch in WebKit** (`touchscreen` only taps). In Chromium, a CDP `Input.dispatchTouchEvent` sequence does a real touch drag. In WebKit the only option is a synthetic `touchmove` event. That checks that a listener is wired up, and proves nothing about scrolling. Prove a scroll-lock probe with a positive control: the same drag with the dialog closed has to scroll. More on driving touch in [browser probes](/testing/browser-probes/).

## `@media (hover: hover)` for a hover-revealed control

Say a control stays hidden until the pointer hovers over the area it belongs to. That breaks on touch, because touch has no hover: someone on a phone never sees the control at all. Put the hidden state behind the media query, so it only applies where hover exists. And reveal the control on `:focus-visible` too. Otherwise a keyboard user tabs to something invisible.

## Opt-in touch targets, and a heading that moves into the header

On a phone, buttons need to be big enough for a finger, 44px. But making every control that big also changes the layout of screens whose compact headers were designed around smaller controls. So make 44px touch targets *opt-in*: a `--control-h-touch` token (2.75rem), and a rule for narrow screens only that sizes every button inside a shell (a page's layout frame with its header) that has an opt-in class. Shells that don't opt in keep their compact controls (and their header layout) on phones.

A narrow screen also has little room for a page heading and summary above the content. They can stay in `main` for screen readers while being visually hidden. A one-line `aria-hidden` copy of the summary shows as a subtitle in the header instead (with the full text in `title`). Put it next to a button group sized to its content, so the subtitle gets the rest of the space (`min-w-0`).

Why I treat the 44 by 44 minimum as part of done, along with the other accessibility checks, is on [accessibility is part of done](/ui-patterns/accessibility-as-done/#targets-of-at-least-44-by-44). The React Native counterpart, with the platform sizes and what `hitSlop` can't do, is on [React Native targets](/react-native/accessibility/#targets-48-on-android-44-elsewhere-and-what-hitslop-cant-do).
