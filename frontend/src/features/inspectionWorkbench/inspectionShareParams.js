export function buildInspectionShareParams(state = {}) {
  const params = new URLSearchParams();
  if (state.selectedBatchId) params.set('batch', String(state.selectedBatchId));
  if (state.selectedPartId) params.set('part', String(state.selectedPartId));
  if (state.selectedImageRef) params.set('image', String(state.selectedImageRef));
  if (state.reviewFilter && state.reviewFilter !== 'all') params.set('review', String(state.reviewFilter));
  if (state.activeMetadataTab && state.activeMetadataTab !== 'nsipro') params.set('metadataTab', String(state.activeMetadataTab));
  if (state.activeMprPane && state.activeMprPane !== 'axial') params.set('mprPane', String(state.activeMprPane));
  if (Array.isArray(state.activeOverlayIds) && state.activeOverlayIds.length > 0) {
    params.set('overlays', state.activeOverlayIds.map((entry) => String(entry)).filter(Boolean).join(','));
  }
  return params;
}
