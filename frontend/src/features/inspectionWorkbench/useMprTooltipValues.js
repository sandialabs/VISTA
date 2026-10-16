import { useMemo } from 'react';
import { getNormalizedDisplayDomain, normalizeDisplayWindow } from './displayDomain';

// Computes the MPR probe readout: a base value windowed into 0..255 and one
// derived percentage per active overlay.
export const getMprTooltipValues = ({
  activeOverlayIds,
  cursorX,
  cursorY,
  displayValueDomain,
  displayWindow,
  slicePosition,
}) => {
  const domain = getNormalizedDisplayDomain(displayValueDomain);
  const activeWindow = normalizeDisplayWindow(displayWindow, domain);
  const axisSeed = slicePosition.axial + slicePosition.coronal + slicePosition.sagittal;
  const unitValue = Math.min(
    255,
    Math.max(0, Math.round(cursorX * 0.35 + cursorY * 0.65 + axisSeed)),
  );
  const sourceValue = domain.min + ((unitValue / 255) * (domain.max - domain.min));
  const windowRange = Math.max(Number.EPSILON, activeWindow.max - activeWindow.min);
  const base = Math.round(((Math.min(activeWindow.max, Math.max(activeWindow.min, sourceValue)) - activeWindow.min) / windowRange) * 255);
  const overlays = activeOverlayIds.map((overlayId, index) => {
    const value = Number((((base + (index + 1) * 17) / 255) * 100).toFixed(1));
    return { overlayId, value };
  });
  return { base, overlays };
};

export default function useMprTooltipValues({
  activeOverlayIds,
  cursorProbe,
  displayValueDomain,
  displayWindow,
  slicePosition,
}) {
  return useMemo(() => getMprTooltipValues({
    activeOverlayIds,
    cursorX: cursorProbe.x,
    cursorY: cursorProbe.y,
    displayValueDomain,
    displayWindow,
    slicePosition,
  }), [activeOverlayIds, cursorProbe.x, cursorProbe.y, displayValueDomain, displayWindow, slicePosition]);
}
