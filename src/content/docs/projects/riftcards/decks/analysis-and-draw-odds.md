---
title: "Analysis: Curves, Mixes and Draw Odds"
description: The analysis feature over CardCopy[], curves, mixes, hypergeometric odds, opening hands, mulligans, and shuffling with an injected random source.
tags: [riftcards, architecture, typescript]
sidebar:
  order: 33
---

A deck's detail screen shows how the deck is built: how many cards at each energy cost, the balance of speeds and keywords, the odds of drawing a card early, and a simulator that deals sample opening hands. In riftcards all of that is the `analysis` feature: eight files with no persistence, three of pure calculation (`card-copy.ts`, `card-metrics.ts`, `draw-simulation.ts`) and five panels that draw the results, all working over a list of cards the caller hands it. How it came out of the deck feature without a cycle is on [extracting analysis](/projects/riftcards/architecture/extracting-analysis/).

## Analysis measures a multiset, not a deck

Every function in analysis takes the same input, `readonly CardCopy[]`. A `CardCopy` is `{ card, quantity }`: a card and how many copies of it are in play. It's the only input type analysis accepts.

The caller selects what goes in. The deck feature's `deck-contents.ts` reduces a deck's entries to `CardCopy` values for the sections being measured, and `deck-analysis-format.ts` passes them to functions like `energyCurve`. So nothing in a curve or a speed mix references sections, legality or champions.

That's the rule for the whole feature: **analysis must not name a deck.** A game term that survives in the wrong module is the leading indicator of a dependency about to come back. That's why the renames around the extraction mattered even after the imports were clean: `deckSize` became `poolSize`, `ChampionOdds` became `PinnedOdds` (since removed, see below), and two days later, on 2026-09-11, `benefitsTheDeck` became `benefitsOwnSide`. An analytic that has to reference decks is in the wrong feature: either the caller should reduce the deck to a pool of cards first, or the measurement belongs in `deck`.

The panels that draw the results (`AttributeCurve`, `SpeedMix`, `KeywordMixPanel`, `DrawOddsPanel`, `HandStatsPanel`) live in analysis too, since they render analysis's own result types. Deck screens import them, which is the legal direction.

## Curves and mixes

`card-metrics.ts` holds the measurements, and two words keep them apart.

A **curve** counts cards per bucket of an attribute. `energyCurve` and `mightCurve` each return a `CurveBucket[]` of `{ label, count }`: how many cards cost 1, 2, 3 and so on, each counted by its quantity.

A **mix** is shares of a whole. `speedMix` returns `SpeedShare[]`, and `keywordMix` returns `{ carrying, keywords }`. The keyword mix counts only keywords that help the side holding the card (`benefitsOwnSide`), and it leaves out `action` and `reaction`, which duplicate a card's speeds, and `equip`.

There's no "tally". A panel was once called `KeywordTally`, the only thing that used the word, and a count of shares is a mix, so it's `KeywordMixPanel` now.

Some measurements exist with no panel yet: `mightCurve` and `totalPower` are marked in the code as kept for panels that would render them, and each has tests.

## Draw odds are hypergeometric

The odds panel computes the answer to one question: if the deck holds a certain number of copies of a card, how likely am I to have drawn at least one by a given point?

Drawing cards is sampling without replacement, so the answer is hypergeometric. Say the pool holds N cards, K of them copies of the card in question, and I've seen n cards. The chance of seeing none is the chance each draw misses, given the draws before it also missed:

```text
P(no copy in n draws) = (N-K)/N * (N-K-1)/(N-1) * ... * (N-K-n+1)/(N-n+1)
P(at least one)       = 1 - P(no copy in n draws)
```

That's the same as `1 - C(N-K, n) / C(N, n)`, written as a running product so it never computes a large binomial coefficient. `atLeastOneChance(poolSize, copies, draws)` does exactly this. It returns `0` when any input is zero or less, and returns `1` early if the running miss chance reaches zero, which happens when there aren't enough other cards left to keep missing.

