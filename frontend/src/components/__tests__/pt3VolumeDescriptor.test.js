import {
  createPt3VolumeDescriptor,
  getPt3AxisDimensions,
  getPt3VolumeMetadata,
  getPt3VolumeSliceUrl,
  isPt3VolumeDescriptor,
} from '../pt3VolumeDescriptor';

describe('PT3 canonical volume descriptor', () => {
  const sourceEntry = {
    image_id: 'source/id',
    filename: 'part.npy',
    volume_shape: { axial: 5, coronal: 7, sagittal: 11 },
    channel_count: 1,
    color_mode: 'scalar',
  };

  test('stores named dimensions once and derives renderer XYZ ordering', () => {
    const descriptor = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry,
    });

    expect(isPt3VolumeDescriptor(descriptor)).toBe(true);
    expect(descriptor.dimensions).toEqual({ axial: 5, coronal: 7, sagittal: 11 });
    expect(descriptor.axisDimensions).toBeUndefined();
    expect(Array.isArray(descriptor.dimensions)).toBe(false);
    expect(getPt3AxisDimensions(descriptor)).toBe(descriptor.dimensions);
    expect(getPt3VolumeMetadata(descriptor).dimensions).toEqual([11, 7, 5]);
  });

  test('uses probe, persisted image, source, part, and real-asset precedence', () => {
    const descriptor = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry,
      imageRecord: {
        id: 'persisted-id',
        filename: 'persisted.npz',
        volume_shape: { axial: 13, coronal: 17, sagittal: 19 },
        channel_count: 3,
        color_mode: 'rgb',
        spacing: [2, 2, 2],
      },
      probeMetadata: {
        dimensions: { axial: 23, coronal: 29, sagittal: 31 },
        channel_count: 4,
        color_mode: 'rgba',
        pixel_dtype: 'uint16',
        bit_depth: 16,
        scalar_range: [4, 4000],
        spacing: [0.1, 0.2, 0.3],
      },
      partMetadata: {
        volume_shape: { axial: 37, coronal: 41, sagittal: 43 },
        pt3_real_splat_asset: { source_dimensions: [47, 53, 59] },
      },
    });

    expect(descriptor.source).toMatchObject({
      kind: 'server-volume',
      imageId: 'persisted-id',
      filename: 'persisted.npz',
      format: 'npz',
    });
    expect(descriptor.dimensions).toEqual({ axial: 23, coronal: 29, sagittal: 31 });
    expect(descriptor.physical.spacing).toEqual([0.1, 0.2, 0.3]);
    expect(descriptor.samples).toEqual({
      dtype: 'uint16',
      bitDepth: 16,
      scalarRange: [4, 4000],
      channelCount: 4,
      colorMode: 'rgba',
    });
  });

  test.each([
    [{ ...sourceEntry, volume_shape: undefined }, 'missing dimensions'],
    [{ ...sourceEntry, channel_count: undefined, color_mode: undefined }, 'missing layout'],
    [{ ...sourceEntry, image_id: undefined }, 'missing image id'],
  ])('leaves an incomplete real source unresolved for metadata probing: %s', (entry) => {
    expect(createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: entry,
    })).toBeNull();
  });

  test('accepts only matching scalar, RGB, and RGBA channel semantics', () => {
    expect(createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: { ...sourceEntry, channel_count: 3, color_mode: 'rgb' },
    }).samples).toMatchObject({ channelCount: 3, colorMode: 'rgb' });
    expect(createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: { ...sourceEntry, channel_count: 4, color_mode: 'rgba' },
    }).samples).toMatchObject({ channelCount: 4, colorMode: 'rgba' });
    expect(createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: { ...sourceEntry, channel_count: 4, color_mode: 'rgb' },
    })).toBeNull();
  });

  test.each([
    ['conflicting layout', { channel_count: 4, color_mode: 'rgb' }],
    ['partial layout', { channel_count: 4 }],
    ['blank declaration', { channel_count: '', color_mode: '' }],
  ])('fails closed when an authoritative probe has a %s', (_label, probeMetadata) => {
    expect(createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry,
      imageRecord: {
        id: 'persisted-id',
        filename: 'persisted.npy',
        volume_shape: { axial: 5, coronal: 7, sagittal: 11 },
        channel_count: 1,
        color_mode: 'scalar',
      },
      probeMetadata: {
        dimensions: { axial: 5, coronal: 7, sagittal: 11 },
        ...probeMetadata,
      },
    })).toBeNull();
  });

  test('derives bit depth and scalar range from conventional and NumPy dtypes', () => {
    const uint16 = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: { ...sourceEntry, pixel_dtype: 'uint16' },
    });
    expect(uint16.samples).toMatchObject({
      dtype: 'uint16',
      bitDepth: 16,
      scalarRange: [0, 65535],
    });

    const int16 = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: { ...sourceEntry, pixel_dtype: '<i2' },
    });
    expect(int16.samples).toMatchObject({
      dtype: '<i2',
      bitDepth: 16,
      scalarRange: [-32768, 32767],
    });
  });

  test('derives observed slice-stack dimensions and scalar defaults', () => {
    const descriptor = createPt3VolumeDescriptor({
      imageStack: [
        { width: 13, height: 9 },
        { width: 13, height: 9 },
        { width: 13, height: 9 },
      ],
    });
    expect(descriptor.source).toMatchObject({
      kind: 'slice-stack',
      imageId: null,
      format: 'image-stack',
      interpretation: 'stack_of_2d_images',
    });
    expect(descriptor.dimensions).toEqual({ axial: 3, coronal: 9, sagittal: 13 });
    expect(descriptor.samples).toMatchObject({ channelCount: 1, colorMode: 'scalar' });
  });

  test('accepts a server-backed TIFF stack interpretation', () => {
    const descriptor = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: {
        ...sourceEntry,
        filename: 'scan.tiff',
        interpretation: 'stack_of_2d_images',
      },
    });

    expect(isPt3VolumeDescriptor(descriptor)).toBe(true);
    expect(descriptor.source).toMatchObject({
      kind: 'server-volume',
      format: 'tiff',
      interpretation: 'stack_of_2d_images',
    });
  });

  test('uses fitted source dimensions in ZYX order before explicit synthetic fallback', () => {
    const fitted = createPt3VolumeDescriptor({
      sourceKind: 'synthetic',
      partMetadata: {
        pt3_real_splat_asset: {
          source_dimensions: [7, 11, 13],
          source_physical_space: {
            spacing: [0.4, 0.5, 0.6],
            origin: [1, 2, 3],
          },
        },
      },
      allowSynthetic: true,
    });
    expect(fitted.dimensions).toEqual({ axial: 7, coronal: 11, sagittal: 13 });
    expect(getPt3VolumeMetadata(fitted)).toMatchObject({
      dimensions: [13, 11, 7],
      spacing: [0.4, 0.5, 0.6],
      origin: [1, 2, 3],
    });

    const synthetic = createPt3VolumeDescriptor({ allowSynthetic: true });
    expect(synthetic.dimensions).toEqual({ axial: 64, coronal: 96, sagittal: 128 });
    expect(synthetic.source.imageId).toBeNull();
    expect(synthetic.source.interpretation).toBe('synthetic');
  });

  test.each([
    ['array dimensions', (valid) => ({ ...valid, dimensions: [11, 7, 5] })],
    ['fractional dimension', (valid) => ({
      ...valid,
      dimensions: { ...valid.dimensions, axial: 1.5 },
    })],
    ['non-positive spacing', (valid) => ({
      ...valid,
      physical: { ...valid.physical, spacing: [1, 0, 1] },
    })],
    ['short origin', (valid) => ({
      ...valid,
      physical: { ...valid.physical, origin: [0, 0] },
    })],
    ['non-finite direction', (valid) => ({
      ...valid,
      physical: {
        ...valid.physical,
        direction: [1, 0, 0, 0, Number.NaN, 0, 0, 0, 1],
      },
    })],
    ['server source without an image id', (valid) => ({
      ...valid,
      source: { ...valid.source, imageId: null },
    })],
    ['synthetic source with an image id', (valid) => ({
      ...valid,
      source: { ...valid.source, kind: 'synthetic', imageId: 'not-allowed' },
    })],
    ['non-string source filename', (valid) => ({
      ...valid,
      source: { ...valid.source, filename: null },
    })],
    ['non-string source format', (valid) => ({
      ...valid,
      source: { ...valid.source, format: { extension: 'npy' } },
    })],
    ['unsupported source interpretation', (valid) => ({
      ...valid,
      source: { ...valid.source, interpretation: 'ambiguous-volume' },
    })],
  ])('rejects malformed descriptors: %s', (_label, mutate) => {
    const valid = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry,
    });
    expect(isPt3VolumeDescriptor(mutate(valid))).toBe(false);
  });

  test.each([
    ['overflowing bit depth', { bit_depth: 2048, pixel_dtype: 'uint8' }],
    ['fractional channel count', { channel_count: 3.5, color_mode: 'rgb' }],
    ['non-finite shape', {
      volume_shape: { axial: Number.POSITIVE_INFINITY, coronal: 7, sagittal: 11 },
    }],
    ['non-finite sample values', {
      bit_depth: Number.NaN,
      scalar_range: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
    }],
  ])('never returns an invalid descriptor for hostile numeric metadata: %s', (_label, metadata) => {
    const descriptor = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: { ...sourceEntry, ...metadata },
    });
    expect(descriptor === null || isPt3VolumeDescriptor(descriptor)).toBe(true);
  });

  test('rejects a fractional explicit bit depth instead of silently rounding it', () => {
    expect(createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry: {
        ...sourceEntry,
        bit_depth: 12.5,
        pixel_dtype: 'uint16',
      },
    })).toBeNull();
  });

  test('builds safe clamped server slice URLs with an optional renderer contract', () => {
    const descriptor = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry,
    });
    expect(getPt3VolumeSliceUrl(descriptor, 'coronal', 999, {
      rendererVersion: 'rgba-segments-v2',
    })).toBe('/api/images/source%2Fid/volume-slice?axis=coronal&index=6&renderer=rgba-segments-v2');
    expect(getPt3VolumeSliceUrl(descriptor, 'invalid', -4))
      .toBe('/api/images/source%2Fid/volume-slice?axis=axial&index=0');
  });

  test('freezes canonical nested state so dimensions cannot drift from renderer metadata', () => {
    const descriptor = createPt3VolumeDescriptor({
      sourceKind: 'server-volume',
      sourceEntry,
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.dimensions)).toBe(true);
    expect(Object.isFrozen(descriptor.samples.scalarRange)).toBe(true);
  });
});
