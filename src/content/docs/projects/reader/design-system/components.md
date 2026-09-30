---
title: The Reader's Component Library
description: What the reader's base library adds to the baseline contract, component by component, and how its Svelte props are named.
tags: [reader, components, design-systems, svelte, svelte-5, accessibility]
sidebar:
  order: 22
---

The reader's base library in `src/lib/components/` implements the [component contract](/design-systems/component-contract/) and adds options on top. Below is the full inventory of those options, in the table shape from [options a system adds beyond the baseline](/design-systems/component-contract/#options-a-system-adds-beyond-the-baseline), followed by how the props are named and the notes behind some of the options. The components the two readers are built from (Carousel, Dock, the gesture and pan-zoom modules, the marquee) are on [reading components](/projects/reader/design-system/reading-components/), and the utility classes on [utilities and layouts](/projects/reader/design-system/utilities-and-layouts/).

## Actions

| Component | Option | Class / effect |
| --- | --- | --- |
| Button | tone × emphasis | a tone class sets the colors (`.btn-primary`, `.btn-accent`, `.btn-danger`; neutral has none) and an emphasis class draws them (`.btn-outline`, `.btn-ghost`; solid has none); any tone composes with any emphasis (`.btn-ghost.btn-danger`, `.btn-outline.btn-primary`), and no rule names both |
| Button | `wrap` | `.btn-wrap`: content wraps from the inline start |
| Button | `--btn-min-block-size` | an ancestor raises every size's minimum height (`.layout-app-shell-narrow-touch` sets `--control-h-touch`) |
| IconButton | (component) | a `Button` (`square` by default) with an `icon` component (`.btn-icon`) or a glyph snippet; the required `label` is a `.visually-hidden` text node, never `aria-label`; `tooltip` (default: the label) is the `title`, a different string, or `false` for none |
| ButtonGroup | (component) | `.btn-group`: an inline flex row of `Button`s or `IconButton`s joined into one bar, each child's resting shadow dropped, the corners they share squared (`--radius-none`) and each border after the first pulled back over its neighbor by `--border-width`; a hovered, focused or `.is-active` child is raised (`--z-raised`) so its whole border shows. `role="group"`, named by a required `label` (`aria-label`) or `aria-labelledby`. For actions; one choice among options is a `SegmentedControl` |

## Form

| Component | Option | Class / effect |
| --- | --- | --- |
| Field | `hideLabel`, `announceError` | label `visually-hidden`; error `role="alert"` |
| Field | `layout="inline"` | `.field-inline`: the label beside the control, the label `flex: 1 0 var(--field-label-width)` and the control `flex: 999 1` twice that, so the label moves above the control once the row is narrower than both (a `sp-2` row gap, `sp-4` column gap); hint and error take a line of their own under both. The default `layout="stacked"` adds no class. A field labels one control with a `label for`; `SettingsRow` names a group of controls laid out to the end of its line and stays separate |
| InputGroup | (component) | `.input-group`: a flex row joining an `Input` (`flex: 1 1 0`, shrinks to nothing) with what the caller writes before and after it, `InputGroupAddon`s and `Button`s (no shadow, own width); every child after the first overlaps its neighbor by `--border-width`, and the corners children share are squared; a hovered, focused or invalid input and a hovered or focused button are raised. No role or name of its own: a `Field` labels the input, and addon text is visual only, so what it says belongs in the label or the hint. `SearchField` does not use it |
| InputGroupAddon | (component) | `.input-group-addon`: a `span` in an `.input-group` holding text, an `icon` component (`.input-group-addon-icon`, `--icon-size-md`, decorative) or both; `sp-3` inline padding, `text-sm`, muted, `--color-surface` behind a `--border-color-strong` border at `--radius-control`, never wraps |
| Radio | `variant="tile"` | `.radio-tile`: the label is a sunken, rounded, padded tile the whole of which picks it; flat when disabled |
| Radio | no children | the bare `.radio-input`, named by a required `aria-labelledby` or `aria-label` |
| SearchField | (component) | `.search-field`: a labeled search input; `clearable` adds `.search-field-clearable` to the root and a drawn `.search-field-clear` on touch, named by `clearLabel` ("Clear the search" by default); `type="text"` for a combobox filter |
| Slider | (component) | `.slider`: a labeled native range, `accent-color` primary; `valuetext`, `dir`; `ticks` (percent from the left edge) wrap it in `.slider-wrapper` with `.slider-tick` marks |
| SegmentedControl | (component) | `.segmented`: one choice as pressed buttons; `.segmented-track` is a sunken track of `.segmented-item` parts, the chosen one raised (`.is-active`) |
| SettingsRow | (component) | `.settings-row`, `.settings-row-label`: label and control on a line |
| Dropzone | `directory` | a second, hidden folder picker (`webkitdirectory`, `multiple`, `.dropzone-input`) inside the zone, opened by the `chooseDirectory()` method from a control the caller places; the files it returns take the same path as chosen files (the accept, size and count policy, then `onfiles`); disabled with the zone |
| WindowDropzone | (component) | `.window-dropzone`: a `popover="manual"` overlay shown while files are dragged over the window; a `.window-dropzone-panel` holds its own `.window-dropzone-icon-frame` (lifted by `sp-1`), `.window-dropzone-icon` and `.window-dropzone-title`, drawn like `Dropzone`'s parts |