`drawOdds(copies)` sets `poolSize` to the total quantity of the copies it's given. It then adds up copies by `cardId` rather than by printing, since three copies split across two arts are still three chances at the card. For each distinct number of copies held, it computes two odds: for the opening hand (4 cards) and by turn three (6 cards seen: the opening four plus two draws). The constants are `OPENING_HAND_SIZE = 4` and `TURN_THREE_CARDS_SEEN = 6`.

For a pool of 40, the numbers come out like this:

| Copies held | Opening hand (4 seen) | By turn three (6 seen) |
| --- | --- | --- |
| 3 | 27.7% | 39.4% |
| 2 | 19.2% | 28.1% |
| 1 | 10.0% | 15.0% |

When analysis was extracted, the odds also included a pinned entry, `PinnedOdds`: the odds for the one card passed to a panel, named `pinned` because analysis has no concept of a champion. Its `name` field rendered the card's id, which is correct, since a card's id is its name. On 2026-09-14 I dropped the Chosen Champion's own odds, and the pinned entry went with them.

## Dealing a hand

The draw simulator deals a sample opening hand from the deck, lets someone replace some of it, and gives a quick verdict.

`dealHand(copies, shuffle)` expands the copies into a flat list with one entry per physical card, shuffles it, and deals the first four. It returns a `DealtHand` of `{ hand, pool, cursor }`: the hand, the whole shuffled pool, and the position of the next card to draw.

`mulliganHand(dealt, indexes)` replaces the cards at the chosen positions with the next cards from the pool, in order, and moves the cursor on. It returns a `MulliganedHand` with the new hand and how many cards were replaced. At most `MULLIGAN_LIMIT = 2` cards can be chosen: `toggleMulliganSelection` returns `{ type: "atLimit" }` instead of a third selection, so the screen can show why the press did nothing.

`handStats(hand)` averages energy and power over the cards that have them and counts early plays: cards costing `EARLY_PLAY_ENERGY = 2` or less. The `HandVerdict` is `keepable` if there's at least one early play and `risky` if there's none.

In analysis, `opening` means "in the opening hand". The hooks that open a card's detail use the same word for showing it. They never meet in one module, and I keep it that way.

## Shuffling with an injected random source

A shuffle is random, and random code is hard to test: the same test run twice deals different hands. So `dealHand` doesn't call `Math.random()`. It takes the shuffle as a parameter:

```ts
function dealHand(
  copies: readonly CardCopy[],
  shuffle: <T>(items: readonly T[]) => readonly T[],
): DealtHand
```

The randomness comes from further out. `RandomSource` is an application port with one method, `next(): number`, and the composition root provides it, backed by `Math.random`. The draw simulation screen builds its shuffle from it: a Fisher-Yates shuffle in `shared/shuffle.ts` that takes a `nextRandom` function. A test can pass a shuffle that returns the list unchanged, or a random source with a fixed sequence, and then assert on the exact hand dealt. The general rule is [time, ids and randomness come from ports](/architecture/dependency-injection/#time-ids-and-randomness-come-from-ports).

## `poolSize` is still an open name

Three things in riftcards are called a pool: a printing's `poolCode` (a product pool), the deck builder's candidate list (`SectionPool*`), and the cards being drawn from here (`DrawOdds.poolSize`, `DealtHand.pool`). The third was named on purpose, when `deckSize` had to go because analysis must not name a deck, and that reasoning stands.

But the builder's pool and the simulator's pool aren't the same set: one is what someone may add, the other is what they'll draw. `dealHand` already calls its unshuffled list `library`, so `librarySize` and `DealtHand.library` would name the cards being drawn from without naming a deck. I haven't decided between that and accepting that "pool" carries both senses. It's recorded as open in the [glossary rulings](/projects/riftcards/glossary/rulings/).
