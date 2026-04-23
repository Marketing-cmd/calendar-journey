// Mirrors TemplateService pattern exactly. Fully standalone.
var SmsTemplateService = (function () {

  function listSmsTemplates() { return SheetService.listSmsTemplates(); }

  function getSmsTemplateById(id) {
    var s = String(id || '').trim();
    return s ? SheetService.getSmsTemplateById(s) : null;
  }

  function saveSmsTemplate(payload) {
    var now      = SheetService.nowIso();
    var existing = payload.sms_template_id ? getSmsTemplateById(payload.sms_template_id) : null;
    var base     = existing || {};

    var body = String(payload.body !== undefined ? payload.body : (base.body || '')).trim();
    if (!body) throw new Error('SMS template body is required.');
    if (body.length > 1600) throw new Error('SMS body exceeds 1600 character limit.');

    var item = {
      sms_template_id: base.sms_template_id || payload.sms_template_id || Utilities.getUuid(),
      template_name:   String(payload.template_name || base.template_name || 'Untitled SMS').trim(),
      body:            body,
      active:          String(payload.active !== undefined ? payload.active : (base.active !== undefined ? base.active : 'true')) === 'true' ? 'true' : 'false',
      created_at:      base.created_at || now,
      updated_at:      now
    };

    SheetService.upsertSmsTemplate(item);
    return item;
  }

  function duplicateSmsTemplate(id) {
    var src = getSmsTemplateById(id);
    if (!src) throw new Error('SMS template not found.');
    var now  = SheetService.nowIso();
    var copy = Object.assign({}, src, {
      sms_template_id: Utilities.getUuid(),
      template_name:   src.template_name + ' (Copy)',
      created_at:      now,
      updated_at:      now
    });
    SheetService.upsertSmsTemplate(copy);
    return copy;
  }

  function deleteSmsTemplate(id) {
    var s = String(id || '').trim();
    if (!s) throw new Error('sms_template_id is required.');
    return { deleted: SheetService.deleteSmsTemplateRow(s) };
  }

  // Replaces {{placeholders}} in body text — shared with EmailService.replacePlaceholders logic
  function replacePlaceholders(text, data) {
    var out = String(text || '');
    Object.keys(data || {}).forEach(function (k) {
      var re = new RegExp('\\{\\{\\s*' + k + '\\s*\\}\\}', 'g');
      out = out.replace(re, String(data[k] == null ? '' : data[k]));
    });
    return out;
  }

  function renderBody(templateId, placeholders) {
    var tpl = getSmsTemplateById(templateId);
    if (!tpl) throw new Error('SMS template not found: ' + templateId);
    if (String(tpl.active) !== 'true') throw new Error('SMS template is inactive.');
    return replacePlaceholders(tpl.body, placeholders || {});
  }

  return {
    listSmsTemplates,
    getSmsTemplateById,
    saveSmsTemplate,
    duplicateSmsTemplate,
    deleteSmsTemplate,
    replacePlaceholders,
    renderBody
  };
})();
