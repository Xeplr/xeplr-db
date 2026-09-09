const { Model } = require('objection');
const { AsyncLocalStorage } = require('async_hooks');

// Multi-tenancy config (set once at startup)
var MT_ALL = '*';
var SLOT_KEYS = ['l1', 'l2', 'l3', 'l4'];
var _mtConfig = { enabled: false, levels: 0, slots: {} };

// Per-request tenant context (thread-safe)
var _mtStore = new AsyncLocalStorage();

// APPLICATION SCOPE — a SECOND, INDEPENDENT axis from multi-tenancy, and the
// distinction is the whole point of it:
//
//   mtId1..mtId4  WHO the row belongs to inside one app (company, workspace).
//                 Per-REQUEST, read from headers, varies call to call.
//   applicationId WHICH app owns the row (xeplr-bi, xeplr-erp).
//                 Per-PROCESS, fixed at boot, identical for every request.
//
// They are not interchangeable. A companyId is minted by each app's own
// `companies` table, so the same id string in two apps means two unrelated
// tenants — which is exactly why a shared table needs BOTH columns, and why
// nothing may ever join across apps on mtId1 alone.
//
// applicationId IS DELIBERATELY NOT READ FROM A HEADER. mtMiddleware() takes
// tenant ids from the request because the caller legitimately chooses which
// of ITS OWN tenants it is acting for. The application is not the caller's to
// choose: a client-supplied app id would let any request read another app's
// rows by changing one header. It is registered in code, at boot, once.
//
// It applies to SHARED STORES ONLY — see BaseModel.applicationScoped. A
// single-app database (xeplr_bi, xeplr_erp, any auth DB) is already isolated
// by being its own database and carries no such column.
var APP_ALL = '*';
var _appConfig = { registered: false, applicationId: null };

/**
 * Register THIS PROCESS's application identity. Call once at startup, before
 * any model is queried — every row this process writes is stamped with it and
 * every row it reads is filtered by it.
 *
 *   var { registerApplication } = require('@xeplr/db');
 *   registerApplication('xeplr-bi');
 *
 * The value is the DEPLOYMENT's identity, not the package's. When xeplr-bi
 * embeds @xeplr-workflow/api they are one process serving one product, so the
 * workflow tables it writes are 'xeplr-bi' rows — that is the entire reason
 * this exists. Standalone workflow is its own deployment and registers
 * 'xeplr-workflow'. Getting this wrong is the difference between two apps
 * sharing a database safely and two apps silently reading each other's data.
 *
 * @param {string} applicationId - e.g. 'xeplr-bi'. '*' is reserved.
 */
function registerApplication(applicationId) {
  if (!applicationId || typeof applicationId !== 'string') {
    throw new Error('registerApplication: an applicationId string is required (e.g. "xeplr-bi")');
  }
  if (applicationId === APP_ALL) {
    throw new Error('registerApplication: "' + APP_ALL + '" is reserved for rows readable by every application — a process cannot run as it');
  }
  // Re-registering under a DIFFERENT name is always a bug: it means two
  // products booted into one process, and every row written before this call
  // is already stamped with the old name. Idempotent under the same name so
  // an embedded package may assert its host's identity without caring who
  // called first.
  if (_appConfig.registered && _appConfig.applicationId !== applicationId) {
    throw new Error(
      'registerApplication: already registered as "' + _appConfig.applicationId +
      '", refusing to re-register as "' + applicationId + '" — applicationId is process-global ' +
      'and rows written before this point already carry the first value.');
  }
  _appConfig = { registered: true, applicationId: applicationId };
}

/**
 * This process's registered applicationId, or null if registerApplication()
 * has not been called.
 */
function getApplicationId() {
  return _appConfig.applicationId;
}

// Shared failure for "a model was used before the app identity was set". This
// is a BOOT-ORDER bug, never a request condition, so it throws on reads as
// well as writes rather than quietly returning nothing — an app that forgot
// the call must not start up looking empty, it must fail with the fix in the
// message.
function requireApplicationId(what, tableName) {
  if (!_appConfig.registered) {
    throw new Error(
      'applicationId is not registered — cannot ' + what + ' "' + tableName + '". ' +
      'Call registerApplication("<this-app>") from @xeplr/db once at startup, ' +
      'before any model is used.');
  }
  return _appConfig.applicationId;
}

