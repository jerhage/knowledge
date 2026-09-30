---
title: The Catalog Seed Pipeline
description: The Deno scripts from the card API to a bundled seed, covering derivation, feed defects, name repair, grouping, invariants, and a seeder that upserts.
tags: [rifty, sqlite, drizzle, images]
sidebar:
  order: 71
---

Rifty, my Riftbound card app, ships its whole card catalog inside the app and loads it into SQLite on first launch. The catalog comes from an upstream card API, and a pipeline of Deno scripts, run by hand, turns what the API returns into a TypeScript seed file that the app bundles. The pipeline stands in for an API adapter the app doesn't have; if a live feed is ever added, it becomes [another adapter](/architecture/extension-points/#a-remote-source-is-another-adapter). Where the data ends up is on [SQLite, Drizzle and the migrations](/projects/rifty/persistence/sqlite-and-drizzle/).

## The scripts

Everything lives in `scripts/`. The pipeline imports the app's own domain schemas by relative path (`../src/features/card/value-objects/...`, `../src/infrastructure/database/reference-schema/...`), because it runs under Deno without the app's `@/` import alias. An alias-based find-and-replace after moving a file will miss these.

1. **`fetch-cards.ts`** (`npm run fetch:cards`) pages through the card API set by set, with throttling and retries, and saves the raw JSON under `data/api/`, which is gitignored.
2. **`card-derivation.ts`** derives what the feed doesn't provide as data: speeds and the keywords a card owns, with their magnitudes, parsed from rules text; champion names; the printing's identity, parsed from the feed's face id; the finish; and the name normalization (`identityName` and `cleanName`).
3. **`extract-keywords.ts`** scans rules text for bracketed keywords and special costs, to find tokens the derivation doesn't handle yet.
4. **`card-image-file.ts`** and **`fetch-card-images.ts`** (`npm run fetch:card-images`) rank the image sources for each printing and download the best into `data/images/`. `npm run convert:card-images` re-encodes them to WebP with `cwebp -q 82`.
5. **`catalog-seed.ts`** is the pure transformation from normalized printings to seed rows. It reads no files, so tests import it directly.
6. **`generate-catalog-seed.ts`** (`npm run generate:catalog-seed`) is the I/O shell around it. It reads `data/`, calls `buildSeed`, writes `src/infrastructure/database/generated/catalog-seed.ts`, hashes the content into `CATALOG_SEED_VERSION`, and reports skipped cards and identity conflicts.

`dependency-graph.ts` sits in the same folder but isn't part of the pipeline: it's the `check:deps` command ([the graph checker](/projects/rifty/architecture/checking-the-graph/)). The core rules have a second pipeline in the same folder, with no shared code, described on [the core rules document](/projects/rifty/rules-and-notes/core-rules/).

## Printings before cards

The feed describes printings, not cards. Until the pipeline groups them, it holds printings that don't have a card yet, and its types reflect that: the working type is `NormalizedPrinting`. That's the one place in the project where a printing exists without its card, which is why the word `printings` is right throughout `catalog-seed.ts` and appears nowhere under `src/`.

