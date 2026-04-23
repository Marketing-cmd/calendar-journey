// Wraps and extends the existing JourneyService duplicate-block logic.
// Handles re-enrollment rules, conflict detection, and paused-journey conflicts.
// JourneyService.enroll() still works unchanged for existing code paths.
var EnrollmentGuard = (function () {

  // Check enrollment eligibility before calling JourneyService.enroll().
  // Returns { allowed: bool, action: string, conflictStateId: string, message: string }
  function checkEligibility(customerEmail, journeyId, options) {
    var email = String(customerEmail || '').toLowerCase().trim();
    var opts  = options || {};
    var settings = SheetService.getSettingsWithDefaults();

    // All active states for this customer across ALL journeys
    var allActive = SheetService.getActiveStatesForCustomer(email);

    // States specifically for this journey
    var sameJourney = allActive.filter(function (s) {
      return String(s.current_journey_id) === String(journeyId);
    });

    // 1. Paused conflict — same journey, paused
    var paused = sameJourney.filter(function (s) { return String(s.current_status) === 'paused'; });
    if (paused.length > 0 && !opts.forceOverride) {
      return {
        allowed:         false,
        action:          'conflict_paused',
        conflictStateId: paused[0].state_id,
        message:         'Customer has a paused enrollment for this journey. Resume, cancel, or force override.'
      };
    }

    // 2. Active/pending duplicate — same journey
    var active = sameJourney.filter(function (s) {
      return ['active', 'pending'].indexOf(String(s.current_status)) >= 0;
    });
    if (active.length > 0 && !opts.forceOverride) {
      return {
        allowed:         false,
        action:          'duplicate_active',
        conflictStateId: active[0].state_id,
        message:         'Duplicate enrollment blocked — journey already active for this customer.'
      };
    }

    // 3. Re-enrollment check — look at historical (completed/cancelled) states
    var historical = SheetService.getAllStatesForCustomer(email).filter(function (s) {
      return String(s.current_journey_id) === String(journeyId) &&
             ['completed', 'cancelled'].indexOf(String(s.current_status)) >= 0;
    });

    if (historical.length > 0 && !opts.forceOverride) {
      var lastState  = historical[0]; // already sorted newest first
      var lastStatus = String(lastState.current_status);

      if (lastStatus === 'completed' && String(settings.reenroll_allow_completed) !== 'true') {
        return {
          allowed:         false,
          action:          'reenroll_blocked_completed',
          conflictStateId: lastState.state_id,
          message:         'Re-enrollment blocked — previous journey completed. Enable re-enrollment in settings.'
        };
      }
      if (lastStatus === 'cancelled' && String(settings.reenroll_allow_cancelled) !== 'true') {
        return {
          allowed:         false,
          action:          'reenroll_blocked_cancelled',
          conflictStateId: lastState.state_id,
          message:         'Re-enrollment blocked — previous journey cancelled. Enable re-enrollment in settings.'
        };
      }
    }

    return { allowed: true, action: 'ok', conflictStateId: '', message: '' };
  }

  // Full enrollment flow with guard check before delegating to JourneyService.enroll()
  function enroll(params) {
    var email     = String(params.customerEmail || '').toLowerCase().trim();
    var journeyId = String(params.journeyId || '');
    var actor     = String(params.actor || 'system');

    if (!email)     throw new Error('customerEmail is required.');
    if (!journeyId) throw new Error('journeyId is required.');

    var check = checkEligibility(email, journeyId, {
      forceOverride: params.forceOverride === true
    });

    if (!check.allowed) {
      // Create a conflict audit log and return the guard result
      if (check.action === 'conflict_paused') {
        AuditService.logConflict({
          actor:          actor,
          customer_email: email,
          journey_id:     journeyId,
          state_id:       check.conflictStateId,
          details:        check.message,
          reason:         params.overrideReason || ''
        });
      }
      return { ok: false, guarded: true, action: check.action,
               conflictStateId: check.conflictStateId, message: check.message };
    }

    // Allowed — delegate to JourneyService
    var result = JourneyService.enroll(params);

    if (result.ok && params.forceOverride) {
      AuditService.log({
        actor:          actor,
        action:         'force_override_enroll',
        customer_email: email,
        journey_id:     journeyId,
        state_id:       result.state ? result.state.state_id : '',
        details:        'Force override used.',
        reason:         params.overrideReason || ''
      });
    }

    return result;
  }

  return { checkEligibility, enroll };
})();
