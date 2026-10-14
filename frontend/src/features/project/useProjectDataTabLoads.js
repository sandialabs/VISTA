import { useEffect } from 'react';

import {
  PROJECT_DATA_TABS_REQUIRING_IMAGES,
  PROJECT_DATA_TABS_REQUIRING_PARTS,
} from './projectTabs';

const needsLoad = (state) => !state.loading && !state.error && (!state.loaded || state.stale);

// Lazily loads the parts and image collections a Project Data tab consumes.
export default function useProjectDataTabLoads({
  activeMainTab,
  activeProjectDataTab,
  loadProjectImages,
  loadProjectParts,
  projectImagesState,
  projectPartsState,
}) {
  const { loaded: imagesLoaded, error: imagesError, loading: imagesLoading, stale: imagesStale } = projectImagesState;
  const { loaded: partsLoaded, error: partsError, loading: partsLoading, stale: partsStale } = projectPartsState;

  useEffect(() => {
    if (activeMainTab !== 'project_data') return;
    const partsState = { loaded: partsLoaded, error: partsError, loading: partsLoading, stale: partsStale };
    const imagesState = { loaded: imagesLoaded, error: imagesError, loading: imagesLoading, stale: imagesStale };
    if (PROJECT_DATA_TABS_REQUIRING_PARTS.has(activeProjectDataTab) && needsLoad(partsState)) {
      loadProjectParts();
    }
    if (PROJECT_DATA_TABS_REQUIRING_IMAGES.has(activeProjectDataTab) && needsLoad(imagesState)) {
      loadProjectImages();
    }
  }, [
    activeMainTab,
    activeProjectDataTab,
    imagesError,
    imagesLoaded,
    imagesLoading,
    imagesStale,
    loadProjectImages,
    loadProjectParts,
    partsError,
    partsLoaded,
    partsLoading,
    partsStale,
  ]);
}