Each printing's identity is computed here, from the set code, collector number, pool code and finish ([how](/projects/rifty/cards/identities/#printingid-is-built-from-the-release)). The feed's own key for the record is kept as `NormalizedPrinting.sourceId` while the pipeline reconciles records, and it's never written to a table, following [never persist another system's surrogate key](/architecture/entities-and-value-objects/#never-persist-another-systems-surrogate-key).

## Reading the finish from the feed's name

A printing's finish (`standard`, `alternateArt`, `metal`, `signature` and eight more) belongs to the printing, and the feed doesn't give it as a field. It's read at the pipeline boundary from the feed's printing name, from its trailing parenthetical like `(Metal)`. When the name has none, it's read from three booleans the feed does provide. Only four of the twelve finishes can be reached from those flags; the other eight exist because the feed's name contains them.

Since the finish is extracted before the name is normalized, dropping the suffix from the stored name loses nothing.

## Name repair

The feed's names weren't consistent enough to store as they were. Across the catalog, 424 names separated their parts with ` - ` and 100 with `, `. 19 cards had printings whose names differed from each other. 234 names had a finish suffix the pipeline had already read into `finish`, and 71 of the 157 alternate-art printings had no suffix at all.

So the pipeline repairs names once, before anything else reads them. `withRepairedIdentities` rewrites each printing's `identityName` to the name `reconciledIdentities` computed for its card, with commas rather than ` - ` and no finish suffix. Every later step (`currentPrintings`, `withoutPoollessDuplicates`, `releaseKey`, `cardGroups`) reads the repaired name off the printing instead of keeping a repair map of its own. And since 2026-09-13 the printing row's `printedName` is that same `identityName`, so it equals the card's id on every row. The normalization happens once, at the boundary, and everything after it treats the name as given.

## Two feed defects, fixed in one place

The feed has two known defects, and `currentPrintings` in `catalog-seed.ts` corrects both, so nothing downstream has to handle them.

- **Preview rows without a pool.** The preview feed omits the pool segment. `withoutPoollessDuplicates` drops a printing with no pool code when a pooled printing shares its card, set code, collector number and finish. That removes 21 of the 241 preview rows. The other 220 are the only source for their cards and stay.
- **Reissued printings.** The feed sometimes reissues a printing under a fresh key. `newestOfReissued` keeps the newest `sourceUpdatedAt` for each `(riftboundId, finish)` pair. That affects 12 pairs, each an old ObjectId row superseded by an `openrift-` one.

The two rules are deliberately asymmetric. Supersession ignores the pool code, while the printing id includes it, because the same printed card can be several products: `Body Rune` at collector number `r04b` is three distinct printings, in pools 219, 221 and 298.

## Grouping printings into cards

`catalog-seed.ts` groups the 1429 printings under 941 cards, and has to set the card's values when its printings differ:

- **Single values take the newest printing**: rules text, supertype, champion name. A later printing is errata.
- **Lists take the union**: tags, domains, speeds, keywords. A promo tagged only `[Sett]` must not strip `Ionia` from the card.

## The invariants

Before writing anything, `assertValid` checks every row against the Drizzle insert schemas, then checks invariants over the whole seed:

- one printing per release key;
- card ids and printing ids are unique;
- every printing has a media row;
- every Riftbound id has exactly one printing marked `isCanonical`;
- every card has a printing;
- no foreign key is orphaned.

Each one throws, rather than returning a result. A bad seed is a bug in the pipeline, not something a caller can handle, so it should stop the build loudly.

## The generated seed

The output, `src/infrastructure/database/generated/catalog-seed.ts`, is about 89,000 lines and gitignored. A fresh checkout won't compile or run until `npm run generate:catalog-seed` has produced it, which in turn needs the downloaded `data/`.

There's a gap in what the tests prove here. `tests/catalog/catalog-seed-generator.test.ts` imports `scripts/catalog-seed.ts` under Jest, which resolves modules its own way. So `npm test` never exercises Deno's module resolution. Only a real `npm run generate:catalog-seed` proves the scripts' relative imports still resolve after files move.

## The seeder only runs when the seed changed

On the device, `reference-seeder.ts` compares the version stored in `catalog_seed_state` with the bundled `CATALOG_SEED_VERSION` at startup, and imports the seed only when they differ. It checks the version again inside the one exclusive transaction that does the import, so the check and the writes happen under the same lock.

It inserts 40 rows per statement. `card_printing` has 12 columns, so that's 480 bound values, inside SQLite's conservative 999-variable budget ([the variable limit](/projects/rifty/persistence/sqlite-and-drizzle/#the-variable-limit)).

## The seeder upserts and never deletes

A deck row points into the catalog: `deck_card.card_id`, `deck_card.printing_id` and `deck.chosen_champion_card_id`. Following the declared foreign keys from those columns reaches six tables: `card_type`, `card_supertype`, `rarity`, `card_set`, `card` and `card_printing`. The seeder upserts those six and never deletes from them. The other twelve reference tables hold no reference from someone's own data, so it still replaces them outright, children first.

That rule is what let the deck's foreign keys be `ON DELETE RESTRICT` ([how a deck is stored](/projects/rifty/decks/deck-storage/#the-foreign-keys-restrict)). A wholesale delete of the catalog would have hit those keys on any device with a deck. It also never matched anything real: card releases are additive, and nothing is ever un-printed.

The consequence is deliberate. A card or printing that a later seed drops lingers on a device that already has it, because only a fresh install rebuilds the catalog from nothing. Such a row has no media row, since the association tables are still replaced. The summary query left-joins media and throws when a printing has none, the same error the detail path throws, instead of silently dropping the printing out of the page while the count still includes it ([fixed 2026-09-11](/projects/rifty/cards/catalog-browsing/#paging-in-sqlite)).

## Serving the images

The images aren't bundled with the seed. During development `npm start` runs `python3 -m http.server` on port 8787 alongside Expo, rooted at `data/images`, so a device on the same network can load them. The wrapper script that starts the server, `scripts/with-card-images.sh`, also sets `EXPO_PUBLIC_CARD_IMAGE_HOST` to the machine's LAN address. `composition/card-image-host.ts` builds the base URL from that host, or from Expo's host URI when it isn't set, or from `localhost` as a last resort, with the port from `EXPO_PUBLIC_CARD_IMAGE_PORT` (8787 by default). A development build launched straight onto a device gets no host URI from Expo, which is why the script names the host. `composition/dependencies.ts` passes that base URL down to the card adapter, which composes each URL from the stored file name.
