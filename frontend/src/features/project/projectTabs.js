import React from 'react';

export const MAIN_TAB_DEFINITIONS = {
  project_configuration: { label: 'Project Configuration' },
  project_data: { label: 'Project Data' },
  analyze: { label: 'Analyze' },
  inspection: { label: 'Inspection' },
  report: { label: 'Report' },
};

export const ALLOWED_PROJECT_QUERY_TABS = new Set(Object.keys(MAIN_TAB_DEFINITIONS));

export const PROJECT_DATA_TABS_REQUIRING_PARTS = new Set([
  'batches',
  'images_to_parts',
  'overlays',
  'metadata',
  'remove_images',
  'unload_parts',
]);

export const PROJECT_DATA_TABS_REQUIRING_IMAGES = new Set([
  'images_to_parts',
  'overlays',
  'remove_images',
]);

export const PROJECT_DATA_TABS = {
  load_images: { label: 'Load Images' },
  images_to_parts: { label: 'Images to Parts' },
  overlays: { label: 'Overlays' },
  metadata: { label: 'Metadata' },
  batches: { label: 'Batches' },
  unload_parts: { label: 'Unload Parts' },
  remove_images: { label: 'Unload Images' },
  recently_deleted: { label: 'Recently Deleted' },
};

export function emptyProjectDataCounts() {
  return {
    partsLoaded: 0,
    rawImages: 0,
    imageMetadata: 0,
    overlayImages: 0,
    annotations: 0,
  };
}

export function LazyProjectDataState({ label, error, onRetry }) {
  if (error) {
    return (
      <div className="project-data-tab-panel" role="tabpanel" aria-label={label}>
        <div className="alert alert-error">{error}</div>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return (
    <div className="project-data-tab-panel" role="tabpanel" aria-label={label}>
      <div className="loading-text" role="status">Loading complete project data...</div>
    </div>
  );
}
