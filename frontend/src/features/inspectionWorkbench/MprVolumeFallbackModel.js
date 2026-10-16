import { MprWindowedImage } from './MprWindowedImage';
import { MPR_AXIS_CONFIG, MPR_RECONSTRUCTION_MODES } from './mprConstants';
import { getFraction } from './mprGeometry';
import { getOverlayStackResourceId } from './partImageRefs';

export function MprVolumeFallbackModel({ navigation, volume, display, handlers }) {
  const {
    lastActiveMprAxis,
    mprRotation,
    slicePosition,
    mprAxisMirrorScale,
    fallbackMprModelZoom,
    mprDimensions,
  } = navigation;
  const {
    volumeCacheState,
    hasVolumeImageSource,
    selectedExternalOverlayResourceId,
    volumePreviewLayers,
    displayVolumeRendererOverlayImageStacks,
    canShowStackReconstruction,
    canShowShellReconstruction,
    effectiveMprReconstructionMode,
  } = volume;
  const {
    displayWindow,
    displayValueDomain,
    pt3GuideAppearance,
    annotationOpacityMultiplier,
  } = display;
  const {
    preventMprNativeDrag,
  } = handlers;
  return (
    <div
      className={`mpr-volume-model reconstruction-${effectiveMprReconstructionMode}`}
      style={{
        '--volume-rotate-x': `${-mprRotation.x}deg`,
        '--volume-rotate-y': `${mprRotation.y}deg`,
        '--volume-mirror-x': mprAxisMirrorScale.x,
        '--volume-mirror-y': mprAxisMirrorScale.y,
        '--volume-mirror-z': mprAxisMirrorScale.z,
        '--volume-zoom': fallbackMprModelZoom,
        '--slice-axial-depth': `${(getFraction(slicePosition.axial, mprDimensions.axial - 1) - 0.5) * 108}px`,
        '--slice-coronal-y': `${(getFraction(slicePosition.coronal, mprDimensions.coronal - 1) - 0.5) * 138}px`,
        '--slice-sagittal-x': `${(getFraction(slicePosition.sagittal, mprDimensions.sagittal - 1) - 0.5) * 190}px`,
        '--reticle-active-color': MPR_AXIS_CONFIG[lastActiveMprAxis]?.color || '#f8fafc',
        '--pt3-crosshair-opacity': pt3GuideAppearance.crosshairOpacity,
        '--pt3-crosshair-line-width': `${pt3GuideAppearance.crosshairLineWidthPx}px`,
        '--pt3-crosshair-half-line-width': `${pt3GuideAppearance.crosshairLineWidthPx / 2}px`,
        '--pt3-plane-outline-opacity': pt3GuideAppearance.planeOutlineOpacity,
        '--pt3-plane-outline-line-width': `${pt3GuideAppearance.planeOutlineLineWidthPx}px`,
        '--pt3-inactive-plane-outline-line-width': `${pt3GuideAppearance.planeOutlineLineWidthPx / 2}px`,
      }}
    >
      {effectiveMprReconstructionMode === MPR_RECONSTRUCTION_MODES.stack ? (
        <>
          {volumePreviewLayers.map((layer) => (
            <MprWindowedImage
              key={`${layer.id}-${layer.sliceIndex}`}
              className="volume-slice-voxel"
              src={layer.url}
              alt={`Volume reconstruction slice ${layer.sliceIndex}`}
              draggable={false}
              onDragStart={preventMprNativeDrag}
              style={{
                '--slice-depth': `${layer.depth}px`,
                '--slice-opacity': layer.opacity,
              }}
              displayWindow={displayWindow}
              displayDomain={displayValueDomain}
            />
          ))}
          {displayVolumeRendererOverlayImageStacks.flatMap((stack, stackIndex) => (
            stack.map((layer, layerIndex) => (
              <img
                key={`volume-overlay-${stackIndex}-${layer.id}-${layer.sliceIndex}-${layerIndex}`}
                className="volume-slice-voxel volume-slice-segment-overlay"
                src={layer.url}
                alt=""
                aria-hidden="true"
                draggable={false}
                onDragStart={preventMprNativeDrag}
                style={{
                  '--slice-depth': `${layer.depth}px`,
                  '--slice-opacity': Math.min(1, annotationOpacityMultiplier * (selectedExternalOverlayResourceId && String(getOverlayStackResourceId(stack)) === selectedExternalOverlayResourceId ? 1.8 : 1)),
                }}
              />
            ))
          ))}
        </>
      ) : !canShowStackReconstruction && !canShowShellReconstruction ? (
        <span className="volume-reconstruction-empty">No 3D reference</span>
      ) : null}
      {volumeCacheState.status === 'loading' && hasVolumeImageSource && (
        <span className="volume-cache-status">Caching slices</span>
      )}
      <span className="volume-box volume-face-front" />
      <span className="volume-box volume-face-back" />
      <span className="volume-box volume-face-left" />
      <span className="volume-box volume-face-right" />
      <span className="volume-box volume-face-top" />
      <span className="volume-box volume-face-bottom" />
      <span className={`volume-plane volume-keepout plane-axial ${lastActiveMprAxis === 'axial' ? 'active' : ''}`} />
      <span className={`volume-plane volume-keepout plane-coronal ${lastActiveMprAxis === 'coronal' ? 'active' : ''}`} />
      <span className={`volume-plane volume-keepout plane-sagittal ${lastActiveMprAxis === 'sagittal' ? 'active' : ''}`} />
      <span className="volume-reticle reticle-x" />
      <span className="volume-reticle reticle-y" />
      <span className="volume-reticle reticle-z" />
    </div>
  );
}
