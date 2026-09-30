---
title: "One Word per Concept: A Project Glossary"
description: A glossary that fixes one word per concept across talk, types, variables and screens, with rulings, banned words, open questions, and the naming rules that follow from it.
tags: [naming-conventions, domain-driven-design]
sidebar:
  order: 1
---

A project picks up words fast. A card becomes a "card" in one file, an "item" in the next and an "entry" on screen, and nobody decided that; each word was reasonable where it was written. The cost shows up later, when someone reads `entry` and has to work out which of three things it holds.

The fix I use is a glossary: a document in the repository that says which word names each concept, and that settles it when two words compete. Domain-driven design calls the shared vocabulary a ubiquitous language; the glossary is where I write mine down. Riftcards, my React Native app, has one, split over four pages starting at [cards, printings and sets](/projects/riftcards/glossary/cards-and-sets/). The examples here use the [card catalog](/architecture/overview/#the-running-example) where they can.

## One word, everywhere the concept appears

The rule is one word per concept, and the same word in every place the concept shows up: in conversation, in a type name, in a variable name and on the screen.

The screen matters as much as the code. Say the code calls a saved collection of cards a `Deck`, and the list screen calls them "lists". A person reports that "my list won't save", and whoever picks up the report now has to translate before they can search the code. When the words match, the report names the type.

Before I name a type, a field, a variable, a component or a label, I check whether the concept is already in the glossary. If it is, I use that word exactly. If the concept is new, it goes into the glossary in the same commit that introduces it, so the glossary never lags behind the code.

## What an entry holds

An entry names one concept and says three things about it:

- what the word means, in one sentence, including what it doesn't cover;
- where it's defined in the code, so the reader can check the entry against the type;
- a real value from the project, like an actual card id or an actual count, so the meaning is concrete.

The real value does more than illustrate. When the code changes and the value stops being true, the entry visibly no longer matches the data, and that's a prompt to fix one or the other. An entry with only a definition can go stale without anyone noticing.

## Rulings name a winner

Sometimes two words are already in use for one thing, or one word for two things. Then I write a ruling in the glossary: it names the winning word, says why, and lists what changed.

A ruling is binding. Where the code disagrees with it today, the code is what changes, not the ruling. In riftcards, for example, several variables that held a printing id were called `cardId`, which is the name of a different id. The ruling said a variable is named for its type, and all of them were renamed on the same day.

Sometimes both words win, for different things. "Criteria" and "filters" both stayed in riftcards, because they name two stages: filters are what a person picked on screen, and criteria are what the database query receives. The ruling then records where each one applies, so the pair stays apart.

## Banned words, and unsettled ones

Some words lose so often that they get their own list. Each banned word comes with what to say instead and why. A few from riftcards:

| Banned | Say instead | Why |
| --- | --- | --- |
| chrome | shell, layout | jargon that names nothing a reader can point at |
| invalid deck | illegal deck | validation is a boundary concern; legality is a judgment |
| list (for a saved deck) | deck | a deck is a deck |
| stats, cost (as names) | attributes, energy | both were second words for concepts already named |

A banned word can also be a pattern rather than a word, like a string key built by joining two ids that later gets sliced apart with a cast.

Not every question gets settled right away. When I can't decide, the glossary records the question as open: the competing words, what each would mean, and what's at stake. That's better than leaving it out, because an open item shows the next person that the collision is known and hasn't been resolved by accident.

## Name a thing for what it provides

A name can describe what a thing provides, or the mechanism inside it. Take a function that attaches a long-press handler which opens a card and fires a haptic buzz. Called `hapticLongPress`, it names only the mechanism. That invites the wrong question: "can I pass it an intensity?" A name that describes a mechanism suggests the mechanism is what callers configure.

Called `openCardHapticLongPress`, it names where it wires, what it does and that a physical side effect fires. A second long press with a different weight isn't a second argument; it's a second, named function, say `removeCardHapticLongPress`. That keeps the haptics library in one file, makes the set of actions reviewable in one place, and gives the next difference (a longer delay, a confirmation for a destructive action) somewhere to go. The riftcards version is on [React rules I hold in riftcards](/projects/riftcards/presentation/react-conventions/), and the rule for React hooks is on [a hook is named for what it provides](/react/components-and-effects/#a-hook-is-named-for-what-it-provides).

The same holds for ports: `CardFinder`, `Clock` and `IdGenerator` say what they provide, never the library or store inside them.

The test: could a caller pass something that contradicts the name? If yes, the parameter controls something the name should fix.

## A name must match everything it covers

In riftcards, a card's `attributes` are exactly three numbers: energy, might and power. A formatter named `formatCardAttributes` was once changed to also return the card's finish. Nothing broke at compile time. But every caller that read the name and trusted it to return attributes was now wrong, silently. That change is why the riftcards glossary exists.

A name covers a set of things, and adding one more thing to the set breaks every reader of the name. So a function that returns attributes and something else names both: `formatCardTypeAndAttributes` matches what it returns. If a third thing gets added, the name gains a third thing, or the function is split.

A formatter is named for the line it produces, not the data it reads: `deckCountLabel(deck)`, not `formatDeck`. And a label that a screen reader reads aloud has `spoken` in its name (`spokenEditedLabel`), because the visual label and the spoken one are different strings.

## A variable is named for its type, not its call site

It's tempting to name a variable after the place it's used. In a function about printings, a `Card` gets called `printing`; in a loop over deck rows, anything gets called `entry`. Then the same word holds different types in different files, and the reader can no longer learn anything from the name.

So a variable's name follows its type. In the catalog, a `Card` is `card` wherever it appears, and a `CardId` is `cardId`, never `id`. A plural says what there are several of. A pair type names the pair: a card with a quantity is a `CardCopy` called `copy`, not a `Card` with a count bolted on. A table in the glossary makes this checkable: for each type, the name to use and the names never to use.

## A mode is a state, not an action

An editor that can create a new deck or edit an existing one needs a value that says which. In riftcards it was first called `DeckBuildStart`, and the ruling changed it to `DeckBuildMode`.

The difference is time. A start is an instant: it's true for one moment and then it's over. A mode is what you're in, for as long as you're in it. You're in create mode from the moment you start a new deck until you save it, whichever step of the editor you're on; you haven't created anything yet. The value describes the whole session, so its name should too.

That also settles the type. A mode may hold data (edit mode holds the deck it opened), because the data belongs to the state, not to the moment it began.

The test for the word: if it stops being true one step later, it's an action. If it stays true until something ends it, it's a mode.

## Say what the thing is

Some words sound precise and aren't. "Chrome" for the surrounding UI of an app is the usual example: it's jargon that names nothing a reader can point at. I say "shell" or "layout" instead.

The same goes for any borrowed word. If a newcomer would have to ask what it refers to, and the answer is a plainer word, use the plainer word.
