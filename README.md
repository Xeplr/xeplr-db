# xeplr-db

Database connection manager, BaseModel, and migration utilities for Knex + Objection.js.

## Install

```bash
npm install xeplr-db mysql2
```

## Usage

### Connection Manager

```js
const { getConnection, bindModels, BaseModel } = require('xeplr-db');

// Get a connection (cached by database name)
const db = getConnection('my_database');

// Or with explicit options
const db = getConnection('my_database', {
  host: 'localhost',
  user: 'root',
  password: 'secret',
  port: 3306
});

// Bind Objection.js models to the connection
bindModels(db);
```

### BaseModel

```js
const { BaseModel } = require('xeplr-db');

class User extends BaseModel {
  static get tableName() {
    return 'users';
  }
}
```

BaseModel automatically sets `recordCreatedDate` and `recordModifiedDate` on insert/update.

### Environment Variables

| Variable | Fallback | Default |
|----------|----------|---------|
| DB_HOST | server | localhost |
| DB_PORT | - | 3306 |
| DB_USER | user_name | root |
| DB_PASSWORD | password | '' |

### Migration CLI

```bash
# Create a migration
npx xeplr-migrate create users --dir ./migrations

# Run migrations
npx xeplr-migrate up --db my_database --dir ./migrations

# Rollback
npx xeplr-migrate rollback --db my_database --dir ./migrations

# Status
npx xeplr-migrate status --db my_database --dir ./migrations
```