/**
 * Register the app's MT levels at startup. Each configured slot (l1..l4, in
 * order, no gaps) names the header a request carries that value in and the
 * app-meaningful name for it — e.g.:
 *
 *   registerMTs({
 *     l1: { name: 'companyId', header: 'x-company-id' },
 *     l2: { name: 'workspaceId', header: 'x-workspace-id' }
 *   });
 *
 * `levels` (how many mtIdN columns get enforced/filtered) is derived from how
 * many contiguous slots are supplied. Call this once per process — it must be
 * registered independently in every process that touches BaseModel-backed
 * data (API server, auth service, etc.), since it's process-local state.
 *
 * @param {object} config - { l1: {name, header}, l2: {...}, ... } (max 4, contiguous from l1)
 */
function registerMTs(config) {
  config = config || {};
  var slots = {};
  var levels = 0;
  var sawGap = false;
  for (var i = 0; i < SLOT_KEYS.length; i++) {
    var key = SLOT_KEYS[i];
    if (config[key]) {
      if (sawGap) throw new Error('registerMTs: levels must be contiguous starting at l1 (gap before ' + key + ')');
      if (!config[key].name || !config[key].header) throw new Error('registerMTs: ' + key + ' requires { name, header }');
      slots[key] = { name: config[key].name, header: String(config[key].header).toLowerCase() };
      levels = i + 1;
    } else {
      sawGap = true;
    }
  }
  _mtConfig = { enabled: levels > 0, levels: levels, slots: slots };
}

/**
 * Get the current mt config: { enabled, levels, slots: { l1: {name, header}, ... } }.
 */
function getMtConfig() {
  return Object.assign({}, _mtConfig, { slots: Object.assign({}, _mtConfig.slots) });
}

/**
 * Run a callback with tenant context. Use in Express middleware:
 *
 *   app.use(function(req, res, next) {
 *     runWithMt({ mtId1: req.user.companyId }, next);
 *   });
 */
function runWithMt(context, callback) {
  return _mtStore.run(context, callback);
}

/**
 * Get the current request's tenant context.
 */
function getMtContext() {
  return _mtStore.getStore() || {};
}

class BaseModel extends Model {
  static formatDateTime(date) {
    return (date || new Date()).toISOString();
  }

  /**
   * Compose a lean jsonSchema. Folds in only the audit-date formats every table
   * shares; a model declares just its own required fields (and any own field that
   * needs a format/enum ajv can check but Postgres can't cheaply). Postgres +
   * the generic controller's error mapper handle lengths/types/NOT NULL/FKs.
   *
   *   static get jsonSchema() {
   *     return BaseModel.schema({ required: ['name'] });
   *   }
   *
   * @param {object} [def]
   * @param {string[]} [def.required]   - required field names
   * @param {object}   [def.properties] - own field schemas (only where useful)
   * @returns {object} a jsonSchema
   */
  static schema(def) {
    def = def || {};
    // Only the audit dates carry validation worth keeping here (a bad ISO string
    // → a clean 422 instead of a Postgres 500). Lengths, types, NOT NULL, FKs are
    // enforced by Postgres and turned into clean statuses by the generic
    // controller's error mapper — so we don't restate them.
    var common = {
      recordCreatedDate: { type: ['string', 'null'], format: 'date-time' },
      recordModifiedDate: { type: ['string', 'null'], format: 'date-time' }
    };
    return {
      type: 'object',
      required: def.required || [],
      properties: Object.assign(common, def.properties || {})
    };
  }

  /**
   * Override in subclass to disable mt filtering for specific models.
   * e.g. models that are shared across tenants.
   */
  static get multiTenant() {
    return true;
  }

