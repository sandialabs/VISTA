import { fireEvent, render, screen, within } from '@testing-library/react';

import { AnnotationsPane } from '../AnnotationsPane';

jest.mock('../../../components/CalibrationManager', () => () => null);

const makeItem = (id, imageId) => ({
  id,
  key: `annotation:${id}`,
  kind: 'annotation',
  label: id,
  displayName: `${id} value`,
  typeLabel: 'Measurement',
  visible: true,
  source: { resource: 'annotation' },
  annotation: { id, image_id: imageId, geometry: {} },
});

const renderPane = (overrides = {}) => render(
  <AnnotationsPane
    inspectionHierarchy={{ rightColumn: 'right' }}
    annotationsVisible
    setAnnotationsVisible={jest.fn()}
    selectedPart={{ serial_number: 'SN-1' }}
    readOnly
    projectType="PT1"
    projectImageLookup={{}}
    annotationsLoading={false}
    inspectionAnnotationItems={[makeItem('front-line', 'img-front'), makeItem('back-line', 'img-back')]}
    selectedImageAnnotationItems={[makeItem('front-line', 'img-front')]}
    selectedInspectionItem={null}
    selectInspectionAnnotationItem={jest.fn()}
    setInspectionItemVisibility={jest.fn()}
    openInspectionItemConfigModal={jest.fn()}
    deleteMeasurementAnnotation={jest.fn()}
    cropBoxAnnotation={jest.fn()}
    {...overrides}
  />,
);

describe('AnnotationsPane list tabs', () => {
  test('defaults to all annotations and switches to the selected image', () => {
    renderPane();
    const allTab = screen.getByRole('tab', { name: 'All (2)' });
    const imageTab = screen.getByRole('tab', { name: 'Selected image (1)' });
    const list = screen.getByTestId('annotation-list');

    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(imageTab).toHaveAttribute('aria-selected', 'false');
    expect(within(list).getByText('front-line value')).toBeInTheDocument();
    expect(within(list).getByText('back-line value')).toBeInTheDocument();

    fireEvent.click(imageTab);
    expect(imageTab).toHaveAttribute('aria-selected', 'true');
    expect(within(list).getByText('front-line value')).toBeInTheDocument();
    expect(within(list).queryByText('back-line value')).not.toBeInTheDocument();

    fireEvent.click(allTab);
    expect(within(list).getByText('back-line value')).toBeInTheDocument();
  });

  test('shows an empty message when the selected image has no annotations', () => {
    renderPane({ selectedImageAnnotationItems: [] });
    fireEvent.click(screen.getByRole('tab', { name: 'Selected image (0)' }));
    expect(screen.getByText('No annotations for the selected image.')).toBeInTheDocument();
  });
});
