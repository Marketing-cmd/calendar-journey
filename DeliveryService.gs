// Manages DeliveryQueue — tiered retry logic and failure escalation.
// JourneyScheduler calls DeliveryService, not the other way around.
var DeliveryService = (function () {

  var RETRY_DELAYS_MS = [
    15  * 60  * 1000,   // retry 1: 15 minutes
    2   * 3600 * 1000,  // retry 2: 2 hours
    12  * 3600 * 1000   // retry 3: 12 hours — then permanent fail
  ];

  var MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 4 total (1 initial + 3 retries)

  // Create a new delivery record when a send is first attempted
  function createDelivery(params) {
    var now = SheetService.nowIso();
    var d = {
      delivery_id:     Utilities.getUuid(),
      state_id:        params.state_id    || '',
      step_index:      params.step_index  !== undefined ? String(params.step_index) : '',
      channel:         params.channel     || 'email',
      recipient:       params.recipient   || '',
      template_id:     params.template_id || '',
      unique_key:      params.unique_key  || '',
      attempt_count:   '1',
      last_attempt_at: now,
      next_retry_at:   '',
      status:          'pending',
      fail_reason:     '',
      created_at:      now,
      updated_at:      now
    };
    SheetService.upsertDelivery(d);
    return d;
  }

  // Mark delivery as sent (success)
  function markSent(deliveryId) {
    var d = SheetService.getDeliveryById(deliveryId);
    if (!d) return false;
    d.status      = 'sent';
    d.fail_reason = '';
    d.updated_at  = SheetService.nowIso();
    SheetService.upsertDelivery(d);
    return true;
  }

  // Mark delivery as failed and schedule next retry, or escalate to permanent fail
  function markFailed(deliveryId, reason) {
    var d = SheetService.getDeliveryById(deliveryId);
    if (!d) return false;

    var attempts = Number(d.attempt_count) || 1;
    var now      = SheetService.nowIso();

    if (attempts < MAX_ATTEMPTS) {
      var delayMs      = RETRY_DELAYS_MS[attempts - 1];
      d.status         = 'pending_retry';
      d.attempt_count  = String(attempts + 1);
      d.next_retry_at  = new Date(Date.now() + delayMs).toISOString();
      d.fail_reason    = String(reason || '');
      d.last_attempt_at= now;
      d.updated_at     = now;
      SheetService.upsertDelivery(d);
      AuditService.logRetry({ delivery_id: deliveryId, state_id: d.state_id,
        details: 'Retry ' + attempts + ' scheduled. Reason: ' + reason });
    } else {
      d.status         = 'failed';
      d.fail_reason    = String(reason || '');
      d.next_retry_at  = '';
      d.updated_at     = now;
      SheetService.upsertDelivery(d);
      AuditService.logFailed({ delivery_id: deliveryId, state_id: d.state_id,
        details: 'Permanent fail after ' + attempts + ' attempts. Reason: ' + reason });
    }

    return true;
  }

  // Called by the hourly trigger — processes all pending retries that are due
  function processRetries() {
    var due = SheetService.getPendingRetries();
    var results = { processed: 0, retried: 0, failed: 0, errors: [] };

    due.forEach(function (d) {
      results.processed++;
      try {
        var state = SheetService.getJourneyStateById(d.state_id);
        if (!state) { markFailed(d.delivery_id, 'JourneyState not found'); results.failed++; return; }

        var journey = SheetService.getJourneyById(state.current_journey_id);
        if (!journey || String(journey.active) !== 'true') {
          markFailed(d.delivery_id, 'Journey inactive or missing'); results.failed++; return;
        }

        var steps    = _getSteps(journey);
        var stepIdx  = Number(d.step_index);
        var step     = steps[stepIdx];
        if (!step) { markFailed(d.delivery_id, 'Step not found'); results.failed++; return; }

        var eventData    = _safeJson(state.event_data_json);
        var placeholders = Object.assign({}, eventData, {
          name:          state.customer_name || state.customer_email.split('@')[0],
          email:         state.customer_email,
          journey_name:  journey.journey_name,
          step_number:   String(stepIdx + 1),
          total_steps:   String(steps.length),
          enrolled_date: state.enrolled_at ? state.enrolled_at.split('T')[0] : ''
        });

        var channel  = String(step.channel || d.channel || 'email');
        var template = step.template_id ? TemplateService.getTemplateById(step.template_id) : null;

        var sendResult = ChannelRouter.send({
          channel:       channel,
          to:            state.customer_email,
          phone:         state.phone || '',
          template:      template ? (step.subject_override ? Object.assign({}, template, { subject: step.subject_override }) : template) : null,
          smsTemplateId: step.sms_template_id || '',
          placeholders:  placeholders,
          stateId:       state.state_id,
          stepIndex:     stepIdx,
          journeyId:     state.current_journey_id,
          uniqueKey:     d.unique_key
        });

        if (sendResult.ok) {
          markSent(d.delivery_id);
          results.retried++;
        } else {
          markFailed(d.delivery_id, sendResult.message);
          results.failed++;
        }
      } catch (err) {
        results.errors.push({ delivery_id: d.delivery_id, error: err.message });
        try { markFailed(d.delivery_id, err.message); } catch(e){}
        results.failed++;
      }
    });

    return results;
  }

  function _getSteps(journey) {
    try { var s = JSON.parse(journey.steps_json || '[]'); return Array.isArray(s) ? s : []; }
    catch(e) { return []; }
  }

  function _safeJson(str) {
    try { return JSON.parse(str || '{}'); } catch(e) { return {}; }
  }

  return { createDelivery, markSent, markFailed, processRetries };
})();