  /**
   * Opt a model into applicationId scoping. DEFAULT IS OFF, and the default
   * is the common case:
   *
   *   A DATABASE THAT ONLY ONE APPLICATION EVER OPENS DOES NOT NEED THIS
   *   COLUMN. xeplr_bi, xeplr_erp and every auth DB are reached by exactly
   *   one product, so the database itself is already the boundary and an
   *   applicationId there would be one constant value in every row — dead
   *   weight that still has to be migrated, indexed and filtered.
   *
   * Turn it ON only for a table that MORE THAN ONE APPLICATION WRITES TO:
   *
   *   - xeplr_configs — the shared control plane, opened by every app.
   *   - @xeplr-workflow/api's tables — one product embedded into several
   *     hosts, so BI's workflows and ERP's workflows can land in one place.
   *
   * Where it is on, it is not advisory: inserts are stamped, every query is
   * filtered, and a missing registerApplication() throws rather than quietly
   * returning nothing.
   */
  static get applicationScoped() {
    return false;
  }

  /**
   * Override in subclass to enforce FEWER levels than the app registered
   * globally — e.g. an app registers 2 levels (l1=companyId, l2=workspaceId)
   * but the `workspaces` table itself is only ever scoped by company (its
   * mtId1); it doesn't have a meaningful mtId2 of its own (a workspace isn't
   * scoped "by workspace"). Default (null) uses the full registered level
   * count — most models want that. Only ever LOWER this, never raise it
   * above what's actually registered (extra levels beyond registerMTs()'s
   * config are simply never enforced/checked, there's no column data for them).
   */
  static get mtLevels() {
    return null;
  }

  $beforeInsert() {
    this.recordCreatedDate = BaseModel.formatDateTime();
    this.recordModifiedDate = BaseModel.formatDateTime();
    if (this.isActive === undefined) this.isActive = true;

    // Stamp the owning application — only for models that opted in (see
    // applicationScoped). A row readable by EVERY app says so in its data, by
    // being written with applicationId '*' (reference data: countries,
    // states) — which keeps "who can see this" a fact you can SELECT rather
    // than a flag buried in a model class.
    if (this.constructor.applicationScoped && !this.applicationId) {
      this.applicationId = requireApplicationId('insert into', this.constructor.tableName);
    }

    // Auto-set mt values on insert
    if (_mtConfig.enabled && this.constructor.multiTenant) {
      var ctx = getMtContext();
      var levels = this.constructor.mtLevels != null ? this.constructor.mtLevels : _mtConfig.levels;

      // Reject insert if required tenant context is missing.
      //
      // The message NAMES THE HEADER, because that is what whoever hits this
      // has to fix. `mtId1` is an internal column name and says nothing to
      // somebody looking at a failing request; `x-company-id` is the thing
      // that is actually absent from it. This surfaces as a 500 with a stack
      // trace in most apps, so the one line they will read has to carry the
      // whole answer.
      for (var lvl = 1; lvl <= 4; lvl++) {
        if (levels < lvl) break;
        if (ctx['mtId' + lvl] || this['mtId' + lvl]) continue;
        var slot = _mtConfig.slots['l' + lvl] || {};
        throw new Error(
          'Tenant context (mtId' + lvl + ') is required to insert into "' +
          this.constructor.tableName + '"' +
          (slot.header ? ' — the request is missing its ' + slot.header + ' header' : '') +
          (slot.name ? ' (' + slot.name + ')' : '') + '.');
      }

      if (levels >= 1 && ctx.mtId1 && !this.mtId1) this.mtId1 = ctx.mtId1;
      if (levels >= 2 && ctx.mtId2 && !this.mtId2) this.mtId2 = ctx.mtId2;
      if (levels >= 3 && ctx.mtId3 && !this.mtId3) this.mtId3 = ctx.mtId3;
      if (levels >= 4 && ctx.mtId4 && !this.mtId4) this.mtId4 = ctx.mtId4;
    }
  }

  $beforeUpdate() {
    this.recordModifiedDate = BaseModel.formatDateTime();
  }

