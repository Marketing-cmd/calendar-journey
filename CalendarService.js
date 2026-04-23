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
    return m ? m[0] : '';
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
    var settings   = SheetService.getSettingsWithDefaults();
    var calendarId = settings.calendar_id||'primary';
    var allowDesc  = String(settings.fallback_parse_description||'true')==='true';
    var tz         = Session.getScriptTimeZone();
    var now        = new Date();
    var winStart   = new Date(now.getTime() - 30*86400000);
    var winEnd     = new Date(now.getTime() + 60*86400000);

    var cal = CalendarApp.getCalendarById(calendarId);
    if (!cal) throw new Error('Calendar not found: '+calendarId);

    var journeyRules = getActiveJourneyRuleMap(calendarId);
    if (!Object.keys(journeyRules).length)
      return { ok:true, source, enrolled:0, switched:0, cancelled:0, message:'No journey color rules.' };

    var events   = cal.getEvents(winStart, winEnd);
    var eventMap = {};
    events.forEach(function(ev){ eventMap[ev.getId()] = { event:ev, colorKey:String(ev.getColor()) }; });

    var enrolled=0, switched=0, cancelled=0;

    // Enroll / switch for events with journey-mapped colors
    events.forEach(function(event){
      var colorKey = String(event.getColor());
      var rule     = journeyRules[colorKey];
      if (!rule) return;

      var journeyId = String(rule.journey_id);
      var pr        = parseRecipient(event.getTitle(), event.getDescription(), allowDesc);
      if (!pr.email) return;

      var fmt = formatEventDateTime(event, tz);
      var eventData = {
        event_title:   event.getTitle(),
        event_date:    fmt.dateStr,
        event_time:    fmt.timeStr,
        event_start:   fmt.startIso,
        calendar_name: cal.getName(),
        location:      event.getLocation()||'',
        description:   event.getDescription()||''
      };

      var activeStates = SheetService.getActiveStatesForEvent(event.getId());

      if (activeStates.length===0) {
        var r = JourneyService.enroll({ customerEmail:pr.email, customerName:pr.name,
          calendarEventId:event.getId(), journeyId, calendarColor:colorKey,
          actor:'calendar_scan', eventData });
        if (r.ok) enrolled++;
      } else {
        activeStates.forEach(function(state){
          if (String(state.current_journey_id)!==journeyId && String(state.manual_override)!=='true') {
            JourneyService.switchJourney(state.state_id, journeyId, 'calendar_scan');
            switched++;
          }
        });
      }
    });

    // Cancel active states whose event is in window but color no longer maps to any journey
    var allActive = SheetService.listJourneyStates().filter(function(s){
      return ['active','pending','paused'].indexOf(String(s.current_status))>=0 &&
             String(s.manual_override)!=='true';
    });

    allActive.forEach(function(state){
      var entry = eventMap[state.calendar_event_id];
      if (!entry) return; // outside window — skip
      var rule = journeyRules[entry.colorKey];
      if (!rule) {
        // Color removed or changed to non-journey color
        JourneyService.cancel(state.state_id, 'calendar_scan');
        cancelled++;
      }
      // Color changed to different journey: handled above in enroll loop
    });

    return { ok:true, source, enrolled, switched, cancelled };
  }

  return {
    getEventColors, listColorRules, saveColorRule, deleteColorRule,
    runScan, runJourneyScan
  };
})();
