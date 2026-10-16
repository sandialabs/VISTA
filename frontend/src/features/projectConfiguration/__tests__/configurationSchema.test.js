import {
  EMPTY_CONFIG,
  normalizeConfigurationSection,
  normalizeInspectionTileMaxColumns,
  normalizeOverlayIndicator,
  normalizeProjectConfiguration,
  validateConfiguration,
} from '../configurationSchema';

const normalizeSection = (key, config) => normalizeConfigurationSection(key, config);

const serialize = (value) => JSON.stringify(value, null, 2);

const validConfig = () => ({
  image_modalities: [
    { id: 'Visible', label: 'Visible light', calibration_required: false },
    { id: 'ir', label: 'Infrared' },
  ],
  part_views: [
    { id: 'Top', label: 'Top', required_modalities: ['visible'], source: 'manual' },
    { id: 'bottom', label: 'Bottom', required_modalities: [] },
  ],
  defect_types: [{ name: 'Crack', color: '#ef4444', definition: 'A crack' }],
  process_settings: {
    require_disposition_on_submit: false,
    require_measurement_for_critical: true,
    require_second_reviewer_for_reject: false,
    configurable_hotkeys: {
      accept_classification: 'A',
      reject_classification: 'r',
      toggle_shortcut_help: '1',
    },
  },
  display_settings: {
    default_colormap: 'magma',
    anomaly_colormap: 'viridis',
    grayscale_base_image: false,
    inspection_tile_max_columns: 12,
    custom_flag: true,
  },
  calibration: { pixels_per_mm: 10, pixels_per_inch: 254, unit: 'mm', updated_at: '2026-01-01T00:00:00Z' },
  extra_top_level: { kept: true },
});

const invalidValuesConfig = () => ({
  defect_types: { not: 'an array' },
  display_settings: {
    inspection_tile_max_columns: 'abc',
    pt3_3d_guides: { crosshair_transparency_percent: 500, crosshair_line_width_px: -1 },
  },
  serial_number_scheme: {
    batch_sn_enabled: 'no',
    sub_batching_enabled: 'yes',
    sub_batch_sn_enabled: true,
    part_sn_enabled: false,
  },
  phase_settings: { manual_phase_selection_enabled: 'true', manual_phase: 'unknown' },
  metadata_parsers: { nsipro: { parser_id: '   ', extra: 1 } },
  ui_sections: { 'project_configuration.filename_convention': true, 'project_configuration.general': 0 },
  file_naming_scheme: {
    use_filename_convention: false,
    hierarchy_levels: [{ id: '  ', label: ' Lot ', abbreviation: ' L ' }, {}],
    image_descriptors: [],
    delimiter: '-',
    metadata_extractor: 'not-an-object',
    overlay_indicator: { enabled: false, field_key: '  ', values: 'a, b,,', remove_from_base_filename: false },
  },
});

describe('normalizeProjectConfiguration characterization', () => {
  it('pins EMPTY_CONFIG', () => {
    expect(serialize(EMPTY_CONFIG)).toMatchSnapshot();
  });

  it.each([
    ['PT1'], ['PT2'], ['PT3'], [''], [null], [undefined], [' pt1 '], ['pt3'],
  ])('normalizes a missing configuration for project type %p', (projectType) => {
    expect(serialize(normalizeProjectConfiguration(undefined, projectType))).toMatchSnapshot();
  });

  it.each([['PT1'], ['PT2']])('normalizes a valid configuration for %s', (projectType) => {
    const config = validConfig();
    const before = serialize(config);
    expect(serialize(normalizeProjectConfiguration(config, projectType))).toMatchSnapshot();
    expect(serialize(config)).toBe(before);
  });

  it.each([['PT1'], ['PT3']])('normalizes invalid values for %s', (projectType) => {
    expect(serialize(normalizeProjectConfiguration(invalidValuesConfig(), projectType))).toMatchSnapshot();
  });

  it.each([['string'], [null], [42], [[1, 2]]])('normalizes non-object input %p', (input) => {
    expect(serialize(normalizeProjectConfiguration(input, 'PT2'))).toMatchSnapshot();
  });

  it('hides PT1-only UI sections and keeps file naming for other types', () => {
    const pt1 = normalizeProjectConfiguration(invalidValuesConfig(), 'PT1');
    expect(pt1.ui_sections['project_configuration.filename_convention']).toBe(false);
    expect(pt1.ui_sections['project_configuration.view_options']).toBe(false);
    expect('file_naming_scheme' in pt1).toBe(false);
    const pt2 = normalizeProjectConfiguration(invalidValuesConfig(), 'PT2');
    expect(pt2.ui_sections['project_configuration.filename_convention']).toBe(true);
    expect(pt2.file_naming_scheme.delimiter).toBe('-');
    expect(pt2.defect_types.map((entry) => entry.name)).toEqual([
      'DefectType1_PT2', 'DefectType2_PT2', 'DefectType3_PT2',
    ]);
  });
});

