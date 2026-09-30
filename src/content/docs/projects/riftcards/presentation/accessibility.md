---
title: Accessibility in Riftcards
description: The six rules in React Native terms, what the audit found, the model row, and the recorded exceptions.
tags: [riftcards, accessibility, react-native, mobile]
sidebar:
  order: 83
---

In riftcards, a component isn't done until it's accessible. The general rules, with their platform background and web equivalents, are on [accessibility is part of done](/ui-patterns/accessibility-as-done/). The React Native props behind each rule, and where they stop working, are on [React Native accessibility](/react-native/accessibility/). This page is riftcards' version: the props and tokens each rule uses, the audit that produced the rules, the component I treat as the model, and the places where the app knowingly falls short.

## The six rules in React Native terms

1. **Every interactive element has a name, the role its behavior implies, and its state.** The props are the ones on [name, role and state](/react-native/accessibility/#name-role-and-state-are-accessibilitylabel-accessibilityrole-and-accessibilitystate). A visual label that abbreviates gets a spoken counterpart, named to mark it as spoken: `spokenCardTypeAndAttributes` and `spokenEditedLabel` sit beside the visual formatters, because `"3E · 5M"` is read aloud as "three E dot five M". The shared `Button` reports `accessibilityState={{ busy, disabled }}`, as two separate props, so the save control reports busy while a save is in flight.
2. **No action is reachable only by a gesture.** VoiceOver and TalkBack take over long press, swipe and pinch. An action gets a plain press, or it's exposed as [an accessibility action](/react-native/accessibility/#a-gestures-action-goes-in-accessibilityactions). No hint tells someone to press and hold.
3. **A target is at least 44 by 44.** The size comes from the `TouchTarget` token in `constants/theme.ts`, never a literal. The token uses 48 on Android and 44 elsewhere. When a control is deliberately smaller on screen, `TouchTarget.slop` gives the `hitSlop` that grows it to the minimum. Adjacent targets don't use slop. The platform guidelines behind the numbers, and what `hitSlop` can't do, are on [targets](/react-native/accessibility/#targets-48-on-android-44-elsewhere-and-what-hitslop-cant-do).
4. **Text scales, and containers don't clip it.** No container uses any of [the three flex layouts that clip scaled text](/react-native/accessibility/#text-scaling-three-flex-layouts-that-clip-and-maxfontsizemultiplier-only-for-decoration), and `maxFontSizeMultiplier` is only for a decorative glyph, never for data.
5. **Meaning is never conveyed by color alone.** The app has seven domain values, each with its own color, and under deuteranopia several pairs of them look like the same color (Chaos and Mind in the dark theme are almost identical). No retuning of seven hues fixes that, so a domain is always shown with its one-letter code as well. `domainCode` gives it (`Chaos` is `X`, `Colorless` is `N`). A state, a selection and a disabled control need a label, a glyph or a shape too.
6. **A state change a person caused is announced.** A save that fails, a quantity that changes, a filter that returns a different count. `useAnnouncement` does it, through React Native's `AccessibilityInfo.announceForAccessibilityWithOptions`, and takes an urgency: `queued` plays after current speech, `interrupting` cuts in. The urgency only has an effect on iOS; on Android every announcement interrupts, for the reason on [announcements queue only on iOS](/react-native/accessibility/#accessibilityinfo-announcements-queue-only-on-ios). `useWriteState`, `usePagedReadState` and `useDraftSheet` already model these changes as unions, so that's where the announcements go. The paged read announces each loaded page, and `DeckSaveData` announces a saved deck, a rule failure such as `nameTaken`, or an unexpected failure.

## The model row

The component I hold up as the model of an accessible one here is `champion-pick-row.tsx`. It's a row in the deck builder's champion step: pressing it picks that champion, and a long press opens the full card.

- `accessibilityRole="radio"` with `accessibilityState={{ selected }}`, because picking one champion unpicks the others. That's what a radio group does, so that's the behavior the role declares.
- An `accessibilityLabel` built from the card that spells out its stats, instead of the abbreviated line drawn on screen.
- An accessibility action that opens the full card, the same thing the long press does, so the long press isn't the only way to reach it.

## Why accessibility blocks

I treat accessibility as blocking, not as a pass before release, because the audit found failures that made a task impossible, and none of them was visible from outside.

In grid layout, someone using VoiceOver couldn't add or remove cards at all. `CardStepper`, the plus and minus control, sat inside a `Pressable`, and in React Native [every touchable element is accessible by default](/react-native/accessibility/#a-touchable-is-accessible-by-default-so-it-hides-the-controls-inside-it). So the whole tile collapsed into one element, and the stepper's buttons weren't reachable. Builder tiles declared `accessibilityRole="button"` with no `onPress`, so a double tap did nothing. And the tiles had a hint telling the person to press and hold, a gesture the screen reader intercepts.

None of that shows when you look at the screen, and none of it was a quick fix. Each needed a structural change to the tile, not a prop. Retrofitting them cost more than writing them right would have.

The alternative, ship first and audit later, is the common one, and its cost is plain: you find out after shipping that the fix is a restructure rather than a prop.

## What the audit found

Some of what it found wasn't about assistive technology at all. These were ordinary bugs that affected everyone:

- The search field's tap region was about 17 points tall inside a 38-point row, so a tap on the bottom 10 points or so of the visible field did nothing.
- A section label was truncated at the normal font size.
- The build footer's button fired when it looked disabled.
- The stepper's disabled glyph was drawn in the border color, which made it invisible rather than dimmed, so someone at a copy limit saw a stepper with one arm missing and couldn't tell whether they had hit the limit or the app had broken.

So the audit didn't slow the work down much: a good part of it would have been bug fixes anyway. An accessibility audit is a layout audit that happens to have a standard attached.

## Where the app is not conformant

The app isn't fully conformant, and I know where.

- In the light theme, the `positive` and `warning` colors are used as small status text, such as a deck's Legal or Illegal label. On a selected row, `positive` has a contrast ratio of 2.89:1 and `warning` has 2.97:1, and neither reaches the 4.5:1 that WCAG's Level AA requires for normal text on any light background.
- On card art, a card's domain is shown by color alone. That fails 1.4.1 Use of Color, which is Level A.

Both are deliberate. I'm taking the palette as one piece of work rather than patching it twice. A lettered domain band on the card art was built and then reverted while that work is pending. When it was reverted, the test asserting that the catalog grid shows a domain without color became false on purpose, so I deleted it, and recorded the decision beside the audit finding it came from.

What matters is that both exceptions are recorded, in the accessibility audit with the reverted implementation, rather than left to look like an oversight. The next person to read the code has none of the reasoning that produced them. An unexplained violation gets fixed again or copied as precedent, and a rule the code breaks with no written record stops being a rule. The general version is [an exception is written down or it is not an exception](/ui-patterns/accessibility-as-done/#an-exception-is-written-down-or-it-is-not-an-exception).

The web side of target sizes, for comparison, is [opt-in touch targets](/html/touch-devices/#opt-in-touch-targets-and-a-heading-that-moves-into-the-header).
