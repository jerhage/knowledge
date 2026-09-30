---
title: "Phone and Tablet Layout in React Native: Layout Class and Usable Width"
description: "Phone or tablet from the window's shorter side, read where it's needed, a usable-width context that the space-taker narrows, the tab bar as a rail, and one detail component rendered as a route or a pane."
tags: [react-native, mobile, layout]
sidebar:
  order: 2
---

A React Native app that runs on phones and tablets from one codebase has to check, on every screen, whether there's room for one thing or two. On a phone, opening an item pushes a new screen. On a tablet, the same item can open in a pane beside the list it came from. These are the rules I use to make that decision and to size things once it's made. The worked example, with every name and value, is [the phone and tablet layout of Rifty, my Riftbound card app](/projects/rifty/presentation/phone-and-tablet/).

## Phone or tablet comes from the window's shorter side

The first question is which kind of device the app is on. I call the answer the layout class: `phone` or `tablet`. React Native's `useWindowDimensions()` returns the window's `width` and `height` and updates them when the window size changes, so the class is computed from those:

```ts
const { width, height } = useWindowDimensions();
const layoutClass = Math.min(width, height) >= MinTabletWidth ? "tablet" : "phone";
```

Using the shorter side is what keeps the answer stable. Rotating a device swaps width and height, but the shorter side stays the same, so a tablet stays a tablet in portrait and a phone in landscape stays a phone. If the class came from the width alone, turning a large phone sideways could flip it into the tablet layout mid-session.

The layout class describes the frame, the whole window. Safe-area insets and a navigation rail never go into it. Those change how much room a component has, which is a different question (the usable width, below).

## Read the layout class where it's needed, never pass it down

A component that behaves differently on a tablet calls the hook that computes the layout class itself. The value is never passed down as a prop.

A prop would have to be threaded through every component between the one that reads the window size and the one that needs the answer. Each of those in-between components would take a parameter it never uses, only to pass it along. Reading the hook where it's needed keeps it out of their props, and the answer is always the current one, since the hook re-renders its caller when the window changes.

## Usable width is narrowed by whatever takes the space

The window's width isn't the width a component can draw in. On a tablet a rail takes some of it, and a pane beside a list takes more. A grid that sizes its columns from the window width would draw columns too wide for the space it actually has.

So the width a subtree may draw in, the usable width, lives in a React context. A provider component sets it, and a hook reads it. When no provider is above a component, the hook falls back to the window width minus the left and right safe-area insets.

The rule that keeps the number right: no consumer subtracts anything itself. Whatever takes the space narrows the provider for what sits beside it. The tab layout wraps its screens in a provider set to the usable width minus the rail. A split view wraps each of its two slots in a provider set to that slot's width. Every consumer below reads one number. If each grid subtracted the rail on its own, a grid inside a pane would have to subtract both the rail and the pane, and one that missed either would overflow.

A small pure function then turns the usable width into a column count and a column width for a grid, given the minimum column width, the gap and the side padding.

## On a tablet the tab bar becomes a rail

On a phone the tab bar sits at the bottom. On a tablet I move it to the side, where it becomes a rail. React Navigation's bottom tab navigator supports this through two options: `tabBarPosition: "left"` styles the tab bar as a sidebar, and `tabBarVariant: "material"` styles it by the Material Design guidelines. The `material` variant is only supported when the position is `left` or `right`. Both are chosen from the layout class inside the tab layout's `screenOptions`.

Where a detail opens determines whether the rail stays visible. A route pushed on the root stack covers the whole window, rail included. A pane that renders inside the tab navigator's screen leaves the rail in place, so the app's destinations stay one tap away.

## One detail component opens as a route on a phone and as a pane on a tablet

A list screen needs one way to open an item that works the same on either device. I pass it one value that describes how, a union:

```ts
type DetailOpening<Subject, Id> =
  | { type: "route"; open: (subject: Subject) => void }
  | { type: "pane"; open: (subject: Subject) => void; close: () => void; shown: DetailPaneContent<Id> };
```

A hook builds it from the layout class. On a phone it's `{ type: "route" }`, and `open` pushes the detail route. On a tablet it's `{ type: "pane" }`, and `open` puts the item's id in `shown`, which the tab screen renders in a pane beside the list. `shown` is either no subject yet or the id of the one on display.

The pane has to render inside the tab navigator's screen, not as a route, so it doesn't cover the rail. The detail component itself is the same in both cases, so it's written once.

Opening and closing the pane are both announced to the screen reader. When a route is pushed, focus moves to the new screen and the screen reader reads it. A pane appears beside the list with no new screen, so without an announcement a screen reader user wouldn't know anything had opened or closed.

## Split slots are named for their role, and tree order is reading order

A split view that holds a list and a pane has two slots. I name them `primary` (the wide one, which takes the remaining space) and `secondary` (the narrow one), never left, right, main or side.

A position name says where a slot is drawn, which a reader can already see; a role name says what it's for. "Main" goes wrong for another reason: the wide slot isn't always the same feature's. On one tab the catalog is wide and the detail is narrow. On another the detail is wide and the list is narrow. A role name describes what the slot is for in the layout, whichever feature fills it.

The order of the slots in the component tree matters too. A screen reader sweeps a screen in tree order, not in the order things appear on screen. So the slot drawn first on screen is also first in the tree, and tree order equals visual order.
