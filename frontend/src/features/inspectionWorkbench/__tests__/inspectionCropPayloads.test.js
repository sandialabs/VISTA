import {
  appendCropSourceEntry,
  applyCropSubtitle,
  buildCropMetadata,
  buildCropSourceEntry,
  getCropSourceRect,
  resolveCropParent,
} from '../inspectionCropPayloads';

describe('inspectionCropPayloads', () => {
  const cropBox = { x: 10, y: 20, width: 30, height: 40, imageWidth: 100, imageHeight: 200 };
  const selectedPart = {
    id: 'p1',
    serial_number: 'SN',
    metadata: { source_images: [{ image_id: 'img-1', modality: 'XRay' }] },
  };

  test('resolves the parent filename, modality, and crop naming', () => {
    const parent = resolveCropParent({
      parentImageId: ' img-1 ', cropBox, title: '', selectedPart, projectImageLookup: { 'img-1': { filename: 'part.png' } },
    });
    expect(parent).toMatchObject({ canonicalParentImageId: 'img-1', parentFilename: 'part.png', parentModality: 'xray' });
    expect(typeof parent.cropFilename).toBe('string');
    expect(parent.cropTitle).toBeTruthy();
    expect(resolveCropParent({ parentImageId: 'x', cropBox, title: 'Mine', selectedPart, projectImageLookup: {} }))
      .toMatchObject({ parentFilename: 'x', parentModality: 'visual', cropTitle: 'Mine' });
  });

  test('scales and clamps the source rectangle to the natural image size', () => {
    expect(getCropSourceRect(cropBox, 200, 400)).toEqual({ sx: 20, sy: 40, sw: 60, sh: 80 });
    expect(getCropSourceRect({ ...cropBox, x: 99, width: 50 }, 100, 200)).toEqual({ sx: 99, sy: 20, sw: 1, sh: 40 });
  });

  test('builds crop metadata and the part source-image entry', () => {
    const parent = { canonicalParentImageId: 'img-1', parentFilename: 'part.png', parentModality: 'visual', cropTitle: 'T', cropFilename: 'crop.png' };
    const metadata = buildCropMetadata({
      parent, cropAnnotationId: 5, cropBox: { ...cropBox, imageWidth: 0 }, naturalWidth: 640, naturalHeight: 480, selectedPart,
    });
    expect(metadata).toMatchObject({
      crop_child_image: true, parent_image_id: 'img-1', crop_annotation_id: '5', crop_subtitle: '', part_id: 'p1',
      serial_number: 'SN', modality: 'visual', side: 'crop', crop_bbox: { x: 10, imageWidth: 640, imageHeight: 200 },
    });
    const entry = buildCropSourceEntry({ createdImage: { id: 9 }, parent, cropAnnotationId: '', cropBbox: metadata.crop_bbox });
    expect(entry).toMatchObject({ filename: 'crop.png', image_id: '9', overlay: false, crop_annotation_id: '', crop_bbox: metadata.crop_bbox });
    const parts = [{ id: 'p1', metadata: { source_images: [{ image_id: '9' }, { filename: 'a.png' }] } }, { id: 'p2' }];
    const next = appendCropSourceEntry(parts, 'p1', entry);
    expect(next[0].metadata.source_images).toEqual([{ filename: 'a.png' }, entry]);
    expect(next[1]).toBe(parts[1]);
  });

  test('applies a crop subtitle to the matching source image only', () => {
    const parts = [{ id: 'p1', metadata: { source_images: [{ image_id: 'a' }, { filename: 'b.png' }] } }];
    expect(applyCropSubtitle(parts, 'p1', 'b.png', 'Sub')[0].metadata.source_images)
      .toEqual([{ image_id: 'a' }, { filename: 'b.png', crop_subtitle: 'Sub' }]);
  });
});