How the folder picker is used when a book is added is on [importing a book](/projects/reader/library/importing-books/).

## Display

| Component | Option | Class / effect |
| --- | --- | --- |
| Card | `eyebrow` | `.card-eyebrow.eyebrow`: the `.eyebrow` utility plus semibold, faint; `.card-eyebrow` sets no size, tracking or case of its own |
| Card | `size="sm"` | `.card-sm`: body `sp-3`, footer `sp-2 sp-3` |
| Card | media only (no body content) | root takes `.card-cover` and the ratio class; the media covers the card, no `.card-body` |
| Card | `tooltip` | the HTML `title` attribute (`title` is the heading snippet) |
| Stat | `size="sm"` | `.stat-sm`: `sp-3` padding, mono `text-sm` value, plain label |
| Stat | `listed` | `dt` label, `dd` value and delta, inside a caller's `dl` |
| Badge | tone × emphasis | a tone class sets the colors (`.badge-success` to `.badge-neutral`, or a `.badge-color-*`) and `.badge-solid` or `.badge-quiet` draws them (tinted has none) |
| Tag | `href` | renders `a.tag` with its color; exclusive with `onremove` |
| Thumbnail | (component) | `.thumbnail`: a sunken, `radius-control`, clipped `span` framing a cover `img` (`object-fit: cover`), blank until there is one; a default width, `-sm` narrower and `-lg` wider, with an `.aspect-*` ratio (portrait by default); `-fill`, never beside a size, takes its parent's box and leaves clip, corners and placeholder to it (Card media); `-bordered`; an empty frame with an `alt` is `role="img"` |
| ListGroup | (component) | `.list-group`: an optional eyebrow `title` (`.list-group-title.eyebrow`: the `.eyebrow` utility plus `sp-1` inline padding, semibold, faint; `h2` to `h4`) names a `section`; `.list-group-box` holds a `ul` (`.list-group-list`) and an optional `summary` `dl` (`.list-group-summary`, sunken); `-separated` rules between rows and clips, `-inset` pads `sp-1` for interactive items |
| ListRow | (component) | `.list-row`: `title`, `description`, and a mono `value` (`.list-row-value`, top-aligned, never wraps; `valueTone="faint"`) or `actions` (centered, wrap under the text); `children` under the line (the `li` form is always `.list-row-stack`, a column with `sp-2` gap, which the component adds and a caller never picks); `size="sm"`, `strong`; `listed` renders `div` > `dt` + `dd` in a summary, one `.list-row-main` line with no stack |
| Table | (parts) | `TableHeader`, `TableBody`, `TableRow`, `TableHeaderCell` and `TableCell` render `thead`, `tbody`, `tr`, `th` and `td` inside `Table`, each passing its attributes and `class` through; `.table` styles them by element, so the parts add no class of their own except `TableHeaderCell`'s `.eyebrow` (the caller writes no class on a header cell); `numeric` on either cell adds `.table-numeric` (end-aligned, mono, tabular figures); `actions` on either cell adds `.table-actions` (`text-align: end` only, so an inline-block control such as a `Dropdown` sits at the inline end, the left in `rtl`; the column keeps its automatic width, because a column squeezed to min-content shrinks its icons through the reset's `svg { max-width: 100% }`); `size="sm"` adds `.table-sm`, `striped` `.table-striped`, `caption` (a string or a snippet) the `caption` |
| EmptyState | (component) | `.empty-state`: a muted message and an optional action; `-fill` centers it in a padded area and caps it at the prose measure, `-inline` starts it at the width of its flow; `live` announces it |
| KeyHints | (component) | `.key-hints`: key(s) and what they do; `-chips`, `-sm`; text variant; `inline` variant (each key a `kbd` in running text, no wrapper per hint) |
| Highlight | (component) | `segments` (`{ text, matched }`) as running text inside the caller's element, each matched one in a `mark` (drawn by the base `mark` rule), with no space added between them; no element or class of its own |
| OverflowList | (component) | as many items (`item` snippet) as `room` holds; past it `room - 1` items and a `+N` count whose `title` and visually hidden text (`moreLabel`, "more" by default, then the names) name the rest (`name(item)`); a `ul.overflow-list` (`label`, `class`; an unmarked, clipped flex row, `sp-3` gap, centered) of `li`s, nothing for no items, or `inline` straight into the caller's flow with no element of its own |
| Alert | `banner` | `.alert-banner`: square (`--radius-none`) with no inline borders, so it spans the surface it heads flush to its sides; the block borders stay |
| PageHeader | (component) | `.page-header` (`display: contents`, so its parts join the caller's row): an optional back link (`backHref`, `backLabel`, default "Back"; a small `Button` with a leading chevron, or with `compact` an `IconButton` whose label is hidden text), then a growing column of an `h1` `title` (`text-base`, medium, truncated, `lang`) and an optional `meta` line (`text-xs`, faint, truncated) |
| Stepper | (component) | `.stepper`: previous/next arrows (`IconButton`s, ghost, `sm`) after the caller's `children` in one flex row (`sp-3` gap, centered); each step is an address (a link, `onfollow(event, href)` on click), a function (a button) or `null`, drawn disabled (`missingStep="disabled"`) or left out (`missingStep="hidden"`); `axis` `inline` (left/right) or `block` (up/down); the count is a primary `Badge` first (`countAs="badge"`) or a `role="status"` line after the row (`countAs="status"`); `spaced` puts `gap-1` between the arrows; `steps={null}` keeps the children and draws no arrows and no count; `previousLabel`, `nextLabel` |

## Navigation

| Component | Option | Class / effect |
| --- | --- | --- |
| Tabs | `--tabs-header-wrap` | an ancestor keeps the header holding the tab list and its `actions` on one line (`nowrap`; `.layout-app-shell-narrow-nowrap` sets it below the shell breakpoint); `wrap` by default |
| NavLink | `--nav-link-direction`, `--nav-link-justify`, `--nav-link-gap`, `--nav-link-padding-inline`, `--nav-link-text-align` | an ancestor stacks and centers the link (`.layout-app-shell-nav-compact` below the shell breakpoint) |

## Overlays and feedback

| Component | Option | Class / effect |
| --- | --- | --- |
| Modal | open state | the native `[open]` of the `dialog` (`.modal-backdrop`) shows it, animates it in and locks the page scroll; no class; `.is-leaving` while it animates out |
| Modal | `closeButton={false}` | the `title` row without its `.modal-close`; Escape and the backdrop still close |
| Modal | `header` snippet | rendered inside `.modal-header.modal-header-bar`: a compact wrapping bar, `sp-2` gap, `sp-3` padding |
| Modal | `wrapFocus` | Tab from the dialog's last tab stop goes to its first, and Shift+Tab from the first to the last, instead of leaving the page (`focus-wrap.ts`: `tabStops(root)`, `wrappedStop`); no class |
| Dropdown | chosen item | a checked `menuitemradio` or the link to the current page takes `.dropdown-item.is-active` |
| Dropdown | `icon`, `label`, `tooltip` | an icon-only trigger labeled as `IconButton` is, in place of the `trigger` snippet: the `icon` component (`.btn-icon`) and the required `label` as a `.visually-hidden` text node, never `aria-label`; `tooltip` (default: the label) is the trigger's `title`, a different string, or `false` for none; `square` and `chevron` stay the caller's choice |
| Popover | (component) | `.popover`: anchored `popover="auto"` dialog, `--popover-width` |
| CommandItem | `element="div"` | a plain `div`, `.command-item-static`: no hover, default cursor |
| CommandItem | `hint`, `hintLang` | `.command-item-hint`: a mono `text-xs` aside at the inline end, one line, never wider than `--command-hint-max-width`; a longer hint shrinks and ends in an ellipsis, so the row's text keeps its room. `hintLang` sets the hint's `lang` when it's text in another language than the interface (a chapter title) |
| Progress | no `value` | `.progress-track.is-indeterminate`: a 40% fill slides across the track, with no `aria-valuenow`; a value arriving removes the state |
| Accordion | open state | the native `[open]` of the `details` item turns `.accordion-icon`; no class |
| ToastRegion | `placement` | `'bottom'` (default, no class) or `'top'`: `.toast-region-top` sits `--_toast-gutter` below the top edge and the top safe area and is centered at `--toast-width`, full width less the gutters below the narrow breakpoint; the clearance applies to the bottom only. The region attaches to its toaster at its placement |
| Toaster | `placement` (toast option) | `show({ …, placement })`, `'bottom'` by default, targets a region: the toast is shown by the region attached last at its placement (`regionFor(placement)`), or, with none there, by the region attached last of any placement, so no toast goes unseen; `toastsIn(region)` lists a region's toasts, and a region is shown while it is its placement's target. A toast follows its target: attaching a region at its placement later moves it there. A modal's own region is a bottom region, so a top toast shown while a modal is open appears in the page's top region, if one is mounted, behind the modal's inert |

## How the props are named

The rules are on [component props follow the class conventions](/design-systems/svelte/#6-component-props-follow-the-class-conventions). In the reader they come out as:

- A prop that picks a class maps to it through `classes.ts` (`variant`, `size`, `tone`, `emphasis`). Native button attributes are typed with `HTMLButtonAttributes` from `svelte/elements` and pass through with `...rest`.
- A boolean for one non-default: `Modal`'s `flushBody` adds `.modal-body-flush`, `fillNarrow` `.modal-fill-narrow`, `infoFooter` `.modal-footer-info`. A union when the caller picks between peers: `emphasis="solid"`, `Stepper`'s `missingStep="hidden"` and `countAs="status"`. `Badge`'s `emphasis` is `'tinted' | 'solid' | 'quiet'`, one union where there would have been two booleans.
- A list that labels each item takes a function: `FileList`'s `removeLabelFor(name)` sets each `FileItem`'s `removeLabel`.
- Payloads of one name match: `onfiles` receives a `FileSelection` from `Dropzone` and `WindowDropzone` alike, and `UploadStrip`, a domain component that forwards it, passes the same `FileSelection` on.
- `onvaluechange` reports every press, the chosen value included, where pressing it again does something (`SegmentedControl`: a fit applied again after a zoom). `onselectedchange` reports only a change, where a repeat does nothing (`Tabs`).
- An element choice is a union of tags: `element` on `KeyHints` and `CommandItem`, `heading` on `Card` and `ListGroup`. `Stat` and `ListRow` take `listed` and render `dt` and `dd`.
- A required prop that can be empty takes `null`: `Thumbnail`'s `src`, `Stepper`'s `steps`.
- Every variable bound with `bind:this` or to a child's `ref` is typed with `null`: `IconButton`'s `asButton` and `asLink`, `SearchDialog`'s `field`, a route's bound component instance such as `search`. A function that receives one accepts `null` (`chromeHolds`, `returnFocusToPage`), and readers test it with `?.` (`bar?.inert === false`). Svelte writes `null` to the binding when the element goes, synchronously since Svelte 5.53.9 ([details](/svelte/bindings/#svelte-writes-null-to-a-bound-element-when-it-goes)), and svelte-check [won't catch a variable typed without it](/svelte/bindings/#svelte-check-does-not-compare-a-bound-variable-with-the-props-type), so the prop's type is the only place the `null` is written down.

## Notes behind some options

### Button: two tiers of private properties

A `Button` has two independent choices: a tone (primary, accent, danger, or neutral with no class) and an emphasis (solid with no class, outline, ghost). Any tone goes with any emphasis. The old CSS handled that with a rule per combination, compound selectors like `.btn-ghost.btn-danger:hover`. It now uses the pattern in [tone and emphasis as two tiers of private custom properties](/design-systems/in-practice/#tone-and-emphasis-as-two-tiers-of-private-custom-properties). A tone class sets only tone inputs (`--_btn-tone-fg`, `-bg`, `-border`, `-hover-bg`, `-hover-image`, `-text`, `-line`, `-soft-hover-bg` and so on). The base rule and each emphasis class map those to painting inputs (`--_btn-fg`, `--_btn-bg`, `--_btn-hover-bg`...), and only `.btn` and `.btn:hover` actually paint.

Keeping every combination looking exactly as before needed care in these cases:

- **Disabled.** A disabled button must not change on hover. Hover now paints from the hover inputs, so `:disabled` has to reset those too. Setting `color` directly instead would have beaten `.btn-loading`'s `transparent`, and a loading button would show its label under the spinner.
- **Pressed while hovered.** A pressed primary button shows no press overlay while the pointer is on it, but a keyboard press (no hover) does show one. That behavior depends on two pseudo-classes at once, so `.btn:hover` sets `--_btn-press-image` and `.btn:active` reads it with a fallback.

One old behavior was a bug and didn't survive. `.btn-ghost.btn-danger:hover` has specificity (0,3,0) and outranked `.btn:disabled` at (0,2,0), so a disabled ghost danger button under the pointer took the danger fill. With no compound rules left, that can't happen.

### IconButton wraps a union

`IconButton` (in the table above) is a wrapper: it takes its own props (`icon`, `label`, `tooltip`) and passes everything else on to `Button`. `Button` can render either a `<button>` or a link, so its props are a union, `ButtonProps | LinkProps`, split on `href`, and each member types `ref` for its own element. A wrapper that spreads one `...rest` into `Button` and binds one `ref` fails svelte-check twice: "a union type that is too complex to represent", and a `ref` of `HTMLButtonElement | HTMLAnchorElement` that fits neither member.

`IconButton` fixes both without a cast. It omits its own keys from each member separately, with a distributive conditional type (`Given extends unknown ? Omit<Given, Named> : never`), because a plain `Omit` of a union collapses it to the keys the members share. It renders `<Button>` in two branches on `rest.href === undefined`, which narrows `rest` to one member in each. And each branch binds its own typed `$state` with a function binding, `bind:ref={() => asButton, (element) => (ref = asButton = element)}`, while the public `ref` is the union. The general write-up: [wrapping a button component whose props are a union](/svelte/bindings/#wrapping-a-button-component-whose-props-are-a-union).

### KeyHints and PageHeader

`KeyHints` draws "`⌘K` to search everything" by building `key` and `words` pieces in TypeScript, with the spaces inside the words (`' to search everything'`, `' + '`, `' · '`), and rendering them on one line of the template ([why](/svelte/rendering-gotchas/#running-text-with-markup-in-it-build-the-pieces-render-them-on-one-line)). `key-hints.spec.ts` pins the exact markup.

`PageHeader` draws a back link and a title column inside a chrome bar, whose content is a wrapping flex row. A wrapper box around the two would change where that row wraps and how its gap and `flex-1` apply, so the two have to stay items of the row themselves. So its root `div.page-header` has one rule, `display: contents` ([why](/css/layout-quirks/#a-component-that-joins-its-callers-row-has-a-display-contents-root)). In a probe's tree walk it shows up as a 0 × 0 `DIV`, which I skip before comparing rects.

### Modal

- **Toasts live inside it.** Toasts are shown in a `ToastRegion`, a `popover="manual"` element that attaches itself to the app's toaster. A modal opened with `showModal()` makes everything outside it inert, top layer included. So a toast shown while a modal is open paints above the dialog but can't be clicked, and its `aria-live` goes quiet ([a toast above a modal must live inside the modal](/html/top-layer/#a-toast-above-a-modal-must-live-inside-the-modal)). To fix that, `Modal` renders a `ToastRegion` of its own while its phase isn't `closed`. The toaster keeps a stack of attached regions and only the last one renders toasts, so opening a modal moves the toasts into it and closing it moves them back.

  Each region stays open while it's the active region, even when empty, so its live region exists before content arrives. To stay above popovers opened later (a dropdown menu), the active region listens for `toggle` in the capture phase (`<svelte:document ontogglecapture>`, since `toggle` doesn't bubble) and, when something else enters the top layer (`entersTopLayer`), calls `hidePopover()` then `showPopover()`. The toaster's mutators read their own state under `untrack`: a region attaches from an `{@attach}`, which runs in an effect, and an effect that reads and writes the same `$state` loops (`effect_update_depth_exceeded`).

  A region is a sibling of every screen, so a custom property set on a screen's root never reaches it. A screen that needs toasts to clear something at the bottom reserves the space with `<ToastClearance blockEnd={px} />` instead; the reader's use is on [reader chrome](/projects/reader/image-reader/reader-chrome/).
- **`wrapFocus`.** A native modal dialog makes the page inert but doesn't keep Tab inside it. Someone tabs past the dialog's last control, and focus leaves the document: in a full browser it goes to the browser's own UI, and the next Tab comes back to the dialog's first stop ([details](/html/dialog-focus/#a-native-modal-dialog-does-not-keep-tab-inside-it)). A dialog that should cycle has to handle Tab itself. `wrapFocus` handles only the two ends, Tab on the last stop and Shift+Tab on the first, and leaves every step in between to the browser, so the order there is the browser's own.
- **Focus on open.** `Modal` calls `showModal()` and then `focusFirst()`, which focuses `[autofocus]` before `.modal-close`. The children are always rendered, so a control with `autofocus` exists at that moment, and `Input` passes the attribute through its `rest` spread. Svelte's own `autofocus` handling is a no-op here, because it only focuses while `document.activeElement` is `body`. The other two approaches (an attachment, or an exported method called after `await tick()`) are on [focus on open without an effect](/html/dialog-focus/#focus-on-open-without-an-effect).

### Dropdown and Popover run on handlers

`Dropdown` opens a menu and `Popover` a popover. Each has to track whether it's open, close on a click outside while open, and clean up if the component is destroyed while open. Those used to live in effects. Both now do their open and close work in handlers, which leaves those last two jobs without a home ([the pattern](/html/dropdown-menus/#a-handler-driven-overlay-a-guarded-global-handler-and-an-attachment-as-the-destroy-hook)):

- The outside-click listener is written in markup, `<svelte:document onpointerdown={outside} />`, and returns early while closed. It stays registered for the component's life, which costs one cheap check per event, and Svelte removes it on destroy.
- The cleanup is an attachment with no reactive reads, `const release: Attachment = () => conceal;`, placed as `{@attach release}` on the overlay. It runs once on mount, and the function it returns runs on unmount.
- `Dropdown`'s `open` is owned `$state`, not a `$bindable` prop. When a parent writes a bindable prop, the child has no setter to run, so an effect would be the only way to react. No caller set it anyway.
- A `popover="auto"` element reports every open and close through its `toggle` event, light dismiss and Escape included, so `ontoggle` with `event.newState` keeps the state right.

The base `Button` defaults to `type="button"`, and `Popover` also puts `type: 'button'` in the props it passes to its trigger, so a plain `<button {...popover}>` inside a form doesn't submit it and still opens the popover ([popover API](/html/popover-api/)).
