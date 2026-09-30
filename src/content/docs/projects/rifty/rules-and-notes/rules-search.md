---
title: Searching the Core Rules
description: Hits, matches, occurrences and passages, and why this is the one search done in JavaScript.
tags: [rifty, ui-patterns, sqlite]
sidebar:
  order: 51
---

The Rules tab in Rifty, my Riftbound card app, shows the whole [core rules document](/projects/rifty/rules-and-notes/core-rules/) and has a find bar over it. Someone types a word, every occurrence in the document is highlighted, a count line shows how many there are, and *Previous hit* and *Next hit* step through them. A *Matches only* toggle hides the rules that don't contain the word.

Everywhere else in the app, filtering happens in the database, as [filter, sort, page and count in the store](/architecture/capabilities/#filter-sort-page-and-count-in-the-store) describes. This search is the one deliberate exception.

## Four words for search

A search over rules produces several kinds of thing, and "match" or "result" alone can't distinguish them. So each kind gets its own word, with one meaning:

- An **occurrence** is one appearance of the query in one piece of text. It's represented as a start offset, because the screen splits the text at that offset to highlight it.
- A **passage** is one searchable text within a rule: its body, or one of its details (a bullet or an example).
- A **match** is one rule that contains at least one occurrence, with its passages and its hit count.
- A **hit** is an occurrence counted across the whole document. `hitCount` totals them, and the active hit is the one that next and previous step to.

Details are searched along with the body, and a hit in a detail is reported against that detail, as its own passage, rather than as an offset into the rule's body. That keeps an example from being shown as if the rule itself said it.

Occurrences never overlap: `aa` in `aaa` is one hit, not two. The screen highlights by splitting the text at each offset into a sequence of spans, and overlapping ranges can't become a sequence of spans.

## The screen uses the same words

These four words reach the screen unchanged. I settled that on 2026-09-15. The count line reads `4 hits in 2 rules`, and the buttons read *Previous hit* and *Next hit*.

A find bar in most apps would show "17 matches" for what the code calls 17 hits. Adopting that wording would have crossed two words at once: the visible "match" would mean the code's hit, while the visible "rule" meant the code's match. Anyone reading a bug report would have had to translate both. The *Matches only* toggle keeps its name, and it's precise: it shows only the matches, and a match is a rule that holds hits. This is the [one word per concept](/practices/one-word-per-concept/#one-word-everywhere-the-concept-appears) rule reaching the screen.

## No query is not an empty result

`searchCoreRules` returns a union. When the query is blank after trimming, it returns `{ type: "noQuery" }` rather than a search with no matches.

The two cases look alike and mean different things. With no query, nothing was searched, so the screen shows the whole document without highlights. With a query that matched nothing, the search ran and found no hits, so the screen replaces the document with a note that nothing in the rules text matches. If both came back as an empty result, the screen would have to trim the query again itself to distinguish them. The variant encodes the difference directly.

A searched result holds the matches, the total `hitCount`, and the set of rule numbers to show, which includes each matching rule's ancestors so a match is never displayed without the headings above it.

## Why this search runs in JavaScript

The rule this breaks has a history. Rifty filters, sorts, pages and counts in SQLite, and never narrows a fetched page in JavaScript. The rule exists because a `limit` was once applied in the database before a filter ran in memory, and the filter only received the first page: a pool of 369 cards was silently cut to about 50.

The core rules don't have that problem, because they have no page and no limit. `features/rules` loads all 1364 entries on purpose, since the screen scrolls the document end to end. A filter in JavaScript over the loaded document covers every entry.

And the search needs something only JavaScript can produce. Highlighting every occurrence needs the offset of each one, and the only way to get those offsets is to scan the text the screen is about to render. The scan lowercases the text and the query and walks the text with `indexOf`, collecting each start offset.

Once that scan exists, its result already holds which rules match and how many hits there are. Asking SQLite for the same counts would run the same search twice, in two languages that fold case differently: SQLite's `LIKE` [only folds case for ASCII characters](/storage/sqlite/#like-folds-case-for-ascii-letters-only) ([SQLite's documentation](https://www.sqlite.org/lang_expr.html) gives `'æ' LIKE 'Æ'` as false), while JavaScript's `toLowerCase` folds far more. A rule could then be counted by one and highlighted by the other, or neither. So `core-rule-search.ts` is a pure function over the loaded document, and SQLite isn't involved in search at all.

Lowercasing has a limit of its own: for a few characters, `toLowerCase` returns a string of a different length, which would move every offset after it. Keeping offsets correct under folding is what [folding text for search](/text/search-folding/) is about.

This exception covers the core rules search and nothing else. It doesn't license narrowing a fetched page in JavaScript anywhere else in the app. A list that's paged in the database still gets its filters in the database, through its criteria and its adapter. The exception holds only because the core rules are loaded whole and the offsets can only come from the rendered text, and a new case has to meet both conditions and be written down the same way before it counts.
