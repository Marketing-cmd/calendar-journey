var EmailService = (function () {
  function replacePlaceholders(text, data) {
    var out = String(text || '');
    Object.keys(data || {}).forEach(function (k) {
      var regex = new RegExp('{{\\s*' + k + '\\s*}}', 'g');
      out = out.replace(regex, String(data[k] == null ? '' : data[k]));
    });
    return out;
  }

  function buildBrandedHtml(template, contentHtml) {
    var header = template.header_color || '#0b8043';
    var button = template.button_color || '#1a73e8';
    var text = template.text_color || '#202124';
    var bg = template.background_color || '#ffffff';

    return ''
      + '<div style="margin:0;padding:24px;background:' + bg + ';font-family:Arial,sans-serif;color:' + text + ';">'
      + '  <div style="max-width:680px;margin:0 auto;border:1px solid #e5e7eb;background:#ffffff;border-radius:8px;overflow:hidden;">'
      + '    <div style="background:' + header + ';color:#fff;padding:14px 18px;font-weight:700;">Calendar Notification</div>'
      + '    <div style="padding:18px 18px 24px;">'
      +       contentHtml
      + '      <div style="margin-top:22px;">'
      + '        <a href="#" style="display:inline-block;background:' + button + ';color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;">Open Calendar</a>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div>';
  }

  function sendTemplatedEmail(input) {
    var to = String(input.to || '').trim();
    if (!to) return { ok: false, subject: '', message: 'Recipient email is missing.' };

    var template = input.template || {};
    var placeholders = input.placeholders || {};
    var settings = SheetService.getSettingsWithDefaults();

    var subject = replacePlaceholders(template.subject || '', placeholders);
    var body = replacePlaceholders(template.html_body || '', placeholders);
    var htmlBody = buildBrandedHtml(template, body);

    var opts = {
      htmlBody: htmlBody
    };

    if (settings.sender_name) opts.name = settings.sender_name;
    if (settings.reply_to) opts.replyTo = settings.reply_to;

    try {
      GmailApp.sendEmail(to, subject, 'Your email client does not support HTML email.', opts);
      return { ok: true, subject: subject, message: 'Email sent.' };
    } catch (err) {
      return { ok: false, subject: subject, message: err.message };
    }
  }

  function sendTestEmail(payload) {
    var templateId = String(payload.template_id || '').trim();
    var testEmail = String(payload.test_email || '').trim();
    var testName = String(payload.test_name || 'Test User').trim();
    var testEventTitle = String(payload.event_title || 'Sample Event').trim();

    if (!templateId) throw new Error('template_id is required.');
    if (!testEmail) throw new Error('test_email is required.');

    var template = TemplateService.getTemplateById(templateId);
    if (!template) throw new Error('Template not found.');

    var placeholders = {
      name: testName,
      email: testEmail,
      event_title: testEventTitle,
      event_date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      event_time: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm'),
      calendar_name: 'Test Calendar',
      location: 'Virtual',
      description: 'This is a test email generated from the dashboard.'
    };

    return sendTemplatedEmail({
      to: testEmail,
      template: template,
      placeholders: placeholders
    });
  }

  return {
    sendTemplatedEmail: sendTemplatedEmail,
    sendTestEmail: sendTestEmail,
    replacePlaceholders: replacePlaceholders,
    buildBrandedHtml: buildBrandedHtml
  };
})();
