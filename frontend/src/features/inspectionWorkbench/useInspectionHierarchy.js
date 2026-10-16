import { useMemo } from 'react';
import { DEFAULT_INTERFACE_HIERARCHY } from '../../utils/interfaceHierarchy';
import { normalizeInspectionHierarchy, normalizeInspectionRegion } from './flexLayout';

// Normalizes the configured inspection hierarchy. PT3 projects always get the
// MPR center tab, prepended when the configuration omits it.
export const getEffectiveInspectionHierarchy = (hierarchy, projectType) => {
  const normalized = normalizeInspectionHierarchy(hierarchy || {});
  if (projectType !== 'PT3' || normalized.centerTabs.includes('mpr')) {
    return normalized;
  }
  return {
    ...normalized,
    centerTabs: ['mpr', ...normalized.centerTabs],
    regions: {
      ...normalized.regions,
      mpr: normalizeInspectionRegion('mpr', DEFAULT_INTERFACE_HIERARCHY.inspection.regions.mpr),
    },
  };
};

export default function useInspectionHierarchy({ hierarchy, projectType }) {
  return useMemo(() => getEffectiveInspectionHierarchy(hierarchy, projectType), [hierarchy, projectType]);
}
