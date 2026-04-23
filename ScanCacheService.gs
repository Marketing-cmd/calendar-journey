// Manages cached calendar scan results so the dashboard doesn't hit the
// Calendar API on every load. Refreshed by a background hourly trigger.
var ScanCacheService = (function () {

  var CACHE_TTL_MINUTES = 55; // slightly under 1 hour trigger interval

  function _windowKey(calendarId, windowStart, windowEnd) {
    return [calendarId, windowStart, windowEnd].join('|');
  }

  function isCacheStale(cachedAt) {
    if (!cachedAt) return true;
    var age = Date.now() - new Date(cachedAt).getTime();
    return age > CACHE_TTL_MINUTES * 60 * 1000;
  }

  // Returns cached result if fresh, or null if stale/missing
  function getCache(calendarId, windowStart, windowEnd) {
    var settings = SheetService.getSettingsWithDefaults();
    if (String(settings.scan_cache_enabled) !== 'true') return null;

    var cached = SheetService.getScanCache(calendarId, windowStart, windowEnd);
    if (!cached || isCacheStale(cached.scanned_at)) return null;

    try {
      return JSON.parse(cached.result_json || '[]');
    } catch(e) {
      return null;
    }
  }

  // Write or update a cache entry
  function setCache(calendarId, windowStart, windowEnd, events, scannedAt) {
    var existing = SheetService.getScanCache(calendarId, windowStart, windowEnd);
    var now      = scannedAt || SheetService.nowIso();
    var entry = {
      cache_id:     existing ? existing.cache_id : Utilities.getUuid(),
      calendar_id:  calendarId,
      window_start: windowStart,
      window_end:   windowEnd,
      scanned_at:   now,
      event_count:  String(events.length),
      result_json:  JSON.stringify(events)
    };
    SheetService.upsertScanCache(entry);
    return entry;
  }

  // Build standard window boundaries for common scan types
  function buildWindow(type, customStart, customEnd) {
    var now   = new Date();
    var start, end;

    if (type === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (type === 'next_month') {
      start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      end   = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    } else if (type === 'custom') {
      start = new Date(customStart);
      end   = new Date(customEnd);
      if (isNaN(start) || isNaN(end)) throw new Error('Invalid custom date range.');
    } else {
      // default: lookahead window (legacy behavior)
      var settings      = SheetService.getSettingsWithDefaults();
      var lookaheadHours= Math.max(1, Number(settings.lookahead_hours || 24));
      start = now;
      end   = new Date(now.getTime() + lookaheadHours * 3600000);
    }

    return { start: start.toISOString(), end: end.toISOString(), startDate: start, endDate: end };
  }

  // Fetch events from Google Calendar and write to cache
  // Returns array of lightweight event objects safe for caching
  function refreshCache(calendarId, windowType, customStart, customEnd) {
    var window = buildWindow(windowType || 'lookahead', customStart, customEnd);
    var tz     = Session.getScriptTimeZone();
    var cal    = CalendarApp.getCalendarById(calendarId || 'primary');
    if (!cal) throw new Error('Calendar not found: ' + calendarId);

    var events = cal.getEvents(window.startDate, window.endDate);
    var lightweight = events.map(function (ev) {
      var start = ev.getStartTime();
      return {
        id:          ev.getId(),
        title:       ev.getTitle(),
        color:       String(ev.getColor()),
        start:       start.toISOString(),
        date:        Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
        time:        ev.isAllDayEvent() ? 'All day' : Utilities.formatDate(start, tz, 'HH:mm'),
        location:    ev.getLocation() || '',
        description: ev.getDescription() || '',
        attendees:   ev.getGuestList().map(function (g) { return g.getEmail(); }),
        allDay:      ev.isAllDayEvent()
      };
    });

    setCache(calendarId, window.start, window.end, lightweight);
    return { events: lightweight, count: lightweight.length, window: window };
  }

  // Get cached events, refreshing if stale
  function getOrRefresh(calendarId, windowType, customStart, customEnd) {
    var window  = buildWindow(windowType || 'lookahead', customStart, customEnd);
    var cached  = getCache(calendarId, window.start, window.end);
    if (cached !== null) return { events: cached, fromCache: true,  count: cached.length };
    var fresh = refreshCache(calendarId, windowType, customStart, customEnd);
    return { events: fresh.events, fromCache: false, count: fresh.count, window: fresh.window };
  }

  return { getOrRefresh, refreshCache, buildWindow, isCacheStale };
})();
