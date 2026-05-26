import {
  PROJECT_PHASE_SEQUENCE,
  PROJECT_PHASE_LABELS,
  resolveAutomaticProjectPhase,
  resolveCurrentProjectPhase,
} from '../projectPhases';

describe('projectPhases utilities', () => {
  test('exports the canonical phase sequence and labels', () => {
    expect(PROJECT_PHASE_SEQUENCE).toEqual(['data_ingestion', 'part_inspection', 'reporting']);
    expect(PROJECT_PHASE_LABELS).toEqual({
      data_ingestion: 'Data Ingestion',
      part_inspection: 'Part Inspection',
      reporting: 'Reporting',
    });
  });

  test('resolveAutomaticProjectPhase chooses reporting when annotations exist', () => {
    expect(resolveAutomaticProjectPhase({ partsLoaded: 0, annotations: 1 })).toBe('reporting');
  });

  test('resolveAutomaticProjectPhase chooses part inspection when parts are loaded', () => {
    expect(resolveAutomaticProjectPhase({ partsLoaded: 5, annotations: 0 })).toBe('part_inspection');
  });

  test('resolveAutomaticProjectPhase defaults to data ingestion', () => {
    expect(resolveAutomaticProjectPhase({ partsLoaded: 0, annotations: 0 })).toBe('data_ingestion');
    expect(resolveAutomaticProjectPhase({})).toBe('data_ingestion');
  });

  test('resolveCurrentProjectPhase uses valid manual phase override when enabled', () => {
    expect(
      resolveCurrentProjectPhase({
        phaseSettings: {
          manual_phase_selection_enabled: true,
          manual_phase: 'reporting',
        },
        partsLoaded: 0,
        annotations: 0,
      }),
    ).toBe('reporting');
  });

  test('resolveCurrentProjectPhase falls back to automatic phase when manual is disabled or invalid', () => {
    expect(
      resolveCurrentProjectPhase({
        phaseSettings: {
          manual_phase_selection_enabled: false,
          manual_phase: 'reporting',
        },
        partsLoaded: 1,
        annotations: 0,
      }),
    ).toBe('part_inspection');

    expect(
      resolveCurrentProjectPhase({
        phaseSettings: {
          manual_phase_selection_enabled: true,
          manual_phase: 'not_a_real_phase',
        },
        partsLoaded: 0,
        annotations: 2,
      }),
    ).toBe('reporting');
  });
});
