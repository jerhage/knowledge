---
title: Accessibility Is Part of Done
description: Why accessibility blocks a change instead of waiting for a later pass, and the rules I hold every piece of native UI to, each with its web counterpart.
tags: [accessibility, ui-patterns, mobile]
sidebar:
  order: 3
---

A component isn't finished when it looks right. It's finished when someone using a screen reader, a larger text size or a less precise finger can use it too. I treat that as a condition of done, not a pass before release.

The rules below came out of an accessibility audit of Rifty, my React Native card app for the Riftbound card game, and each one exists because its absence was found there rather than imagined. They're written in native platform terms: a **role** (what kind of control an element is), a **state** (disabled, selected, busy), **accessibility actions** (named actions a screen reader can invoke). Where the web has an equivalent, it gets one line. How Rifty applies them, with the audit's findings, is on [accessibility in Rifty](/projects/rifty/presentation/accessibility/). The React Native props for each rule are on [React Native accessibility](/react-native/accessibility/).

## Why it blocks instead of waiting for a pass

Take a card tile in a deck builder. The tile opens the card when pressed, and it holds a stepper with plus and minus buttons for the number of copies. On screen it works.

To a screen reader it can be a single element. An element marked as accessible is presented as one item: on iOS it becomes an accessibility element, and VoiceOver doesn't allow accessibility elements nested inside another one; TalkBack on Android may focus the parent instead of its children. If the tile's pressable wrapper is accessible (and in React Native [every touchable element is by default](/react-native/accessibility/#a-touchable-is-accessible-by-default-so-it-hides-the-controls-inside-it)), the plus and minus buttons inside it disappear as separate controls. Someone using VoiceOver reaches the tile, hears its name, and has no way to add or remove a copy at all.

Nothing on screen shows that. And the fix isn't a prop: the stepper has to move out of the pressable, which changes the tile's structure. That's the pattern the audit found over and over: failures that made a task impossible, invisible from outside, each needing a structural change. Retrofitting them cost more than writing them right would have. The usual approach (ship, then audit) is honest about its cost too: you find out later that the fix is a restructure rather than a prop.

## A name, a role that matches the behavior, and a state

Every interactive element has three things:

- **An accessible name**: what a screen reader says for it.
- **The role its behavior implies**: button, link, checkbox, adjustable.
- **Its state**: disabled, selected, checked, busy, expanded.

A role states what activation does. A tile that declares the button role and has no press handler is announced as a button, someone double-taps, and nothing happens.

The name has to be the spoken form, not the visual one. A label like `3E · 5M` reads fine on a card and is read aloud as "three E dot five M". The element needs a spoken counterpart as its name, one that spells out the words the letters stand for.

Web: the accessible name, the `role` and the `aria-*` states, which WCAG 4.1.2 Name, Role, Value requires at Level A. A native element brings most of this with it, like [`<dialog>` with `showModal()`](/html/top-layer/#dialog-with-showmodal-is-free-accessibility). A text glyph inside a button can leak into its name; see [a glyph in a button named by its content](/html/forms-and-labels/#a-glyph-in-a-button-named-by-its-content-is-part-of-the-name).

## No action only behind a gesture

A screen reader takes over the touch screen's gestures for its own navigation. With VoiceOver or TalkBack running, a swipe moves to the next element and a double tap activates, so an action behind a long press, a swipe or a pinch can't be performed the usual way.

So every action gets one of two routes:

- **A plain press**, on a control of its own.
- **An accessibility action**: a named action the element declares, which the screen reader shows in its actions list. React Native exposes these as [`accessibilityActions`](/react-native/accessibility/#a-gestures-action-goes-in-accessibilityactions) with an `onAccessibilityAction` handler.

And never write a hint telling someone to perform a gesture the screen reader intercepts. "Press and hold to remove" describes something nobody using VoiceOver can do.

Web: WCAG 2.5.1 Pointer Gestures (Level A) requires a single-pointer alternative to path-based and multipoint gestures, and 2.1.1 Keyboard (Level A) requires every function to work from a keyboard.

## Targets of at least 44 by 44

A control's touch target is at least 44 by 44 points. Apple's Human Interface Guidelines give 44 by 44 points as the default control size on iOS and iPadOS. Android's accessibility guidance recommends at least 48 by 48 dp, so an Android-first app should use the larger number.

The size comes from a design token, not a literal, so it can't drift one control at a time.

When a control is deliberately smaller than that on screen (an icon in a dense row, say), the touch area can extend past the visual with hit slop. The exception is adjacent targets. Their slop overlaps, and a press in the overlap goes to only one of them. React Native: [what `hitSlop` can't do](/react-native/accessibility/#targets-48-on-android-44-elsewhere-and-what-hitslop-cant-do).

Web: WCAG 2.5.8 Target Size (Minimum) asks for 24 by 24 CSS pixels at Level AA, and 2.5.5 Target Size (Enhanced) asks for 44 by 44 at Level AAA. Making 44px targets opt-in on a site is in [opt-in touch targets](/html/touch-devices/#opt-in-touch-targets-and-a-heading-that-moves-into-the-header).

## Text scales and containers let it

Both platforms let people raise the system text size, and text follows it by default. A layout can still defeat it. These layouts do:

- A fixed `height` around text. The text grows and gets clipped.
- A fixed basis that doesn't shrink on a label. The label keeps its width and its text overflows.
- A row of text that neither wraps nor shrinks. The row runs off the edge.

A cap on how far text scales is for a decorative glyph whose meaning is already in the accessible name, never for data. Capping a card's cost because it breaks a layout hides the data from exactly the person who asked for bigger text.

Web: WCAG 1.4.4 Resize Text (Level AA) requires text to scale to 200 percent without losing content or function.

## Meaning is never shown by color alone

A category, a state, a selection and a disabled control each need a label, a glyph or a shape as well as a color.

Sometimes no palette can fix it. Riftbound has seven card domains, each with a color, and two of those seven are indistinguishable under deuteranopia. However the palette is tuned, a domain shown only by color is invisible to some people. So each domain also has a one-letter code.

Web: WCAG 1.4.1 Use of Color (Level A). Contrast is separate: 1.4.3 asks 4.5:1 for normal text, and 1.4.11 asks 3:1 for controls and graphics, both at Level AA.

## A change a person caused is announced

Some changes happen away from where someone's focus is. A save fails. A quantity changes. A filter returns a different number of cards. Sighted people see the change. A screen reader announces nothing unless the app posts an announcement.

So a state change a person caused is announced. On iOS and Android the app posts an announcement to the screen reader; React Native does that with [`AccessibilityInfo.announceForAccessibility`](/react-native/accessibility/#accessibilityinfo-announcements-queue-only-on-ios). Code that already models these states as unions (a write's `idle | saving | failed`, a paged read's loading-more state) has a natural place to announce from: the transition between two variants.

Web: a live region, `role="status"` or `aria-live`, which is how WCAG 4.1.3 Status Messages (Level AA) is met.

## An exception is written down or it is not an exception

Sometimes a rule is broken on purpose. In Rifty, card art shows a card's domain by color alone while the palette work is pending. The lettered alternative was built and then reverted.

That exception is written down, with the reason, where the rule lives. That matters because the next person to read the code usually has none of the reasoning that produced the exception. An unexplained violation reads as an oversight, so they either fix it again, undoing a decision, or copy it as precedent into new code. Both are worse than the exception itself. A rule broken with no note saying why stops being a rule.

So any deliberate departure is written beside the rule, or it isn't allowed; see [a departure is written beside the rule](/practices/recording-decisions/#a-departure-is-written-beside-the-rule).

## An audit is also a layout audit

Some of what the Rifty audit found wasn't specific to assistive technology at all. They were ordinary bugs that affected everyone:

- The search field's tap area was about 17 points tall inside a 38-point row, so a tap on the bottom part of the row did nothing.
- A section label was truncated at the normal text size.
- The build footer's button fired when it looked disabled.

Checking names, targets and text scaling means looking at every control's real size and every label's real space. That's a layout audit that happens to have a standard attached.
