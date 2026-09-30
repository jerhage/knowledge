---
title: "react-native-screens: The formSheet Scroll-View Constraint"
description: "A formSheet scrolls only a first or second child, React Navigation's stricter reading, and where expo-router sets a screen's presentation."
tags: [react-native, expo, mobile]
sidebar:
  order: 3
---

react-native-screens is the library that gives React Navigation's native stack (and expo-router's `Stack`, which is built on it) real native screens: a pushed screen, a modal, a sheet. Most of it works without thinking about it. The form sheet has one layout constraint that nothing in an app's own code reveals, and I lost time to it, so it's written down here. The worked example is [the formSheet constraint on riftcards' deck builder](/projects/riftcards/decks/deck-builder/#the-formsheet-constraint).

## A formSheet supports a scroll view only as the first or second child

A form sheet is a screen presented as a sheet that slides up over the screen below it. React Navigation's native stack offers it as `presentation: "formSheet"`: on iOS it uses the `UIModalPresentationFormSheet` modal style, and on Android a `BottomSheetBehavior`. Its height is set by detents (`sheetAllowedDetents`), and on iOS scrolling inside the sheet can expand it to a larger detent.

For that to work, the library has to find the sheet's scroll view and size it to the sheet. Its iOS code (read in react-native-screens 4.26) looks for the scroll view among the direct children of the screen's content and handles two cases:

- the scroll view is the first child, and it's sized to fill the sheet;
- the scroll view is the second child, and the first child is treated as a header: the scroll view is sized to the sheet minus the header's height and placed below it.

Any other position isn't handled. With more than two children, the library logs a warning ("FormSheet with ScrollView expects at most 2 subviews"), and a scroll view past the second position isn't sized to the sheet at all. When riftcards' deck builder had four sibling views with its card list third, the list was hoisted to fill the whole sheet.

React Navigation's documentation words the requirement more strictly: the `ScrollView` must be reachable by following the first child view at each level of the view hierarchy, starting from the screen component. It calls this a platform requirement. The two readings agree on one layout, the scroll view as the first child, and I use that one where I can.

So a screen meant for a form sheet has at most two children at its top level: an optional header view, then the scroll view. The warning suggests `collapsable: false` on the header view, so React Native doesn't flatten it away and change the count.

None of this shows up in the screen's own code. A layout with the list third looks perfectly reasonable in the component, and the failure only appears when it's presented as a sheet. That's why I write constraints like this down next to the screen that works around them.

## A route's presentation is an option on its stack screen

With expo-router, how a route is presented is set in the layout that owns its stack, not in the route's own file. The root `_layout.tsx` renders a `Stack`, and each route that shouldn't be pushed as a plain card gets a `Stack.Screen` with a `presentation` option:

```tsx
<Stack>
  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  <Stack.Screen name="cards/[id]" options={{ presentation: "modal" }} />
  <Stack.Screen name="decks/build" options={{ presentation: "fullScreenModal" }} />
</Stack>
```

`name` is the route's path relative to the layout's folder. The values are React Navigation's: `card` (the default push), `modal`, `transparentModal`, `containedModal`, `containedTransparentModal`, `fullScreenModal` and `formSheet`. A `fullScreenModal` covers the whole screen and can't be dismissed with a swipe, so the screen has to provide its own way out.

Changing a route from `fullScreenModal` to `formSheet` is a one-word change in this file, and the constraint above determines whether it works.
