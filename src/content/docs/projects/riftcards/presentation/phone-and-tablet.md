---
title: Phone and Tablet Layout
description: "The shell, `LayoutClass` read at the seam, usable width, the rail, panes vs panels, primary and secondary slots, and sheets and faces."
tags: [riftcards, react-native, mobile, layout]
sidebar:
  order: 82
---

Riftcards runs on phones and tablets from one codebase. On a phone, opening a card or a deck pushes a new screen. On a tablet there's room for two things side by side, so the same content opens in a pane beside the list it came from. The general rules behind these choices are on [phone and tablet layout in React Native](/react-native/layout/). This page is how riftcards' layout decides between the two, and the words the code uses for the parts of the screen. Those words are also glossary entries, in [the screen section of the glossary](/projects/riftcards/glossary/core-rules-annotations-screen/).

## The shell

The shell is the surrounding UI: the tab bar, the rail, the headers. I never call it "chrome", because that's jargon that names nothing someone can point at.

A shell component is named for the shell, not for one of the things inside it. The tab navigator's layout in `src/app/(tabs)/_layout.tsx` was once exported as `CatalogLayout`, which named the whole navigator after one of its tabs. It's `TabsLayout` since 2026-09-14.

## `LayoutClass` is read where it's needed

`LayoutClass` is `phone | tablet`, and `useLayoutSize()` returns it as `layoutClass`, beside the usable width described below. It describes the frame, the whole window, and it's computed from `Math.min(width, height) >= MinTabletWidth`, so [it comes from the window's shorter side](/react-native/layout/#phone-or-tablet-comes-from-the-windows-shorter-side). Insets and rails never go into it.

A component that needs the layout class calls `useLayoutSize()` itself. The value is never passed down as a prop, for the reason on [read the layout class where it's needed](/react-native/layout/#read-the-layout-class-where-its-needed-never-pass-it-down).

A variable holding one is named `layoutClass`, never `layout`, `size` or `device`.

## Usable width

The window's width isn't the width a component can draw in. On a tablet the rail takes some of it, and a pane beside a list takes more. `usableWidth` is the width a subtree may actually draw in: the window minus its insets, narrowed by whatever sits beside it.

`UsableWidthProvider` holds it, and `useUsableWidth` reads it. Nothing subtracts a rail or a pane itself: the thing that takes the space narrows the provider, and every consumer below reads one number. Why is on [usable width is narrowed by whatever takes the space](/react-native/layout/#usable-width-is-narrowed-by-whatever-takes-the-space).

`fitColumns(usableWidth, spec)` turns that number into a `ColumnFit`, the column count and width for a grid.

## The rail

On a tablet the tab bar moves to the side and becomes a rail: `tabBarPosition: "left"`, `tabBarVariant: "material"`, `RailWidth = 118`. It holds the app's destinations.

A pushed route covers the rail. A pane never does, because a pane lives inside the tab navigator's screen. The general version is [on a tablet the tab bar becomes a rail](/react-native/layout/#on-a-tablet-the-tab-bar-becomes-a-rail).

## Panes and panels

These two words sound alike and name different things, and the code keeps them apart.

A **pane** is a layout slot inside the tab shell that holds a whole screen's worth of content beside another one: `CardDetailPane`, `DeckDetailPane`, `DrawSimulationPane`, `SectionsPane`. On the decks tab, `DeckPrimaryPane` holds whichever of the deck's panes is showing: nothing yet, the deck detail, or its draw simulation.

`DetailOpening` is the union that sets how a detail opens. On a phone it's `{ type: "route" }`, and opening a card pushes a route. On a tablet it's `{ type: "pane", open, close, shown }`, where `shown` is either no subject yet or the id of the one on display, and opening a card fills the pane. Both opening and closing the pane are announced to the screen reader, since nothing moves to a new screen. A pane has to render inside the tab navigator's screen, and one component serves both renderings, so the card detail isn't written twice. The general pattern is [one detail component opens as a route on a phone and as a pane on a tablet](/react-native/layout/#one-detail-component-opens-as-a-route-on-a-phone-and-as-a-pane-on-a-tablet).

A **panel** is a titled, bordered box inside a scrolling screen: the `Panel` atom in `components/ui/atoms/panel.tsx`, and `DrawOddsPanel`, `HandStatsPanel`, `CardRulesPanel`, `DeckAnalysisPanels`.

A pane is a slot in the frame, and a panel is a box in a scroll view. The code didn't always keep them apart. The deck builder's sections step sized its pane with `PanelMaxWidth`, `panelWidthFor` and `styles.panel`, none of which described a titled box. They became `PaneMaxWidth`, `paneWidthFor` and `styles.pane` on 2026-09-14 (the ruling is in [the glossary rulings](/projects/riftcards/glossary/rulings/#pane-and-panel-are-different-words)).

## Primary and secondary

`SplitLayout` has two slots, named for their role rather than their position:

| Slot | Width | Where | Border |
| --- | --- | --- | --- |
| `primary` | `flex: 1` | against the rail | none |
| `secondary` | `min(392, 34% of frame)` | outer edge | leading border |

The names are never "left", "right", "main" or "side", because [the wide slot isn't always the same feature's](/react-native/layout/#split-slots-are-named-for-their-role-and-tree-order-is-reading-order):

```tsx
<SplitLayout primary={<CardCatalog />} secondary={<CardDetailPane />} />
```

That's the cards tab: the catalog is wide and the detail is narrow. On the decks tab it's the other way round:

```tsx
<SplitLayout primary={<DeckPrimaryPane />} secondary={<DeckList />} />
```

Tree order equals visual order, so a screen reader sweeps the wide slot first.

## Sheets and faces

A **sheet** is the bottom sheet. A **face** is one of its interchangeable contents: `CatalogFilterFace`, `PoolFilterFace`, `SheetFace`. In the catalog and the builder's pool, a `*SheetState` union of `hidden | filter | sort` (`CatalogSheetState`, `SectionPoolSheetState`) records which face is showing, so a sheet can't show two faces at once, and "hidden" is a state rather than a missing value.

A face's edits are pending until they're applied. `useDraftSheet` holds that pending value, its `draft`, beside the `applied` one, which is one of the three kinds of draft on [the deck builder](/projects/riftcards/decks/deck-builder/#three-kinds-of-draft).
