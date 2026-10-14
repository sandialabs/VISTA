import { useCallback, useEffect, useState } from 'react';

const EMPTY_LIST = Object.freeze([]);

export default function useImageAnalysisSelection({
  routeInstanceKey,
  setOverlayOptions,
}) {
  const [analysisState, setAnalysisState] = useState({
    routeInstanceKey: null,
    selectedAnalysis: null,
    selectedAnnotations: EMPTY_LIST,
  });
  const selectedAnalysis = analysisState.routeInstanceKey === routeInstanceKey
    ? analysisState.selectedAnalysis
    : null;
  const selectedAnnotations = analysisState.routeInstanceKey === routeInstanceKey
    ? analysisState.selectedAnnotations
    : EMPTY_LIST;

  const resetAnalysisSelection = useCallback(() => {
    setAnalysisState({
      routeInstanceKey,
      selectedAnalysis: null,
      selectedAnnotations: EMPTY_LIST,
    });
    setOverlayOptions((previous) => ({
      ...previous,
      bitmapAvailable: false,
    }));
  }, [routeInstanceKey, setOverlayOptions]);

  const handleMLAnalysisSelect = useCallback((data) => {
    if (data && data.analysis) {
      const annotations = data.annotations || [];
      setAnalysisState({
        routeInstanceKey,
        selectedAnalysis: data.analysis,
        selectedAnnotations: annotations,
      });
      const hasBitmap = annotations.some((annotation) => (
        annotation.storage_path
        && ['heatmap', 'segmentation', 'mask'].includes(annotation.annotation_type)
      ));
      setOverlayOptions((previous) => ({ ...previous, bitmapAvailable: hasBitmap }));
    } else {
      resetAnalysisSelection();
    }
  }, [resetAnalysisSelection, routeInstanceKey, setOverlayOptions]);

  useEffect(() => {
    resetAnalysisSelection();
  }, [resetAnalysisSelection]);

  return {
    handleMLAnalysisSelect,
    selectedAnalysis,
    selectedAnnotations,
  };
}
