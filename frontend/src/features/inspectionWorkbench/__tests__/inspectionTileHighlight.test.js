import React from 'react';
import { render, screen } from '@testing-library/react';
import { findHighlightedInspectionTileId } from '../inspectionTileHighlight';
import { InspectionViewBoard } from '../InspectionViewBoard';

jest.mock('../InspectionImageTile', () => ({
  InspectionImageTile: ({ entry, isHighlighted }) => (
    <div data-testid={`tile-${entry.id}`} data-highlighted={isHighlighted ? 'true' : 'false'} />
  ),
}));

const lookup = {
  base: { id: 'base', filename: 'sn1_front_xray.png', metadata: {} },
  heat: { id: 'heat', filename: 'sn1_front_heatmap.png', metadata: { overlay_base_image_id: 'base' } },
  seg: { id: 'seg', filename: 'sn1_front_seg.png', metadata: { overlay_base_image_id: 'base' } },
  back: { id: 'back', filename: 'sn1_back_xray.png', metadata: {} },
};

const baseEntry = { id: 'p-source-0', imageRef: 'base', imageId: 'base', filename: 'sn1_front_xray.png', overlay: false, viewName: 'front', modality: 'xray' };
const heatEntry = { id: 'p-analysis-1', imageRef: 'heat', imageId: 'heat', filename: 'sn1_front_heatmap.png', overlay: true, overlayBaseImageId: 'base', viewName: 'front', modality: 'heatmap' };
const segEntry = { id: 'p-analysis-2', imageRef: 'seg', imageId: 'seg', filename: 'sn1_front_seg.png', overlay: true, overlayBaseImageId: 'base', viewName: 'front', modality: 'segmentation' };
const backEntry = { id: 'p-source-3', imageRef: 'back', imageId: 'back', filename: 'sn1_back_xray.png', overlay: false, viewName: 'back', modality: 'xray' };

const measurementOn = (imageId) => ({
  key: 'annotation:m1',
  kind: 'annotation',
  source: { resource: 'annotation', resourceId: 'm1' },
  annotation: { id: 'm1', image_id: imageId, annotation_kind: 'measurement', geometry: { line: { x1: 0, y1: 0, x2: 1, y2: 1 } } },
});

describe('findHighlightedInspectionTileId', () => {
  test('returns no tile without a selected item or matching tile', () => {
    expect(findHighlightedInspectionTileId(null, [baseEntry], 'base', lookup)).toBe('');
    expect(findHighlightedInspectionTileId(measurementOn('other'), [baseEntry, backEntry], 'base', lookup)).toBe('');
  });

  test('highlights only the selected overlay when several same-view overlays share a base', () => {
    const entries = [heatEntry, segEntry, backEntry];
    expect(findHighlightedInspectionTileId(measurementOn('base'), entries, 'seg', lookup)).toBe('p-analysis-2');
    expect(findHighlightedInspectionTileId(measurementOn('base'), entries, 'heat', lookup)).toBe('p-analysis-1');
  });

  test('prefers the exact image tile over related overlays when the selection is elsewhere', () => {
    const entries = [heatEntry, baseEntry, segEntry];
    expect(findHighlightedInspectionTileId(measurementOn('base'), entries, 'back', lookup)).toBe('p-source-0');
  });

  test('falls back to one related tile when the exact image is not visible', () => {
    expect(findHighlightedInspectionTileId(measurementOn('base'), [heatEntry, segEntry], '', lookup)).toBe('p-analysis-1');
  });
});

describe('InspectionViewBoard highlight', () => {
  test('marks exactly one tile highlighted for a measurement on a shared base image', () => {
    render(
      <InspectionViewBoard
        tabKey="view_parts"
        readOnly={false}
        tileColumns={{ normalizedTileColumnCount: 2 }}
        tileView={{}}
        handlers={{}}
        selection={{
          visibleSelectedPartImageRefs: [heatEntry, segEntry, backEntry],
          selectedInspectionItem: measurementOn('base'),
          selectedImageRef: 'heat',
          projectImageLookup: lookup,
        }}
      />,
    );
    expect(screen.getByTestId('tile-p-analysis-1')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('tile-p-analysis-2')).toHaveAttribute('data-highlighted', 'false');
    expect(screen.getByTestId('tile-p-source-3')).toHaveAttribute('data-highlighted', 'false');
  });
});
