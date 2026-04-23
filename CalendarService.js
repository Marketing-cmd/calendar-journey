var CalendarService = (function () {
  var COLOR_DEFS = [
  { key:'PALE_BLUE',  label:'Lavender',  hex:'#7986cb' },
  { key:'PALE_GREEN', label:'Sage',      hex:'#33b679' },
  { key:'MAUVE',      label:'Grape',     hex:'#8e24aa' },
  { key:'PALE_RED',   label:'Flamingo',  hex:'#e67c73' },
  { key:'YELLOW',     label:'Banana',    hex:'#f6bf26' },
  { key:'ORANGE',     label:'Tangerine', hex:'#f4511e' },
  { key:'CYAN',       label:'Peacock',   hex:'#039be5' },
  { key:'GRAY',       label:'Graphite',  hex:'#616161' },
  { key:'BLUE',       label:'Blueberry', hex:'#3f51b5' },
  { key:'GREEN',      label:'Basil',     hex:'#0b8043' },
  { key:'RED',        label:'Tomato',    hex:'#d50000' }
];

  function getEventColors() {
    return COLOR_DEFS.map(function(d){
      return { key:d.key, enumValue:CalendarApp.EventColor[d.key]?String(CalendarApp.EventColor[d.key]):d.key, label:d.label, hex:d.hex };
    });
  }

  function resolveColorLabel(colorKey) {
    var m = COLOR_DEFS.find(function(c){ return c.key===colorKey; });
    return m ? m.label : colorKey;
  }

  function listColorRules() {
    var rows = SheetService.getSheetData(SheetService.SHEETS.COLOR_RULES, SheetService.COLUMNS.COLOR_RULES);
    rows.sort(function(a,b){ return new Date(b.updated_at)-new Date(a.updated_at); });
    return rows;
  }

  function saveColorRule(payload) {
    var settings   = SheetService.getSettingsWithDefaults();
    var calendarId = String(payload.calendar_id||settings.calendar_id||'primary').trim();
    var eventColor = String(payload.event_color||'').trim();
    var templateId = String(payload.template_id||'').trim();
    var journeyId  = String(payload.journey_id||'').trim();

    if (!eventColor) throw new Error('event_color is required.');
    if (!templateId && !journeyId) throw new Error('Either template_id or journey_id is required.');
    if (templateId && !TemplateService.getTemplateById(templateId)) throw new Error('template_id not found.');
    if (journeyId  && !SheetService.getJourneyById(journeyId))      throw new Error('journey_id not found.');

    var existing = listColorRules().find(function(r){
      return String(r.calendar_id)===calendarId && String(r.event_color)===eventColor;
    });

    var rule = {
      rule_id:          existing ? existing.rule_id : Utilities.getUuid(),
      calendar_id:      calendarId,
      event_color:      eventColor,
      event_color_label:resolveColorLabel(eventColor),
      template_id:      journeyId ? '' : templateId,  // journey mode clears template
      active:           String(payload.active!==undefined?payload.active:'true')==='true'?'true':'false',
      updated_at:       SheetService.nowIso(),
      journey_id:       journeyId
    };

    SheetService.upsertByKey(SheetService.SHEETS.COLOR_RULES, SheetService.COLUMNS.COLOR_RULES, 'rule_id', rule);
    return rule;
  }

  function deleteColorRule(ruleId) {
    var id = String(ruleId||'').trim();
    if (!id) throw new Error('ruleId is required.');
    return { deleted: SheetService.deleteByKey(SheetService.SHEETS.COLOR_RULES, SheetService.COLUMNS.COLOR_RULES, 'rule_id', id) };
  }

  // Legacy rules only (no journey_id)
  function getActiveLegacyRuleMap(calendarId) {
    var map = {};
    listColorRules().filter(function(r){
      return String(r.active)==='true' && String(r.calendar_id)===String(calendarId) && !String(r.journey_id||'').trim();
    }).forEach(function(r){ map[String(r.event_color)] = r; });
    return map;
  }

  // Journey rules only (has journey_id)
  function getActiveJourneyRuleMap(calendarId) {
    var map = {};
    listColorRules().filter(function(r){
      return String(r.active)==='true' && String(r.calendar_id)===String(calendarId) && String(r.journey_id||'').trim();
    }).forEach(function(r){ map[String(r.event_color)] = r; });
    return map;
  }

  function extractEmail(text) {
    var m = String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0].toLowerCase() : '';
  }

  // Extract ALL emails from text (returns deduplicated array)
  function extractAllEmails(text) {
    var matches = String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    var seen = {};
    return matches.map(function(e){ return e.toLowerCase().trim(); }).filter(function(e){
      if (seen[e]) return false; seen[e] = true; return true;
    });
  }

  // Extract first phone number from text — supports common NA formats
  function extractPhone(text) {
    var clean = String(text||'').replace(/[^\d\s\+\-\(\)\.]/g,'');
    var m = clean.match(/(\+?1[\s\-\.]?)?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/);
    if (!m) return '';
    return m[0].replace(/\D/g,'');
  }

  function parseRecipient(title, desc, allowDesc) {
    var email = extractEmail(title);
    if (!email && allowDesc) email = extractEmail(desc);
    if (!email) return { email:'', name:'' };
    var name = '';
    var t = String(title||'');
    if (t.indexOf(email)>=0) name = t.replace(email,'').replace(/[<>()\[\]-]/g,' ').trim();
    if (!name) name = email.split('@')[0];
    return { email, name };
  }

  // Full identity resolution with priority order + multi-contact detection
  // Returns { email, name, phone, emails, phones, attendees, multiContact }
  function resolveIdentity(event, allowDesc, attendeeList) {
    var title = event.getTitle();
    var desc  = event.getDescription() || '';

    // Priority 1 & 2: email from title, then description
    var titEmails  = extractAllEmails(title);
    var descEmails = allowDesc ? extractAllEmails(desc) : [];
    var attEmails  = (attendeeList || []).map(function(e){ return String(e).toLowerCase().trim(); }).filter(Boolean);

    // Priority 3: phone from title then description
    var phone = extractPhone(title) || (allowDesc ? extractPhone(desc) : '');

    var allEmails = [];
    titEmails.forEach(function(e){ if (allEmails.indexOf(e)<0) allEmails.push(e); });
    descEmails.forEach(function(e){ if (allEmails.indexOf(e)<0) allEmails.push(e); });
    attEmails.forEach(function(e){ if (allEmails.indexOf(e)<0) allEmails.push(e); });

    var multiContact = allEmails.length > 1 || (allEmails.length === 1 && attEmails.length > 1);

    if (allEmails.length === 0 && !phone) {
      return { email:'', name:'', phone:'', emails:[], phones:[], attendees:attEmails, multiContact:false };
    }

    // Single clear primary
    var primaryEmail = allEmails[0] || '';
    var name = '';
    if (primaryEmail) {
      if (title.toLowerCase().indexOf(primaryEmail)>=0) {
        name = title.replace(new RegExp(primaryEmail,'i'),'').replace(/[<>()\[\]-]/g,' ').trim();
      }
      if (!name) name = primaryEmail.split('@')[0];
    }

    return {
      email:        primaryEmail,
      name:         name,
      phone:        phone,
      emails:       allEmails,
      phones:       phone ? [phone] : [],
      attendees:    attEmails,
      multiContact: multiContact
    };
  }

  // Stable transition key: event ID + color — used to prevent reprocessing
  function transitionKey(eventId, colorKey) { return eventId + '|' + colorKey; }

  function formatEventDateTime(event, tz) {
    var start  = event.getStartTime();
    var dateStr= Utilities.formatDate(start, tz, 'yyyy-MM-dd');
    var timeStr= event.isAllDayEvent() ? 'All day' : Utilities.formatDate(start, tz, 'HH:mm');
    return { dateStr, timeStr, startIso: start.toISOString() };
  }

  // ── Legacy single-email scan (unchanged behavior, skips journey rules) ──
  function runScan(source) {
    var settings      = SheetService.getSettingsWithDefaults();
    var calendarId    = settings.calendar_id||'primary';
    var lookaheadHours= Math.max(1, Number(settings.lookahead_hours||24));
    var allowDesc     = String(settings.fallback_parse_description||'true')==='true';
    var now = new Date(), end = new Date(now.getTime()+lookaheadHours*3600000);
    var tz  = Session.getScriptTimeZone();
    var cal = CalendarApp.getCalendarById(calendarId);
    if (!cal) throw new Error('Calendar not found: '+calendarId);

    var rulesByColor = getActiveLegacyRuleMap(calendarId);
    if (!Object.keys(rulesByColor).length)
      return { ok:true, source, scanned:0, sent:0, skipped:0, message:'No active legacy color rules.' };

    var events = cal.getEvents(now, end);
    var sent=0, skipped=0, processed=0;

    events.forEach(function(event){
      processed++;
      var colorKey = String(event.getColor());
      var rule     = rulesByColor[colorKey];
      if (!rule) { skipped++; return; }

      var template = TemplateService.getTemplateById(rule.template_id);
      if (!template || String(template.active)!=='true') { skipped++; return; }

      var pr = parseRecipient(event.getTitle(), event.getDescription(), allowDesc);
      if (!pr.email) {
        SheetService.addSendLog({ timestamp:SheetService.nowIso(), event_id:event.getId(),
          event_title:event.getTitle(), event_start:event.getStartTime().toISOString(),
          event_color:colorKey, recipient:'', template_id:template.template_id,
          subject:template.subject, status:'SKIPPED', message:'No recipient found.', unique_key:'' });
        skipped++; return;
      }

      var fmt       = formatEventDateTime(event, tz);
      var uniqueKey = [event.getId(), fmt.startIso, template.template_id, colorKey].join('|');
      if (SheetService.wasAlreadySent(uniqueKey)) { skipped++; return; }

      var sendResult = EmailService.sendTemplatedEmail({ to:pr.email, template, placeholders:{
        name:pr.name, email:pr.email, event_title:event.getTitle(),
        event_date:fmt.dateStr, event_time:fmt.timeStr, calendar_name:cal.getName(),
        location:event.getLocation()||'', description:event.getDescription()||''
      }});

      SheetService.addSendLog({ timestamp:SheetService.nowIso(), event_id:event.getId(),
        event_title:event.getTitle(), event_start:fmt.startIso, event_color:colorKey,
        recipient:pr.email, template_id:template.template_id, subject:sendResult.subject,
        status:sendResult.ok?'SENT':'ERROR', message:sendResult.message, unique_key:uniqueKey });

      sendResult.ok ? sent++ : skipped++;
    });

    return { ok:true, source, scanned:processed, sent, skipped,
             windowStart:now.toISOString(), windowEnd:end.toISOString() };
  }

  // ── Journey scan: enroll / switch / cancel based on calendar color ──
  function runJourneyScan(source) {
    var settings        = SheetService.getSettingsWithDefaults();
    var calendarId      = settings.calendar_id||'primary';
    var allowDesc       = String(settings.fallback_parse_description||'true')==='true';
    var useAttendees    = String(settings.identity_use_attendees||'true')==='true';
    var multiAction     = String(settings.multi_contact_action||'candidate');
    var tz              = Session.getScriptTimeZone();
    var now             = new Date();
    var winStart        = new Date(now.getTime() - 30*86400000);
    var winEnd          = new Date(now.getTime() + 60*86400000);

    var cal = CalendarApp.getCalendarById(calendarId);
    if (!cal) throw new Error('Calendar not found: '+calendarId);

    var journeyRules = getActiveJourneyRuleMap(calendarId);
    if (!Object.keys(journeyRules).length)
      return { ok:true, source, enrolled:0, switched:0, cancelled:0, candidates:0, message:'No journey color rules.' };

    var events   = cal.getEvents(winStart, winEnd);
    var eventMap = {};
    events.forEach(function(ev){ eventMap[ev.getId()] = { event:ev, colorKey:String(ev.getColor()) }; });

    // Load already-processed transition keys to avoid reprocessing
    var processedKeys = {};
    SheetService.listJourneyStates().forEach(function(s){
      if (s.calendar_event_id && s.current_journey_id) {
        processedKeys[transitionKey(s.calendar_event_id, s.current_journey_id)] = true;
      }
    });

    var enrolled=0, switched=0, cancelled=0, candidates=0;

    events.forEach(function(event){
      var colorKey  = String(event.getColor());
      var rule      = journeyRules[colorKey];
      if (!rule) return;

      var journeyId = String(rule.journey_id);
      var tKey      = transitionKey(event.getId(), journeyId);

      var attendeeList = useAttendees
        ? event.getGuestList().map(function(g){ return g.getEmail(); })
        : [];

      var identity = resolveIdentity(event, allowDesc, attendeeList);
      var fmt      = formatEventDateTime(event, tz);
      var eventData = {
        event_title:   event.getTitle(),
        event_date:    fmt.dateStr,
        event_time:    fmt.timeStr,
        event_start:   fmt.startIso,
        calendar_name: cal.getName(),
        location:      event.getLocation()||'',
        description:   event.getDescription()||''
      };

      // No identity found at all
      if (!identity.email && !identity.phone) {
        if (multiAction === 'candidate') {
          CandidateService.createCandidate({
            calendarEventId: event.getId(), eventTitle: event.getTitle(),
            eventStart: fmt.startIso, eventColor: colorKey,
            rawTitle: event.getTitle(), rawDescription: event.getDescription()||'',
            extractedEmails: identity.emails, extractedPhones: identity.phones,
            attendeeEmails: identity.attendees
          });
          candidates++;
        }
        return;
      }

      // Multiple contacts — create candidate for admin resolution
      if (identity.multiContact && multiAction === 'candidate') {
        var existing = SheetService.listCandidates('pending').find(function(c){
          return String(c.calendar_event_id) === event.getId();
        });
        if (!existing) {
          CandidateService.createCandidate({
            calendarEventId: event.getId(), eventTitle: event.getTitle(),
            eventStart: fmt.startIso, eventColor: colorKey,
            rawTitle: event.getTitle(), rawDescription: event.getDescription()||'',
            extractedEmails: identity.emails, extractedPhones: identity.phones,
            attendeeEmails: identity.attendees
          });
          candidates++;
        }
        return;
      }

      var activeStates = SheetService.getActiveStatesForEvent(event.getId());

      if (activeStates.length === 0) {
        if (processedKeys[tKey]) return; // already enrolled for this color+journey
        var r = EnrollmentGuard.enroll({
          customerEmail:   identity.email,
          customerName:    identity.name,
          phone:           identity.phone,
          calendarEventId: event.getId(),
          journeyId:       journeyId,
          calendarColor:   colorKey,
          actor:           'calendar_scan',
          source:          'calendar_scan',
          eventData:       eventData
        });
        if (r.ok) enrolled++;
      } else {
        activeStates.forEach(function(state){
          if (String(state.current_journey_id) !== journeyId && String(state.manual_override) !== 'true') {
            JourneyService.switchJourney(state.state_id, journeyId, 'calendar_scan');
            switched++;
          }
        });
      }
    });

    // Cancel active states whose event color no longer maps to any journey
    var allActive = SheetService.listJourneyStates().filter(function(s){
      return ['active','pending','paused'].indexOf(String(s.current_status))>=0 &&
             String(s.manual_override)!=='true';
    });

    allActive.forEach(function(state){
      var entry = eventMap[state.calendar_event_id];
      if (!entry) return;
      var rule = journeyRules[entry.colorKey];
      if (!rule) {
        JourneyService.cancel(state.state_id, 'calendar_scan');
        cancelled++;
      }
    });

    return { ok:true, source, enrolled, switched, cancelled, candidates };
  }

  return {
    getEventColors, listColorRules, saveColorRule, deleteColorRule,
    runScan, runJourneyScan,
    // New helpers (used by ScanCacheService and dashboard)
    extractAllEmails, extractPhone, resolveIdentity
  };
})();
