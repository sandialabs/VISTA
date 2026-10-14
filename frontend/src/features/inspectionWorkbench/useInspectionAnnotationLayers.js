import { useMemo } from 'react';
import {
  annotationToPt3VectorAnnotation,
  annotationToVectorSegment,
} from '../../components/inspectionAnnotationAdapter';
import {
  getBoxAnnotationsByImageId,
  getMeasurementLinesByImageId,
  getMprBoxAnnotationsBySlice,
  getMprCubeAnnotations,
  getMprMeasurementLinesBySlice,
} from './inspectionAnnotationDisplay';

// Returns the configured defect type names, trimmed and de-duplicated
// case-insensitively in configuration order.
export const getConfiguredDefectTypes = (projectConfiguration) => {
  if (!Array.isArray(projectConfiguration?.defect_types)) return [];
  const seen = new Set();
  return projectConfiguration.defect_types
    .map((entry) => String(typeof entry === 'string' ? entry : entry?.name || '').trim())
    .filter((defectType) => {
      const key = defectType.toLocaleLowerCase();
      if (!defectType || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export function useConfiguredDefectTypes(projectConfiguration) {
  return useMemo(() => getConfiguredDefectTypes(projectConfiguration), [projectConfiguration]);
}

// Derives the per-surface annotation geometry layers. The stored layers keep
// every visible annotation for hit testing; the returned display layers are
// empty while the annotation layer is hidden.
export default function useInspectionAnnotationLayers({ annotationLayerVisible, annotations }) {
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation?.hidden !== true),
    [annotations],
  );
  const vectorSegmentAnnotations = useMemo(
    () => annotations.map(annotationToVectorSegment).filter(Boolean),
    [annotations],
  );
  const pt3RenderableAnnotations = useMemo(
    () => annotations.map(annotationToPt3VectorAnnotation).filter(Boolean),
    [annotations],
  );
  const storedMeasurementLinesByImageId = useMemo(() => getMeasurementLinesByImageId(visibleAnnotations), [visibleAnnotations]);
  const storedBoxAnnotationsByImageId = useMemo(() => getBoxAnnotationsByImageId(visibleAnnotations), [visibleAnnotations]);
  const storedMprMeasurementLinesBySlice = useMemo(() => getMprMeasurementLinesBySlice(visibleAnnotations), [visibleAnnotations]);
  const storedMprBoxAnnotationsBySlice = useMemo(() => getMprBoxAnnotationsBySlice(visibleAnnotations), [visibleAnnotations]);
  const storedMprCubeAnnotations = useMemo(() => getMprCubeAnnotations(visibleAnnotations), [visibleAnnotations]);
  return {
    boxAnnotationsByImageId: annotationLayerVisible ? storedBoxAnnotationsByImageId : {},
    measurementLinesByImageId: annotationLayerVisible ? storedMeasurementLinesByImageId : {},
    mprBoxAnnotationsBySlice: annotationLayerVisible ? storedMprBoxAnnotationsBySlice : {},
    mprCubeAnnotations: annotationLayerVisible ? storedMprCubeAnnotations : [],
    mprMeasurementLinesBySlice: annotationLayerVisible ? storedMprMeasurementLinesBySlice : {},
    pt3RenderableAnnotations,
    storedBoxAnnotationsByImageId,
    storedMeasurementLinesByImageId,
    storedMprBoxAnnotationsBySlice,
    storedMprMeasurementLinesBySlice,
    vectorSegmentAnnotations,
  };
}
