// Builds the Pt3GaussianSplatViewer props shared by the MPR 3D pane and the
// segmentation helper 3D view. Call sites add their mode, slice position,
// control visibility, and annotation props.
export const buildPt3SplatViewerProps = ({
  part,
  projectId,
  volume,
  navigation,
  settings,
  pt3GuideSettings,
}) => ({
  part,
  projectId,
  volumeDescriptor: volume.descriptor,
  volumeImageStack: volume.imageStack,
  volumeOverlayImageStacks: volume.overlayImageStacks,
  splatParameters: volume.splatParameters,
  rotation: navigation.rotation,
  zoom: navigation.zoom,
  mirrorScale: navigation.mirrorScale,
  activeSliceAxis: navigation.activeSliceAxis,
  rayMarchSettings: settings.rayMarchSettings,
  splatViewSettings: settings.splatViewSettings,
  onRayMarchSettingsChange: settings.onRayMarchSettingsChange,
  onSplatViewSettingsChange: settings.onSplatViewSettingsChange,
  onRotationChange: (nextRotation) => navigation.apply({
    rotation: nextRotation,
  }),
  onZoomChange: (nextZoom) => navigation.apply((previous) => ({
    viewportTransform: {
      ...previous.viewportTransform,
      zoom: nextZoom,
    },
  })),
  onResetView: navigation.onReset,
  annotationOpacityMultiplier: 1,
  pt3GuideSettings,
});
