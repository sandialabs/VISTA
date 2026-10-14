export const PROJECT_PHASE_SEQUENCE = ['data_ingestion', 'part_inspection', 'reporting'];

export const PROJECT_PHASE_LABELS = {
  data_ingestion: 'Data Ingestion',
  part_inspection: 'Part Inspection',
  reporting: 'Reporting',
};

export function resolveAutomaticProjectPhase({ partsLoaded = 0, annotations = 0 }) {
  if (annotations > 0) {
    return 'reporting';
  }
  if (partsLoaded > 0) {
    return 'part_inspection';
  }
  return 'data_ingestion';
}

export function resolveCurrentProjectPhase({
  phaseSettings,
  partsLoaded,
  annotations,
}) {
  const manualEnabled = Boolean(phaseSettings?.manual_phase_selection_enabled);
  const manualPhase = phaseSettings?.manual_phase;
  if (manualEnabled && PROJECT_PHASE_SEQUENCE.includes(manualPhase)) {
    return manualPhase;
  }
  return resolveAutomaticProjectPhase({ partsLoaded, annotations });
}
