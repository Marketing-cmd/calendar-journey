var JourneyScheduler = (function () {

  function getSteps(journey) {
    try { var s = JSON.parse(journey.steps_json||'[]'); return Array.isArray(s)?s:[]; }
    catch(e){ return []; }
  }

  function computeNextSendAt(step) {
    var ms = ((Number(step.delay_days)||0)*86400 + (Number(step.delay_hours)||0)*3600)*1000;
    return new Date(Date.now()+ms).toISOString();
  }

  function safeJson(str) { try{ return JSON.parse(str||'{}'); }catch(e){ return {}; } }

  function processState(state, results) {
    results.processed++;
    var journey = SheetService.getJourneyById(state.current_journey_id);
    if (!journey || String(journey.active)!=='true') { results.skipped++; return; }

    var steps   = getSteps(journey);
    var nextIdx = Number(state.last_email_sent_step)+1;

    // All steps already sent — mark completed
    if (nextIdx >= steps.length) {
      var now = SheetService.nowIso();
      state.current_status = 'completed';
      state.completed_at   = now;
      state.next_send_at   = '';
      state.updated_at     = now;
      SheetService.upsertJourneyState(state);
      SheetService.addAuditLog({ action:'completed', actor:'system',
        customer_email:state.customer_email,
        journey_id:state.current_journey_id, journey_name:journey.journey_name,
        state_id:state.state_id, details:'All steps completed.' });
      results.completed++;
      return;
    }

    var step       = steps[nextIdx];
    var templateId = String(step.template_id||'');
    var template   = TemplateService.getTemplateById(templateId);

    if (!template || String(template.active)!=='true') {
      SheetService.addAuditLog({ action:'step_skipped', actor:'system',
        customer_email:state.customer_email,
        journey_id:state.current_journey_id, journey_name:journey.journey_name,
        state_id:state.state_id, step_index:nextIdx,
        details:'Template inactive or missing: '+templateId });
      results.skipped++;
      return;
    }

    // Resend guard — extended to check SMS log and delivery queue too
    var uniqueKey = state.state_id+'|'+nextIdx;
    if (SheetService.wasAlreadySentOrQueued(uniqueKey)) { results.skipped++; return; }

    var eventData    = safeJson(state.event_data_json);
    var placeholders = Object.assign({}, eventData, {
      name:          state.customer_name || state.customer_email.split('@')[0],
      email:         state.customer_email,
      journey_name:  journey.journey_name,
      step_number:   String(nextIdx+1),
      total_steps:   String(steps.length),
      enrolled_date: state.enrolled_at ? state.enrolled_at.split('T')[0] : ''
    });

    var channel    = String(step.channel || 'email');
    var tplForSend = (template && step.subject_override)
      ? Object.assign({}, template, { subject: step.subject_override })
      : template;

    // Create delivery record before sending (enables retry tracking)
    var delivery = DeliveryService.createDelivery({
      state_id:    state.state_id,
      step_index:  nextIdx,
      channel:     channel,
      recipient:   channel === 'sms' ? (state.phone || '') : state.customer_email,
      template_id: templateId,
      unique_key:  uniqueKey
    });

    // Route through ChannelRouter instead of calling EmailService directly
    var sendResult = ChannelRouter.send({
      channel:       channel,
      to:            state.customer_email,
      phone:         state.phone || '',
      template:      tplForSend,
      smsTemplateId: step.sms_template_id || '',
      placeholders:  placeholders,
      stateId:       state.state_id,
      stepIndex:     nextIdx,
      journeyId:     state.current_journey_id,
      uniqueKey:     uniqueKey
    });

    var now        = SheetService.nowIso();
    var subject    = sendResult.emailResult ? sendResult.emailResult.subject : '';
    var logMessage = sendResult.message || '';

    // Always write a send log for email channel (backward compat with existing log table)
    if (channel === 'email' || channel === 'both') {
      SheetService.addSendLog({
        timestamp:      now,
        event_id:       state.calendar_event_id,
        event_title:    eventData.event_title||'',
        event_start:    eventData.event_start||'',
        event_color:    '',
        recipient:      state.customer_email,
        template_id:    templateId,
        subject:        subject,
        status:         sendResult.ok ? 'SENT' : 'ERROR',
        message:        logMessage,
        unique_key:     uniqueKey,
        delivery_id:    delivery.delivery_id,
        attempt_number: '1',
        channel:        channel
      });
    }

    if (sendResult.ok) {
      DeliveryService.markSent(delivery.delivery_id);
      state.last_email_sent_step = String(nextIdx);
      state.last_email_sent_at   = now;
      state.current_status       = 'active';
      state.updated_at           = now;
      var afterIdx = nextIdx+1;
      state.next_send_at = afterIdx < steps.length ? computeNextSendAt(steps[afterIdx]) : now;
      SheetService.upsertJourneyState(state);
      AuditService.logStepSent({
        customer_email: state.customer_email,
        journey_id:     state.current_journey_id,
        journey_name:   journey.journey_name,
        state_id:       state.state_id,
        step_index:     nextIdx,
        channel:        channel,
        delivery_id:    delivery.delivery_id,
        details:        'Step '+(nextIdx+1)+'/'+steps.length+' sent via '+channel+'. Subject: '+subject
      });
      results.sent++;
    } else {
      DeliveryService.markFailed(delivery.delivery_id, logMessage);
      AuditService.logStepError({
        customer_email: state.customer_email,
        journey_id:     state.current_journey_id,
        journey_name:   journey.journey_name,
        state_id:       state.state_id,
        step_index:     nextIdx,
        channel:        channel,
        delivery_id:    delivery.delivery_id,
        details:        'Send failed: '+logMessage
      });
      results.skipped++;
    }
  }

  function processQueue() {
    var due = SheetService.getPendingDueStates();
    var results = { processed:0, sent:0, skipped:0, completed:0, errors:[] };
    due.forEach(function(state){
      try { processState(state, results); }
      catch(err){ results.errors.push({ state_id:state.state_id, error:err.message }); }
    });
    // Process retries for previously failed deliveries
    var retryResults = DeliveryService.processRetries();
    results.retried  = retryResults.retried || 0;
    return results;
  }

  return { processQueue };
})();
