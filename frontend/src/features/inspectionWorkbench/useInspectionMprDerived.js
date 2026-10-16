import { useMemo } from 'react';
import { getMprAxisMirrorScale } from '../../components/pt3VolumeGeometry';
import { getMprDimensions } from './volumeDescriptors';
import { getPartDisplayValueDomain, getSplatParametersForPart } from './displayDomain';
import { getMprFallbackModelZoom } from './mprGeometry';

// Derives the selected part's MPR dimensions, display value domain, splat
// parameters, and mirror/zoom factors. Keeps mprDimensionsRef current for the
// session-state callbacks that read it outside render.
export default function useInspectionMprDerived({
  mprDimensionsRef,
  mprFullscreenOpen,
  mprProjectionMirror,
  projectImageLookup,
  selectedPart,
  splatParameterOverridesByPart,
  viewportTransformZoom,
}) {
  const mprDimensions = useMemo(() => getMprDimensions(selectedPart, projectImageLookup), [projectImageLookup, selectedPart]);
  mprDimensionsRef.current = mprDimensions;
  const displayValueDomain = useMemo(
    () => getPartDisplayValueDomain(selectedPart, projectImageLookup),
    [projectImageLookup, selectedPart],
  );
  const splatParameters = useMemo(
    () => getSplatParametersForPart(selectedPart, displayValueDomain, splatParameterOverridesByPart),
    [displayValueDomain, selectedPart, splatParameterOverridesByPart],
  );
  const mprAxisMirrorScale = useMemo(
    () => getMprAxisMirrorScale(mprProjectionMirror),
    [mprProjectionMirror],
  );
  return {
    displayValueDomain,
    fallbackMprModelZoom: getMprFallbackModelZoom(viewportTransformZoom, mprFullscreenOpen),
    mprAxisMirrorScale,
    mprDimensions,
    splatParameters,
  };
}
