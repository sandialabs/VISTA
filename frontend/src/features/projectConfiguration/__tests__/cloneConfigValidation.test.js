import { getCloneConfigOrThrow } from '../cloneConfigValidation';

const validConfig = () => ({
  image_modalities: [{ id: 'visible', label: 'Visible' }],
  part_views: [{ id: 'top', label: 'Top', required_modalities: ['visible'], source: 'manual' }],
  defect_types: [{ name: 'Crack', color: '#ef4444' }],
  process_settings: {
    require_disposition_on_submit: false,
    require_measurement_for_critical: true,
    require_second_reviewer_for_reject: false,
    configurable_hotkeys: {
      accept_classification: 'a',
      reject_classification: 'r',
      toggle_shortcut_help: 'h',
    },
  },
  display_settings: {
    default_colormap: 'grayscale',
    anomaly_colormap: 'viridis',
    grayscale_base_image: false,
    inspection_tile_max_columns: 8,
  },
});

describe('getCloneConfigOrThrow', () => {
  test('returns the config for a valid clone response', () => {
    const config = validConfig();
    expect(getCloneConfigOrThrow({ config })).toBe(config);
  });

  test('throws when the config payload is missing', () => {
    expect(() => getCloneConfigOrThrow({ copied: true })).toThrow(/missing config payload/);
  });

  test('throws when the top-level shape is invalid', () => {
    expect(() => getCloneConfigOrThrow({ config: {} })).toThrow(/invalid config payload shape/);
  });

  test('throws when collection entries are invalid', () => {
    const config = validConfig();
    config.image_modalities = [null];
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config payload entries/);
  });

  test('throws when scalar fields are invalid', () => {
    const config = validConfig();
    config.image_modalities = [{ id: 123, label: 'Modality' }];
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config scalar fields/);
  });

  test('throws when semantic fields are blank', () => {
    const config = validConfig();
    config.image_modalities = [{ id: '   ', label: '   ' }];
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config semantic fields/);
  });

  test('throws when settings fields are invalid', () => {
    const config = validConfig();
    config.display_settings.grayscale_base_image = 'true';
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config settings fields/);
  });

  test('throws when domain fields are out of range', () => {
    const config = validConfig();
    config.display_settings.default_colormap = 'plasma';
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config domain fields/);
  });

  test('throws when hotkeys are duplicated', () => {
    const config = validConfig();
    config.process_settings.configurable_hotkeys.reject_classification = 'a';
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config hotkey domain fields/);
  });

  test('throws when relational references are invalid', () => {
    const config = validConfig();
    config.part_views[0].required_modalities = ['missing-modality'];
    expect(() => getCloneConfigOrThrow({ config })).toThrow(/invalid config relational fields/);
  });
});