describe('section normalizers characterization', () => {
  it.each([
    ['display_settings'], ['file_naming_scheme'], ['metadata_parsers'], ['phase_settings'], ['serial_number_scheme'],
  ])('normalizes %s from empty, valid, and invalid input', (key) => {
    const outputs = [undefined, {}, validConfig(), invalidValuesConfig()]
      .map((config) => normalizeSection(key, config));
    expect(serialize(outputs)).toMatchSnapshot();
  });

  it('keeps a valid manual phase', () => {
    expect(normalizeSection('phase_settings', {
      phase_settings: { manual_phase_selection_enabled: true, manual_phase: 'reporting' },
    })).toEqual({ manual_phase_selection_enabled: true, manual_phase: 'reporting' });
  });

  it('normalizes inspection tile columns', () => {
    expect([undefined, 'abc', 0, -3, 1, 3.6, '7', 64, 100, Infinity].map(normalizeInspectionTileMaxColumns))
      .toEqual([8, 8, 1, 1, 1, 4, 7, 64, 64, 8]);
  });

  it('normalizes overlay indicators', () => {
    expect(normalizeOverlayIndicator()).toEqual({
      enabled: true,
      field_key: 'overlay',
      values: ['true', 'overlay', 'ov', 'mask', 'heatmap'],
      remove_from_base_filename: true,
    });
    expect(normalizeOverlayIndicator({ enabled: false, field_key: ' ov ', values: [' x ', '', null] })).toEqual({
      enabled: false,
      field_key: 'ov',
      values: ['x'],
      remove_from_base_filename: true,
    });
  });
});

describe('validateConfiguration characterization', () => {
  it('accepts default and valid configurations', () => {
    expect(validateConfiguration(EMPTY_CONFIG)).toEqual([]);
    expect(validateConfiguration(normalizeProjectConfiguration(undefined, 'PT2'))).toEqual([]);
    expect(validateConfiguration(validConfig())).toEqual([]);
    expect(validateConfiguration({ ...validConfig(), calibration: null })).toEqual([]);
  });

  it('reports every error in order', () => {
    expect(validateConfiguration({
      image_modalities: [{ id: 'a', label: '' }, { id: 'A', label: 'Again' }],
      part_views: [{ id: 'top', label: '' }, { id: 'TOP', label: 'x', required_modalities: ['missing'] }],
      defect_types: [{ name: '', color: 'red' }, { name: 'Crack', color: '#ef4444' }, { name: 'crack', color: '#ef4444' }],
      process_settings: { configurable_hotkeys: { accept_classification: 'ab', reject_classification: 'ab', toggle_shortcut_help: '' } },
      calibration: { pixels_per_mm: -1, unit: 'mm' },
    })).toEqual([
      'Each modality requires both a filename value and label.',
      'Modality filename values must be unique.',
      'Each side requires both a filename value and label.',
      'Side filename values must be unique.',
      'Stored side modality requirements must reference configured modalities.',
      'Each defect type requires a name.',
      'Defect type names must be unique (case-insensitive).',
      'Defect type colors must be valid 6-digit hex values (for example #ef4444).',
      'Hotkeys must be single alphanumeric characters.',
      'Hotkeys must be unique across accept, reject, and help actions.',
      'Project calibration requires positive finite pixel scales and a valid unit.',
    ]);
  });

  it.each([
    ['missing hotkeys', { process_settings: {} }],
    ['bad calibration unit', { calibration: { pixels_per_mm: 10, pixels_per_inch: 254, unit: 'cm' } }],
    ['bad calibration timestamp', { calibration: { pixels_per_mm: 10, pixels_per_inch: 254, unit: 'mm', updated_at: 'never' } }],
    ['array calibration', { calibration: [] }],
    ['inconsistent calibration', { calibration: { pixels_per_mm: 10, pixels_per_inch: 100, unit: 'inches' } }],
    ['blank modality id', { image_modalities: [{ id: '  ', label: 'x' }] }],
    ['empty collections', { image_modalities: [], part_views: [], defect_types: [] }],
  ])('pins messages for %s', (_, overrides) => {
    expect(validateConfiguration({ ...validConfig(), ...overrides })).toMatchSnapshot();
  });
});
