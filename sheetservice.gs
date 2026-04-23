var SheetService = (function () {
  var SPREADSHEET_ID_PROP = 'DATA_SPREADSHEET_ID';

  var SHEETS = {
    TEMPLATES:        'Templates',
    COLOR_RULES:      'ColorRules',
    SEND_LOG:         'SendLog',
    SETTINGS:         'Settings',
    JOURNEYS:         'Journeys',
    JOURNEY_STATE:    'JourneyState',
    AUDIT_LOG:        'AuditLog',
    // ── New tabs (appended safely — existing tabs above unchanged) ──
    SMS_TEMPLATES:    'SmsTemplates',
    SMS_LOG:          'SmsLog',
    CANDIDATES:       'Candidates',
    MATCH_PATTERNS:   'MatchPatterns',
    DELIVERY_QUEUE:   'DeliveryQueue',
    SCAN_CACHE:       'ScanCache',
    JOURNEY_VERSIONS: 'JourneyVersions'
  };

  var COLUMNS = {
    TEMPLATES: [
      'template_id','template_name','subject','html_body',
      'header_color','button_color','text_color','background_color',
      'active','created_at','updated_at'
    ],
    COLOR_RULES: [
      'rule_id','calendar_id','event_color','event_color_label',
      'template_id','active','updated_at','journey_id'
      // journey_id added at end — existing rows will read '' for it safely
    ],
    SEND_LOG: [
      'timestamp','event_id','event_title','event_start','event_color',
      'recipient','template_id','subject','status','message','unique_key'
    ],
    SETTINGS: ['key','value'],
    JOURNEYS: [
      'journey_id','journey_name','description','steps_json',
      'active','created_at','updated_at'
    ],
    JOURNEY_STATE: [
      'state_id','customer_id','calendar_event_id','customer_email','customer_name',
      'current_journey_id','current_status','enrolled_at','paused_at','cancelled_at',
      'completed_at','switched_from','switched_to','last_email_sent_step',
      'last_email_sent_at','next_send_at','manual_override','event_data_json',
      'created_at','updated_at'
    ],
    AUDIT_LOG: [
      'log_id','timestamp','actor','action','customer_email',
      'journey_id','journey_name','step_index','state_id','details',
      // New columns appended — old rows return '' safely
      'channel','delivery_id','reason'
    ],

    // ── New tab column definitions ────────────────────────────────
    SMS_TEMPLATES: [
      'sms_template_id','template_name','body',
      'active','created_at','updated_at'
    ],
    SMS_LOG: [
      'sms_log_id','timestamp','twilio_sid','enrollment_id','state_id',
      'phone','journey_id','step_index','sent_at',
      'delivery_status','reply_status','reply_text','reply_timestamp',
      'action_flag','unique_key'
    ],
    CANDIDATES: [
      'candidate_id','calendar_event_id','event_title','event_start',
      'event_color','raw_title','raw_description','extracted_emails',
      'extracted_phones','attendee_emails','status',
      'resolved_email','resolved_phone','resolved_name',
      'resolved_by','resolved_at','pattern_id','created_at','updated_at'
    ],
    MATCH_PATTERNS: [
      'pattern_id','pattern_type','match_value','resolved_email',
      'resolved_phone','resolved_name','created_by','created_at','use_count'
    ],
    DELIVERY_QUEUE: [
      'delivery_id','state_id','step_index','channel','recipient',
      'template_id','unique_key','attempt_count','last_attempt_at',
      'next_retry_at','status','fail_reason','created_at','updated_at'
    ],
    SCAN_CACHE: [
      'cache_id','calendar_id','window_start','window_end',
      'scanned_at','event_count','result_json'
    ],
    JOURNEY_VERSIONS: [
      'version_id','journey_id','version','steps_json',
      'saved_by','saved_at','notes'
    ],

    // ── Extended columns on existing tabs (appended — old rows return '' safely) ──
    JOURNEYS_EXT: ['version','parent_journey_id'],
    JOURNEY_STATE_EXT: [
      'journey_version','channel','phone','source',
      'staff_owner','notes','conflict_flag'
    ],
    SEND_LOG_EXT: ['delivery_id','attempt_number','channel']
  };

  var DEFAULT_SETTINGS = {};
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.CALENDAR_ID]               = 'primary';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.SCAN_FREQUENCY_DAYS]       = '1';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.DAILY_SCAN_TIME]           = '09:00';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.LOOKAHEAD_HOURS]           = '24';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.AUTOMATION_ENABLED]        = 'false';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.FALLBACK_PARSE_DESCRIPTION]= 'true';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.SENDER_NAME]               = 'Calendar Automation';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.REPLY_TO]                  = Session.getActiveUser().getEmail() || '';
  // ── New settings (appended — old installs get empty defaults safely) ──
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.TWILIO_ACCOUNT_SID]        = '';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.TWILIO_AUTH_TOKEN]         = '';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.TWILIO_FROM_NUMBER]        = '';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.TWILIO_MESSAGING_SID]      = '';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.SMS_ENABLED]               = 'false';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.SCAN_CACHE_ENABLED]        = 'true';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.IDENTITY_USE_ATTENDEES]    = 'true';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.IDENTITY_USE_PHONE]        = 'true';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.MULTI_CONTACT_ACTION]      = 'candidate'; // candidate | skip
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.REENROLL_ALLOW_COMPLETED]  = 'true';
  DEFAULT_SETTINGS[APP_CONFIG.SETTINGS_KEYS.REENROLL_ALLOW_CANCELLED]  = 'true';

  function nowIso() { return new Date().toISOString(); }

  function getOrCreateSpreadsheet() {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty(SPREADSHEET_ID_PROP);
    if (id) { try { return SpreadsheetApp.openById(id); } catch(e){} }
    var active; try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch(e){ active = null; }
    var ss = active || SpreadsheetApp.create('Calendar Color Email Automation DB');
    props.setProperty(SPREADSHEET_ID_PROP, ss.getId());
    return ss;
  }

  function getSheet(name) {
    var ss = getOrCreateSpreadsheet();
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    return sh;
  }

  function ensureHeader(sheet, headers) {
    var first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    var mismatch = headers.some(function(h,i){ return first[i] !== h; });
    if (mismatch) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  // Safely appends new columns to an existing sheet without touching existing data.
  // Only writes headers for columns that don't exist yet (by checking the header row width).
  function ensureExtraColumns(sheet, allHeaders) {
    var lastCol = sheet.getLastColumn();
    var existingHeaders = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      : [];
    var toAdd = allHeaders.filter(function(h){ return existingHeaders.indexOf(h) < 0; });
    if (!toAdd.length) return;
    var startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  }

  function ensureInitialized() {
    // ── Existing tabs (unchanged) ──
    ensureHeader(getSheet(SHEETS.TEMPLATES),     COLUMNS.TEMPLATES);
    ensureHeader(getSheet(SHEETS.COLOR_RULES),   COLUMNS.COLOR_RULES);
    ensureHeader(getSheet(SHEETS.SEND_LOG),      COLUMNS.SEND_LOG);
    ensureHeader(getSheet(SHEETS.SETTINGS),      COLUMNS.SETTINGS);
    ensureHeader(getSheet(SHEETS.JOURNEYS),      COLUMNS.JOURNEYS);
    ensureHeader(getSheet(SHEETS.JOURNEY_STATE), COLUMNS.JOURNEY_STATE);
    ensureHeader(getSheet(SHEETS.AUDIT_LOG),     COLUMNS.AUDIT_LOG);

    // ── Append new columns to existing tabs (safe — existing data untouched) ──
    ensureExtraColumns(getSheet(SHEETS.JOURNEYS),      COLUMNS.JOURNEYS_EXT);
    ensureExtraColumns(getSheet(SHEETS.JOURNEY_STATE), COLUMNS.JOURNEY_STATE_EXT);
    ensureExtraColumns(getSheet(SHEETS.SEND_LOG),      COLUMNS.SEND_LOG_EXT);
    ensureExtraColumns(getSheet(SHEETS.AUDIT_LOG),     ['channel','delivery_id','reason']);

    // ── New tabs ──
    ensureHeader(getSheet(SHEETS.SMS_TEMPLATES),    COLUMNS.SMS_TEMPLATES);
    ensureHeader(getSheet(SHEETS.SMS_LOG),          COLUMNS.SMS_LOG);
    ensureHeader(getSheet(SHEETS.CANDIDATES),       COLUMNS.CANDIDATES);
    ensureHeader(getSheet(SHEETS.MATCH_PATTERNS),   COLUMNS.MATCH_PATTERNS);
    ensureHeader(getSheet(SHEETS.DELIVERY_QUEUE),   COLUMNS.DELIVERY_QUEUE);
    ensureHeader(getSheet(SHEETS.SCAN_CACHE),       COLUMNS.SCAN_CACHE);
    ensureHeader(getSheet(SHEETS.JOURNEY_VERSIONS), COLUMNS.JOURNEY_VERSIONS);

    var tpl = getSheet(SHEETS.TEMPLATES);
    if (tpl.getLastRow() < 2) {
      tpl.appendRow([
        Utilities.getUuid(), 'Default Template', 'Upcoming: {{event_title}}',
        '<p>Hello {{name}},</p><p>Reminder: <strong>{{event_title}}</strong> on {{event_date}} at {{event_time}}.</p>',
        '#0b8043','#1a73e8','#202124','#f8f9fa','true', nowIso(), nowIso()
      ]);
    }

    var existing = getSettingsMap();
    var sSheet = getSheet(SHEETS.SETTINGS);
    Object.keys(DEFAULT_SETTINGS).forEach(function(k){
      if (!existing.hasOwnProperty(k)) sSheet.appendRow([k, DEFAULT_SETTINGS[k]]);
    });
  }

  function getSheetData(name, headers) {
    var sheet = getSheet(name);
    var last = sheet.getLastRow();
    if (last < 2) return [];
    return sheet.getRange(2, 1, last-1, headers.length).getValues().map(function(row){
      var obj = {};
      headers.forEach(function(h,i){ obj[h] = row[i]; });
      return obj;
    });
  }

  function upsertByKey(name, headers, keyField, item) {
    var sheet = getSheet(name);
    var rows  = getSheetData(name, headers);
    var idx   = rows.findIndex(function(r){ return String(r[keyField]) === String(item[keyField]); });
    var vals  = headers.map(function(h){ return item[h] !== undefined ? item[h] : ''; });
    if (idx >= 0) sheet.getRange(idx+2, 1, 1, headers.length).setValues([vals]);
    else          sheet.appendRow(vals);
    return item;
  }

  function deleteByKey(name, headers, keyField, keyValue) {
    var sheet = getSheet(name);
    var rows  = getSheetData(name, headers);
    var idx   = rows.findIndex(function(r){ return String(r[keyField]) === String(keyValue); });
    if (idx >= 0) { sheet.deleteRow(idx+2); return true; }
    return false;
  }

  function appendRow(name, headers, item) {
    getSheet(name).appendRow(headers.map(function(h){ return item[h] !== undefined ? item[h] : ''; }));
  }

  // ── Settings ────────────────────────────────────────────────
  function getSettingsMap() {
    var map = {};
    getSheetData(SHEETS.SETTINGS, COLUMNS.SETTINGS).forEach(function(r){ map[String(r.key)] = String(r.value); });
    return map;
  }
  function getSettingsWithDefaults() {
    var map = getSettingsMap(), merged = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function(k){ merged[k] = map.hasOwnProperty(k) ? map[k] : DEFAULT_SETTINGS[k]; });
    return merged;
  }
  function setSetting(key, value) {
    var rows = getSheetData(SHEETS.SETTINGS, COLUMNS.SETTINGS);
    var idx  = rows.findIndex(function(r){ return String(r.key) === String(key); });
    if (idx >= 0) getSheet(SHEETS.SETTINGS).getRange(idx+2, 2).setValue(String(value));
    else          getSheet(SHEETS.SETTINGS).appendRow([String(key), String(value)]);
  }
  function setSettings(obj) { Object.keys(obj).forEach(function(k){ setSetting(k, obj[k]); }); }

  // ── Send Log ────────────────────────────────────────────────
  function addSendLog(log)  { appendRow(SHEETS.SEND_LOG, COLUMNS.SEND_LOG, log); }
  function listSendLogs(limit) {
    var rows = getSheetData(SHEETS.SEND_LOG, COLUMNS.SEND_LOG);
    rows.sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); });
    return rows.slice(0, Math.max(1, Number(limit)||200));
  }
  function wasAlreadySent(uniqueKey) {
    if (!uniqueKey) return false;
    return getSheetData(SHEETS.SEND_LOG, COLUMNS.SEND_LOG).some(function(r){
      return String(r.unique_key) === String(uniqueKey) && String(r.status).toUpperCase() === 'SENT';
    });
  }

  // ── Journeys ─────────────────────────────────────────────────
  function listJourneys() {
    var rows = getSheetData(SHEETS.JOURNEYS, COLUMNS.JOURNEYS);
    rows.sort(function(a,b){ return new Date(b.updated_at)-new Date(a.updated_at); });
    return rows;
  }
  function getJourneyById(id) {
    var s = String(id||'').trim();
    return s ? (listJourneys().find(function(j){ return String(j.journey_id)===s; })||null) : null;
  }
  function upsertJourney(j)      { return upsertByKey(SHEETS.JOURNEYS, COLUMNS.JOURNEYS, 'journey_id', j); }
  function deleteJourneyRow(id)  { return deleteByKey(SHEETS.JOURNEYS, COLUMNS.JOURNEYS, 'journey_id', id); }

  // ── JourneyState ─────────────────────────────────────────────
  function listJourneyStates() { return getSheetData(SHEETS.JOURNEY_STATE, COLUMNS.JOURNEY_STATE); }

  function getJourneyStateById(id) {
    var s = String(id||'').trim();
    return s ? (listJourneyStates().find(function(r){ return String(r.state_id)===s; })||null) : null;
  }

  function getActiveStatesForEvent(eventId) {
    var id = String(eventId||'').trim();
    return listJourneyStates().filter(function(s){
      return String(s.calendar_event_id)===id && ['active','pending','paused'].indexOf(String(s.current_status))>=0;
    });
  }

  function getActiveStatesForCustomer(email) {
    var em = String(email||'').toLowerCase().trim();
    return listJourneyStates().filter(function(s){
      return String(s.customer_email).toLowerCase()===em && ['active','pending','paused'].indexOf(String(s.current_status))>=0;
    });
  }

  function getAllStatesForCustomer(email) {
    var em = String(email||'').toLowerCase().trim();
    var rows = listJourneyStates().filter(function(s){ return String(s.customer_email).toLowerCase()===em; });
    rows.sort(function(a,b){ return new Date(b.enrolled_at)-new Date(a.enrolled_at); });
    return rows;
  }

  function getPendingDueStates() {
    var now = new Date();
    return listJourneyStates().filter(function(s){
      var st = String(s.current_status);
      if (st!=='active' && st!=='pending') return false;
      if (!s.next_send_at) return false;
      return new Date(s.next_send_at) <= now;
    });
  }

  function upsertJourneyState(s) { return upsertByKey(SHEETS.JOURNEY_STATE, COLUMNS.JOURNEY_STATE, 'state_id', s); }

  // ── Audit Log ────────────────────────────────────────────────
  function addAuditLog(log) {
    var entry = {
      log_id:        Utilities.getUuid(),
      timestamp:     nowIso(),
      actor:         log.actor        || 'system',
      action:        log.action       || '',
      customer_email:log.customer_email||'',
      journey_id:    log.journey_id   || '',
      journey_name:  log.journey_name || '',
      step_index:    log.step_index   !== undefined ? String(log.step_index) : '',
      state_id:      log.state_id     || '',
      details:       log.details      || ''
    };
    appendRow(SHEETS.AUDIT_LOG, COLUMNS.AUDIT_LOG, entry);
    return entry;
  }

  function listAuditLogs(params) {
    var rows = getSheetData(SHEETS.AUDIT_LOG, COLUMNS.AUDIT_LOG);
    rows.sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); });
    var p = params || {};
    if (p.customer_email) {
      var em = String(p.customer_email).toLowerCase();
      rows = rows.filter(function(r){ return String(r.customer_email).toLowerCase()===em; });
    }
    if (p.journey_id) rows = rows.filter(function(r){ return String(r.journey_id)===String(p.journey_id); });
    return rows.slice(0, Math.max(1, Number(p.limit)||200));
  }

  // ── SMS Templates ─────────────────────────────────────────────
  function listSmsTemplates() {
    var rows = getSheetData(SHEETS.SMS_TEMPLATES, COLUMNS.SMS_TEMPLATES);
    rows.sort(function(a,b){ return new Date(b.updated_at)-new Date(a.updated_at); });
    return rows;
  }
  function getSmsTemplateById(id) {
    var s = String(id||'').trim();
    return s ? (listSmsTemplates().find(function(t){ return String(t.sms_template_id)===s; })||null) : null;
  }
  function upsertSmsTemplate(t) { return upsertByKey(SHEETS.SMS_TEMPLATES, COLUMNS.SMS_TEMPLATES, 'sms_template_id', t); }
  function deleteSmsTemplateRow(id) { return deleteByKey(SHEETS.SMS_TEMPLATES, COLUMNS.SMS_TEMPLATES, 'sms_template_id', id); }

  // ── SMS Log ───────────────────────────────────────────────────
  function addSmsLog(log) { appendRow(SHEETS.SMS_LOG, COLUMNS.SMS_LOG, log); }
  function listSmsLogs(limit) {
    var rows = getSheetData(SHEETS.SMS_LOG, COLUMNS.SMS_LOG);
    rows.sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); });
    return rows.slice(0, Math.max(1, Number(limit)||200));
  }
  function updateSmsLogDelivery(smsLogId, updates) {
    var sheet = getSheet(SHEETS.SMS_LOG);
    var rows  = getSheetData(SHEETS.SMS_LOG, COLUMNS.SMS_LOG);
    var idx   = rows.findIndex(function(r){ return String(r.sms_log_id)===String(smsLogId); });
    if (idx < 0) return false;
    var row = Object.assign({}, rows[idx], updates);
    sheet.getRange(idx+2, 1, 1, COLUMNS.SMS_LOG.length)
      .setValues([COLUMNS.SMS_LOG.map(function(h){ return row[h]!==undefined?row[h]:''; })]);
    return true;
  }

  // ── Candidates ────────────────────────────────────────────────
  function listCandidates(statusFilter) {
    var rows = getSheetData(SHEETS.CANDIDATES, COLUMNS.CANDIDATES);
    rows.sort(function(a,b){ return new Date(b.created_at)-new Date(a.created_at); });
    if (statusFilter) rows = rows.filter(function(r){ return String(r.status)===String(statusFilter); });
    return rows;
  }
  function getCandidateById(id) {
    var s = String(id||'').trim();
    return s ? (getSheetData(SHEETS.CANDIDATES, COLUMNS.CANDIDATES).find(function(r){ return String(r.candidate_id)===s; })||null) : null;
  }
  function upsertCandidate(c) { return upsertByKey(SHEETS.CANDIDATES, COLUMNS.CANDIDATES, 'candidate_id', c); }

  // ── Match Patterns ────────────────────────────────────────────
  function listMatchPatterns() { return getSheetData(SHEETS.MATCH_PATTERNS, COLUMNS.MATCH_PATTERNS); }
  function upsertMatchPattern(p) { return upsertByKey(SHEETS.MATCH_PATTERNS, COLUMNS.MATCH_PATTERNS, 'pattern_id', p); }
  function findMatchPattern(type, value) {
    var t = String(type||'').trim(), v = String(value||'').toLowerCase().trim();
    return listMatchPatterns().find(function(p){ return String(p.pattern_type)===t && String(p.match_value).toLowerCase()===v; })||null;
  }

  // ── Delivery Queue ────────────────────────────────────────────
  function listDeliveryQueue(statusFilter) {
    var rows = getSheetData(SHEETS.DELIVERY_QUEUE, COLUMNS.DELIVERY_QUEUE);
    if (statusFilter) rows = rows.filter(function(r){ return String(r.status)===String(statusFilter); });
    return rows;
  }
  function getDeliveryById(id) {
    var s = String(id||'').trim();
    return s ? (getSheetData(SHEETS.DELIVERY_QUEUE, COLUMNS.DELIVERY_QUEUE).find(function(r){ return String(r.delivery_id)===s; })||null) : null;
  }
  function upsertDelivery(d) { return upsertByKey(SHEETS.DELIVERY_QUEUE, COLUMNS.DELIVERY_QUEUE, 'delivery_id', d); }
  function getPendingRetries() {
    var now = new Date();
    return listDeliveryQueue('pending_retry').filter(function(d){
      return d.next_retry_at && new Date(d.next_retry_at) <= now;
    });
  }

  // ── Scan Cache ────────────────────────────────────────────────
  function getScanCache(calendarId, windowStart, windowEnd) {
    return getSheetData(SHEETS.SCAN_CACHE, COLUMNS.SCAN_CACHE).find(function(r){
      return String(r.calendar_id)===String(calendarId) &&
             String(r.window_start)===String(windowStart) &&
             String(r.window_end)===String(windowEnd);
    })||null;
  }
  function upsertScanCache(c) { return upsertByKey(SHEETS.SCAN_CACHE, COLUMNS.SCAN_CACHE, 'cache_id', c); }

  // ── Journey Versions ──────────────────────────────────────────
  function addJourneyVersion(v) { appendRow(SHEETS.JOURNEY_VERSIONS, COLUMNS.JOURNEY_VERSIONS, v); }
  function listJourneyVersions(journeyId) {
    var rows = getSheetData(SHEETS.JOURNEY_VERSIONS, COLUMNS.JOURNEY_VERSIONS);
    var id = String(journeyId||'').trim();
    if (id) rows = rows.filter(function(r){ return String(r.journey_id)===id; });
    rows.sort(function(a,b){ return Number(b.version)-Number(a.version); });
    return rows;
  }

  // ── Extended wasAlreadySent (checks DeliveryQueue too) ────────
  function wasAlreadySentOrQueued(uniqueKey) {
    if (!uniqueKey) return false;
    if (getSheetData(SHEETS.SEND_LOG, COLUMNS.SEND_LOG).some(function(r){
      return String(r.unique_key)===String(uniqueKey) && String(r.status).toUpperCase()==='SENT';
    })) return true;
    return getSheetData(SHEETS.SMS_LOG, COLUMNS.SMS_LOG).some(function(r){
      return String(r.unique_key)===String(uniqueKey);
    });
  }

  return {
    SHEETS, COLUMNS,
    ensureInitialized,
    getSheet, getSheetData, upsertByKey, deleteByKey, appendRow,
    getSettingsMap, getSettingsWithDefaults, setSetting, setSettings,
    addSendLog, listSendLogs, wasAlreadySent,
    nowIso,
    listJourneys, getJourneyById, upsertJourney, deleteJourneyRow,
    listJourneyStates, getJourneyStateById, getActiveStatesForEvent,
    getActiveStatesForCustomer, getAllStatesForCustomer, getPendingDueStates, upsertJourneyState,
    addAuditLog, listAuditLogs,
    // ── New exports ──
    listSmsTemplates, getSmsTemplateById, upsertSmsTemplate, deleteSmsTemplateRow,
    addSmsLog, listSmsLogs, updateSmsLogDelivery,
    listCandidates, getCandidateById, upsertCandidate,
    listMatchPatterns, upsertMatchPattern, findMatchPattern,
    listDeliveryQueue, getDeliveryById, upsertDelivery, getPendingRetries,
    getScanCache, upsertScanCache,
    addJourneyVersion, listJourneyVersions,
    wasAlreadySentOrQueued
  };
})();
