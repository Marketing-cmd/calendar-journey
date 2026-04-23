var TriggerService = (function () {
  var LEGACY_HANDLER  = 'runScheduledScan';
  var JOURNEY_HANDLER = 'runJourneyQueue';

  function parseTime(hhmm) {
    var parts = String(hhmm||'09:00').split(':');
    return { hour: Math.max(0,Math.min(23,Number(parts[0])||9)), minute: Math.max(0,Math.min(59,Number(parts[1])||0)) };
  }

  function getTriggersByHandler(handler) {
    return ScriptApp.getProjectTriggers().filter(function(t){ return t.getHandlerFunction()===handler; });
  }

  function deleteDailyTrigger() {
    var list = getTriggersByHandler(LEGACY_HANDLER);
    list.forEach(function(t){ ScriptApp.deleteTrigger(t); });
    return { ok:true, removed:list.length };
  }

  function deleteHourlyTrigger() {
    var list = getTriggersByHandler(JOURNEY_HANDLER);
    list.forEach(function(t){ ScriptApp.deleteTrigger(t); });
    return { ok:true, removed:list.length };
  }

  function createOrUpdateDailyTrigger() {
    var settings = SheetService.getSettingsWithDefaults();
    var enabled  = String(settings.automation_enabled)==='true';
    deleteDailyTrigger();
    if (!enabled) return { ok:true, active:false, message:'Automation disabled. Legacy trigger removed.' };
    var freq = Math.max(1, Number(settings.scan_frequency_days||1));
    var t    = parseTime(settings.daily_scan_time||'09:00');
    var trigger = ScriptApp.newTrigger(LEGACY_HANDLER).timeBased()
      .everyDays(freq).atHour(t.hour).nearMinute(t.minute)
      .inTimezone(Session.getScriptTimeZone()).create();
    return { ok:true, active:true, message:'Daily trigger created.', triggerId:trigger.getUniqueId(), frequencyDays:freq };
  }

  function createOrUpdateHourlyTrigger() {
    var settings = SheetService.getSettingsWithDefaults();
    var enabled  = String(settings.automation_enabled)==='true';
    deleteHourlyTrigger();
    if (!enabled) return { ok:true, active:false, message:'Automation disabled. Journey trigger removed.' };
    var trigger = ScriptApp.newTrigger(JOURNEY_HANDLER).timeBased().everyHours(1).create();
    return { ok:true, active:true, message:'Hourly journey trigger created.', triggerId:trigger.getUniqueId() };
  }

  function saveAndApplySettings(payload) {
    var normalized = {};
    normalized[APP_CONFIG.SETTINGS_KEYS.CALENDAR_ID]               = String(payload.calendar_id||'primary').trim()||'primary';
    normalized[APP_CONFIG.SETTINGS_KEYS.SCAN_FREQUENCY_DAYS]       = String(Math.max(1,Number(payload.scan_frequency_days||1)));
    normalized[APP_CONFIG.SETTINGS_KEYS.DAILY_SCAN_TIME]           = String(payload.daily_scan_time||'09:00');
    normalized[APP_CONFIG.SETTINGS_KEYS.LOOKAHEAD_HOURS]           = String(Math.max(1,Number(payload.lookahead_hours||24)));
    normalized[APP_CONFIG.SETTINGS_KEYS.AUTOMATION_ENABLED]        = String(payload.automation_enabled)==='true'?'true':'false';
    normalized[APP_CONFIG.SETTINGS_KEYS.FALLBACK_PARSE_DESCRIPTION]= String(payload.fallback_parse_description)==='false'?'false':'true';
    normalized[APP_CONFIG.SETTINGS_KEYS.SENDER_NAME]               = String(payload.sender_name||'Calendar Automation');
    normalized[APP_CONFIG.SETTINGS_KEYS.REPLY_TO]                  = String(payload.reply_to||'');
    SheetService.setSettings(normalized);
    createOrUpdateDailyTrigger();
    createOrUpdateHourlyTrigger();
    return { ok:true, settings:SheetService.getSettingsWithDefaults(), triggerInfo:getTriggerInfo() };
  }

  function getTriggerInfo() {
    var legacy  = getTriggersByHandler(LEGACY_HANDLER);
    var journey = getTriggersByHandler(JOURNEY_HANDLER);
    var s       = SheetService.getSettingsWithDefaults();
    return {
      legacy:  { active:legacy.length>0,  count:legacy.length,  handler:LEGACY_HANDLER },
      journey: { active:journey.length>0, count:journey.length, handler:JOURNEY_HANDLER },
      configuredTime:          s.daily_scan_time,
      configuredFrequencyDays: s.scan_frequency_days
    };
  }

  return {
    saveAndApplySettings, createOrUpdateDailyTrigger, createOrUpdateHourlyTrigger,
    deleteDailyTrigger, deleteHourlyTrigger, getTriggerInfo
  };
})();
