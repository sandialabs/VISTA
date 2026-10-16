import { readFileSync } from 'fs';
import path from 'path';
import {
  createPt3ExternalOverlayTextureWithinBudget,
  DEFAULT_PT3_RECONSTRUCTION_OPTIONS,
  getPt3AdaptiveMarchParameters,
  getPt3BoundedProjectionOpacity,
  getPt3ReconstructionUniformValues,
  getPt3TextureAllocationLimitError,
  getPt3TextureSizeLimitError,
  initializePt3RendererWithExternalOverlayFallback,
  normalizePt3ReconstructionOptions,
  Pt3WebGlContextLossError,
  PT3_MAX_BROWSER_VOLUME_TEXTURE_BYTES,
  PT3_MAX_RAY_MARCH_SAMPLES,
  PT3_RECONSTRUCTION_STYLE_IDS,
  PT3_VOLUME_MATERIAL_OPTIONS,
  PT3_VOLUME_FRAGMENT_SHADER,
  recreatePt3BaseRendererAfterContextLoss,
  scalePt3PremultipliedOverlayLayer,
  shouldRenderPt3ExternalOverlay,
} from '../pt3ThreeRenderer';

const PT3_THREE_RENDERER_SOURCE = readFileSync(
  path.join(__dirname, '..', 'pt3ThreeRenderer.js'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('PT3 reconstruction renderer settings', () => {
  test('keeps legacy render calls on the composite defaults', () => {
    expect(normalizePt3ReconstructionOptions()).toEqual(DEFAULT_PT3_RECONSTRUCTION_OPTIONS);
    expect(normalizePt3ReconstructionOptions(null)).toEqual(DEFAULT_PT3_RECONSTRUCTION_OPTIONS);
    expect(getPt3ReconstructionUniformValues()).toEqual({
      renderStyle: 0,
      windowCenter: 0.45,
      windowWidth: 0.18,
      isoThreshold: 0.45,
      isoWidth: 0.04,
      boundaryEnhancement: false,
      boundaryStrength: 0.45,
      boundaryBandWidth: 0.08,
    });
  });

  test.each([
    ['composite', 0],
    ['mip', 1],
    ['xray', 2],
    ['average', 2],
    ['iso', 3],
    ['window', 4],
  ])('maps %s to its stable shader style id', (reconstructionStyle, renderStyle) => {
    expect(getPt3ReconstructionUniformValues({ reconstructionStyle }).renderStyle).toBe(renderStyle);
  });

  test('falls back from unknown styles and clamps unsafe numeric values', () => {
    expect(normalizePt3ReconstructionOptions({
      reconstructionStyle: 'not-a-style',
      windowCenter: -4,
      windowWidth: 0,
      isoThreshold: 7,
      isoWidth: -1,
      boundaryEnhancement: true,
      boundaryStrength: 99,
      boundaryBandWidth: Number.NaN,
    })).toEqual({
      reconstructionStyle: 'composite',
      windowCenter: 0,
      windowWidth: 0.01,
      isoThreshold: 1,
      isoWidth: 0.001,
      boundaryEnhancement: true,
      boundaryStrength: 2,
      boundaryBandWidth: 0.08,
    });
    expect(PT3_RECONSTRUCTION_STYLE_IDS).toEqual({
      composite: 0,
      mip: 1,
      xray: 2,
      iso: 3,
      window: 4,
    });
  });

  test('parses persisted boolean representations without enabling false strings', () => {
    expect(normalizePt3ReconstructionOptions({ boundaryEnhancement: 'true' }).boundaryEnhancement)
      .toBe(true);
    expect(normalizePt3ReconstructionOptions({ boundaryEnhancement: '1' }).boundaryEnhancement)
      .toBe(true);
    expect(normalizePt3ReconstructionOptions({ boundaryEnhancement: 'false' }).boundaryEnhancement)
      .toBe(false);
    expect(normalizePt3ReconstructionOptions({ boundaryEnhancement: '0' }).boundaryEnhancement)
      .toBe(false);
    expect(normalizePt3ReconstructionOptions({ boundaryEnhancement: 'invalid' }).boundaryEnhancement)
      .toBe(false);
  });

  test('adapts large-volume steps to cover the complete ray within the fixed sample budget', () => {
    const requestedStepSize = 0.75 / 1024;
    const parameters = getPt3AdaptiveMarchParameters({
      requestedStepSize,
      rayExitDistance: 1,
      sampleStep: 0.75,
    });

    expect(PT3_MAX_RAY_MARCH_SAMPLES).toBe(512);
    expect(parameters.marchStep).toBeCloseTo(1 / 511, 12);
    expect(parameters.marchStep * (PT3_MAX_RAY_MARCH_SAMPLES - 1)).toBeCloseTo(1, 12);
    expect(parameters.effectiveSampleStep).toBeCloseTo(1024 / 511, 12);
  });

  test('retains nominal sampling when it already reaches the box exit', () => {
    expect(getPt3AdaptiveMarchParameters({
      requestedStepSize: 0.01,
      rayExitDistance: 1,
      sampleStep: 1.25,
    })).toEqual({ marchStep: 0.01, effectiveSampleStep: 1.25 });
  });

  test('reports observed texture dimensions and the device limit only when exceeded', () => {
    expect(getPt3TextureSizeLimitError([2048, 128, 64], 2048)).toBeNull();
    expect(getPt3TextureSizeLimitError([4096, 512, 200], 2048)).toBe(
      "PT3 volume texture dimensions 4096×512×200 exceed this device's WebGL MAX_3D_TEXTURE_SIZE limit of 2048 voxels per axis",
    );
    expect(getPt3TextureSizeLimitError([4096, 512, 200], null)).toBeNull();
  });

  test('preflights the combined volume and segmentation texture budget', () => {
    expect(PT3_MAX_BROWSER_VOLUME_TEXTURE_BYTES).toBe(512 * 1024 * 1024);
    expect(getPt3TextureAllocationLimitError([512, 512, 512])).toBeNull();
    expect(getPt3TextureAllocationLimitError([512, 512, 512], {
      includeSegmentation: true,
      byteLimit: 128 * 1024 * 1024,
    })).toBe(
      'PT3 volume texture dimensions 512×512×512 require an estimated 518.0 MiB of browser decode, staging, and 3D-texture memory, exceeding the built-in 128.0 MiB browser volume budget',
    );
    expect(getPt3TextureAllocationLimitError([512, 512, 512], {
      includeExternalOverlay: true,
    })).toBe(
      'PT3 volume texture dimensions 512×512×512 require an estimated 2310.0 MiB of browser decode, staging, and 3D-texture memory, exceeding the built-in 512.0 MiB browser volume budget',
    );
  });

  test('keeps the valid base preflight independent and skips an oversized optional overlay', async () => {
    const createTexture = jest.fn(() => ({ dispose: jest.fn() }));

    await expect(createPt3ExternalOverlayTextureWithinBudget({
      dimensions: [512, 512, 512],
      hasOverlaySources: true,
      createTexture,
    })).resolves.toBeNull();

    expect(createTexture).not.toHaveBeenCalled();
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'includeSegmentation: includeSegmentationTexture,\n      });',
    );
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'externalOverlayTexture = await createPt3ExternalOverlayTextureWithinBudget({',
    );
  });

  test('drops optional overlay decode and allocation failures without rejecting base setup', async () => {
    const createTexture = jest.fn().mockRejectedValue(new RangeError('RGBA allocation failed'));

    await expect(createPt3ExternalOverlayTextureWithinBudget({
      dimensions: [4, 4, 4],
      hasOverlaySources: true,
      createTexture,
    })).resolves.toBeNull();
    expect(createTexture).toHaveBeenCalledTimes(1);
  });

  test.each([
    'external RGBA texture upload failed',
    'external-overlay shader material compilation failed',
  ])('retries renderer initialization base-only after %s', (message) => {
    const externalOverlayTexture = { dispose: jest.fn() };
    let overlayEnabled = true;
    const initialize = jest.fn(() => {
      if (initialize.mock.calls.length === 1) throw new Error(message);
      expect(overlayEnabled).toBe(false);
    });
    const disableExternalOverlay = jest.fn((texture) => {
      overlayEnabled = false;
      texture.dispose();
    });

    expect(initializePt3RendererWithExternalOverlayFallback({
      initialize,
      externalOverlayTexture,
      disableExternalOverlay,
    })).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(disableExternalOverlay).toHaveBeenCalledWith(externalOverlayTexture);
    expect(externalOverlayTexture.dispose).toHaveBeenCalledTimes(1);
  });

  test('does not suppress a base-only renderer initialization failure', () => {
    const initializationError = new Error('base volume shader compilation failed');
    const initialize = jest.fn(() => { throw initializationError; });

    expect(() => initializePt3RendererWithExternalOverlayFallback({
      initialize,
      externalOverlayTexture: null,
      disableExternalOverlay: jest.fn(),
    })).toThrow(initializationError);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  test('recreates a healthy base-only renderer after external-overlay context loss', async () => {
    const externalOverlayTexture = { dispose: jest.fn() };
    const lostContextError = new Pt3WebGlContextLossError();
    const initializeLostOverlayRenderer = jest.fn(() => { throw lostContextError; });
    const disableExternalOverlay = jest.fn();
    let observedError;

    try {
      initializePt3RendererWithExternalOverlayFallback({
        initialize: initializeLostOverlayRenderer,
        externalOverlayTexture,
        disableExternalOverlay,
      });
    } catch (error) {
      observedError = error;
    }

    const sequence = [];
    const healthyBaseRenderer = { rendererType: 'three-webgl-raymarch', hasExternalOverlay: false };
    const disposeFailedRenderer = jest.fn(() => {
      sequence.push('dispose-lost-renderer');
      externalOverlayTexture.dispose();
    });
    const restoreContext = jest.fn(async () => sequence.push('restore-context'));
    const createBaseRenderer = jest.fn(() => {
      sequence.push('create-base-only-renderer');
      return healthyBaseRenderer;
    });
    const recoveredRenderer = await recreatePt3BaseRendererAfterContextLoss({
      disposeFailedRenderer,
      restoreContext,
      createBaseRenderer,
    });

    expect(observedError).toBe(lostContextError);
    expect(initializeLostOverlayRenderer).toHaveBeenCalledTimes(1);
    expect(disableExternalOverlay).not.toHaveBeenCalled();
    expect(externalOverlayTexture.dispose).toHaveBeenCalledTimes(1);
    expect(recoveredRenderer).toBe(healthyBaseRenderer);
    expect(sequence).toEqual([
      'dispose-lost-renderer',
      'restore-context',
      'create-base-only-renderer',
    ]);
    expect(PT3_THREE_RENDERER_SOURCE).toContain('volumeOverlayImageStacks: []');
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      "canvas?.removeEventListener?.('webglcontextrestored', handleRestore)",
    );
  });

  test('propagates base-only context loss without another recovery attempt', () => {
    const lostContextError = new Pt3WebGlContextLossError();
    const initialize = jest.fn(() => { throw lostContextError; });
    const disableExternalOverlay = jest.fn();

    expect(() => initializePt3RendererWithExternalOverlayFallback({
      initialize,
      externalOverlayTexture: null,
      disableExternalOverlay,
    })).toThrow(lostContextError);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(disableExternalOverlay).not.toHaveBeenCalled();
  });

  test('preserves cancellation after disposing a context-lost renderer', async () => {
    const controller = new AbortController();
    const restoreContext = jest.fn();
    const createBaseRenderer = jest.fn();

    await expect(recreatePt3BaseRendererAfterContextLoss({
      signal: controller.signal,
      disposeFailedRenderer: () => controller.abort(),
      restoreContext,
      createBaseRenderer,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(restoreContext).not.toHaveBeenCalled();
    expect(createBaseRenderer).not.toHaveBeenCalled();
  });

  test('disposes a context-lost renderer before propagating a pre-existing cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const disposeFailedRenderer = jest.fn();
    const restoreContext = jest.fn();
    const createBaseRenderer = jest.fn();

    await expect(recreatePt3BaseRendererAfterContextLoss({
      signal: controller.signal,
      disposeFailedRenderer,
      restoreContext,
      createBaseRenderer,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(disposeFailedRenderer).toHaveBeenCalledTimes(1);
    expect(restoreContext).not.toHaveBeenCalled();
    expect(createBaseRenderer).not.toHaveBeenCalled();
  });

  test('propagates cancellation while disposing an overlay returned after cancellation', async () => {
    const controller = new AbortController();
    const externalOverlayTexture = { dispose: jest.fn() };

    await expect(createPt3ExternalOverlayTextureWithinBudget({
      dimensions: [4, 4, 4],
      hasOverlaySources: true,
      signal: controller.signal,
      createTexture: async () => {
        controller.abort();
        return externalOverlayTexture;
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(externalOverlayTexture.dispose).toHaveBeenCalledTimes(1);
  });

  test('keeps projection density bounded and responsive across the complete UI range', () => {
    const lowDensity = getPt3BoundedProjectionOpacity(1, 0.25);
    const highDensity = getPt3BoundedProjectionOpacity(1, 2.5);
    expect(lowDensity).toBeCloseTo(1 - Math.exp(-0.25), 12);
    expect(highDensity).toBeCloseTo(1 - Math.exp(-2.5), 12);
    expect(lowDensity).toBeGreaterThan(0);
    expect(highDensity).toBeGreaterThan(lowDensity);
    expect(highDensity).toBeLessThan(1);
    expect(getPt3BoundedProjectionOpacity(4, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('PT3 reconstruction fragment shader', () => {
  test('builds one aligned RGBA 3D texture for external overlay stacks', () => {
    expect(PT3_THREE_RENDERER_SOURCE).toContain('volumeOverlayImageStacks = []');
    expect(PT3_THREE_RENDERER_SOURCE).toContain('createExternalOverlayTexture(');
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'do not match volume dimensions ${expectedDimensions.join(\'×\')}',
    );
    expect(PT3_THREE_RENDERER_SOURCE).toContain("if (error?.name === 'AbortError') throw error");
    expect(PT3_THREE_RENDERER_SOURCE).toContain('const stackVoxels = new Uint8Array(voxels.length)');
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'compositeRgbaPixel(voxels, pixelOffset, stackVoxels, pixelOffset)',
    );
    expect(PT3_THREE_RENDERER_SOURCE.match(/new VolumeSliceDimensionMismatchError/g))
      .toHaveLength(2);
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'if (acceptedOverlayStackCount === 0) return null',
    );
    expect(PT3_THREE_RENDERER_SOURCE).toMatch(
      /new THREE\.Data3DTexture\(voxels, width, height, depth\);[\s\S]*?texture\.format = THREE\.RGBAFormat;/,
    );
    expect(PT3_THREE_RENDERER_SOURCE).toContain('compositeRgbaPixel(');
    expect(PT3_THREE_RENDERER_SOURCE).toContain('disposeOptionalTexture(externalOverlayTexture)');
    expect(PT3_THREE_RENDERER_SOURCE).toContain('#ifdef PT3_EXTERNAL_OVERLAY');
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'delete material.defines.PT3_EXTERNAL_OVERLAY',
    );
  });

  test('marches from the camera-facing entry surface toward the far exit', () => {
    expect(PT3_THREE_RENDERER_SOURCE).toMatch(/side:\s*THREE\.FrontSide\b/);
    expect(PT3_VOLUME_FRAGMENT_SHADER).toMatch(
      /vec3\s+ray\s*=\s*normalize\(\s*localPosition\s*-\s*cameraLocal\s*\)\s*;/,
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).not.toMatch(
      /normalize\(\s*cameraLocal\s*-\s*localPosition\s*\)/,
    );
  });

  test('declares premultiplied blending for alpha-weighted shader output', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'accumulated.rgb += (1.0 - accumulated.a) * alpha * color',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('vec4(maximumColor * alpha, alpha)');
    expect(PT3_VOLUME_MATERIAL_OPTIONS).toEqual(expect.objectContaining({
      transparent: true,
      premultipliedAlpha: true,
    }));
    expect(PT3_THREE_RENDERER_SOURCE).toMatch(
      /new THREE\.ShaderMaterial\(\{[\s\S]*?\.\.\.PT3_VOLUME_MATERIAL_OPTIONS,[\s\S]*?fragmentShader:\s*PT3_VOLUME_FRAGMENT_SHADER/,
    );
  });

  test('contains bounded composite, MIP, X-ray, iso, and window paths', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('for (int i = 0; i < 512; i++)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('renderStyle == 1');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('maximumValue = value');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('renderStyle == 2');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('averageValue = xrayValueTotal / xraySampleCount');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('renderStyle == 3');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('abs(value - isoThreshold)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('renderStyle == 4');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('windowCenter - halfWindow');
  });

  test('adapts the march step to the per-fragment box exit and uses it for every increment', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('float rayBoxExitDistance');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('exitDistance / 511.0');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('float effectiveSampleStep = sampleStep * marchStep');
    expect(PT3_VOLUME_FRAGMENT_SHADER.match(/samplePoint \+= ray \* marchStep/g)).toHaveLength(2);
    expect(PT3_VOLUME_FRAGMENT_SHADER).not.toContain('samplePoint += ray * stepSize');
  });

  test('retains the legacy composite transfer and sample-step safeguards', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'smoothstep(intensityThreshold, min(1.0, intensityThreshold + opacityRampWidth), value)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('* 0.075 * opacityMultiplier * effectiveSampleStep');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'accumulated.rgb += (1.0 - accumulated.a) * alpha * color',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('samplePoint += ray * marchStep');
  });

  test('uses central differences for opt-in boundary opacity/color and iso lighting', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('vec3 centralDifferenceGradient(vec3 point)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('(forwardPoint - backwardPoint) * physicalSize');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('/ physicalSpan');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('normalize(ray * physicalSize)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('alpha *= 1.0 + boost');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('color = mix(color, colorHigh');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('if (!boundaryEnhancement || alpha <= 0.0) return');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('if (boundaryEnhancement && alpha > 0.0)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('boundaryStrength * 0.5');
  });

  test('bounds opacity before compositing and keeps projection density responsive', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER.match(/alpha = clamp\(alpha, 0\.0, 1\.0\)/g))
      .toHaveLength(3);
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('1.0 - exp(-opticalDepth)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('boundedProjectionOpacity(transferResponse)');
  });

  test('continues to hide excluded segments and color visible segments in shared traversal', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('if (segmentState > 1.5)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('continue;');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('segmentColor = texture(segmentationPalette, palettePoint)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'color = mix(color, segmentColor.rgb, segmentationOpacityMultiplier)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('vec4 segmentProjection = vec4(0.0)');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('addProjectionOverlay');
  });

  test('global transparency restores base volume samples without alpha punching', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('uniform float segmentationOpacityMultiplier');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'color = mix(color, segmentColor.rgb, segmentationOpacityMultiplier)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'alpha *= mix(1.0, segmentColor.a, segmentationOpacityMultiplier)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).not.toContain('alpha *= segmentColor.a;');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'segmentProjection *= segmentationOpacityMultiplier;',
    );
  });

  test('projects external RGBA overlays independently of reconstruction intensity in every style', () => {
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('uniform sampler3D externalOverlayMap');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('uniform bool hasExternalOverlay');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('uniform float externalOverlayOpacity');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'vec4 externalOverlaySample = texture(externalOverlayMap, samplePoint)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain('externalOverlayProjection.rgb +=');
    expect(PT3_VOLUME_FRAGMENT_SHADER).not.toContain(') * externalOverlayOpacity;');
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'externalOverlayProjection *= externalOverlayOpacity;',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      'outputColor = addProjectionOverlay(reconstructedColor, externalOverlayProjection)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER.indexOf('vec4 externalOverlaySample')).toBeLessThan(
      PT3_VOLUME_FRAGMENT_SHADER.indexOf('if (renderStyle == 1)'),
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).toContain(
      '&& (!hasExternalOverlay || externalOverlayProjection.a > 0.98)',
    );
    expect(PT3_VOLUME_FRAGMENT_SHADER).not.toContain(
      '|| accumulated.a > 0.98) break',
    );
  });

  test('gates an uploaded external overlay at render time without recreating its texture', () => {
    expect(PT3_THREE_RENDERER_SOURCE).toContain('showExternalOverlay = true');
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'hasExternalOverlay: Boolean(externalOverlayTexture)',
    );
    expect(shouldRenderPt3ExternalOverlay({}, true, 1)).toBe(true);
    expect(shouldRenderPt3ExternalOverlay({}, true, 0)).toBe(false);
    expect(shouldRenderPt3ExternalOverlay({}, false, 1)).toBe(false);
    expect(shouldRenderPt3ExternalOverlay(null, true, 1)).toBe(false);
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'shouldRenderPt3ExternalOverlay(',
    );
    expect(PT3_THREE_RENDERER_SOURCE).toContain(
      'material.uniforms.externalOverlayOpacity.value = safeExternalOverlayOpacity;',
    );
  });

  test('scales the completed premultiplied overlay layer independently of ray depth', () => {
    const twoSampleAlpha = 1 - ((1 - 0.4) ** 2);
    const baselineLayer = [twoSampleAlpha * 0.75, twoSampleAlpha * 0.25, 0, twoSampleAlpha];

    expect(scalePt3PremultipliedOverlayLayer(baselineLayer, 1)).toEqual(baselineLayer);
    expect(scalePt3PremultipliedOverlayLayer(baselineLayer, 0.25)).toEqual([
      0.12, 0.04, 0, 0.16,
    ]);
    expect(scalePt3PremultipliedOverlayLayer(baselineLayer, 0)).toEqual([0, 0, 0, 0]);
    expect(0.16).not.toBeCloseTo(1 - ((1 - (0.4 * 0.25)) ** 2), 10);
  });
});
