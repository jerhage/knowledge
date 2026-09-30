---
title: SQLite, Drizzle and the Migrations
description: One database file, reference data against the person's own rows, 27 tables, squashed migrations, startup, and mappers that parse.
tags: [riftcards, storage, sqlite, drizzle, expo]
sidebar:
  order: 70
---

Riftcards stores everything on the device in one SQLite database, through [expo-sqlite](/react-native/expo-setup/), with Drizzle defining the schema and generating the migrations. There's no server. The adapters that read and write it implement the features' ports, as in [adapters implement the ports](/architecture/ports-and-adapters/#adapters-implements-the-ports); this page is about the database behind them.

## One file, two kinds of data

The database file holds cards, sets, the core rules, decks and annotations. Its tables split into two kinds, and the split determines which code may write them.

**Reference data** is the seeded, read-only catalog: cards, printings, keywords, sets, taxonomy and the core rules. Its schema lives in `src/infrastructure/database/reference-schema/`, and only the seeder writes it (how is on [the seed pipeline](/projects/riftcards/persistence/seed-pipeline/)). The folder is `reference-schema/` and not `catalog-schema/` on purpose: three features read those tables (card, set and rules), and catalog is the one feature that owns none of them. `catalog-data-store.ts` was renamed to `reference-data-store.ts` for the same reason.

**The person's own rows** are what someone writes: their decks in `deck-schema/` and their bookmarks and notes in `annotation-schema/`. The seeder never touches these tables, because it only imports the ones in `reference-schema/`.

Drizzle finds all of them through one glob in `drizzle.config.ts`: `./src/infrastructure/database/**/*-schema/*.ts`.

The file is still called `catalog.db` (`CATALOG_DATABASE_NAME` in `open-app-data-store.ts`), and the seed-state table `catalog_seed_state` and the constant `CATALOG_SEED_VERSION` keep their names too. That's deliberate, not a naming precedent. Renaming the file would orphan the data on every installed device: the app would open a new, empty file and never open the old one. The seed-state names travel with the file.

## The 27 tables

```text
card, card_printing, card_domain, card_tag, card_speed, card_media,
card_image_source, card_marketplace_reference, card_keyword,
card_keyword_target, card_set, set_marketplace_reference, card_type,
card_supertype, rarity, domain, tag, keyword, catalog_seed_state,
core_rules_seed_state, core_rules_edition, core_rule, core_rule_detail,
deck, deck_card, bookmark, note
```

Foreign keys, uniqueness constraints and query-oriented indexes belong in this schema. How the card tables split between card and printing is on [cards and printings](/projects/riftcards/cards/card-and-printing/), and the deck tables on [how a deck is stored](/projects/riftcards/decks/deck-storage/).

## Migrations, squashed

SQLite's `ALTER TABLE` can't add a constraint to an existing table without [a table rebuild](/storage/sqlite/#alter-table-does-four-things-anything-else-is-a-table-rebuild). (The change SQLite 3.53.0 added, setting or dropping `NOT NULL`, is newer than the SQLite riftcards ships.) Writing a rebuild by hand for every constraint is slow and easy to get wrong.

Riftcards has no users. Every install is a development one, mine. So when a schema change would be simpler as a fresh `CREATE TABLE` than as an incremental migration, I take the simpler path: delete the migration, regenerate it, and clear the app's data on the device. I don't hand-write a table rebuild to add a constraint, and I don't keep saved decks alive across a change to an identity. That's why the migration history was squashed on 2026-09-11 into one `CREATE TABLE` migration, `drizzle/20260911185741_initial_schema/`.

Four migrations sit on top of it:

- `20260916003312_core_rules/` adds the three core-rules tables;
- `20260916004202_core_rules_seed_state/` adds their seed-state table;
- `20260916160332_annotations/` adds the two annotation tables;
- `20260916161824_drop_deck_notes/` drops `deck.notes`.

None of those four needed the squash. Adding a table needs no rebuild, and SQLite has supported `DROP COLUMN` since 3.35.0, as long as [nothing depends on the column](/storage/sqlite/#drop-column-needs-no-rebuild-unless-something-depends-on-the-column). So all four keep existing devices working.

To change the schema, I run `npx drizzle-kit generate`, commit `drizzle/` including the regenerated `drizzle/migrations.js`, and validate with `npm run check:db`. The app imports the generated `.sql` files directly. That works through `babel-plugin-inline-import` (why it's needed is on [Drizzle's Expo migrations import .sql files](/react-native/expo-setup/#drizzles-expo-migrations-import-sql-files-and-babel-has-to-inline-them)), with the module type declared in `src/types/sql.d.ts`.

## Startup

At startup, `openAppDataStore(logger, imageBaseUrl)` does five things in order:

1. opens `catalog.db`;
2. runs `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;`;
3. applies the committed migrations with Drizzle's migrator;
4. seeds the reference data (the catalog, then the core rules);
5. returns three data stores, `reference`, `decks` and `annotations`, each holding the adapters built on that part of the database.

Step 2 matters more than it looks. Without the pragma, the `RESTRICT` keys that protect decks would never be checked, because [foreign keys are off until each connection turns them on](/storage/sqlite/#foreign-keys-are-off-until-each-connection-turns-them-on).

Migrating and seeding can fail, and when they do, the error should name which step failed. So `openAppDataStore` catches those failures only to add that context ("Could not migrate the app database", "Could not seed the card catalog into the app database"), and rethrows with the original as `cause`. It never swallows one. The error travels to the startup boundary, `AppDependenciesProvider`, which shows it.

`createAppDependencies` then reads the stores into groups (`store.reference.cards` and `store.reference.keywords` into `cards`, `store.reference.sets` into `sets`, `store.reference.coreRules` into `rules`, `store.decks.repository` into `decks`, and `store.annotations.bookmarks` and `store.annotations.notes` into `annotations`) and wraps each adapter in `withQueryLogging`. The clock, the id generator and the random source sit beside those groups and don't come from the database. How those groups reach the screens is on [capabilities, adapters and the composition root](/projects/riftcards/architecture/capabilities-and-composition/).

## Adapters are named for SQLite, not Drizzle

The adapters in `src/infrastructure/sqlite/` are named for the capability they provide and the store they cross to: `SqliteCardRepository`, never `DrizzleCardRepository`. Drizzle is the library the adapter uses to query SQLite today. If it were replaced, the adapter wouldn't need a new name.

Database rows never reach feature or UI code. The adapters query rows and map them into domain models, and no caller has to put an aggregate back together from joins.

## Mappers parse every row

The mappers in `infrastructure/sqlite/` are the only bridge between rows and domain models. Each schema file pairs its Drizzle tables with row schemas made by Drizzle's Zod integration (`createSelectSchema` and `createInsertSchema`), and the mappers `parse` their select schema on every row they read.

A row that fails that parse isn't something a caller can handle. It means the database holds data the schema rules out, which is corruption or a bug, so the parse throws and the error goes to a boundary. That's the throwing parse used where invalid data is a broken contract, as in [validate where data arrives](/architecture/expected-and-unexpected-failure/#validate-where-data-arrives). Whether that's right for every row schema is the one question I've left open about it.

The same parse is where a bare string becomes a branded id like `PrintingId`. The failure to watch for is the opposite shortcut, a branded type reached by a cast ([parsing at the adapter](/projects/riftcards/cards/identities/#parsing-at-the-adapter)). No mapper calls `safeParse`. The repository's `safeParse` calls are all places where a failed parse is an expected answer: two in the seed pipeline, on the raw feed payload, where falling back to a flat shape is legitimate; four in the deck and note use cases, on a name or a note body someone typed; and one in `linked-deck.ts`, where a deck id from a route parameter that doesn't parse means an unknown deck.

## The variable limit

A SQLite statement binds its values as parameters, and [older builds cap one statement at 999 of them](/storage/sqlite/#a-statement-binds-at-most-999-variables-on-older-builds). expo-sqlite bundles its own, newer SQLite (3.50.3 in the version riftcards uses), but riftcards sizes its batches against 999 anyway. It's the conservative figure, and a batch that fits it fits any build.

The places that depend on it:

- Resolving a deck's cards by printing id sends `PRINTING_ID_CHUNK_SIZE`, 200 ids, per statement. Each chunk then fans out into one statement per related table (media, speeds, keywords, domains, tags and marketplace references), each with an `IN` list of at most those 200 printing or card ids. The keyword targets come last, keyed by each card keyword row, so that list can be longer: a card has up to four keywords in the current seed, and the 200 cards with the most keywords have 445 between them, still under 999.
- The seeder inserts the catalog 40 rows at a time. `card_printing` has 12 columns, so a batch binds 480 values. An `excluded.column` reference in the upsert's conflict clause is a column reference, not a parameter, so it adds nothing to the count.

## Case folding is ASCII only

SQLite's `LIKE` [folds case for ASCII letters only](/storage/sqlite/#like-folds-case-for-ascii-letters-only), so `'æ' LIKE 'Æ'` is false. That's one reason the core rules search runs in JavaScript instead of SQL: counting matches in SQL as well as highlighting them in JavaScript would run the same search twice in two languages that disagree about case. The full story is on [searching the core rules](/projects/riftcards/rules-and-notes/rules-search/).

## Contrast: a schema change in IndexedDB

Where adding a store to a live IndexedDB database is a version bump every adapter has to follow, in riftcards [a new table is one more migration, not a version bump](/storage/sqlite/#a-new-table-is-one-more-migration-not-a-version-bump).
