import { useCallback, useMemo, useState } from 'react';

export const DEFAULT_INSPECTION_RENDER_CATEGORIES = ['source', 'overlay', 'annotation', 'crop'];

export function getAnnotationLayerVisible({ annotationsVisible, projectType, renderCategories }) {
  return Boolean(
    annotationsVisible
    && (projectType === 'PT3' || (Array.isArray(renderCategories) && renderCategories.includes('annotation'))),
  );
}

export function getVolumeOverlayLayersVisible({ annotationsVisible, projectType, renderCategories }) {
  return Boolean(
    annotationsVisible
    && (projectType === 'PT3' || (Array.isArray(renderCategories) && renderCategories.includes('overlay'))),
  );
}

export default function useInspectionDisplayLayers({ projectType }) {
  const [renderCategories, setRenderCategories] = useState(DEFAULT_INSPECTION_RENDER_CATEGORIES);
  const [imageEnabled, setImageEnabled] = useState(true);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);

  const annotationLayerVisible = useMemo(
    () => getAnnotationLayerVisible({ annotationsVisible, projectType, renderCategories }),
    [annotationsVisible, projectType, renderCategories],
  );
  const volumeOverlayLayersVisible = useMemo(
    () => getVolumeOverlayLayersVisible({ annotationsVisible, projectType, renderCategories }),
    [annotationsVisible, projectType, renderCategories],
  );

  const ensureRenderCategoryVisible = useCallback((category) => {
    const normalizedCategory = String(category || '').trim();
    if (!normalizedCategory) return;
    setRenderCategories((previous) => (
      previous.includes(normalizedCategory) ? previous : [...previous, normalizedCategory]
    ));
  }, []);

  return {
    annotationLayerVisible,
    annotationsVisible,
    ensureRenderCategoryVisible,
    imageEnabled,
    renderCategories,
    setAnnotationsVisible,
    setImageEnabled,
    setRenderCategories,
    volumeOverlayLayersVisible,
  };
}
