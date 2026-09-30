---
title: "SQLite: Schema Changes, Pragmas and Statement Limits"
description: "What ALTER TABLE can do and when DROP COLUMN works, foreign keys switched on per connection, RESTRICT timing, WAL stored in the file, the bound-variable cap, and ASCII-only LIKE case folding."
tags: [storage, sqlite]
sidebar:
  order: 5
---

These are the SQLite facts I needed while building an app that keeps all its data in one SQLite file on the device, with Drizzle generating the migrations. Each one is checked against [sqlite.org](https://www.sqlite.org/). The Expo side of the setup is on [Expo setup](/react-native/expo-setup/), and the worked example is [the SQLite and Drizzle page for Rifty, my Riftbound card app](/projects/rifty/persistence/sqlite-and-drizzle/).

## ALTER TABLE does four things; anything else is a table rebuild

When a schema changes, the migration has to change the tables already on the device. SQLite's [`ALTER TABLE`](https://www.sqlite.org/lang_altertable.html) supports only a few changes: rename a table, rename a column, add a column and drop a column. SQLite 3.53.0 (2026-04-09) added a fifth, setting or dropping `NOT NULL` on a column with `ALTER TABLE … ALTER COLUMN`, but an app only gets it once the SQLite it ships is that new.

Anything else, like adding a foreign key or a `CHECK` to an existing table, needs the rebuild procedure the same page describes. In short: with foreign keys switched off, inside a transaction, create a new table with the new schema, copy the rows across with `INSERT INTO new_X SELECT … FROM X`, drop the old table, rename the new one to the old name, recreate its indexes, triggers and views, run `PRAGMA foreign_key_check`, commit, and switch foreign keys back on. It's easy to get one of those steps wrong by hand, which is a reason to get the constraints right in the first `CREATE TABLE`.

## DROP COLUMN needs no rebuild unless something depends on the column

`ALTER TABLE … DROP COLUMN` exists since SQLite 3.35.0. It fails, and a rebuild is needed instead, when the column:

- is the primary key or part of it;
- has a `UNIQUE` constraint;
- is indexed, or named in the `WHERE` clause of a partial index;
- is named in a `CHECK` constraint other than one attached to the column itself;
- is used in a foreign key constraint;
- is used in a generated column's expression;
- appears in a trigger or a view.

A plain column nothing else refers to drops cleanly. Adding a whole new table never needs a rebuild either: it's a `CREATE TABLE`, and the existing tables aren't touched.

## Foreign keys are off until each connection turns them on

A schema can declare foreign keys, and SQLite will still not check them. [Foreign key enforcement is off by default](https://www.sqlite.org/foreignkeys.html), for backward compatibility, and it's a setting of the database connection, not of the file. So every connection has to run `PRAGMA foreign_keys = ON` after opening. Without it, a key declared `ON DELETE RESTRICT` is never checked, and a delete that should fail goes through.

WAL (write-ahead logging) mode is different. [`PRAGMA journal_mode = WAL`](https://www.sqlite.org/wal.html) is persistent: once set, the database comes back in WAL mode the next time it's opened. The other journal modes fall back to the default when the database is reopened. I still set both pragmas together at startup; on a file already in WAL mode, setting it again changes nothing.

Two details of the keys themselves matter once they're on:

- `RESTRICT` fails the change at the moment the parent row is deleted or changed. Ordinary enforcement checks at the end of the statement, or at the end of the transaction for a deferred key, but a `RESTRICT` action fails immediately, even on a deferred key.
- A child row whose foreign key column is `NULL` needs no parent row. A nullable reference, like an optional field that hasn't been chosen yet, passes the key.

## A statement binds at most 999 variables on older builds

A statement's values are bound as parameters (the `?` placeholders), and SQLite caps how many one statement may use. The cap, `SQLITE_MAX_VARIABLE_NUMBER`, [defaulted to 999 before SQLite 3.32.0 and is 32766 since](https://www.sqlite.org/limits.html). A build can also set its own value.

A batch insert binds one parameter per column per row, so a batch of rows costs rows × columns parameters. An `IN (…)` list costs one per item. Sizing batches against 999 is the conservative choice: a batch that fits it fits any build, whatever SQLite the app ends up running on. In an upsert, an `excluded.column` reference in the conflict clause is a column reference, not a parameter, so it adds nothing to the count. How Rifty sizes its chunks and batches against the limit is in [the variable limit](/projects/rifty/persistence/sqlite-and-drizzle/#the-variable-limit).

## LIKE folds case for ASCII letters only

SQLite's `LIKE` is case-insensitive, but [only for ASCII characters by default](https://www.sqlite.org/lang_expr.html#the_like_glob_regexp_match_and_extract_operators): `'a' LIKE 'A'` is true, and `'æ' LIKE 'Æ'` is false. Case folding across all of Unicode needs the ICU extension, which provides its own `LIKE`.

So a search that has to match accented or non-Latin text the same way regardless of case can't rely on plain `LIKE`. It also can't be split between SQL and JavaScript, because the two handle case differently: a row could be found by one and not by the other. [Rifty's core rules search](/projects/rifty/rules-and-notes/rules-search/) runs entirely in JavaScript partly for this reason, and [folding text for search](/text/search-folding/) covers the JavaScript side.

## A new table is one more migration, not a version bump

With generated migrations, adding a table is one more migration in the folder. The app applies the ones it hasn't run yet, in order, at startup, and the code that doesn't use the new table is unaffected.

IndexedDB in the browser works differently: [adding a store to a live database is a version bump](/storage/indexeddb/#adding-a-store-to-a-live-database-is-a-version-bump-and-every-adapter-on-that-database-has-to-move-together), and every adapter that opens that database has to move to the new version together. SQLite has no such coupling between the schema and the code that opens the file.
