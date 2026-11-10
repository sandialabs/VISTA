import React from 'react';
import { render } from '@testing-library/react';
import { InspectionImageTile } from '../InspectionImageTile';
import { buildCenterPaneProps } from '../centerPaneProps';

// While a draw tool (Measure, Draw box, Crop) is active, existing shapes must
// not expose move/edit hit targets: the tool owns the pointer so new shapes
// can be drawn over existing ones.

const line = { id: 'line-1', x1: 10, y1: 10, x2: 90, y2: 10, imageWidth: 100, imageHeight: 100, color: '#06b6d4' };
const box = { id: 'box-1', x: 20, y: 20, width: 40, height: 40, imageWidth: 100, imageHeight: 100, color: '#f97316' };
const entry = { id: 'p-source-0', imageRef: 'img-1', imageId: 'img-1', filename: 'img.png', viewName: 'front', overlay: false };

const renderTile = (annotationDrawToolActive) => render(
  <InspectionImageTile
    entry={entry}
    tabKey="view_parts"
    readOnly={false}
    selection={{ isAllImagesSelection: false, selectedImageRef: '', projectImageLookup: { 'img-1': { id: 'img-1', filename: 'img.png', metadata: {} } } }}
    tileView={{
      imageEnabled: true,
      annotationOpacityMultiplier: 1,
      measurementLinesByImageId: { 'img-1': [line] },
      boxAnnotationsByImageId: { 'img-1': [box] },
      tileGeometryDragPreview: null,
      tileAnnotationPreview: null,
      selectedAnnotationId: '',
      annotationDrawToolActive,
      deletingOverlayId: '',
      suppressNextTileClickRef: { current: false },
      getBoxWithDerivedDimensions: (value) => value,
      getUnitForImage: () => 'mm',
    }}
    handlers={{}}
  />,
);

describe('tile annotation edit targets', () => {
  test('render move targets for existing shapes when no draw tool is active', () => {
    const { container } = renderTile(false);
    expect(container.querySelectorAll('.inspection-annotation-drag-target')).toHaveLength(2);
  });

  test('drop move targets while a draw tool is active', () => {
    const { container } = renderTile(true);
    expect(container.querySelectorAll('.inspection-annotation-drag-target')).toHaveLength(0);
    expect(container.querySelector('[aria-label="tile measurement overlay"]')).toBeInTheDocument();
  });
});

describe('buildCenterPaneProps annotationDrawToolActive', () => {
  const baseInput = {
    annotationLayers: {},
    annotationDrafts: { tile: {} },
    calibratedGeometry: {},
    imageSortFilter: {},
    tileColumns: {},
  };
  test.each([
    ['measure', true],
    ['box', true],
    ['crop', true],
    ['', false],
    ['segment', false],
  ])('tool mode %p -> %p', (annotationToolMode, expected) => {
    const props = buildCenterPaneProps({ ...baseInput, annotationToolMode });
    expect(props.tileView.annotationDrawToolActive).toBe(expected);
  });
});
