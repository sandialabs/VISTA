import {
  getActiveRayMarchReconstructionStyle,
  getEffectiveMprReconstructionMode,
  getMprReconstructionView,
} from '../mprReconstructionView';
import { MPR_RECONSTRUCTION_MODES, RAY_MARCH_SELECTOR_PREFIX } from '../mprConstants';

const baseInput = {
  mprReconstructionMode: MPR_RECONSTRUCTION_MODES.orientation,
  rayMarchSettings: { reconstructionStyle: 'composite' },
  selectedPart: { id: 'part-1' },
  shellImageLayers: [],
  volumePreviewLayers: [],
};

describe('mprReconstructionView', () => {
  test('falls back to orientation when stack layers are unavailable', () => {
    expect(getEffectiveMprReconstructionMode(MPR_RECONSTRUCTION_MODES.stack, {
      canShowStackReconstruction: false,
      canShowGaussianSplatPreview: true,
    })).toBe(MPR_RECONSTRUCTION_MODES.orientation);
    expect(getEffectiveMprReconstructionMode(MPR_RECONSTRUCTION_MODES.stack, {
      canShowStackReconstruction: true,
      canShowGaussianSplatPreview: false,
    })).toBe(MPR_RECONSTRUCTION_MODES.stack);
  });

  test('keeps renderer modes only when a part is selected', () => {
    expect(getEffectiveMprReconstructionMode(MPR_RECONSTRUCTION_MODES.realSplat, {
      canShowStackReconstruction: false,
      canShowGaussianSplatPreview: true,
    })).toBe(MPR_RECONSTRUCTION_MODES.realSplat);
    expect(getEffectiveMprReconstructionMode(MPR_RECONSTRUCTION_MODES.volume3d, {
      canShowStackReconstruction: true,
      canShowGaussianSplatPreview: false,
    })).toBe(MPR_RECONSTRUCTION_MODES.orientation);
  });

  test('normalizes unknown ray march styles to the default style', () => {
    expect(getActiveRayMarchReconstructionStyle({ reconstructionStyle: 'mip' })).toBe('mip');
    expect(getActiveRayMarchReconstructionStyle({ reconstructionStyle: 'unknown' })).toBe('composite');
    expect(getActiveRayMarchReconstructionStyle(null)).toBe('composite');
  });

  test('derives availability flags, selector value, and label', () => {
    const view = getMprReconstructionView({
      ...baseInput,
      mprReconstructionMode: MPR_RECONSTRUCTION_MODES.volume3d,
      rayMarchSettings: { reconstructionStyle: 'mip' },
      shellImageLayers: [{ id: 'shell' }],
      volumePreviewLayers: [{ id: 'slice' }],
    });
    expect(view).toEqual({
      canShowGaussianSplatPreview: true,
      canShowShellReconstruction: true,
      canShowStackReconstruction: true,
      effectiveMprReconstructionLabel: 'Ray marching — MIP',
      effectiveMprReconstructionMode: MPR_RECONSTRUCTION_MODES.volume3d,
      mprReconstructionSelectorValue: `${RAY_MARCH_SELECTOR_PREFIX}mip`,
    });
  });

  test('labels the fallback mode while keeping the requested selector value', () => {
    const view = getMprReconstructionView({
      ...baseInput,
      mprReconstructionMode: MPR_RECONSTRUCTION_MODES.stack,
    });
    expect(view.effectiveMprReconstructionMode).toBe(MPR_RECONSTRUCTION_MODES.orientation);
    expect(view.effectiveMprReconstructionLabel).toBe('Orientation only');
    expect(view.mprReconstructionSelectorValue).toBe(MPR_RECONSTRUCTION_MODES.stack);
    expect(view.canShowStackReconstruction).toBe(false);
  });
});
