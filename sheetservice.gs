var SheetService = (function () {
  var SPREADSHEET_ID_PROP = 'DATA_SPREADSHEET_ID';

  var SHEETS = {
    TEMPLATES:     'Templates',
    COLOR_RULES:   'ColorRules',
    SEND_LOG:      'SendLog',
    SETTINGS:      'Settings',
    JOURNEYS:      'Journeys',
    JOURNEY_STATE: 'JourneyState',
    AUDIT_LOG:     'AuditLog'
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
      'journey_id','journey_name','step_index','state_id','details'
    ]
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

  function ensureInitialized() {
    ensureHeader(getSheet(SHEETS.TEMPLATES),     COLUMNS.TEMPLATES);
    ensureHeader(getSheet(SHEETS.COLOR_RULES),   COLUMNS.COLOR_RULES);
    ensureHeader(getSheet(SHEETS.SEND_LOG),      COLUMNS.SEND_LOG);
    ensureHeader(getSheet(SHEETS.SETTINGS),      COLUMNS.SETTINGS);
    ensureHeader(getSheet(SHEETS.JOURNEYS),      COLUMNS.JOURNEYS);
    ensureHeader(getSheet(SHEETS.JOURNEY_STATE), COLUMNS.JOURNEY_STATE);
    ensureHeader(getSheet(SHEETS.AUDIT_LOG),     COLUMNS.AUDIT_LOG);

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
    addAuditLog, listAuditLogs
  };
})();
