import {
  drawMprOverlaySlice,
  drawServerMprSliceImage,
  getMprOverlayCompositeAlpha,
  getMprSliceCanvasCacheStats,
  getServerVolumePrefetchSources,
  getAlignedVolumeOverlayRendererStacks,
  getVolumeSummaryRepresentativeIndices,
  getVolumeRendererSliceIndices,
  getVolumeOverlayStacks,
  getVolumeSourceImages,
  getSemantic3dVolumeOverlayStacks,
  isRenderableVolumeOverlay,
  mapWithConcurrency,
  MPR_VOLUME_SLICE_RENDER_VERSION,
  rememberSliceCanvas,
  resetMprSliceCanvasCacheForTests,
} from '../InspectionWorkbenchPanel';

describe('PT3 volume overlay stack mapping', () => {
  afterEach(() => resetMprSliceCanvasCacheForTests());

  test('does not treat legacy NumPy volumes as regular images before metadata probing', () => {
    const part = {
      id: 'part-1',
      metadata: {
        source_images: [
          { filename: 'scan.npy', image_id: 'stack-base-id', overlay: false, slice_index: 0 },
          {
            filename: 'scan.npy',
            image_id: 'stack-overlay-id',
            overlay: true,
            overlay_base_filename: 'scan.npy',
            overlay_base_image_id: 'stack-base-id',
            slice_index: 0,
          },
        ],
      },
    };
    const projectImageLookup = {
      'stack-base-id': { id: 'stack-base-id', filename: 'scan.npy' },
      'stack-overlay-id': { id: 'stack-overlay-id', filename: 'scan.npy' },
    };

    const baseStack = getVolumeSourceImages(part, projectImageLookup);
    const overlayStacks = getVolumeOverlayStacks(part, projectImageLookup);

    expect(baseStack).toEqual([]);
    expect(overlayStacks).toEqual([]);
  });

  test('never resolves stale explicit volume IDs through a unique filename alias', () => {
    const part = {
      id: 'part-stale-volume-id',
      metadata: {
        source_images: [{
          filename: 'shared-slice.png',
          image_id: 'stale-base-id',
          overlay: 'false',
          slice_index: 0,
        }],
      },
    };
    const activeRecord = { id: 'active-base-id', filename: 'shared-slice.png' };
    const projectImageLookup = {
      'active-base-id': activeRecord,
      'shared-slice.png': activeRecord,
    };

    expect(getVolumeSourceImages(part, projectImageLookup)).toEqual([]);
  });

  test('links same-name volume overlays only by exact base UUID', () => {
    const part = {
      id: 'part-same-name-volume-overlay',
      metadata: {
        source_images: [
          { filename: 'capture.png', image_id: 'base-a', overlay: 'false', slice_index: 0 },
          { filename: 'capture.png', image_id: 'base-b', overlay: 'false', slice_index: 1 },
          {
            filename: 'overlay-a.png',
            image_id: 'overlay-a',
            overlay: 'true',
            overlay_base_image_id: 'base-a',
            overlay_base_filename: 'capture.png',
            slice_index: 0,
          },
          {
            filename: 'overlay-stale.png',
            image_id: 'overlay-stale',
            overlay: 'true',
            overlay_base_image_id: 'stale-base-id',
            overlay_base_filename: 'capture.png',
            slice_index: 0,
          },
        ],
      },
    };
    const projectImageLookup = {
      'base-a': { id: 'base-a', filename: 'capture.png' },
      'base-b': { id: 'base-b', filename: 'capture.png' },
      'overlay-a': { id: 'overlay-a', filename: 'overlay-a.png' },
      'overlay-stale': { id: 'overlay-stale', filename: 'overlay-stale.png' },
    };

    const overlayStacks = getVolumeOverlayStacks(part, projectImageLookup);

    expect(overlayStacks).toHaveLength(1);
    expect(overlayStacks[0]).toEqual(expect.objectContaining({ id: 'overlay-a' }));
    expect(overlayStacks[0].stack).toEqual([
      expect.objectContaining({
        id: 'overlay-a',
        overlayBaseImageId: 'base-a',
      }),
    ]);
  });

  test('represents large npy base and overlay volumes as bounded server-backed descriptors', () => {
    const dimensions = { axial: 749, coronal: 1010, sagittal: 984 };
    const part = {
      id: 'part-large-volume',
      metadata: {
        source_images: [
          {
            filename: 'part.npy',
            image_id: 'large-base-id',
            overlay: false,
            metadata: { load_mode: 'volume', volume_shape: dimensions, channel_count: 1, color_mode: 'scalar' },
          },
          {
            filename: 'part-segments.npy',
            image_id: 'large-overlay-id',
            overlay: true,
            overlay_base_image_id: 'large-base-id',
            metadata: { load_mode: 'volume', volume_shape: dimensions, channel_count: 4, color_mode: 'rgba' },
          },
        ],
      },
    };
    const projectImageLookup = {
      'large-base-id': { id: 'large-base-id', filename: 'part.npy', metadata: { volume_shape: dimensions, channel_count: 1, color_mode: 'scalar' } },
      'large-overlay-id': { id: 'large-overlay-id', filename: 'part-segments.npy', metadata: { volume_shape: dimensions, channel_count: 4, color_mode: 'rgba' } },
    };

    const baseVolume = getVolumeSourceImages(part, projectImageLookup);
    const [overlayVolume] = getVolumeOverlayStacks(part, projectImageLookup);

    expect(Array.isArray(baseVolume)).toBe(false);
    expect(baseVolume).toEqual(expect.objectContaining({
      kind: 'server-volume',
      imageId: 'large-base-id',
      dimensions,
      url: `/api/images/large-base-id/volume-slice?axis=axial&index=374&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`,
    }));
    expect(overlayVolume).toEqual(expect.objectContaining({
      kind: 'server-volume',
      imageId: 'large-overlay-id',
      overlayBaseImageId: 'large-base-id',
      dimensions,
    }));

    const baseSources = getServerVolumePrefetchSources(baseVolume, 'coronal', 505);
    const overlaySources = getServerVolumePrefetchSources(overlayVolume, 'coronal', 505);
    expect(baseSources).toHaveLength(5);
    expect(baseSources.map((source) => source.index)).toEqual([505, 504, 506, 503, 507]);
    expect(overlaySources.map((source) => `${source.axis}:${source.index}`)).toEqual(
      baseSources.map((source) => `${source.axis}:${source.index}`),
    );
    expect(baseSources.every((source) => source.url.startsWith('/api/images/large-base-id/volume-slice?'))).toBe(true);
    expect(overlaySources.every((source) => source.url.startsWith('/api/images/large-overlay-id/volume-slice?'))).toBe(true);
  });

  test('treats Analyze volume outputs as assigned volume overlays', () => {
    const dimensions = { axial: 3, coronal: 60, sagittal: 80 };
    const part = {
      id: 'part-analysis-volume-overlay',
      metadata: {
        source_images: [{
          filename: 'source-volume.npy',
          image_id: 'source-volume-id',
          overlay: false,
          metadata: { load_mode: 'volume', volume_shape: dimensions, channel_count: 1, color_mode: 'scalar' },
        }],
        analysis_outputs: [{
          filename: 'source-volume_prediction.npy',
          image_id: 'analysis-volume-overlay-id',
          overlay: true,
          analysis_output: true,
          overlay_base_image_id: 'source-volume-id',
          overlay_base_filename: 'source-volume.npy',
          load_mode: 'volume',
          volume_shape: dimensions,
          channel_count: 4,
          color_mode: 'rgba',
        }],
      },
    };
    const projectImageLookup = {
      'source-volume-id': { id: 'source-volume-id', filename: 'source-volume.npy', metadata: { volume_shape: dimensions, channel_count: 1, color_mode: 'scalar' } },
      'analysis-volume-overlay-id': { id: 'analysis-volume-overlay-id', filename: 'source-volume_prediction.npy', metadata: { volume_shape: dimensions, channel_count: 4, color_mode: 'rgba' } },
    };

    const [overlayVolume] = getVolumeOverlayStacks(part, projectImageLookup);

    expect(overlayVolume).toEqual(expect.objectContaining({
      kind: 'server-volume',
      imageId: 'analysis-volume-overlay-id',
      overlayBaseImageId: 'source-volume-id',
      dimensions,
    }));
  });

  test('aligns sampled external overlay slices with the renderer base depth', () => {
    const dimensions = { axial: 9, coronal: 5, sagittal: 4 };
    const baseRendererStack = [0, 4, 8].map((sliceIndex) => ({
      id: `base-${sliceIndex}`,
      sliceIndex,
      url: `/base/${sliceIndex}`,
    }));
    const overlayVolume = {
      kind: 'server-volume',
      id: 'segments',
      imageId: 'segments',
      dimensions,
      channelCount: 4,
      colorMode: 'rgba',
    };

    const [aligned] = getAlignedVolumeOverlayRendererStacks(
      [overlayVolume],
      baseRendererStack,
      dimensions,
    );

    expect(aligned).toHaveLength(baseRendererStack.length);
    expect(aligned.map((entry) => entry.sliceIndex)).toEqual([0, 4, 8]);
    expect(aligned.map((entry) => entry.url)).toEqual([
      `/api/images/segments/volume-slice?axis=axial&index=0&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`,
      `/api/images/segments/volume-slice?axis=axial&index=4&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`,
      `/api/images/segments/volume-slice?axis=axial&index=8&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`,
    ]);
    expect(aligned.every((entry) => entry.colorMode === 'rgba' && entry.opacity === 1)).toBe(true);
  });

  test.each([
    ['npy', 'application/octet-stream'],
    ['npz', 'application/octet-stream'],
    ['inspiro', 'application/zip'],
    ['tiff', 'image/tiff'],
  ])('uses lazy volume-slice descriptors for %s source and RGBA overlay volumes', (extension, contentType) => {
    const dimensions = { axial: 7, coronal: 5, sagittal: 3 };
    const baseId = `base-${extension}`;
    const overlayId = `overlay-${extension}`;
    const baseFilename = `source.${extension}`;
    const overlayFilename = `segments.${extension}`;
    const part = {
      metadata: {
        source_images: [
          {
            filename: baseFilename,
            image_id: baseId,
            overlay: false,
            content_type: contentType,
            metadata: {
              load_mode: 'volume',
              volume_shape: dimensions,
              channel_count: 1,
              color_mode: 'scalar',
            },
          },
          {
            filename: overlayFilename,
            image_id: overlayId,
            overlay: true,
            overlay_base_image_id: baseId,
            content_type: contentType,
            metadata: {
              load_mode: 'volume',
              volume_shape: dimensions,
              channel_count: 4,
              color_mode: 'rgba',
            },
          },
        ],
      },
    };

    const baseVolume = getVolumeSourceImages(part);
    const [overlayVolume] = getVolumeOverlayStacks(part);

    expect(baseVolume).toEqual(expect.objectContaining({
      kind: 'server-volume',
      imageId: baseId,
      dimensions,
      channelCount: 1,
      colorMode: 'scalar',
    }));
    expect(overlayVolume).toEqual(expect.objectContaining({
      kind: 'server-volume',
      imageId: overlayId,
      dimensions,
      channelCount: 4,
      colorMode: 'rgba',
      overlayBaseImageId: baseId,
    }));
    expect(baseVolume.url).toBe(`/api/images/${baseId}/volume-slice?axis=axial&index=3&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`);
    expect(overlayVolume.url).toBe(`/api/images/${overlayId}/volume-slice?axis=axial&index=3&renderer=${MPR_VOLUME_SLICE_RENDER_VERSION}`);
    expect(baseVolume.url).not.toContain('/content');
    expect(overlayVolume.url).not.toContain('/content');
  });

  test('injects sparse semantic slices into aligned overlay slots without changing uniform base sampling', () => {
    const baseAxialCount = 100;
    const baseIndices = getVolumeRendererSliceIndices(baseAxialCount);
    const baseRendererStack = baseIndices.map((sliceIndex) => ({
      id: `base-${sliceIndex}`,
      sliceIndex,
      url: `/base/${sliceIndex}`,
    }));
    const overlayVolume = {
      kind: 'server-volume',
      imageId: 'sparse-segments',
      filename: 'sparse-segments.npy',
      dimensions: { axial: 25, coronal: 8, sagittal: 8 },
      channelCount: 4,
      colorMode: 'rgba',
    };
    const summaries = {
      'sparse-segments': {
        summary_version: 1,
        channel_representatives: [
          { channel: 0, axial_index: 23 },
          { channel: 1, axial_index: 7 },
          { channel: 2, axial_index: 18 },
          { channel: 3, axial_index: 23 },
        ],
      },
    };

    const [aligned] = getAlignedVolumeOverlayRendererStacks(
      [overlayVolume],
      baseRendererStack,
      { axial: baseAxialCount, coronal: 8, sagittal: 8 },
      summaries,
    );

    expect(getVolumeRendererSliceIndices(baseAxialCount)).toEqual(baseIndices);
    expect(aligned).toHaveLength(12);
    expect(aligned.map((entry) => entry.sliceIndex)).toEqual(baseIndices);
    expect(aligned.map((entry) => entry.sourceSliceIndex))
      .toEqual(expect.arrayContaining([7, 18, 23]));
    [
      [7, 28.875],
      [18, 74.25],
      [23, 94.875],
    ].forEach(([sourceSliceIndex, expectedVoxelSliceIndex]) => {
      expect(aligned.find((entry) => entry.sourceSliceIndex === sourceSliceIndex)?.voxelSliceIndex)
        .toBeCloseTo(expectedVoxelSliceIndex);
    });
    expect(aligned.find((entry) => entry.sourceSliceIndex === 23).url).toContain('index=23');
  });

  test('maps a sparse overlay source slice to base-coordinate Z when depths differ', () => {
    const baseAxialCount = 749;
    const baseRendererStack = getVolumeRendererSliceIndices(baseAxialCount).map((sliceIndex) => ({
      id: `base-${sliceIndex}`,
      sliceIndex,
      url: `/base/${sliceIndex}`,
    }));
    const overlayVolume = {
      kind: 'server-volume',
      imageId: 'segments',
      dimensions: { axial: 1001, coronal: 8, sagittal: 8 },
      channelCount: 4,
      colorMode: 'rgba',
    };

    const [aligned] = getAlignedVolumeOverlayRendererStacks(
      [overlayVolume],
      baseRendererStack,
      { axial: baseAxialCount, coronal: 8, sagittal: 8 },
      { segments: { summary_version: 1, representative_axial_indices: [700] } },
    );
    const injected = aligned.find((entry) => entry.sourceSliceIndex === 700);

    expect(injected).toEqual(expect.objectContaining({
      sourceSliceIndex: 700,
      voxelSliceIndex: 523.6,
    }));
    expect(injected.url).toContain('index=700');
    expect(aligned.map((entry) => entry.sliceIndex)).toEqual(
      getVolumeRendererSliceIndices(baseAxialCount),
    );
  });

  test.each([
    [13, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]],
    [23, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]],
  ])('uniformly spans all %s axial slices when no sparse summary is available', (
    axialCount,
    expected,
  ) => {
    const selected = getVolumeRendererSliceIndices(axialCount);

    expect(selected).toEqual(expected);
    expect(selected).toHaveLength(12);
    expect(selected[0]).toBe(0);
    expect(selected[selected.length - 1]).toBe(axialCount - 1);
  });

  test('bounds untrusted summary hints and renderer sampling to twelve valid slices', () => {
    const channel_representatives = Array.from({ length: 40 }, (_, index) => ({
      channel: index,
      axial_index: index === 0 ? -1 : index * 3,
    }));

    const representatives = getVolumeSummaryRepresentativeIndices(
      { summary_version: 1, channel_representatives },
      100,
    );
    const selected = getVolumeRendererSliceIndices(100, 999);

    expect(representatives).toEqual([3, 6, 9]);
    expect(selected).toHaveLength(12);
    expect(selected.every((index) => index >= 0 && index < 100)).toBe(true);
  });

  test('admits colorized scalar and RGB overlays to semantic 3D rendering', () => {
    expect(isRenderableVolumeOverlay({
      kind: 'server-volume', imageId: 'rgba', channelCount: 4, colorMode: 'rgba',
    })).toBe(true);
    expect(isRenderableVolumeOverlay({
      kind: 'server-volume', imageId: 'scalar', channelCount: 1, colorMode: 'scalar',
    })).toBe(true);
    expect(isRenderableVolumeOverlay({
      kind: 'server-volume', imageId: 'rgb', channelCount: 3, colorMode: 'rgb',
    })).toBe(true);
    expect(isRenderableVolumeOverlay({
      stack: [{ channelCount: 4, colorMode: 'rgba' }, { channelCount: 1, colorMode: 'scalar' }],
    })).toBe(true);
    expect(isRenderableVolumeOverlay({
      kind: 'server-volume', imageId: 'unsupported', channelCount: 2, colorMode: 'complex',
    })).toBe(false);
    expect(isRenderableVolumeOverlay({
      id: 'external-png-overlay',
      stack: [{ id: 'overlay-slice-0', url: '/api/images/overlay-slice-0/content', sliceIndex: 0 }],
    })).toBe(true);
    const rgbaVolumes = Array.from({ length: 6 }, (_, index) => ({
      kind: 'server-volume', imageId: `rgba-${index}`, channelCount: 4, colorMode: 'rgba',
    }));
    const scalarVolume = {
      kind: 'server-volume', imageId: 'scalar-extra', channelCount: 1, colorMode: 'scalar',
    };
    expect(getSemantic3dVolumeOverlayStacks([scalarVolume, ...rgbaVolumes]).map((entry) => entry.imageId))
      .toEqual(['scalar-extra', 'rgba-0', 'rgba-1', 'rgba-2']);
  });

  test('bounds optional summary work to two concurrent requests', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases = [];
    const work = mapWithConcurrency([0, 1, 2, 3], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => { releases.push(resolve); });
      active -= 1;
      return value;
    });

    await Promise.resolve();
    expect(maximumActive).toBe(2);
    releases.splice(0).forEach((release) => release());
    await Promise.resolve();
    await Promise.resolve();
    releases.splice(0).forEach((release) => release());

    await expect(work).resolves.toEqual([0, 1, 2, 3]);
    expect(maximumActive).toBe(2);
  });

  test('enforces one global 192 MiB canvas budget across volume caches', () => {
    const firstCache = { key: 'base-volume', sliceCanvases: new Map() };
    const secondCache = { key: 'overlay-volume', sliceCanvases: new Map() };
    const canvasBytes = 1000 * 1000 * 4;

    for (let index = 0; index < 60; index += 1) {
      const cache = index % 2 === 0 ? firstCache : secondCache;
      rememberSliceCanvas(cache, `axial:${index}`, { width: 1000, height: 1000 });
    }

    const stats = getMprSliceCanvasCacheStats();
    expect(stats.maxBytes).toBe(192 * 1024 * 1024);
    expect(stats.bytes).toBeLessThanOrEqual(stats.maxBytes);
    expect(stats.items * canvasBytes).toBe(stats.bytes);
    expect(stats.items).toBe(50);
    expect(firstCache.sliceCanvases.has('axial:0')).toBe(false);
    expect(secondCache.sliceCanvases.has('axial:59')).toBe(true);
  });

  test.each([
    ['axial', false],
    ['coronal', true],
    ['sagittal', true],
  ])('matches legacy vertical orientation for %s server slices', (axis, shouldFlipVertically) => {
    const context = {
      save: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      drawImage: jest.fn(),
      restore: jest.fn(),
    };
    const image = { marker: 'z-zero-at-source-top' };

    drawServerMprSliceImage(context, image, axis, 120, 80);

    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 120, 80);
    expect(context.restore).toHaveBeenCalledTimes(1);
    if (shouldFlipVertically) {
      expect(context.translate).toHaveBeenCalledWith(0, 80);
      expect(context.scale).toHaveBeenCalledWith(1, -1);
    } else {
      expect(context.translate).not.toHaveBeenCalled();
      expect(context.scale).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['rgba', 1],
    ['rgb', 0.45],
    ['scalar', 0.45],
    [undefined, 0.45],
  ])('uses %s overlay layout alpha %s without windowing color data', (colorMode, expectedAlpha) => {
    expect(getMprOverlayCompositeAlpha({ colorMode })).toBe(expectedAlpha);
    const observed = {};
    const context = {
      globalAlpha: 0,
      globalCompositeOperation: 'copy',
      save: jest.fn(),
      drawImage: jest.fn(() => {
        observed.alpha = context.globalAlpha;
        observed.operation = context.globalCompositeOperation;
      }),
      restore: jest.fn(),
    };
    const overlayCanvas = { width: 4, height: 3 };

    drawMprOverlaySlice(context, overlayCanvas, { colorMode }, 8, 6);

    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.drawImage).toHaveBeenCalledWith(overlayCanvas, 0, 0, 8, 6);
    expect(observed).toEqual({ alpha: expectedAlpha, operation: 'source-over' });
    expect(context.restore).toHaveBeenCalledTimes(1);
  });

  test('uses assigned MPR overlay alpha from the per-overlay opacity only', () => {
    const observed = {};
    const context = {
      globalAlpha: 0,
      globalCompositeOperation: 'copy',
      save: jest.fn(),
      drawImage: jest.fn(() => {
        observed.alpha = context.globalAlpha;
      }),
      restore: jest.fn(),
    };

    drawMprOverlaySlice(context, { width: 4, height: 3 }, { colorMode: 'rgba' }, 8, 6, 0.35);

    expect(observed.alpha).toBe(1);
  });

  test('tints assigned MPR overlay slices with their configured overlay color and opacity', () => {
    const observed = [];
    const context = {
      globalAlpha: 0,
      globalCompositeOperation: 'copy',
      fillStyle: '',
      save: jest.fn(),
      drawImage: jest.fn(() => {
        observed.push({ type: 'draw', alpha: context.globalAlpha, operation: context.globalCompositeOperation });
      }),
      fillRect: jest.fn(() => {
        observed.push({ type: 'fill', alpha: context.globalAlpha, operation: context.globalCompositeOperation, fillStyle: context.fillStyle });
      }),
      restore: jest.fn(),
    };

    drawMprOverlaySlice(
      context,
      { width: 4, height: 3 },
      { colorMode: 'rgba', overlayColor: '#22c55e', overlayOpacity: 0.4 },
      8,
      6,
      0.5,
    );

    expect(observed).toEqual([
      { type: 'draw', alpha: 0.4, operation: 'source-over' },
      { type: 'fill', alpha: 0.4, operation: 'source-in', fillStyle: 'rgb(34,197,94)' },
    ]);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 8, 6);
  });

  test('tints scalar MPR overlay masks without increasing their base alpha', () => {
    const observed = [];
    const context = {
      globalAlpha: 0,
      globalCompositeOperation: 'copy',
      fillStyle: '',
      save: jest.fn(),
      drawImage: jest.fn(() => {
        observed.push({ type: 'draw', alpha: context.globalAlpha, operation: context.globalCompositeOperation });
      }),
      fillRect: jest.fn(() => {
        observed.push({ type: 'fill', alpha: context.globalAlpha, operation: context.globalCompositeOperation, fillStyle: context.fillStyle });
      }),
      restore: jest.fn(),
    };

    drawMprOverlaySlice(
      context,
      { width: 4, height: 3 },
      { colorMode: 'scalar', overlayColor: '#ef4444', overlayOpacity: 0.6 },
      8,
      6,
      0.25,
    );

    expect(observed).toEqual([
      { type: 'draw', alpha: 0.27, operation: 'source-over' },
      { type: 'fill', alpha: 0.27, operation: 'source-in', fillStyle: 'rgb(239,68,68)' },
    ]);
  });
});
