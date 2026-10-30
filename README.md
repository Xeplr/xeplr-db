# @xeplr/db

**Postgres connections, a tenant-scoped Objection `BaseModel`, and a `.sql` migration runner** — the database layer every xeplr service is built on.

```js
var { getConnection, registerMTs, mtMiddleware, BaseModel } = require('@xeplr/db')

registerMTs({ l1: { name: 'companyId', header: 'x-company-id' } })
await getConnection('myapp', process.env.XEPLR_DB_CONNECTION)   // encrypted { host, port, user, password }
app.use(mtMiddleware())

class Department extends BaseModel { static get tableName() { return 'departments' } }
await Department.query()   // active rows of the company in x-company-id — nothing else is reachable
```

## How the pieces fit

| what | where |
|---|---|
| Connection per database name, models bound to it | `getConnection(dbName, dbInfo)` |
| Where the server is and who logs in | an **encrypted** `{ host, port, user, password }` blob, decrypted with `ENCRYPTION_KEY` — never a database name |
| Who owns a row inside an app (company, workspace) | `mtId1`–`mtId4`, per request, from headers — `registerMTs` + `mtMiddleware` |
| Which product owns a row in a shared database | `applicationId`, per process — `registerApplication` |
| Schema changes | hand-written `NNNN_name.sql` files, applied once — `sqlMigrator` / `xeplr-migrate` |
| The framework's control-plane database (`xeplr_config`) | `bootstrapConfigDb` |

## Install

```sh
npm i @xeplr/db @xeplr/utils
```

Built for Postgres: `pg` is the dependency, `client` defaults to `'pg'`, and `sqlMigrator`, `ensureDatabase` and `bootstrapConfigDb` talk to Postgres directly. Brings `knex` and `objection`. `@xeplr/utils` supplies the encryption used for connection strings.

## Quick start

```sh
ENCRYPTION_KEY=… npx xeplr-db-encrypt --name xeplr_db --host localhost --port 5432 --user postgres --password secret
# prints XEPLR_DB_CONNECTION=<encrypted>
```

```js
var { getConnection, resolveDbConnection, sqlMigrator, resolveConfig, migrationsFor,
      registerMTs, mtMiddleware, BaseModel } = require('@xeplr/db')

var conn = resolveDbConnection('MYAPP_CONNECTION')   // the service's own var, else XEPLR_DB_CONNECTION

await resolveConfig('myapp', conn)
await sqlMigrator.up({ db: 'myapp', dir: 'migrations', extDir: migrationsFor('myapp'), connectionName: 'myapp' })

registerMTs({
  l1: { name: 'companyId', header: 'x-company-id' },
  l2: { name: 'workspaceId', header: 'x-workspace-id' }
})
await getConnection('myapp', conn)

app.use(authGate)          // first, so req.user exists
app.use(mtMiddleware())    // then tenant context from the headers
```

## Connections

