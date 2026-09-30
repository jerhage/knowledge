---
title: "React Native Accessibility: The Props Behind Each Rule"
description: "Touchables that are accessible by default, name, role and state props, accessibilityActions, platform target sizes and hitSlop's limits, text scaling and maxFontSizeMultiplier, and announcements that only queue on iOS."
tags: [react-native, accessibility, mobile]
sidebar:
  order: 1
---

The rules I hold native UI to, and the reasons for them, are on [accessibility is part of done](/ui-patterns/accessibility-as-done/). This page is the React Native API for each one: the props, what they default to, and where they stop working. How one app uses them, with its audit, is on [accessibility in riftcards](/projects/riftcards/presentation/accessibility/).

## A touchable is accessible by default, so it hides the controls inside it

An element with `accessible={true}` is one item to a screen reader: React Native maps the prop to `isAccessibilityElement` on iOS and to `focusable` on Android. [Every touchable is accessible by default](https://reactnative.dev/docs/accessibility#accessible), and `Pressable` sets `accessible` to `true` unless it's passed `false`.

So take a card tile that opens the card when pressed and holds a stepper, a plus and a minus button for the number of copies. If the tile is a `Pressable` and the stepper sits inside it, the tile collapses into one element, and someone using VoiceOver can reach the tile but not the plus or minus button.

No prop on the stepper fixes that. The fix is structural: move the stepper out of the pressable, so the tile and its buttons are siblings. That structural cost is [why accessibility blocks instead of waiting for a pass](/ui-patterns/accessibility-as-done/#why-it-blocks-instead-of-waiting-for-a-pass).

## Name, role and state are accessibilityLabel, accessibilityRole and accessibilityState

An interactive element's name is `accessibilityLabel`, its role is `accessibilityRole`, and its state is `accessibilityState`, an object with `disabled`, `selected`, `checked`, `busy` and `expanded`.

The role declares what activation does. `accessibilityRole="button"` on an element with no `onPress` is wrong: the screen reader announces a button, someone double-taps, and nothing happens. A row that picks one option out of several, unpicking the others, is `accessibilityRole="radio"` with `accessibilityState={{ selected }}`, because that's what a radio group does.

`busy` and `disabled` are separate fields, and a control can need either without the other: it can be unavailable with nothing in flight, and it reports `busy` while its own work runs.

The label is what gets spoken, so it's the spoken form of what's on screen. A visual line like `3E · 5M` is read aloud as "three E dot five M". So beside each visual formatter sits a spoken one that spells the words out, and the element's `accessibilityLabel` comes from the spoken one.

## A gesture's action goes in accessibilityActions

With VoiceOver or TalkBack running, the screen reader takes over the touch gestures, so an action behind a long press can't be performed the usual way. React Native lets an element declare [named actions](https://reactnative.dev/docs/accessibility#accessibility-actions) that the screen reader offers in its actions list: `accessibilityActions` lists them, each with a `name` and an optional `label`, and `onAccessibilityAction` receives the one that was invoked as `event.nativeEvent.actionName`.

A row that opens a card on long press declares an action that does the same thing, so the long press isn't the only way to reach it. And the element has no hint telling someone to press and hold, since that's the gesture the screen reader intercepts.

## Targets: 48 on Android, 44 elsewhere, and what hitSlop can't do

Apple's Human Interface Guidelines give 44 by 44 points as the default control size, and Android's accessibility guidance recommends at least 48 by 48 dp. One token holds both, through `Platform.select`:

```ts
const MINIMUM_TOUCH_TARGET = Platform.select({ android: 48, default: 44 });
```

When a control is deliberately smaller on screen, `hitSlop` extends the area where a press registers. I compute it from the face size rather than writing a number: a function takes the size of the visible face and returns the inset that grows it to the minimum, `Math.ceil((minimum - face) / 2)` on each side. Adjacent targets don't get slop, because it would overlap the neighbor and a press in the overlap goes to only one of them.

Slop also has two limits from [`Pressable`](https://reactnative.dev/docs/pressable#hitrect): the touch area never extends past the parent view's bounds, and where two sibling views overlap, the one on top wins. So slop on a control at the edge of a tight container does nothing past that edge. The web counterpart is [opt-in touch targets](/html/touch-devices/#opt-in-touch-targets-and-a-heading-that-moves-into-the-header).

## Text scaling: three flex layouts that clip, and maxFontSizeMultiplier only for decoration

`Text` follows the system text size by default (`allowFontScaling` is `true`). A layout can still defeat it, and three layouts do:

- A fixed `height` around text. The text grows and gets clipped.
- `flexBasis` with `flexShrink: 0` on a label. The label keeps its width and its text overflows.
- A row of text with neither `flexWrap` nor `flexShrink`. The row runs off the edge.

[`maxFontSizeMultiplier`](https://reactnative.dev/docs/text#maxfontsizemultiplier) caps how far one node's text scales. I use it only on a decorative glyph whose meaning is already in the accessible name. On data it hides the value from exactly the person who asked for bigger text.

## AccessibilityInfo announcements queue only on iOS

A change away from someone's focus, like a failed save, has to be announced. React Native's [`AccessibilityInfo`](https://reactnative.dev/docs/accessibilityinfo#announceforaccessibilitywithoptions) has `announceForAccessibilityWithOptions(message, { queue })`. With `queue: true` the message is queued behind the current speech; otherwise it interrupts.

The option only works on iOS. On Android, React Native's implementation passes the message to the plain `announceForAccessibility` call and drops the options, so every announcement interrupts. An urgency setting in the app's own announce hook is therefore an iOS-only setting, and worth naming as one.

Where to announce from: code that models a write or a paged read as a union (`idle | saving | failed`, a loading-more state) announces on the transition between two variants, because that's the moment the change happened.