  static get modifiers() {
    return {
      active(builder) {
        builder.where(builder.modelClass().tableName + '.isActive', true);
      },
      // Applied to EVERY query, including unscopedQuery(). A background
      // worker has no tenant context — that is what unscopedQuery exists for
      // — but it is still running inside one application, so dropping this
      // filter is never correct.
      application(builder) {
        var modelClass = builder.modelClass();
        if (!modelClass.applicationScoped) return;
        var table = modelClass.tableName;
        var appId = requireApplicationId('query', table);
        builder.where(function() {
          this.where(table + '.applicationId', appId).orWhere(table + '.applicationId', APP_ALL);
        });
      },
      tenant(builder) {
        var modelClass = builder.modelClass();
        if (!_mtConfig.enabled || !modelClass.multiTenant) return;
        var ctx = getMtContext();
        var table = modelClass.tableName;
        var levels = modelClass.mtLevels != null ? modelClass.mtLevels : _mtConfig.levels;

        // If mt is configured but no context provided, return nothing (security)
        if (levels >= 1 && !ctx.mtId1) { builder.whereRaw('1 = 0'); return; }
        if (levels >= 2 && !ctx.mtId2) { builder.whereRaw('1 = 0'); return; }
        if (levels >= 3 && !ctx.mtId3) { builder.whereRaw('1 = 0'); return; }
        if (levels >= 4 && !ctx.mtId4) { builder.whereRaw('1 = 0'); return; }

        if (levels >= 1) builder.where(function() { this.where(table + '.mtId1', ctx.mtId1).orWhere(table + '.mtId1', MT_ALL); });
        if (levels >= 2) builder.where(function() { this.where(table + '.mtId2', ctx.mtId2).orWhere(table + '.mtId2', MT_ALL); });
        if (levels >= 3) builder.where(function() { this.where(table + '.mtId3', ctx.mtId3).orWhere(table + '.mtId3', MT_ALL); });
        if (levels >= 4) builder.where(function() { this.where(table + '.mtId4', ctx.mtId4).orWhere(table + '.mtId4', MT_ALL); });
      }
    };
  }

  static query(...args) {
    return super.query(...args).modify('active').modify('application').modify('tenant');
  }

  /**
   * ACROSS EVERY TENANT. Almost always the wrong thing.
   *
   * query() is tenant-filtered and there is no way to opt a single call out of
   * it, which is the correct default: forgetting the filter must not be
   * possible. But a BACKGROUND WORKER has no request and therefore no tenant
   * context, and the modifier's rule for that case is `where 1 = 0` — so a
   * scheduler polling for due work finds nothing, silently, forever. The
   * alternative people reach for is raw knex, which also loses `isActive` and
   * the model with it, and is invisible to a search for tenancy problems.
   *
   * `isActive` AND the applicationId filter are still applied. Only the
   * TENANT filter is dropped — a worker without a request still belongs to
   * exactly one application, and there is no case where it should see
   * another's rows.
   *
   * THE CALLER TAKES ON AN OBLIGATION: whatever it does with these rows must
   * re-establish each row's own context before touching anything else. See
   * runWithMt — the pattern is pick unscoped, then run scoped, one tenant at a
   * time. Handing a cross-tenant row set to code that assumes one tenant is
   * the exact bug this method makes possible.
   *
   * Named to be greppable, and deliberately not pretty. A reviewer should be
   * able to find every use in one search and ask about each of them.
   */
  static unscopedQuery(...args) {
    return super.query(...args).modify('active').modify('application');
  }
}

/**
 * Express middleware that reads whichever headers registerMTs() configured
 * and sets mt context from them. Use after auth middleware so req.user is
 * available (mtMembershipMiddleware in @xeplr/auth relies on that ordering).
 *
 *   var { registerMTs, mtMiddleware } = require('@xeplr/db');
 *   registerMTs({ l1: { name: 'companyId', header: 'x-company-id' } });
 *   app.use(mtMiddleware());
 */
function mtMiddleware() {
  return function(req, res, next) {
    var ctx = {};
    SLOT_KEYS.forEach(function(key, idx) {
      var slot = _mtConfig.slots[key];
      if (!slot) return;
      var value = req.headers[slot.header];
      if (value) ctx['mtId' + (idx + 1)] = value;
    });
    runWithMt(ctx, next);
  };
}

module.exports = BaseModel;
module.exports.MT_ALL = MT_ALL;
module.exports.APP_ALL = APP_ALL;
module.exports.registerApplication = registerApplication;
module.exports.getApplicationId = getApplicationId;
module.exports.registerMTs = registerMTs;
module.exports.getMtConfig = getMtConfig;
module.exports.runWithMt = runWithMt;
module.exports.getMtContext = getMtContext;
module.exports.mtMiddleware = mtMiddleware;
