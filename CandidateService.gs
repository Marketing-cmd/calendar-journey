// Manages review candidates — ambiguous calendar events where identity is unclear.
// Handles pattern-based auto-resolution and manual admin resolution.
var CandidateService = (function () {

  function listCandidates(statusFilter) { return SheetService.listCandidates(statusFilter || ''); }
  function getCandidateById(id)          { return SheetService.getCandidateById(id); }

  // Called by CalendarService when identity extraction produces ambiguous results
  function createCandidate(params) {
    var now = SheetService.nowIso();
    var c = {
      candidate_id:     Utilities.getUuid(),
      calendar_event_id:String(params.calendarEventId || ''),
      event_title:      String(params.eventTitle       || ''),
      event_start:      String(params.eventStart       || ''),
      event_color:      String(params.eventColor       || ''),
      raw_title:        String(params.rawTitle         || ''),
      raw_description:  String(params.rawDescription   || ''),
      extracted_emails: JSON.stringify(params.extractedEmails  || []),
      extracted_phones: JSON.stringify(params.extractedPhones  || []),
      attendee_emails:  JSON.stringify(params.attendeeEmails   || []),
      status:           'pending',
      resolved_email:   '',
      resolved_phone:   '',
      resolved_name:    '',
      resolved_by:      '',
      resolved_at:      '',
      pattern_id:       '',
      created_at:       now,
      updated_at:       now
    };
    SheetService.upsertCandidate(c);
    AuditService.logConflict({
      actor:   'system',
      details: 'Candidate created for event: ' + c.event_title,
      details: 'Ambiguous identity — pending admin review.'
    });
    return c;
  }

  // Try to auto-resolve a candidate using learned match patterns
  function tryAutoResolve(candidate) {
    var emails  = _parseJson(candidate.extracted_emails);
    var phones  = _parseJson(candidate.extracted_phones);
    var pattern = null;

    // Check email patterns first
    for (var i = 0; i < emails.length; i++) {
      pattern = SheetService.findMatchPattern('email', emails[i]);
      if (pattern) break;
    }
    // Then phone patterns
    if (!pattern) {
      for (var j = 0; j < phones.length; j++) {
        pattern = SheetService.findMatchPattern('phone', phones[j]);
        if (pattern) break;
      }
    }

    if (!pattern) return { resolved: false };

    return resolve(candidate.candidate_id, {
      resolvedEmail: pattern.resolved_email,
      resolvedPhone: pattern.resolved_phone,
      resolvedName:  pattern.resolved_name,
      resolvedBy:    'auto_pattern',
      patternId:     pattern.pattern_id
    });
  }

  // Admin manually resolves a candidate
  function resolve(candidateId, params) {
    var c = getCandidateById(candidateId);
    if (!c) throw new Error('Candidate not found: ' + candidateId);
    if (String(c.status) === 'resolved') throw new Error('Candidate already resolved.');

    var now = SheetService.nowIso();
    c.resolved_email = String(params.resolvedEmail || '').toLowerCase().trim();
    c.resolved_phone = String(params.resolvedPhone || '').trim();
    c.resolved_name  = String(params.resolvedName  || '').trim();
    c.resolved_by    = String(params.resolvedBy    || 'admin');
    c.resolved_at    = now;
    c.pattern_id     = String(params.patternId     || '');
    c.status         = 'resolved';
    c.updated_at     = now;
    SheetService.upsertCandidate(c);

    AuditService.logResolve({
      actor:          c.resolved_by,
      customer_email: c.resolved_email,
      details:        'Candidate resolved. Event: ' + c.event_title
    });

    return { resolved: true, candidate: c };
  }

  // Admin saves a new matching pattern (optionally bulk-applies to similar pending candidates)
  function saveMatchPattern(params) {
    var now = SheetService.nowIso();
    var existing = params.pattern_id ? SheetService.listMatchPatterns().find(function (p) {
      return String(p.pattern_id) === String(params.pattern_id);
    }) : null;

    var pattern = {
      pattern_id:     existing ? existing.pattern_id : Utilities.getUuid(),
      pattern_type:   String(params.patternType   || 'email').toLowerCase(),
      match_value:    String(params.matchValue     || '').toLowerCase().trim(),
      resolved_email: String(params.resolvedEmail  || '').toLowerCase().trim(),
      resolved_phone: String(params.resolvedPhone  || '').trim(),
      resolved_name:  String(params.resolvedName   || '').trim(),
      created_by:     String(params.createdBy      || 'admin'),
      created_at:     existing ? existing.created_at : now,
      use_count:      existing ? String(Number(existing.use_count || 0) + 1) : '0'
    };

    if (!pattern.match_value) throw new Error('matchValue is required.');
    SheetService.upsertMatchPattern(pattern);

    // Bulk-apply to similar unresolved candidates if requested
    var bulkCount = 0;
    if (params.bulkApply) {
      var pending = SheetService.listCandidates('pending');
      pending.forEach(function (c) {
        var emails = _parseJson(c.extracted_emails);
        var phones = _parseJson(c.extracted_phones);
        var matches = pattern.pattern_type === 'email'
          ? emails.some(function (e) { return e.toLowerCase() === pattern.match_value; })
          : phones.some(function (p) { return p === pattern.match_value; });
        if (matches) {
          resolve(c.candidate_id, {
            resolvedEmail: pattern.resolved_email,
            resolvedPhone: pattern.resolved_phone,
            resolvedName:  pattern.resolved_name,
            resolvedBy:    'bulk_pattern',
            patternId:     pattern.pattern_id
          });
          bulkCount++;
        }
      });
    }

    return { pattern: pattern, bulkResolved: bulkCount };
  }

  function ignoreCandidate(candidateId, actor) {
    var c = getCandidateById(candidateId);
    if (!c) throw new Error('Candidate not found.');
    c.status     = 'ignored';
    c.resolved_by= actor || 'admin';
    c.resolved_at= SheetService.nowIso();
    c.updated_at = SheetService.nowIso();
    SheetService.upsertCandidate(c);
    return { ignored: true };
  }

  function _parseJson(str) {
    try { var v = JSON.parse(str || '[]'); return Array.isArray(v) ? v : []; }
    catch(e) { return []; }
  }

  return {
    listCandidates, getCandidateById,
    createCandidate, tryAutoResolve,
    resolve, saveMatchPattern, ignoreCandidate
  };
})();
