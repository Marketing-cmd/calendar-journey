var APP_CONFIG = {
  SETTINGS_KEYS: {
    // ── Existing keys (never rename) ──
    CALENDAR_ID:               'calendar_id',
    SCAN_FREQUENCY_DAYS:       'scan_frequency_days',
    DAILY_SCAN_TIME:           'daily_scan_time',
    LOOKAHEAD_HOURS:           'lookahead_hours',
    AUTOMATION_ENABLED:        'automation_enabled',
    FALLBACK_PARSE_DESCRIPTION:'fallback_parse_description',
    SENDER_NAME:               'sender_name',
    REPLY_TO:                  'reply_to',
    // ── New keys (appended) ──
    TWILIO_ACCOUNT_SID:        'twilio_account_sid',
    TWILIO_AUTH_TOKEN:         'twilio_auth_token',
    TWILIO_FROM_NUMBER:        'twilio_from_number',
    TWILIO_MESSAGING_SID:      'twilio_messaging_sid',
    SMS_ENABLED:               'sms_enabled',
    SCAN_CACHE_ENABLED:        'scan_cache_enabled',
    IDENTITY_USE_ATTENDEES:    'identity_use_attendees',
    IDENTITY_USE_PHONE:        'identity_use_phone',
    MULTI_CONTACT_ACTION:      'multi_contact_action',
    REENROLL_ALLOW_COMPLETED:  'reenroll_allow_completed',
    REENROLL_ALLOW_CANCELLED:  'reenroll_allow_cancelled'
  }
};

function doGet() {
  SheetService.ensureInitialized();
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.appName = 'Calendar Journey System';
  return tpl.evaluate().setTitle('Calendar Journey System').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(fileName) { return HtmlService.createHtmlOutputFromFile(fileName).getContent(); }

// ── Dashboard ────────────────────────────────────────────────
function getDashboardData() {
  SheetService.ensureInitialized();
  return {
    settings:    SheetService.getSettingsWithDefaults(),
    templates:   TemplateService.listTemplates(),
    colorRules:  CalendarService.listColorRules(),
    eventColors: CalendarService.getEventColors(),
    logs:        SheetService.listSendLogs(200),
    triggerInfo: TriggerService.getTriggerInfo(),
    journeys:    SheetService.listJourneys()
  };
}

function saveSettings(payload)    { SheetService.ensureInitialized(); return TriggerService.saveAndApplySettings(payload||{}); }
function runScanNow()              { SheetService.ensureInitialized(); return CalendarService.runScan('manual'); }
function runScheduledScan()        {
  SheetService.ensureInitialized();
  var s = SheetService.getSettingsWithDefaults();
  if (s.automation_enabled!=='true') return { ok:true, message:'Automation disabled.' };
  return CalendarService.runScan('scheduled');
}

// ── Journey trigger handler (called by hourly trigger) ────────
function runJourneyQueue() {
  SheetService.ensureInitialized();
  var s = SheetService.getSettingsWithDefaults();
  if (s.automation_enabled!=='true') return;
  CalendarService.runJourneyScan('scheduled');
  JourneyScheduler.processQueue();
}

// ── Journey scan (manual) ─────────────────────────────────────
function runJourneyScanNow() {
  SheetService.ensureInitialized();
  var scan  = CalendarService.runJourneyScan('manual');
  var queue = JourneyScheduler.processQueue();
  return { scan, queue };
}

// ── Templates ────────────────────────────────────────────────
function listTemplates()              { SheetService.ensureInitialized(); return TemplateService.listTemplates(); }
function getTemplateById(id)          { SheetService.ensureInitialized(); return TemplateService.getTemplateById(id); }
function saveTemplate(p)              { SheetService.ensureInitialized(); return TemplateService.saveTemplate(p||{}); }
function duplicateTemplate(id)        { SheetService.ensureInitialized(); return TemplateService.duplicateTemplate(id); }
function deleteTemplate(id)           { SheetService.ensureInitialized(); return TemplateService.deleteTemplate(id); }
function sendTestEmail(p)             { SheetService.ensureInitialized(); return EmailService.sendTestEmail(p||{}); }

// ── Color Rules ───────────────────────────────────────────────
function listColorRules()             { SheetService.ensureInitialized(); return CalendarService.listColorRules(); }
function saveColorRule(p)             { SheetService.ensureInitialized(); return CalendarService.saveColorRule(p||{}); }
function deleteColorRule(id)          { SheetService.ensureInitialized(); return CalendarService.deleteColorRule(id); }

// ── Journeys ─────────────────────────────────────────────────
function listJourneys()               { SheetService.ensureInitialized(); return SheetService.listJourneys(); }
function getJourneyById(id)           { SheetService.ensureInitialized(); return SheetService.getJourneyById(id); }
function saveJourney(p)               { SheetService.ensureInitialized(); return JourneyService.saveJourney(p||{}); }
function deleteJourney(id)            { SheetService.ensureInitialized(); return JourneyService.deleteJourney(id); }

// ── Journey Controls ─────────────────────────────────────────
function lookupCustomer(email)        { SheetService.ensureInitialized(); return JourneyService.lookupCustomer(email); }
function enrollCustomer(p)            { SheetService.ensureInitialized(); return JourneyService.enroll(p||{}); }
function cancelCustomerJourney(id)    { SheetService.ensureInitialized(); return JourneyService.cancel(id,'admin'); }
function pauseCustomerJourney(id)     { SheetService.ensureInitialized(); return JourneyService.pause(id,'admin'); }
function resumeCustomerJourney(id)    { SheetService.ensureInitialized(); return JourneyService.resume(id,'admin'); }
function switchCustomerJourney(p)     { SheetService.ensureInitialized(); return JourneyService.switchJourney(p.state_id, p.new_journey_id,'admin'); }
function setManualOverride(p)         { SheetService.ensureInitialized(); return JourneyService.setManualOverride(p.state_id, p.value,'admin'); }

// ── Logs ─────────────────────────────────────────────────────
function listSendLogs(limit)          { SheetService.ensureInitialized(); return SheetService.listSendLogs(limit||200); }
function listAuditLogs(p)             { SheetService.ensureInitialized(); return SheetService.listAuditLogs(p||{}); }

// ── Triggers ─────────────────────────────────────────────────
function createOrUpdateDailyTrigger() { SheetService.ensureInitialized(); return TriggerService.createOrUpdateDailyTrigger(); }
function deleteDailyTrigger()         { SheetService.ensureInitialized(); return TriggerService.deleteDailyTrigger(); }
