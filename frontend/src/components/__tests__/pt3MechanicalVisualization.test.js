import {
  countVisibleSplats,
  getMechanicalCropBox,
  getMechanicalVolumeDescriptor,
  getMechanicalVolumeMetadata,
  makeMechanicalFallbackSplats,
} from '../pt3MechanicalVisualization';

describe('mechanical 3D visualization helpers', () => {
  test('derives industrial part metadata without medical defaults', () => {
    const part = { id: 'gear-1', metadata: { volume_shape: { sagittal: 20, coronal: 10, axial: 5 } } };
    const descriptor = getMechanicalVolumeDescriptor(part);
    const metadata = getMechanicalVolumeMetadata(part);
    expect(descriptor.dimensions).toEqual({ sagittal: 20, coronal: 10, axial: 5 });
    expect(metadata.dimensions).toEqual([20, 10, 5]);
    expect(metadata.spacing).toEqual([0.08, 0.08, 0.12]);
    expect(metadata.modality).toBe('industrial_ct');
    expect(metadata.sourceId).toBe('gear-1');
  });

  test('creates deterministic mechanical splat layers and crop counts', () => {
    const metadata = getMechanicalVolumeMetadata({ id: 'bracket-1', metadata: { volume_shape: { sagittal: 16, coronal: 16, axial: 8 } } });
    const splats = makeMechanicalFallbackSplats(metadata);
    expect(splats.positions).toHaveLength(720 * 3);
    expect(splats.layers.map((layer) => layer.id)).toEqual(['surface', 'core', 'defect-candidates']);
    const fullCount = countVisibleSplats(splats, getMechanicalCropBox(metadata, false));
    const croppedCount = countVisibleSplats(splats, getMechanicalCropBox(metadata, true));
    expect(fullCount).toBe(720);
    expect(croppedCount).toBeGreaterThan(0);
    expect(croppedCount).toBeLessThan(fullCount);
  });

  test('uses authoritative source-image dimensions and unit spacing for imported NPY volumes', () => {
    const metadata = getMechanicalVolumeMetadata({
      id: 'large-npy-part',
      metadata: {
        source_images: [{
          filename: 'set1sample5raw_uint16.npy',
          overlay: false,
          volume_shape: { axial: 749, coronal: 1010, sagittal: 984 },
        }],
      },
    });

    expect(metadata.dimensions).toEqual([984, 1010, 749]);
    expect(metadata.spacing).toEqual([1, 1, 1]);
  });

  test('falls back to canonical asset source geometry when part shape metadata is absent', () => {
    const metadata = getMechanicalVolumeMetadata({
      id: 'fitted-part',
      metadata: {
        pt3_real_splat_asset: {
          source_dimensions: [7, 11, 13],
          source_physical_space: {
            spacing: [0.4, 0.5, 0.6],
            origin: [1, 2, 3],
            direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
          scalar_range: [0, 65535],
        },
      },
    });

    expect(metadata.dimensions).toEqual([13, 11, 7]);
    expect(metadata.spacing).toEqual([0.4, 0.5, 0.6]);
    expect(metadata.origin).toEqual([1, 2, 3]);
    expect(metadata.scalarRange).toEqual([0, 65535]);
  });

  test('fills missing legacy shape axes without collapsing them to one voxel', () => {
    const metadata = getMechanicalVolumeMetadata({
      id: 'partial-shape-part',
      metadata: { volume_shape: { sagittal: 20 } },
    });

    expect(metadata.dimensions).toEqual([20, 96, 64]);
  });
});
