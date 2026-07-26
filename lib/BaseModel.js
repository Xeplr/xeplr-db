const { Model } = require('objection');
const { AsyncLocalStorage } = require('async_hooks');

// Multi-tenancy config (set once at startup)
var MT_ALL = '*';
var SLOT_KEYS = ['l1', 'l2', 'l3', 'l4'];
var _mtConfig = { enabled: false, levels: 0, slots: {} };

// Per-request tenant context (thread-safe)
var _mtStore = new AsyncLocalStorage();

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

    // Auto-set mt values on insert
    if (_mtConfig.enabled && this.constructor.multiTenant) {
      var ctx = getMtContext();
      var levels = this.constructor.mtLevels != null ? this.constructor.mtLevels : _mtConfig.levels;

      // Reject insert if required tenant context is missing
      if (levels >= 1 && !ctx.mtId1 && !this.mtId1) throw new Error('Tenant context (mtId1) is required');
      if (levels >= 2 && !ctx.mtId2 && !this.mtId2) throw new Error('Tenant context (mtId2) is required');
      if (levels >= 3 && !ctx.mtId3 && !this.mtId3) throw new Error('Tenant context (mtId3) is required');
      if (levels >= 4 && !ctx.mtId4 && !this.mtId4) throw new Error('Tenant context (mtId4) is required');

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
    return super.query(...args).modify('active').modify('tenant');
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
module.exports.registerMTs = registerMTs;
module.exports.getMtConfig = getMtConfig;
module.exports.runWithMt = runWithMt;
module.exports.getMtContext = getMtContext;
module.exports.mtMiddleware = mtMiddleware;
