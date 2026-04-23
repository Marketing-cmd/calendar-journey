// Twilio-backed SMS sender. Standalone — no dependency on EmailService.
// Falls back gracefully when SMS is disabled or credentials are missing.
var SmsService = (function () {

  function getCredentials() {
    var s = SheetService.getSettingsWithDefaults();
    return {
      enabled:          String(s.sms_enabled) === 'true',
      accountSid:       String(s.twilio_account_sid  || '').trim(),
      authToken:        String(s.twilio_auth_token    || '').trim(),
      fromNumber:       String(s.twilio_from_number   || '').trim(),
      messagingSid:     String(s.twilio_messaging_sid || '').trim()
    };
  }

  function normalizePhone(raw) {
    var digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    // Prepend +1 for 10-digit North American numbers
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits[0] === '1') return '+' + digits;
    return '+' + digits;
  }

  function send(to, body) {
    var creds = getCredentials();

    if (!creds.enabled) {
      return { ok: false, sid: '', message: 'SMS disabled in settings.' };
    }
    if (!creds.accountSid || !creds.authToken || !creds.fromNumber) {
      return { ok: false, sid: '', message: 'Twilio credentials incomplete.' };
    }

    var phone = normalizePhone(to);
    if (!phone) {
      return { ok: false, sid: '', message: 'Invalid phone number: ' + to };
    }

    var payload = {
      To:   phone,
      Body: String(body || '').trim()
    };

    // Prefer MessagingServiceSid if configured, otherwise use From number
    if (creds.messagingSid) {
      payload.MessagingServiceSid = creds.messagingSid;
    } else {
      payload.From = creds.fromNumber;
    }

    var formBody = Object.keys(payload).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]);
    }).join('&');

    var url = 'https://api.twilio.com/2010-04-01/Accounts/' + creds.accountSid + '/Messages.json';

    try {
      var response = UrlFetchApp.fetch(url, {
        method:  'post',
        headers: {
          Authorization: 'Basic ' + Utilities.base64Encode(creds.accountSid + ':' + creds.authToken)
        },
        payload:              formBody,
        contentType:          'application/x-www-form-urlencoded',
        muteHttpExceptions:   true
      });

      var code = response.getResponseCode();
      var json = JSON.parse(response.getContentText());

      if (code === 201) {
        return { ok: true, sid: json.sid || '', message: 'Sent.', status: json.status || '' };
      } else {
        return { ok: false, sid: '', message: (json.message || json.error_message || 'Twilio error ' + code) };
      }
    } catch (err) {
      return { ok: false, sid: '', message: 'HTTP error: ' + err.message };
    }
  }

  // Poll Twilio for delivery status of a previously sent message
  function fetchStatus(sid) {
    var creds = getCredentials();
    if (!creds.accountSid || !creds.authToken) return { ok: false, status: '', message: 'No credentials.' };

    var url = 'https://api.twilio.com/2010-04-01/Accounts/' + creds.accountSid + '/Messages/' + sid + '.json';
    try {
      var response = UrlFetchApp.fetch(url, {
        method:  'get',
        headers: {
          Authorization: 'Basic ' + Utilities.base64Encode(creds.accountSid + ':' + creds.authToken)
        },
        muteHttpExceptions: true
      });
      var json = JSON.parse(response.getContentText());
      return { ok: response.getResponseCode() === 200, status: json.status || '', message: json.error_message || '' };
    } catch (err) {
      return { ok: false, status: '', message: err.message };
    }
  }

  return { send, fetchStatus, normalizePhone };
})();
