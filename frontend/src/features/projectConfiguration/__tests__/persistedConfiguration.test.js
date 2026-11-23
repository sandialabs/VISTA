import { toPersistedConfiguration } from '../persistedConfiguration';

describe('toPersistedConfiguration', () => {
  test('drops PT1-forced hidden sections only for PT1 projects', () => {
    const config = {
      defect_types: [],
      ui_sections: {
        'project_configuration.filename_convention': false,
        'project_configuration.view_options': false,
        'project_configuration.hotkeys': false,
        'main.inspection': true,
      },
    };
    expect(toPersistedConfiguration(config, 'PT2')).toBe(config);
    expect(toPersistedConfiguration(config, 'PT1')).toEqual({
      defect_types: [],
      ui_sections: {
        'project_configuration.hotkeys': false,
        'main.inspection': true,
      },
    });
    expect(config.ui_sections['project_configuration.view_options']).toBe(false);
  });

  test('passes through configs without ui_sections', () => {
    const config = { defect_types: [] };
    expect(toPersistedConfiguration(config, 'PT1')).toBe(config);
    expect(toPersistedConfiguration(null, 'PT1')).toBeNull();
  });
});
