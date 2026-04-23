// Wraps SheetService.addAuditLog with richer schema.
// All existing direct calls to SheetService.addAuditLog still work unchanged.
// New code should call AuditService.log() for the extended fields.
var AuditService = (function () {

  function log(params) {
    var p = params || {};
    return SheetService.addAuditLog({
      actor:          p.actor         || 'system',
      action:         p.action        || '',
      customer_email: p.customer_email|| '',
      journey_id:     p.journey_id    || '',
      journey_name:   p.journey_name  || '',
      step_index:     p.step_index    !== undefined ? p.step_index : '',
      state_id:       p.state_id      || '',
      details:        p.details       || '',
      // Extended fields (old rows simply leave these blank)
      channel:        p.channel       || '',
      delivery_id:    p.delivery_id   || '',
      reason:         p.reason        || ''
    });
  }

  function logEnroll(p)    { return log(Object.assign({ action:'enrolled' },    p)); }
  function logCancel(p)    { return log(Object.assign({ action:'cancelled' },   p)); }
  function logPause(p)     { return log(Object.assign({ action:'paused' },      p)); }
  function logResume(p)    { return log(Object.assign({ action:'resumed' },     p)); }
  function logSwitch(p)    { return log(Object.assign({ action:'switched' },    p)); }
  function logStepSent(p)  { return log(Object.assign({ action:'step_sent' },   p)); }
  function logStepError(p) { return log(Object.assign({ action:'step_error' },  p)); }
  function logOverride(p)  { return log(Object.assign({ action:'override_set'}, p)); }
  function logConflict(p)  { return log(Object.assign({ action:'conflict_created'}, p)); }
  function logResolve(p)   { return log(Object.assign({ action:'candidate_resolved'}, p)); }
  function logRetry(p)     { return log(Object.assign({ action:'delivery_retry'},  p)); }
  function logFailed(p)    { return log(Object.assign({ action:'delivery_failed'}, p)); }

  return {
    log,
    logEnroll, logCancel, logPause, logResume, logSwitch,
    logStepSent, logStepError, logOverride,
    logConflict, logResolve, logRetry, logFailed
  };
})();
