// Routes each journey step to the correct channel (email or sms).
// Wraps EmailService — all existing direct EmailService calls still work.
// New journey step sends should call ChannelRouter.send() instead.
var ChannelRouter = (function () {

  // input = {
  //   channel:      'email' | 'sms' | 'both'  (defaults to 'email' for backward compat)
  //   to:           email address (for email/both)
  //   phone:        phone number  (for sms/both)
  //   template:     email template object (for email/both)
  //   smsTemplateId:sms template id string (for sms/both)
  //   placeholders: key/value map
  //   stateId:      journey state id (for SMS log linkage)
  //   stepIndex:    step number (for SMS log)
  //   enrollmentId: same as stateId — alias
  // }
  //
  // Returns: { ok, channel, emailResult, smsResult, message }
  function send(input) {
    var channel = String(input.channel || 'email').toLowerCase().trim();

    // Default to email for any unrecognised channel — preserves backward compat
    if (channel !== 'sms' && channel !== 'both') channel = 'email';

    var emailResult = null;
    var smsResult   = null;

    if (channel === 'email' || channel === 'both') {
      emailResult = _sendEmail(input);
    }

    if (channel === 'sms' || channel === 'both') {
      smsResult = _sendSms(input);
    }

    var ok = (emailResult ? emailResult.ok : true) && (smsResult ? smsResult.ok : true);

    return {
      ok:          ok,
      channel:     channel,
      emailResult: emailResult,
      smsResult:   smsResult,
      message:     _combineMessages(emailResult, smsResult)
    };
  }

  function _sendEmail(input) {
    if (!input.to || !input.template) {
      return { ok: false, subject: '', message: 'Email recipient or template missing.' };
    }
    return EmailService.sendTemplatedEmail({
      to:           input.to,
      template:     input.template,
      placeholders: input.placeholders || {}
    });
  }

  function _sendSms(input) {
    if (!input.phone) {
      return { ok: false, sid: '', message: 'Phone number missing for SMS send.' };
    }
    if (!input.smsTemplateId) {
      return { ok: false, sid: '', message: 'smsTemplateId missing for SMS step.' };
    }

    var body;
    try {
      body = SmsTemplateService.renderBody(input.smsTemplateId, input.placeholders || {});
    } catch (err) {
      return { ok: false, sid: '', message: 'SMS template error: ' + err.message };
    }

    var result = SmsService.send(input.phone, body);

    // Write SMS log record regardless of success/failure
    SheetService.addSmsLog({
      sms_log_id:      Utilities.getUuid(),
      timestamp:       SheetService.nowIso(),
      twilio_sid:      result.sid || '',
      enrollment_id:   input.enrollmentId || input.stateId || '',
      state_id:        input.stateId || '',
      phone:           input.phone,
      journey_id:      input.journeyId || '',
      step_index:      input.stepIndex !== undefined ? String(input.stepIndex) : '',
      sent_at:         result.ok ? SheetService.nowIso() : '',
      delivery_status: result.status || (result.ok ? 'queued' : 'failed'),
      reply_status:    '',
      reply_text:      '',
      reply_timestamp: '',
      action_flag:     '',
      unique_key:      input.uniqueKey || ''
    });

    return result;
  }

  function _combineMessages(emailResult, smsResult) {
    var parts = [];
    if (emailResult) parts.push('Email: ' + (emailResult.ok ? 'sent' : emailResult.message));
    if (smsResult)   parts.push('SMS: '   + (smsResult.ok   ? 'sent' : smsResult.message));
    return parts.join(' | ');
  }

  return { send };
})();
