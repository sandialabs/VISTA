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

  test('does not highlight same-view overlays for an annotation on their base image', () => {
    const entries = [heatEntry, segEntry, backEntry];
    expect(findHighlightedInspectionTileId(measurementOn('base'), entries, 'seg', lookup)).toBe('');
    expect(findHighlightedInspectionTileId(measurementOn('base'), entries, 'heat', lookup)).toBe('');
  });

  test('highlights the exact image tile even when another tile is selected', () => {
    const entries = [heatEntry, baseEntry, segEntry];
    expect(findHighlightedInspectionTileId(measurementOn('base'), entries, 'back', lookup)).toBe('p-source-0');
    expect(findHighlightedInspectionTileId(measurementOn('heat'), entries, 'base', lookup)).toBe('p-analysis-1');
  });

  test('prefers the selected tile when the same image appears in several tiles', () => {
    const aggregateBase = { ...baseEntry, id: 'all-p-source-0' };
    expect(findHighlightedInspectionTileId(measurementOn('base'), [aggregateBase, baseEntry], 'base', lookup)).toBe('all-p-source-0');
  });
});

describe('InspectionViewBoard highlight', () => {
  test('highlights only the tile whose own image owns the measurement', () => {
    render(
      <InspectionViewBoard
        tabKey="view_parts"
        readOnly={false}
        tileColumns={{ normalizedTileColumnCount: 2 }}
        tileView={{}}
        handlers={{}}
        selection={{
          visibleSelectedPartImageRefs: [baseEntry, heatEntry, segEntry, backEntry],
          selectedInspectionItem: measurementOn('heat'),
          selectedImageRef: 'base',
          projectImageLookup: lookup,
        }}
      />,
    );
    expect(screen.getByTestId('tile-p-analysis-1')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('tile-p-source-0')).toHaveAttribute('data-highlighted', 'false');
    expect(screen.getByTestId('tile-p-analysis-2')).toHaveAttribute('data-highlighted', 'false');
    expect(screen.getByTestId('tile-p-source-3')).toHaveAttribute('data-highlighted', 'false');
  });
});
