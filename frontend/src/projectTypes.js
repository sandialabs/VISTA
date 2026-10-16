// Centralized project type display metadata.
// Update these labels when a deployment needs different user-facing names for PT1/PT2/PT3.
export const PROJECT_TYPE_OPTIONS = [
  { value: 'PT1', label: 'Project Type 1', shortLabel: 'PT1' },
  { value: 'PT2', label: 'Project Type 2', shortLabel: 'PT2' },
  { value: 'PT3', label: 'Project Type 3', shortLabel: 'PT3' },
];

export const DEFAULT_PROJECT_TYPE = PROJECT_TYPE_OPTIONS[0].value;

export function getProjectTypeLabel(projectType, { short = false } = {}) {
  const option = PROJECT_TYPE_OPTIONS.find((item) => item.value === projectType);
  if (!option) return projectType || DEFAULT_PROJECT_TYPE;
  return short ? option.shortLabel : option.label;
}
