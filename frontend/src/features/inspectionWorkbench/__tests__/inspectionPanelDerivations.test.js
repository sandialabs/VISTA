import { getConfiguredDefectTypes } from '../useInspectionAnnotationLayers';
import { getEffectiveInspectionHierarchy } from '../useInspectionHierarchy';
import { mergeSegmentationSegmentsWithDrafts } from '../useSegmentationSegmentSync';
import { findSelectedInspectionItem } from '../useInspectionAnnotationItems';
import { findImageRefForAnnotation } from '../useInspectionFocusRequest';
import { getMprTooltipValues } from '../useMprTooltipValues';
import { createCalibratedAnnotationGeometry } from '../calibratedAnnotationGeometry';
import { getTileViewportStyle } from '../centerPaneProps';

describe('inspection panel derivations', () => {
  test('getConfiguredDefectTypes trims and de-duplicates case-insensitively', () => {
    expect(getConfiguredDefectTypes(null)).toEqual([]);
    expect(getConfiguredDefectTypes({ defect_types: 'Crack' })).toEqual([]);
    expect(getConfiguredDefectTypes({
      defect_types: [' Crack ', { name: 'crack' }, { name: 'Void' }, '', null, 'VOID', 'Pit'],
    })).toEqual(['Crack', 'Void', 'Pit']);
  });

  test('getEffectiveInspectionHierarchy prepends the MPR tab only for PT3', () => {
    const pt1 = getEffectiveInspectionHierarchy({}, 'PT1');
    expect(pt1.centerTabs).not.toContain('mpr');
    const pt3 = getEffectiveInspectionHierarchy({}, 'PT3');
    expect(pt3.centerTabs[0]).toBe('mpr');
    expect(pt3.regions.mpr).toBeTruthy();
    expect(pt3.centerTabs.slice(1)).toEqual(pt1.centerTabs);
  });

  test('mergeSegmentationSegmentsWithDrafts keeps only in-scope drafts and replaces by local or server id', () => {
    const drafts = [
      ['1:p1:a', { localId: 'local-1', serverId: '', segment: { id: 'local-1', name: 'new' } }],
      ['1:p1:b', { localId: 'local-2', serverId: '42', segment: { id: 'local-2', name: 'edited' } }],
      ['1:p2:c', { localId: 'other', segment: { id: 'other' } }],
    ];
    const merged = mergeSegmentationSegmentsWithDrafts([], drafts, '1:p1:');
    expect(merged.map((segment) => segment.id)).toEqual(['local-1', 'local-2']);
  });

  test('findSelectedInspectionItem prefers the selected annotation then the key', () => {
    const items = [
      { key: 'annotation:7', source: { resource: 'annotation', resourceId: 7 } },
      { key: 'overlay:3', kind: 'external_overlay', source: { resource: 'overlay', resourceId: 3 } },
    ];
    expect(findSelectedInspectionItem(items, '7', 'overlay:3')).toBe(items[0]);
    expect(findSelectedInspectionItem(items, '99', 'overlay:3')).toBe(items[1]);
    expect(findSelectedInspectionItem(items, null, 'missing')).toBeNull();
  });

  test('findImageRefForAnnotation matches the annotation image to a part image ref', () => {
    const refs = [
      { imageRef: 'ref-a', imageId: 10 },
      { imageRef: 'ref-b', imageId: 11 },
    ];
    expect(findImageRefForAnnotation({ image_id: 11 }, refs, {})).toBe('ref-b');
    expect(findImageRefForAnnotation({ image_id: 12 }, refs, {})).toBe('');
    expect(findImageRefForAnnotation({}, refs, {})).toBe('');
  });

  test('getMprTooltipValues windows the probe value and derives overlay percentages', () => {
    const values = getMprTooltipValues({
      activeOverlayIds: ['a', 'b'],
      cursorX: 50,
      cursorY: 50,
      displayValueDomain: { min: 0, max: 255 },
      displayWindow: { min: 0, max: 255 },
      slicePosition: { axial: 0, coronal: 0, sagittal: 0 },
    });
    expect(values.base).toBe(50);
    expect(values.overlays).toEqual([
      { overlayId: 'a', value: Number((((50 + 17) / 255) * 100).toFixed(1)) },
      { overlayId: 'b', value: Number((((50 + 34) / 255) * 100).toFixed(1)) },
    ]);
  });

  test('createCalibratedAnnotationGeometry derives millimetre lengths and box dimensions', () => {
    const calibrations = { src: { pixels_per_mm: 2 } };
    const { getLineDistanceMm, getBoxWithDerivedDimensions } = createCalibratedAnnotationGeometry({
      getAnnotationSourceImageIdForImage: (imageId) => (imageId === 'img' ? 'src' : imageId),
      getCalibrationForImage: (imageId) => calibrations[imageId] || null,
    });
    expect(getLineDistanceMm({ x1: 0, y1: 0, x2: 6, y2: 8 }, 'img')).toBe(5);
    expect(getLineDistanceMm({ x1: 0, y1: 0, x2: 6, y2: 8 }, 'uncalibrated')).toBeNull();
    const box = { x: 0, y: 0, width: 10, height: 4, imageWidth: 100, imageHeight: 100 };
    expect(getBoxWithDerivedDimensions(box, 'img')).toEqual({ ...box, widthMm: 5, heightMm: 2 });
    expect(getBoxWithDerivedDimensions({ ...box, widthMm: 9 }, 'img').widthMm).toBe(9);
    expect(getBoxWithDerivedDimensions(box, 'uncalibrated')).toBe(box);
  });

  test('getTileViewportStyle composes pan and zoom', () => {
    expect(getTileViewportStyle({ panX: 3, panY: -4, zoom: 2 })).toEqual({
      transform: 'translate(3px, -4px) scale(2)',
      transformOrigin: 'center center',
    });
  });
});
