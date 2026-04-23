var JourneyService = (function () {

  function makeCustomerId(email) {
    return String(email||'').toLowerCase().trim().replace(/[^a-z0-9@._-]/g,'_');
  }

  function getSteps(journey) {
    try { var s = JSON.parse(journey.steps_json||'[]'); return Array.isArray(s)?s:[]; }
    catch(e){ return []; }
  }

  function computeNextSendAt(step) {
    var ms = ((Number(step.delay_days)||0)*86400 + (Number(step.delay_hours)||0)*3600)*1000;
    return new Date(Date.now()+ms).toISOString();
  }

  function safeJson(str) { try { return JSON.parse(str||'{}'); } catch(e){ return {}; } }

  // ── Enroll ───────────────────────────────────────────────────
  function enroll(p) {
    var email     = String(p.customerEmail||'').trim().toLowerCase();
    var name      = String(p.customerName||email.split('@')[0]);
    var eventId   = String(p.calendarEventId||'');
    var journeyId = String(p.journeyId||'');
    var actor     = String(p.actor||'system');
    var eventData = p.eventData || {};

    if (!email)     throw new Error('customerEmail is required.');
    if (!journeyId) throw new Error('journeyId is required.');

    var journey = SheetService.getJourneyById(journeyId);
    if (!journey)                          throw new Error('Journey not found: '+journeyId);
    if (String(journey.active)!=='true')   throw new Error('Journey is inactive: '+journeyId);

    var steps = getSteps(journey);
    if (steps.length===0) throw new Error('Journey has no steps defined.');

    // Duplicate guard
    var dup = SheetService.getActiveStatesForCustomer(email).filter(function(s){
      return String(s.current_journey_id)===journeyId;
    });
    if (dup.length>0) {
      SheetService.addAuditLog({ actor, action:'duplicate_blocked',
        customer_email:email, journey_id:journeyId, journey_name:journey.journey_name,
        state_id:dup[0].state_id, details:'Status: '+dup[0].current_status });
      return { ok:false, message:'Duplicate enrollment blocked.', state:dup[0] };
    }

    var now   = SheetService.nowIso();
    var state = {
      state_id:             Utilities.getUuid(),
      customer_id:          makeCustomerId(email),
      calendar_event_id:    eventId,
      customer_email:       email,
      customer_name:        name,
      current_journey_id:   journeyId,
      current_status:       'pending',
      enrolled_at:          now,
      paused_at:            '',
      cancelled_at:         '',
      completed_at:         '',
      switched_from:        String(p.switchedFrom||''),
      switched_to:          '',
      last_email_sent_step: '-1',
      last_email_sent_at:   '',
      next_send_at:         computeNextSendAt(steps[0]),
      manual_override:      'false',
      event_data_json:      JSON.stringify(eventData),
      created_at:           now,
      updated_at:           now
    };

    SheetService.upsertJourneyState(state);
    SheetService.addAuditLog({ actor, action:'enrolled',
      customer_email:email, journey_id:journeyId, journey_name:journey.journey_name,
      step_index:0, state_id:state.state_id,
      details:'Enrolled via '+(p.calendarColor?'color: '+p.calendarColor:actor) });

    return { ok:true, state };
  }

  // ── Cancel ───────────────────────────────────────────────────
  function cancel(stateId, actor) {
    var state = SheetService.getJourneyStateById(stateId);
    if (!state) throw new Error('JourneyState not found: '+stateId);
    var j = SheetService.getJourneyById(state.current_journey_id);
    var now = SheetService.nowIso();
    state.current_status = 'cancelled';
    state.cancelled_at   = now;
    state.next_send_at   = '';
    state.updated_at     = now;
    SheetService.upsertJourneyState(state);
    SheetService.addAuditLog({ actor:actor||'system', action:'cancelled',
      customer_email:state.customer_email,
      journey_id:state.current_journey_id, journey_name:j?j.journey_name:'',
      state_id:stateId, details:'Cancelled by '+(actor||'system') });
    return { ok:true, state };
  }

  // ── Pause ────────────────────────────────────────────────────
  function pause(stateId, actor) {
    var state = SheetService.getJourneyStateById(stateId);
    if (!state) throw new Error('JourneyState not found: '+stateId);
    if (['active','pending'].indexOf(String(state.current_status))<0)
      throw new Error('Can only pause active/pending. Current: '+state.current_status);
    var j = SheetService.getJourneyById(state.current_journey_id);
    var now = SheetService.nowIso();
    state.current_status = 'paused';
    state.paused_at      = now;
    state.updated_at     = now;
    SheetService.upsertJourneyState(state);
    SheetService.addAuditLog({ actor:actor||'admin', action:'paused',
      customer_email:state.customer_email,
      journey_id:state.current_journey_id, journey_name:j?j.journey_name:'',
      state_id:stateId, details:'Paused by '+(actor||'admin') });
    return { ok:true, state };
  }

  // ── Resume ───────────────────────────────────────────────────
  function resume(stateId, actor) {
    var state = SheetService.getJourneyStateById(stateId);
    if (!state) throw new Error('JourneyState not found: '+stateId);
    if (String(state.current_status)!=='paused')
      throw new Error('Can only resume paused journeys. Current: '+state.current_status);
    var j = SheetService.getJourneyById(state.current_journey_id);
    if (!j) throw new Error('Journey not found.');
    var steps     = getSteps(j);
    var nextIdx   = Number(state.last_email_sent_step)+1;
    var now       = SheetService.nowIso();
    state.paused_at  = '';
    state.updated_at = now;
    if (nextIdx < steps.length) {
      state.current_status = 'active';
      state.next_send_at   = computeNextSendAt(steps[nextIdx]);
    } else {
      state.current_status = 'completed';
      state.completed_at   = now;
      state.next_send_at   = '';
    }
    SheetService.upsertJourneyState(state);
    SheetService.addAuditLog({ actor:actor||'admin', action:'resumed',
      customer_email:state.customer_email,
      journey_id:state.current_journey_id, journey_name:j.journey_name,
      state_id:stateId, details:'Resumed by '+(actor||'admin') });
    return { ok:true, state };
  }

  // ── Switch ───────────────────────────────────────────────────
  function switchJourney(stateId, newJourneyId, actor) {
    var state = SheetService.getJourneyStateById(stateId);
    if (!state) throw new Error('JourneyState not found: '+stateId);
    var newJ = SheetService.getJourneyById(newJourneyId);
    if (!newJ)                         throw new Error('Target journey not found: '+newJourneyId);
    if (String(newJ.active)!=='true')  throw new Error('Target journey is inactive.');
    var oldJ = SheetService.getJourneyById(state.current_journey_id);
    var now  = SheetService.nowIso();
    state.current_status = 'cancelled';
    state.cancelled_at   = now;
    state.switched_to    = newJourneyId;
    state.next_send_at   = '';
    state.updated_at     = now;
    SheetService.upsertJourneyState(state);
    SheetService.addAuditLog({ actor:actor||'system', action:'switched',
      customer_email:state.customer_email,
      journey_id:state.current_journey_id, journey_name:oldJ?oldJ.journey_name:'',
      state_id:stateId, details:'Switched to: '+newJourneyId });
    var result = enroll({
      customerEmail:    state.customer_email,
      customerName:     state.customer_name,
      calendarEventId:  state.calendar_event_id,
      journeyId:        newJourneyId,
      actor:            actor||'system',
      switchedFrom:     state.current_journey_id,
      eventData:        safeJson(state.event_data_json)
    });
    return { ok:true, oldStateId:stateId, newState:result.state };
  }

  // ── Manual Override ──────────────────────────────────────────
  function setManualOverride(stateId, value, actor) {
    var state = SheetService.getJourneyStateById(stateId);
    if (!state) throw new Error('JourneyState not found: '+stateId);
    state.manual_override = String(value)==='true'?'true':'false';
    state.updated_at = SheetService.nowIso();
    SheetService.upsertJourneyState(state);
    SheetService.addAuditLog({ actor:actor||'admin', action:'override_set',
      customer_email:state.customer_email,
      journey_id:state.current_journey_id, state_id:stateId,
      details:'manual_override → '+state.manual_override });
    return { ok:true, state };
  }

  // ── Customer Lookup ──────────────────────────────────────────
  function lookupCustomer(email) {
    var em = String(email||'').trim().toLowerCase();
    if (!em) return [];
    return SheetService.getAllStatesForCustomer(em).map(function(s){
      var j = SheetService.getJourneyById(s.current_journey_id);
      return Object.assign({}, s, {
        journey_name:       j ? j.journey_name : s.current_journey_id,
        journey_step_count: j ? getSteps(j).length : 0
      });
    });
  }

  // ── Journey CRUD ─────────────────────────────────────────────
  function saveJourney(payload) {
    var now      = SheetService.nowIso();
    var existing = payload.journey_id ? SheetService.getJourneyById(payload.journey_id) : null;
    var id       = existing ? existing.journey_id : (payload.journey_id || Utilities.getUuid());

    var steps;
    if (payload.steps && Array.isArray(payload.steps)) {
      steps = payload.steps.map(function(s,i){
        return {
          step_index:       i,
          template_id:      String(s.template_id||''),
          delay_days:       Number(s.delay_days)||0,
          delay_hours:      Number(s.delay_hours)||0,
          subject_override: String(s.subject_override||''),
          description:      String(s.description||'')
        };
      });
    } else {
      steps = existing ? (function(){ try{ return JSON.parse(existing.steps_json||'[]'); }catch(e){ return []; } })() : [];
    }

    if (steps.length===0) throw new Error('Journey must have at least one step.');
    steps.forEach(function(s){ if (!s.template_id) throw new Error('Step '+(s.step_index+1)+' has no template.'); });

    var journey = {
      journey_id:   id,
      journey_name: String(payload.journey_name||(existing&&existing.journey_name)||'').trim(),
      description:  String(payload.description||(existing&&existing.description)||'').trim(),
      steps_json:   JSON.stringify(steps),
      active:       String(payload.active!==undefined?payload.active:(existing?existing.active:'true'))==='true'?'true':'false',
      created_at:   existing ? existing.created_at : now,
      updated_at:   now
    };
    if (!journey.journey_name) throw new Error('journey_name is required.');
    SheetService.upsertJourney(journey);
    return Object.assign({}, journey, { steps });
  }

  function deleteJourney(journeyId) {
    var id = String(journeyId||'').trim();
    if (!id) throw new Error('journeyId is required.');
    var active = SheetService.listJourneyStates().filter(function(s){
      return String(s.current_journey_id)===id && ['active','pending','paused'].indexOf(String(s.current_status))>=0;
    });
    if (active.length>0) throw new Error('Cannot delete: '+active.length+' active enrollment(s) exist. Cancel them first.');
    return { deleted: SheetService.deleteJourneyRow(id) };
  }

  return {
    enroll, cancel, pause, resume, switchJourney,
    setManualOverride, lookupCustomer, saveJourney, deleteJourney, getSteps
  };
})();
