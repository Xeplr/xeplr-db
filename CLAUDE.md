# @xeplr/db — map

The database layer every xeplr backend sits on: Postgres knex connections from an encrypted login,
the tenant- and application-scoped Objection `BaseModel`, the `.sql` migration runner, the
`xeplr_config` control-plane bootstrap, and `dataDir` (per-tenant file folders). Used by auth, base-apis,
actions, imports, jobs, workflow, BI. NOT a query layer for user databases (that is `@xeplr/actions` drivers).

## Where things are
- `index.js` — the public surface (re-exports only).
- `lib/connection.js` — `resolveConfig()` (decrypt + cache a login by name, legacy `<NAME>_CONNECTION`), `getConnection(dbName, dbInfo, { bind, pool, client, connectionName })` (cached per dbName), `bindModels()`, `destroy/destroyAll()`, `ensureDatabaseFor()`, `getResolvedConfig()`.
- `lib/resolve-connection.js` — `resolveDbConnection(serviceVar)` (service var else `XEPLR_DB_CONNECTION`), `describeDbConnection()`.
- `lib/BaseModel.js` — `BaseModel` (`query()` = modifiers `active` + `application` + `tenant`; `unscopedQuery()` drops tenant only; `$beforeInsert/$beforeUpdate`; statics `multiTenant`, `mtLevels`, `applicationScoped`, `schema()`), tenancy (`registerMTs`, `mtMiddleware`, `runWithMt`, `getMtContext`, `getMtConfig`, `MT_ALL`, AsyncLocalStorage), application scope (`registerApplication`, `getApplicationId`, `requireApplicationId`, `APP_ALL`).
- `lib/application-column.js` — `addApplicationIdColumns()` (migration helper), `assertApplicationIdColumns()` (boot check).
- `lib/dataDir.js` — `root()`, `tenantFolder()`, `scratch()`, `resolve(name, what)`, `nameOf()`, `requiredEnv`; errors `DATA_DIR_UNSET`, `NO_TENANT`, `PATH_NOT_ALLOWED`.
- `lib/sqlMigrator.js` — `up()`, `status()` (with `drift`), `create()`; ledger `xeplr_migrations`, `substituteEnv()` for `${VAR}`, plain `pg` client.
- `lib/migrator.js` — knex migrations: `up/rollback/status/create/seed/createSeed/buildKnexConfig`.
- `lib/directories.js` — `resolveDirectories(ownDir, extDir, type)`: the one place comma lists are split and missing dirs throw.
- `lib/app-migrations.js` — `migrationsFor(app)` → raw `XEPLR_<APP>_MIGRATIONS`, `migrationsVar(app)`.
- `lib/bootstrap-config.js` — `bootstrapConfigDb({ connection, database, extDir, seed, poolMax })`, `ensureDatabase()` (`assertSafeDbName`).
- `lib/pool.js` — `poolOf(given)`: min 0 + 1 s idle under `node --test`. Only `test/pool.test.js` uses it today.
- `config/migrations/*.js` — knex migrations for xeplr_config: `import_meta` (+tenant), countries, states, `0004_application_id`, templates, units. `config/seeds/` + `config/data/*.json` — countries, states, 41 units.
- `bin/migrate.js` — `xeplr-migrate` CLI (create, create-db, up, status) over `sqlMigrator`. `bin/encrypt-config.js` — `xeplr-db-encrypt`.

## Flow
- App boot: `registerApplication(id)` → `registerMTs({ l1, l2 })` → `resolveConfig(name, resolveDbConnection(VAR))` → `sqlMigrator.up({ db, dir, extDir: migrationsFor(app), connectionName })` → `getConnection(db, conn)` (binds models) → `app.use(auth)` then `app.use(mtMiddleware())`.
- Request: `mtMiddleware()` reads registered headers → `_mtStore.run(ctx)` → `Model.query()` adds `isActive`, `applicationId IN (id,'*')` (scoped models), `mtIdN IN (ctx,'*')` or `1 = 0` when a level is missing.
- Worker: `Model.unscopedQuery()` → per row `runWithMt({ mtId1, … }, fn)`.
- Files: `dataDir.resolve(name)` → `root()` (XEPLR_DATA_DIR, absolute, existing) → `tenantFolder()` (`<root>/<applicationId>/<mtId1>/<mtId2>`, `*` → `_all`) → realpath + `inside()` check.
- Control plane: `bootstrapConfigDb()` → `ensureDatabase()` → knex `migrate.latest()` over `resolveDirectories(config/migrations, XEPLR_CONFIG_MIGRATIONS)` with `sortDirsSeparately` → `seed.run()`.

## To change X, edit Y
- Tenant filtering / insert stamping → `BaseModel.js` `modifiers.tenant`, `$beforeInsert` (keep `unscopedQuery` dropping tenant only).
- Application scoping → `BaseModel.js` `modifiers.application`, `requireApplicationId()`; per-table column → `application-column.js`.
- Knex pool sizing → `connection.js getConnection()` (inline `pool:`), and `pool.js poolOf()`.
- A new control-plane table → new `config/migrations/000N_*.js` (knex, distinct filename) + seed in `config/seeds/` if reference data (`applicationId = '*'`).
- Migration ordering / extension dirs → `directories.js resolveDirectories()` only.
- `XEPLR_<APP>_MIGRATIONS` naming → `app-migrations.js`.
- `.sql` runner behaviour (ledger, checksum, `${VAR}`) → `sqlMigrator.js`.
- Data-root rules (what is refused, folder layout) → `dataDir.js resolve()`, `tenantFolder()`, `segment()`.
- CLI flags → `bin/migrate.js parseArgs()`.

## Rules and traps
- `applicationId` is per process (`registerApplication`, once; a different name throws), never from a header. Only `xeplr_configs`-style shared tables set `applicationScoped` true (workspace CLAUDE.md "Tenancy vs application scope").
- A scoped model throws on read and write without `registerApplication()` — intended, do not soften to empty results.
- Missing tenant context = no rows (`1 = 0`); insert missing a required level throws naming the header.
- `getConnection` for an existing dbName returns the cached knex and ignores new options (warns on a different `bind`). The first `bind: true` connection becomes every model's knex.
- Ledgers are keyed by filename alone; extension dirs must use distinct filenames. A missing extension dir throws (by design).
- `sqlMigrator.up` needs `connectionName` already `resolveConfig`-ed; an unset `${VAR}` in a .sql throws.
- Never default a data root or DB name; `dataDir` refuses unset/relative roots by name.
- `lib/dataDir.js` requires `./BaseModel` lazily (`db()`), so `directories.js`/bootstrap stay dependency-light.
- Library style here mixes `const`/`let` (connection, migrators, bootstrap) with `var`; new code uses `var` per workspace rules.

## Test
- No `test` script in `package.json`; run `node --test test/*.test.js`.
- `test/data-dir.test.js`, `test/pool.test.js` — no DB, set their own temp `XEPLR_DATA_DIR`.
- `test/bootstrap-config.test.js` — live Postgres, creates/drops `xeplr_config_test`; reads `PG_HOST PG_PORT PG_USER PG_PASSWORD` with fallbacks `localhost:5435`, `postgres`/`postgres` (an empty `PG_PASSWORD` falls back to `postgres`). Local: `PG_HOST=localhost PG_PORT=5432 PG_USER=vikasbhandari PG_PASSWORD= node --test test/*.test.js`. It does not skip without a DB.
