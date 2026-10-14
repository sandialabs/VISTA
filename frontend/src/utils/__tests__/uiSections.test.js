import { isUiSectionEnabled, normalizeUiSections } from '../uiSections';

describe('uiSections', () => {
  test('defaults known UI sections to visible', () => {
    expect(isUiSectionEnabled({}, 'main.analyze')).toBe(true);
    expect(isUiSectionEnabled({}, 'project_data.batches')).toBe(true);
    expect(isUiSectionEnabled({}, 'project_data.unload_parts')).toBe(true);
    expect(isUiSectionEnabled({}, 'project_configuration.calibration')).toBe(true);
  });

  test('preserves explicit hidden section settings', () => {
    const normalized = normalizeUiSections({ ui_sections: { 'main.analyze': false, 'project_data.batches': false } });
    expect(normalized['main.analyze']).toBe(false);
    expect(normalized['project_data.batches']).toBe(false);
    expect(normalized['project_data.images_to_parts']).toBe(true);
    expect(normalized['project_data.unload_parts']).toBe(true);
  });

  test('preserves an explicitly hidden project calibration section', () => {
    const normalized = normalizeUiSections({
      ui_sections: { 'project_configuration.calibration': false },
    });
    expect(normalized['project_configuration.calibration']).toBe(false);
  });
});
