var TemplateService = (function () {
  function sanitizeColor(hex, fallback) {
    var val = String(hex || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(val) ? val : fallback;
  }

  function normalizeTemplate(input, existing) {
    var now = SheetService.nowIso();
    var base = existing || {};
    var id = base.template_id || input.template_id || Utilities.getUuid();

    var item = {
      template_id: id,
      template_name: String(input.template_name || base.template_name || 'Untitled Template').trim(),
      subject: String(input.subject || base.subject || '').trim(),
      html_body: String(input.html_body || base.html_body || '').trim(),
      header_color: sanitizeColor(input.header_color || base.header_color, '#0b8043'),
      button_color: sanitizeColor(input.button_color || base.button_color, '#1a73e8'),
      text_color: sanitizeColor(input.text_color || base.text_color, '#202124'),
      background_color: sanitizeColor(input.background_color || base.background_color, '#ffffff'),
      active: String(
        input.active !== undefined ? input.active :
        (base.active !== undefined ? base.active : 'true')
      ) === 'true' ? 'true' : 'false',
      created_at: base.created_at || now,
      updated_at: now
    };

    if (!item.subject) throw new Error('Template subject is required.');
    if (!item.html_body) throw new Error('Template HTML body is required.');
    return item;
  }

  function listTemplates() {
    var rows = SheetService.getSheetData(SheetService.SHEETS.TEMPLATES, SheetService.COLUMNS.TEMPLATES);
    rows.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
    return rows;
  }

  function getTemplateById(templateId) {
    var id = String(templateId || '').trim();
    if (!id) return null;
    return listTemplates().find(function (t) { return String(t.template_id) === id; }) || null;
  }

  function saveTemplate(payload) {
    var existing = payload.template_id ? getTemplateById(payload.template_id) : null;
    var item = normalizeTemplate(payload, existing);
    SheetService.upsertByKey(
      SheetService.SHEETS.TEMPLATES,
      SheetService.COLUMNS.TEMPLATES,
      'template_id',
      item
    );
    return item;
  }

  function duplicateTemplate(templateId) {
    var src = getTemplateById(templateId);
    if (!src) throw new Error('Template not found.');
    var copy = Object.assign({}, src, {
      template_id: Utilities.getUuid(),
      template_name: src.template_name + ' (Copy)',
      created_at: SheetService.nowIso(),
      updated_at: SheetService.nowIso()
    });
    SheetService.appendRow(SheetService.SHEETS.TEMPLATES, SheetService.COLUMNS.TEMPLATES, copy);
    return copy;
  }

  function deleteTemplate(templateId) {
    var id = String(templateId || '').trim();
    if (!id) throw new Error('templateId is required.');

    var rules = CalendarService.listColorRules().filter(function (r) {
      return String(r.template_id) === id && String(r.active) === 'true';
    });
    if (rules.length > 0) {
      throw new Error('Template is in use by active color rules. Re-map rules before deleting.');
    }

    return { deleted: SheetService.deleteByKey(SheetService.SHEETS.TEMPLATES, SheetService.COLUMNS.TEMPLATES, 'template_id', id) };
  }

  return {
    listTemplates: listTemplates,
    getTemplateById: getTemplateById,
    saveTemplate: saveTemplate,
    duplicateTemplate: duplicateTemplate,
    deleteTemplate: deleteTemplate
  };
})();
