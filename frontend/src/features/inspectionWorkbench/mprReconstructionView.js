import { DEFAULT_RAY_MARCH_SETTINGS } from '../../components/Pt3GaussianSplatViewer';
import {
  MPR_RECONSTRUCTION_LABELS,
  MPR_RECONSTRUCTION_MODES,
  PT3_RENDERER_RECONSTRUCTION_MODES,
  RAY_MARCH_RECONSTRUCTION_IDS,
  RAY_MARCH_RECONSTRUCTION_OPTIONS,
  RAY_MARCH_SELECTOR_PREFIX,
} from './mprConstants';

export const getEffectiveMprReconstructionMode = (
  mprReconstructionMode,
  { canShowStackReconstruction, canShowGaussianSplatPreview },
) => {
  if (PT3_RENDERER_RECONSTRUCTION_MODES.includes(mprReconstructionMode) && canShowGaussianSplatPreview) {
    return mprReconstructionMode;
  }
  if (mprReconstructionMode === MPR_RECONSTRUCTION_MODES.stack && canShowStackReconstruction) {
    return MPR_RECONSTRUCTION_MODES.stack;
  }
  return MPR_RECONSTRUCTION_MODES.orientation;
};

export const getActiveRayMarchReconstructionStyle = (rayMarchSettings) => (
  RAY_MARCH_RECONSTRUCTION_IDS.has(rayMarchSettings?.reconstructionStyle)
    ? rayMarchSettings.reconstructionStyle
    : DEFAULT_RAY_MARCH_SETTINGS.reconstructionStyle
);

/**
 * Derives which PT3 reconstruction modes are available, the effective mode
 * after fallbacks, the controlled selector value, and the display label.
 */
export const getMprReconstructionView = ({
  mprReconstructionMode,
  rayMarchSettings,
  selectedPart,
  shellImageLayers,
  volumePreviewLayers,
}) => {
  const canShowStackReconstruction = volumePreviewLayers.length > 0;
  const canShowShellReconstruction = shellImageLayers.length > 0;
  const canShowGaussianSplatPreview = Boolean(selectedPart);
  const effectiveMprReconstructionMode = getEffectiveMprReconstructionMode(mprReconstructionMode, {
    canShowStackReconstruction,
    canShowGaussianSplatPreview,
  });
  const activeRayMarchReconstructionStyle = getActiveRayMarchReconstructionStyle(rayMarchSettings);
  const mprReconstructionSelectorValue = mprReconstructionMode === MPR_RECONSTRUCTION_MODES.volume3d
    ? `${RAY_MARCH_SELECTOR_PREFIX}${activeRayMarchReconstructionStyle}`
    : mprReconstructionMode;
  const effectiveMprReconstructionLabel = effectiveMprReconstructionMode === MPR_RECONSTRUCTION_MODES.volume3d
    ? `Ray marching — ${RAY_MARCH_RECONSTRUCTION_OPTIONS.find(
      ({ value }) => value === activeRayMarchReconstructionStyle,
    )?.label || 'Composite'}`
    : MPR_RECONSTRUCTION_LABELS[effectiveMprReconstructionMode];
  return {
    canShowGaussianSplatPreview,
    canShowShellReconstruction,
    canShowStackReconstruction,
    effectiveMprReconstructionLabel,
    effectiveMprReconstructionMode,
    mprReconstructionSelectorValue,
  };
};
