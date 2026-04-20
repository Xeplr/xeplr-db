const { Model } = require('objection');
const { AsyncLocalStorage } = require('async_hooks');

// Multi-tenancy config (set once at startup)
var MT_ALL = '*';
var _mtConfig = { enabled: false, levels: 0 };

// Per-request tenant context (thread-safe)
var _mtStore = new AsyncLocalStorage();

/**
 * Configure multi-tenancy at startup.
 * @param {object} config
 * @param {boolean} [config.enabled=false] - Enable multi-tenancy filtering
 * @param {number} [config.levels=0] - How many mt levels to enforce (1-4)
 */
function configureMt(config = {}) {
  _mtConfig.enabled = !!config.enabled;
  _mtConfig.levels = config.levels || 0;
}

/**
 * Get the current mt config.
 */
function getMtConfig() {
  return { ..._mtConfig };
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
   * Override in subclass to disable mt filtering for specific models.
   * e.g. models that are shared across tenants.
   */
  static get multiTenant() {
    return true;
  }

  $beforeInsert() {
    this.recordCreatedDate = BaseModel.formatDateTime();
    this.recordModifiedDate = BaseModel.formatDateTime();
    if (this.isActive === undefined) this.isActive = true;

    // Auto-set mt values on insert
    if (_mtConfig.enabled && this.constructor.multiTenant) {
      var ctx = getMtContext();

      // Reject insert if required tenant context is missing
      if (_mtConfig.levels >= 1 && !ctx.mtId1 && !this.mtId1) throw new Error('Tenant context (mtId1) is required');
      if (_mtConfig.levels >= 2 && !ctx.mtId2 && !this.mtId2) throw new Error('Tenant context (mtId2) is required');
      if (_mtConfig.levels >= 3 && !ctx.mtId3 && !this.mtId3) throw new Error('Tenant context (mtId3) is required');
      if (_mtConfig.levels >= 4 && !ctx.mtId4 && !this.mtId4) throw new Error('Tenant context (mtId4) is required');

      if (_mtConfig.levels >= 1 && ctx.mtId1 && !this.mtId1) this.mtId1 = ctx.mtId1;
      if (_mtConfig.levels >= 2 && ctx.mtId2 && !this.mtId2) this.mtId2 = ctx.mtId2;
      if (_mtConfig.levels >= 3 && ctx.mtId3 && !this.mtId3) this.mtId3 = ctx.mtId3;
      if (_mtConfig.levels >= 4 && ctx.mtId4 && !this.mtId4) this.mtId4 = ctx.mtId4;
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
        if (!_mtConfig.enabled || !builder.modelClass().multiTenant) return;
        var ctx = getMtContext();
        var table = builder.modelClass().tableName;

        // If mt is configured but no context provided, return nothing (security)
        if (_mtConfig.levels >= 1 && !ctx.mtId1) { builder.whereRaw('1 = 0'); return; }
        if (_mtConfig.levels >= 2 && !ctx.mtId2) { builder.whereRaw('1 = 0'); return; }
        if (_mtConfig.levels >= 3 && !ctx.mtId3) { builder.whereRaw('1 = 0'); return; }
        if (_mtConfig.levels >= 4 && !ctx.mtId4) { builder.whereRaw('1 = 0'); return; }

        if (_mtConfig.levels >= 1) builder.where(function() { this.where(table + '.mtId1', ctx.mtId1).orWhere(table + '.mtId1', MT_ALL); });
        if (_mtConfig.levels >= 2) builder.where(function() { this.where(table + '.mtId2', ctx.mtId2).orWhere(table + '.mtId2', MT_ALL); });
        if (_mtConfig.levels >= 3) builder.where(function() { this.where(table + '.mtId3', ctx.mtId3).orWhere(table + '.mtId3', MT_ALL); });
        if (_mtConfig.levels >= 4) builder.where(function() { this.where(table + '.mtId4', ctx.mtId4).orWhere(table + '.mtId4', MT_ALL); });
      }
    };
  }

  static query(...args) {
    return super.query(...args).modify('active').modify('tenant');
  }
}

/**
 * Express middleware that reads X-Tenant-Id header and sets mt context.
 * Use after auth middleware so req.user is available.
 *
 *   var { mtMiddleware } = require('@xeplr/db');
 *   app.use(mtMiddleware());
 */
function mtMiddleware() {
  return function(req, res, next) {
    var tenantId = req.headers['x-tenant-id'];
    if (tenantId) {
      runWithMt({ mtId1: tenantId }, next);
    } else {
      next();
    }
  };
}

module.exports = BaseModel;
module.exports.MT_ALL = MT_ALL;
module.exports.configureMt = configureMt;
module.exports.getMtConfig = getMtConfig;
module.exports.runWithMt = runWithMt;
module.exports.getMtContext = getMtContext;
module.exports.mtMiddleware = mtMiddleware;
