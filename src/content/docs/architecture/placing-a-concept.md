---
title: Which Domain Owns a Concept
description: Containment is not ownership, three tests for an owner, where UI for another domain's types goes, naming against slotting, and why a name in the wrong domain matters before any import does.
tags: [architecture, typescript, domain-driven-design]
sidebar:
  order: 6
---

Every new type, component, port or loader has to go in some domain. Often [the dependency graph](/architecture/domains-and-the-graph/#leaves-and-non-leaves) settles it: only one placement keeps every arrow pointing the right way. Sometimes the graph allows more than one answer, and then I pick with a few rules.

The examples extend the [card catalog](/architecture/overview/#the-running-example) with three more areas. `browsing` is the search screen: a search field, filters, a sort and a grid of cards. `collections` holds a person's saved lists of cards, each card with a count. `stats` measures a list of cards: how many of each kind, how the costs are spread. These rules came out of [riftcards](/projects/riftcards/architecture/ownership-and-placement/), where its modules are called features and the real cases are on that page.

## Containment is not ownership

The browsing screen shows cards, and it's natural to say "the catalog contains the cards". Reasoning from that, the `Card` type would live under `browsing`, since that's where cards appear.

Follow what happens next. `collections` needs `Card` to record which cards a list holds, so it imports `browsing`. `stats` needs `Card` to measure a list, so it imports `browsing` too. Neither of them browses anything. Those two edges describe nothing real, and now every change to the search screen's folder is a change that `collections` and `stats` depend on.

The other way round works. `cards` is a peer of `browsing`, not a part of it. `browsing` reads cards and owns no model at all: its search criteria, its sort options, the grid and the filter sheet are all presentation. That's still a legitimate domain. A domain is one coherent thing the app does, not a table, so a domain that stores nothing and one that only calculates are both fine.

So the question is never "what contains this?". A thing can appear inside many screens and belong to none of them.

## Three tests for an owner

When a concept has more than one plausible home, I ask three questions, in this order.

**1. Would another domain need this if the candidate owner didn't exist?** Take a card's kind. `stats` needs it to count kinds, and `collections` needs it for a limit per kind. Neither needs it because of `browsing`, which only happens to filter by it. So the kind belongs to `cards`, the domain that would still need it with `browsing` deleted.

**2. Does it name a type only one domain should use?** Not "does it name a domain type", which is a weaker question and gives wrong answers. An image component that takes `{ source, alt, fit }` names nothing specific to cards, so it stays in the shared `components/` even if its file is called `card-image`. A stripe that colors a tile by `CardKind` names a card type, so it moves into `cards`.

**3. Is this module retrieving the concept, or only coordinating?** The next section is about this one.

## Ownership follows what is retrieved, not who calls

Say the browsing grid needs a page of cards. Something has to declare the port that reads a page, and something has to own the code that loads it and tracks the loading. `browsing` is the only caller, so it looks like the owner. It isn't: that code retrieves cards through a cards port, so it's `cards`' code, and `browsing` calls it. A domain that retrieves nothing of its own owns no repository, and `browsing` shouldn't become a storage domain just to hold filters, a sort or a slimmer card type.

What follows from that:

- **A matched pair isn't split by consumer.** If one loader pages full cards and another pages a slim card summary, they differ only in which card type and which cards port they use. Putting one in `cards` and the other in `browsing`, because `browsing` happens to be the summary's only caller, is the split that would need a justification.
- **Ownership determines placement, not usage count.** Once a concept has a real owner, all of it moves together. If `cards` owns eight value objects and five of them are mostly used by `browsing`, moving those five by call count would leave `card.ts` importing them from `browsing`, the exact edge the move was meant to remove.

## A domain may expose UI for its own types, never borrow another's

Here the collection detail screen shows two `stats` panels, a cost curve and a mix of kinds. The screen belongs to `collections`, the panels render `stats` result types, and something has to put them together. Either the screen imports the panels, or the route puts them together, and I've used both.

**Option 1: a domain exposes components that render its own types.** `stats` owns `CostCurvePanel`, which takes a `stats` result. The collection screen imports it directly. That's an edge from `collections` to `stats`, in a legal direction. What a domain may not do is borrow another domain's rendering: a card-art component that names card media belongs to `cards`, and if it sits in the shared `components/` and `collections` imports it from there, it's in the wrong place and moves to `cards`.

- What it buys: a screen says what it renders. Reading the collection screen tells you the panels are there.
- What it costs: domains import each other's UI, so the domain graph gets more edges. It only works if `stats` may be imported by `collections` while `stats` itself imports `cards`, and the [leaf rule](/architecture/domains-and-the-graph/#leaves-and-non-leaves) forbids exactly that. So this option needs a graph that allows any acyclic shape, with the cycles checked on [the domain graph itself](/architecture/domains-and-the-graph/#or-check-cycles-on-the-domain-graph-itself).
- Used by [riftcards](/projects/riftcards/architecture/ownership-and-placement/#a-feature-may-expose-ui-for-its-own-types): its deck screens import the analysis panels. It considered composing at the route and rejected that as a default.

**Option 2: domains meet only at the route.** No domain imports another domain's `ui/`. The collection screen exposes a slot, and the route fills it with the `stats` panels. How that works is on [two domains meet at the route](/architecture/dependency-injection/#two-domains-meet-at-the-route-not-inside-each-other).

- What it buys: no domain edge at all, so the leaf rule can hold and a domain cycle stays impossible by construction.
- What it costs: the coupling moves to the route rather than going away, and the screen alone no longer says what it renders. You have to read the route to find the panels.
- Used by [the reader](/projects/reader/architecture/composing-screens/): both of its readers show the capture panel through a slot the route fills.

The choice follows from the graph. Under the leaf layout, option 2 is the only one available. Under an any-DAG layout, option 1 is the default and option 2 is for a dependency that is really optional or substitutable, like the case in the next section.

## Naming or slotting: which side of a pair holds the edge

One domain can use another by naming it or by slotting it:

- **Naming.** It imports the other domain and names its types and capabilities. `collections` names `cards`: it holds cards and calls a cards port.
- **Slotting.** It declares a hole and something above it fills the hole. The card details view takes a `notes` slot, draws it where notes belong, and has no reference to what goes in it. The route fills it. No edge exists.

A slot can only hold UI. It can't stand in for a type. So sometimes there's no choice: if a domain needs another domain's types or capabilities, it has to name it, and the direction is forced. `collections` can't hold a list of cards without the card type. Only when a domain just needs to place some UI it shouldn't import is there a choice, and then the choice is whether the edge exists at all.

When there is a choice, the meaning determines the direction of the edge: **the domain that would be meaningless without the other is the one that names it.** A note is about a card. Delete every note and `cards` is untouched. Delete every card and a note about one means nothing. So `annotations` names `cards`, and the card view slots the note control.

From each side, that looks like this:

- `cards` slots. It has a place beside the title and a place under the text, filled by something it doesn't import.
- `annotations` names. A note holds `{ kind: 'card'; id: CardId }`, imports `cards` for that id, and fetches the card to draw its title beside the note. Nothing passes it the card. That's what makes a screen of "every note I've written" possible, because a domain that can't resolve its own subjects can't list them.

With it, the subject union can hold each owner's own branded id, so it states exactly what may be annotated and with which identifier. And [a slot can be a function](/react/render-props-and-tanstack-query/#a-render-prop-is-the-react-slot) that makes UI, not only UI: a list of a thousand rows takes one `noteControlFor(id)` and calls it per row, instead of a thousand nodes.

The cost is the same as in option 2 above: reading the card view alone doesn't tell you a note control appears there. The side that doesn't depend on the other pays for the slot.

The other layout keeps `annotations` a leaf. It refers to a card by a `CardId` that lives in [the kernel](/architecture/domains-and-the-graph/#the-kernel-knows-no-domain) and never imports `cards`. That keeps every domain edge provably acyclic, and it's the layout the card catalog uses under [the leaf rule](/architecture/domains-and-the-graph/#leaves-and-non-leaves) and the one [the reader](/projects/reader/architecture/domains/) uses. The price is that `annotations` can't resolve its own subjects, so showing a card's title beside a note happens at the route or in a non-leaf, and the id type leaves its owner. [Riftcards](/projects/riftcards/architecture/ownership-and-placement/#naming-and-slotting-annotation) took the naming layout, with the ids staying in the features that own them.

## Calls may cross an edge; vocabulary may not enter the model

A dependency graph can decay without any new edge. An existing, legal edge starts passing types where it used to pass only calls.

Take `collections → stats`, which is allowed. To draw the cost curve, `collections` reduces its entries to `stats`' input type, `CardCount = { card, quantity }`, and passes them to `costCurve(counts)`. That names a `stats` type inside `collections`, and it's correct: you can't call a function without using its types.

Now someone tidies up. A collection entry also holds a card and a quantity, so they write `interface CollectionEntry extends CardCount` in the collection model, to avoid declaring the same two fields twice. The direction is still legal, so every dependency check passes. But the collection model can no longer be read without opening `stats`, and if `stats` later adds a field to `CardCount`, every collection entry inherits it.

The test is: **can you remove the dependency by deleting a call?** If yes, it's behavior, and it's fine. If you'd first have to redefine one of your own types, it's vocabulary, and it has entered your model. A call is reversible. A type in your model is much harder to take back out, and every reader of that model inherits the other domain.

The fix moves the edge down one layer. `CollectionEntry` declares its own `card` and `quantity`, and the `CardCount` is built at the call site. The two types then hold the same fields. That repetition is the boundary: two lines of repetition are what stop `collections` inheriting whatever `stats` adds later. Don't-repeat-yourself is right inside a domain and wrong across one.

This holds whichever graph layout you use. A non-leaf that imports a leaf's `domain/` can let the leaf's types into its own model the same way. [Extracting analysis](/projects/riftcards/architecture/extracting-analysis/) is the real case.

## A name in the wrong domain comes before the import

Say `stats` started out inside `collections` and was later moved out into its own domain. The imports get fixed, so the graph is clean. But names like `collectionSize` and `benefitsTheCollection` came along with the code.

Nothing is broken yet. The trouble comes later: the next person to touch `stats` reads `collectionSize`, reasonably concludes that `stats` depends on collections, and imports the collection type to compute it. The name led them to add the edge back.

So a name that belongs to another domain is the leading indicator of a dependency about to come back, and it shows up before any import does. When a module moves, I rename its vocabulary in the same change: `collectionSize` becomes `poolSize`, because `stats` measures a pool of cards and has no idea where it came from. The renames riftcards made when it extracted analysis are on [extracting analysis](/projects/riftcards/architecture/extracting-analysis/#the-renames).