| export | does |
|---|---|
| `getConnection(dbName, dbInfo?, options?)` | Opens (or returns the cached) knex for `dbName` and binds the Objection models to it. `dbInfo` is an encrypted string or a decrypted `{ host, port, user, password }`. Options: `connectionName` (use a config already resolved under that name), `bind` (default `true`; `false` for a secondary connection that must not become the models' knex), `client` (`'pg'`), `pool` (`{ min: 2, max: 10 }`) |
| `resolveConfig(name, source?)` | Decrypts and caches a login under `name` (case-insensitive). Without `source`, reads `<NAME>_CONNECTION` — a legacy fallback |
| `resolveDbConnection(serviceVar, { sharedVar, env }?)` | The service's own variable if set, else `XEPLR_DB_CONNECTION`. Throws naming **both** when neither is set |
| `describeDbConnection(serviceVar, opts?)` | Which variable that would use, or `null` — for a startup log line |
| `bindModels(knex)` | `Model.knex(knex)` |
| `destroy(dbName)` / `destroyAll()` | Close one / every cached connection |
| `ensureDatabaseFor(source, dbName)` | `CREATE DATABASE` if missing, from an encrypted or decrypted login. Returns `{ created }`. Needs a login with `CREATEDB` |
| `ensureDatabase(login, dbName)` | The same from a decrypted login. Only `[A-Za-z_][A-Za-z0-9_]*` names — `CREATE DATABASE` cannot be parameterised |

Rules:

- **One connection variable for the server, one name per service.** The blob holds no database, so one `XEPLR_DB_CONNECTION` serves `xeplr_auth`, `myapp`, `myapp_jobs`. A per-service variable still wins when set — the day one service needs its own server or a read-only user is a config change, not a code change.
- **A second `getConnection` for the same `dbName` returns the cached connection** and ignores its options; a different `bind` value logs a warning rather than silently rebinding.
- A decrypted blob is cached per string, so the same value is decrypted once.

## BaseModel

```js
class Task extends BaseModel {
  static get tableName() { return 'tasks' }
  static get jsonSchema() { return BaseModel.schema({ required: ['title'] }) }
}
```

Every `query()` applies three modifiers, and no single call can opt out of them:

| modifier | filter |
|---|---|
| `active` | `isActive = true` |
| `application` | `applicationId = <registered> OR '*'` — only when `applicationScoped` |
| `tenant` | each registered level: `mtIdN = <context> OR '*'`. **A missing context value returns no rows** (`where 1 = 0`) |

On insert: `recordCreatedDate` / `recordModifiedDate` are set, `isActive` defaults to `true`, `applicationId` is stamped (when scoped), and `mtId1…` are filled from the context. **An insert with a required tenant value missing throws**, naming the header the request lacked (`the request is missing its x-company-id header (companyId)`) — the column name would tell the person reading the 500 nothing. On update, `recordModifiedDate`.

| static | default | |
|---|---|---|
| `multiTenant` | `true` | `false` for a table shared by every tenant |
| `mtLevels` | `null` (all registered) | enforce **fewer** levels — e.g. `workspaces` is scoped by company only |
| `applicationScoped` | `false` | `true` only for a table more than one application writes to |
| `schema({ required, properties })` | | a jsonSchema with the audit-date formats folded in; Postgres enforces lengths, types and foreign keys |
| `unscopedQuery()` | | `active` and `application` still applied — **only the tenant filter is dropped** |

`unscopedQuery()` exists for background workers, which have no request and so no tenant — `query()` would find nothing, silently, forever. Whoever uses it must re-establish each row's tenant (`runWithMt`) before acting on it. It is named to be greppable so every use can be reviewed.

## Tenancy

| export | does |
|---|---|
| `registerMTs({ l1: { name, header }, l2, l3, l4 })` | Once per process, at startup. Levels must be contiguous from `l1`; the number given is the number enforced. Headers are lower-cased |
| `mtMiddleware()` | Express middleware: reads the registered headers into `{ mtId1, mtId2, … }` and runs the rest of the request inside that context. Mount after auth |
| `runWithMt(ctx, fn)` | Run `fn` with a tenant context (`AsyncLocalStorage`) — for workers and scripts |
| `getMtContext()` | The current context, or `{}` |
| `getMtConfig()` | `{ enabled, levels, slots }` |
| `MT_ALL` | `'*'` — a row value visible to every tenant at that level |

An app that never calls `registerMTs` gets no tenant filtering. It is process-local state: the API server, the auth service and every worker each register their own.

## Files: a folder per tenant (`dataDir`)

Where any package keeps a tenant's files: under one root, **`XEPLR_DATA_DIR`** (required, absolute, existing — `dataRequiredEnv`), in the folder of the tenant the work runs as. Here, beside the context it reads, so `@xeplr/actions`, `@xeplr/utils`' uploads, `@xeplr/base-apis`, `@xeplr/imports` and `@xeplr/factory` all use one copy.

```
<XEPLR_DATA_DIR>/<applicationId>/<mtId1>/<mtId2>/…
```

| `dataDir.` | does |
|---|---|
| `resolve(name, what?)` | A name (`bank/inbox/sept.csv`) → its real absolute path in the tenant's folder. A full path is accepted only when already inside. Refused (`PATH_NOT_ALLOWED`): anywhere else, `../`, a symlink pointing out, an address (`http://`, `file://`) |
| `tenantFolder()` | The folder, made if missing. `*` at a level is `_all`; no tenant, a missing level, or an id that could be a path is refused (`NO_TENANT`) — never the root. No application registered: refused. An app with no tenancy registered is one tenant, `<root>/<app>` |
| `scratch()` | The tenant's `tmp/` |
| `nameOf(path)` | A path's name inside the tenant's folder, or `null` — what a screen shows |
| `requiredEnv` | `['XEPLR_DATA_DIR']` (also exported as `dataRequiredEnv`) |

The tenant comes from the context (a request after its membership is checked, a job, a workflow run) — **never from input**. Missing, relative or absent root: refused by name (`DATA_DIR_UNSET`), because a wrong root that boots reads as empty data.

## Application scope

A second axis, independent of tenancy.

| export | does |
|---|---|
| `registerApplication('xeplr-bi')` | Once per process. Idempotent under the same name; **a different name throws** — rows already written carry the first |
| `getApplicationId()` | The registered id, or `null` |
| `APP_ALL` | `'*'` — a row every application reads (countries, states) |
| `addApplicationIdColumns(db, { applicationId, sharedTables?, exclude? })` | For a migration: adds `applicationId varchar(100) NOT NULL` to every public table lacking it, backfilled (`'*'` for `sharedTables`), indexed. The default is then dropped on app-owned tables so a later insert that forgets the column fails instead of being attributed to whoever ran the migration. Idempotent; takes knex or a pg `Client` |
| `assertApplicationIdColumns(db, { database?, exclude? })` | At boot: throws naming every table without the column |

Why it is never read from a header: a tenant is the caller's to choose among its own; the application is not. A client-supplied app id would let any request read another product's rows by changing one header.

Why it is off by default: a database only one product opens (`xeplr_bi`, an auth DB) is already isolated by being its own database. Scope a model only in a store several products share (`xeplr_config`). A model that is scoped throws — on reads too — if `registerApplication` was never called, so a boot-order mistake fails loudly instead of looking empty.

## Migrations

### sqlMigrator — use this for new schemas

```js
await resolveConfig('auth', process.env.XEPLR_DB_CONNECTION)
await sqlMigrator.up({
  db: 'xeplr_auth',
  dir: path.join(__dirname, 'migrations'),   // the library's own
  extDir: migrationsFor('auth'),             // XEPLR_AUTH_MIGRATIONS, if set
  type: 'precede',
  connectionName: 'auth'
})
```

| function | does |
|---|---|
| `create(name, { dir })` | Writes the next `NNNN_name.sql` (`0001`, `0002`, …) |
| `up({ db, connectionName, dir, extDir, type, tableName })` | Applies pending files in filename order, each in its own transaction. Returns `{ migrations }` |
| `status(opts)` | `{ completed, pending, drift }` — `drift` lists applied files whose content has changed since |

- **Applied once, no down.** The ledger (`xeplr_migrations`: `filename`, `checksum`, `appliedAt`) is keyed by **filename alone**, so directories contributing to one database must keep filenames distinct (`0001_workflow_access.sql`, not `0001_access.sql`).
- **`${VAR_NAME}`** in a file is replaced from the environment before it runs; an unset variable throws rather than writing `undefined` into applied SQL.
- Run through a plain `pg` client, not knex, so a literal `?` (jsonb operators, regexes) is never taken for a bind parameter.
- `connectionName` must already be resolved with `resolveConfig`.

### Extension directories

| `type` | order |
|---|---|
| `precede` (default) | the library's `dir`, then each `extDir` |
| `succeed` | each `extDir`, then `dir` |
| `override` | `extDir` only |

`extDir` is a path, an array, or a comma-separated string. **A directory that does not exist throws** — an absent directory would otherwise contribute zero files and a clean boot.

`migrationsFor(app)` reads `XEPLR_<APP>_MIGRATIONS` (`undefined` when unset); `migrationsVar(app)` returns that name. One convention in every library — `XEPLR_AUTH_MIGRATIONS`, `XEPLR_EMAIL_MIGRATIONS`, `XEPLR_JOBS_MIGRATIONS`, `XEPLR_WORKFLOW_MIGRATIONS`, `XEPLR_CONFIG_MIGRATIONS`. Pass the result as `extDir`; parsing lives in one place so a library's server and its CLI cannot read the same variable two ways.

### migrator — knex migrations

Kept for knex-format migrations (the `xeplr_config` bootstrap and older consumers): `up`, `rollback`, `status`, `create` (a `.js` table template with `id`, `mtId1–4`, audit columns, `isActive`), `seed`, `createSeed`, `buildKnexConfig`, `resolveDirectories`. Same `db` / `connectionName` / `dir` / `extDir` / `type` options.

### bootstrapConfigDb

```js
var { db, created, migrations, seeds } = await bootstrapConfigDb({
  connection: { host, port, user, password },   // may create databases
  database: 'xeplr_config'                        // default
})
```

Creates the database if missing, runs the bundled knex migrations (`import_meta`, `countries`, `states`, `applicationId` on every table, `templates`, `units`) and seeds countries, states and the standard units (`seed: false` to skip). Idempotent. It holds no credentials; connection details belong to the consumer.

**An app's own migrations run after the library's,** from `XEPLR_CONFIG_MIGRATIONS` (or `extDir`). They are knex `.js` files, each directory in turn (`sortDirsSeparately`), one ledger keyed by file name, so keep app file names distinct. A directory that does not exist is an error. This variable was documented but never read, so an app could not add a row to `xeplr_configs` at all.

**Units** (`units`): a master list every app converts with.
- **Kind and factor:** each unit has a `kind` (weight, length, volume, area, energy, time) and a `factor` to that kind's base unit, as an exact decimal (`numeric(38,18)`). The bases are kg, m, L, m², kWh and h. Any unit converts to any other of the same kind by the two factors.
- **Standard units:** 41 of them, in `config/data/units.json`, seeded with `applicationId = mtId1 = mtId2 = '*'`. An upsert on id, so a corrected factor reaches every install.
- **A company's own units** (e.g. a "bag" of 50 kg) are rows with its `applicationId` and `mtId1`.
- **Codes:** unique per (application, company, workspace) among live rows.

Migration-directory resolution lives in `lib/directories.js`, which has no dependencies, so this bootstrap does not load the connection layer.

## CLIs

### `xeplr-migrate`

Reads `process.env` only; the app loads its own `.env`.

```sh
npx xeplr-migrate create add_tasks --dir migrations
npx xeplr-migrate create-db --connectionName myapp --connection-env XEPLR_DB_CONNECTION --db myapp
npx xeplr-migrate up        --connectionName myapp --connection-env XEPLR_DB_CONNECTION --db myapp --dir migrations
npx xeplr-migrate status    --connectionName myapp --connection-env XEPLR_DB_CONNECTION --db myapp --dir migrations
```

| option | |
|---|---|
| `--connectionName` / `--connection-name` | required for `up`, `status`, `create-db` |
| `--connection <encrypted>` or `--connection-env <VAR>` | the login; omit both to read `<CONNECTIONNAME>_CONNECTION` |
| `--db <name>` or `--db-env <VAR>` | falls back to `DB_<CONNECTIONNAME>`, then `DB_NAME` |
| `--dir`, `--extDir`, `--type`, `--tableName` | as in `sqlMigrator.up` |

The CLI runs `sqlMigrator` (`.sql` files). It does not read `XEPLR_*_MIGRATIONS` itself — pass `--extDir`.

### `xeplr-db-encrypt`

```sh
npx xeplr-db-encrypt --name api --host localhost --port 5432 --user postgres --password secret [--key <key>]
```

Prints the encrypted `{ host, port, user, password }` and a `<NAME>_CONNECTION=…` line. Key from `--key` or `ENCRYPTION_KEY`.

## Environment

| variable | used by |
|---|---|
| `ENCRYPTION_KEY` | decrypting any connection string; `xeplr-db-encrypt` |
| `XEPLR_DB_CONNECTION` | `resolveDbConnection` — the shared encrypted login |
| `<NAME>_CONNECTION` | `resolveConfig(name)` without a source; the CLI without `--connection` |
| `XEPLR_<APP>_MIGRATIONS` | `migrationsFor(app)` |
| `DB_<NAME>`, `DB_NAME` | `xeplr-migrate` database-name fallback |
| any `${VAR}` in a `.sql` file | `sqlMigrator.up` — must be set |
| `XEPLR_DATA_DIR` | `dataDir` — the root of every tenant's files (`dataRequiredEnv`) |

## Tests

```sh
node --test test/*.test.js
```

`data-dir.test.js`: the folder per tenant on a real folder — two companies with the same names, each refused the other's files by full path, `../`, a link and an address; `*`, a missing level, an id that could climb; no application; the root required, absolute, existing.

Integration test for `bootstrapConfigDb` against a live Postgres: creates, migrates, seeds and drops `xeplr_config_test`. Connection from `PG_HOST`, `PG_PORT` (default `5435`), `PG_USER`, `PG_PASSWORD`.

## License

MIT
