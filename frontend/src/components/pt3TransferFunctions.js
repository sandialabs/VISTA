import { mapWindowLevel, opacityCorrection } from './pt3VolumeGeometry';

export const CT_TRANSFER_PRESETS = {
  bone: { label: 'Bone', window: 1800, level: 450, opacity: 0.72, colorStops: [[0.0, [15, 23, 42]], [0.45, [226, 232, 240]], [1, [255, 255, 255]]] },
  soft: { label: 'Soft tissue', window: 400, level: 40, opacity: 0.38, colorStops: [[0, [30, 41, 59]], [0.55, [248, 180, 150]], [1, [255, 244, 214]]] },
  lung: { label: 'Lung / low density', window: 1500, level: -600, opacity: 0.46, colorStops: [[0, [2, 6, 23]], [0.5, [56, 189, 248]], [1, [240, 249, 255]]] },
};

export function interpolateColor(stops, t) {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  const upperIndex = sorted.findIndex((stop) => t <= stop[0]);
  if (upperIndex <= 0) return sorted[0][1];
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const local = (t - lower[0]) / Math.max(0.0001, upper[0] - lower[0]);
  return lower[1].map((value, index) => Math.round(value + (upper[1][index] - value) * local));
}

export function generateTransferFunctionLut({ preset = CT_TRANSFER_PRESETS.bone, scalarRange = [-1024, 3071], opacityMultiplier = 1, sampleStep = 1 } = {}) {
  const lut = new Uint8Array(256 * 4);
  const [minScalar, maxScalar] = scalarRange;
  for (let index = 0; index < 256; index += 1) {
    const scalar = minScalar + (index / 255) * (maxScalar - minScalar);
    const mapped = mapWindowLevel(scalar, preset.window, preset.level);
    const [r, g, b] = interpolateColor(preset.colorStops, mapped);
    lut[index * 4] = r;
    lut[index * 4 + 1] = g;
    lut[index * 4 + 2] = b;
    lut[index * 4 + 3] = Math.round(255 * opacityCorrection(mapped * preset.opacity * opacityMultiplier, sampleStep, 1));
  }
  return lut;
}
