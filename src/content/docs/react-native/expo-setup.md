---
title: "Expo Setup: expo-sqlite with Drizzle, Migrations in the Bundle, and expo lint"
description: "Drizzle's Expo driver and migrations.js, inlining .sql with a Babel plugin, the startup order, expo-sqlite's bundled SQLite, replaying migrations on node:sqlite under Jest, and what npx expo lint does."
tags: [expo, react-native, sqlite, drizzle]
sidebar:
  order: 4
---

An Expo app that keeps its data on the device can use expo-sqlite for the database and Drizzle to define the schema and generate migrations. Wiring the two together takes a few pieces of setup that aren't obvious from either library alone. These are the ones I needed. The worked example is [riftcards' SQLite and Drizzle setup](/projects/riftcards/persistence/sqlite-and-drizzle/), and the SQLite facts behind them are on [SQLite](/storage/sqlite/).

## Drizzle's Expo migrations import .sql files, and Babel has to inline them

On a server, Drizzle's migrator reads migration files from disk when it runs. An app on a phone has no project folder to read from, so the migrations have to travel inside the JavaScript bundle. Drizzle handles that with an Expo driver in `drizzle.config.ts`:

```ts
export default defineConfig({
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/infrastructure/database/**/*-schema/*.ts",
  out: "./drizzle",
});
```

`schema` can be a glob, so tables split across several folders are all found. Running `npx drizzle-kit generate` writes the SQL for each schema change into `out` (the drizzle-kit 1.0 release candidate I use writes a folder per migration, holding `migration.sql` and a `snapshot.json`), and, because of the Expo driver, a `migrations.js` beside them. That file imports every `migration.sql` and exports them in one object for the migrator. Both the folders and `migrations.js` get committed, since the app bundles `migrations.js` and the next `generate` compares against the snapshots.

Importing a `.sql` file isn't something the JavaScript toolchain does on its own. `babel-plugin-inline-import` fills the gap: it replaces each `import m0000 from "./…/migration.sql"` with the file's contents as a string at build time. It's one entry in `babel.config.js`:

```js
plugins: [["inline-import", { extensions: [".sql"] }]],
```

Drizzle's Expo guide also adds `sql` to Metro's `sourceExts` in `metro.config.js`. TypeScript needs a declaration file that types such an import:

```ts
declare module "*.sql" {
  const contents: string;
  export default contents;
}
```

`npx drizzle-kit check` then checks that the generated migration history is consistent, which I run as part of the project's checks.

## At startup: open, set the pragmas, migrate, then seed

The app opens its database once, before any screen reads from it, and the order of the steps matters:

```ts
const database = SQLite.openDatabaseSync("app.db");
await database.execAsync("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
await migrate(drizzle(database), migrations);
// then seed reference data, then build the adapters
```

The pragmas come first because foreign key enforcement is a setting of the connection, not of the file, so it has to be switched on before the migrator or the seeder writes anything. Why both pragmas are needed is on [SQLite](/storage/sqlite/#foreign-keys-are-off-until-each-connection-turns-them-on). `migrate` comes from `drizzle-orm/expo-sqlite/migrator` and applies the committed migrations that haven't run yet. Drizzle's guide shows the same module's `useMigrations` hook, which runs migrations from a component; a plain function fits better when the database is opened by startup code outside of rendering.

Migrating and seeding can fail, and when they do, the error should say which step failed. So each step is wrapped only to add that context, and the original goes along as `cause`:

```ts
throw new Error(`Could not migrate the app database: ${errorMessage(error)}`, { cause: error });
```

Nothing is swallowed. The error travels to whatever boundary shows startup failures.

## expo-sqlite ships its own SQLite, not the operating system's

iOS and Android each come with a copy of SQLite, but expo-sqlite doesn't use it. It bundles its own SQLite library, built into the app. So a question like "does my SQLite support this?" is answered by the version expo-sqlite ships, not by the phone's OS version.

The version is in the package's vendored header, `node_modules/expo-sqlite/vendor/sqlite3/sqlite3.h`, as `SQLITE_VERSION`. For example, expo-sqlite 57.0.2 (the version riftcards uses) bundles SQLite 3.50.3, and its SQLCipher copy is a separate, older 3.49.1. A feature added after the bundled version isn't there, however new the device is: SQLite 3.53.0's `ALTER TABLE … ALTER COLUMN` for setting or dropping `NOT NULL` isn't available in 3.50.3.

## Under Jest, replay the same migrations on node:sqlite

Tests run under Jest on Node, where expo-sqlite's native code isn't available. The tempting substitute is an in-memory fake of each repository. But a fake only does what its author thought of, and it won't reject a delete that a foreign key would.

Node has a real SQLite built in, `node:sqlite`, and Drizzle has a driver for it, `drizzle-orm/node-sqlite`. So a test store can be the real engine:

1. create an in-memory `DatabaseSync(":memory:")` and run `PRAGMA foreign_keys = ON`;
2. read each committed `migration.sql` from the migrations folder, in folder-name order (the names start with a timestamp), and execute it;
3. wrap the client with `drizzle({ client })` and put the production repository adapters on top.

The tests then run against the same schema the app migrates to, with the same adapters, and foreign keys are enforced, so a test can prove the database rejects a delete that would strand a row. One test store holds every table, mirroring the one database file on the device; splitting it per feature would test a layout the device never has. This is the Node side of [running a scenario on real critical infrastructure](/testing/tests-as-evidence/#a-scenario-runs-on-real-critical-infrastructure).

## npx expo lint installs ESLint and rewrites the lock file

`npx expo lint` looks like a harmless check. In a project without ESLint set up, Expo's documentation says it installs the dependencies it needs (ESLint and `eslint-config-expo`) and creates an `eslint.config.js`. Installing packages changes `package.json` and rewrites the lock file.

That's fine when setting up ESLint on purpose. In a project that lints with something else, such as oxlint, it adds a second linter and dependency churn nobody asked for. So in such a project I never run it, and I treat any `npx <tool>` the same way: it can install things as a side effect, so I check what it does first.
