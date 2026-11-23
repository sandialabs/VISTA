import { render, renderHook, screen } from '@testing-library/react';
import useInspectionAnnotationItems from '../useInspectionAnnotationItems';
import { AnnotationsPane } from '../AnnotationsPane';
import { resolveMeasurementCalibration } from '../../../utils/calibration';

const inchCalibration = { pixels_per_mm: 4, pixels_per_inch: 101.6, unit: 'inches' };
const mmCalibration = { pixels_per_mm: 4, pixels_per_inch: 101.6, unit: 'mm' };
const annotations = [
  { id: 'line-1', image_id: 'img-1', defect_class: 'Measurement', geometry: { line: {} }, measurements: { length_mm: 25.4, length_px: 101.6 } },
  { id: 'box-1', image_id: 'img-1', defect_class: 'Porosity', measurements: { width_mm: 12.7, height_mm: 6.35 } },
];

const lookupFor = (projectConfiguration) => (imageId) => resolveMeasurementCalibration(
  {}, { id: imageId }, projectConfiguration, undefined,
);

describe('useInspectionAnnotationItems calibration units', () => {
  test('uses the project calibration unit and updates when it changes', () => {
    const selectedPartImageRefs = [];
    const { result, rerender } = renderHook((props) => useInspectionAnnotationItems(props), {
      initialProps: { annotations, selectedPartImageRefs, getCalibrationForImage: lookupFor({ calibration: inchCalibration }) },
    });
    expect(result.current.map((item) => item.displayName)).toEqual(['1.000"', '0.500" x 0.250"']);

    rerender({ annotations, selectedPartImageRefs, getCalibrationForImage: lookupFor({ calibration: mmCalibration }) });
    expect(result.current.map((item) => item.displayName)).toEqual(['25.40 mm', '12.70 x 6.35 mm']);
  });

  test('defaults to mm when no calibration or lookup is available', () => {
    const { result } = renderHook(() => useInspectionAnnotationItems({ annotations, selectedPartImageRefs: [] }));
    expect(result.current[0].displayName).toBe('25.40 mm');
  });

  test('AnnotationsPane renders inch display names and tooltip', () => {
    const { result } = renderHook(() => useInspectionAnnotationItems({
      annotations, selectedPartImageRefs: [], getCalibrationForImage: lookupFor({ calibration: inchCalibration }),
    }));
    render(
      <AnnotationsPane
        inspectionHierarchy={{}}
        annotationsVisible
        setAnnotationsVisible={() => {}}
        selectedPart={{ id: 'p1' }}
        readOnly
        annotationToolMode={null}
        setTileAnnotationMode={() => {}}
        projectType="PT1"
        openOtherAnnotationModal={() => {}}
        tileCalibrationPromptImageId={null}
        projectImageLookup={{}}
        handleTileCalibrationChange={() => {}}
        annotationsLoading={false}
        inspectionAnnotationItems={result.current}
        selectedInspectionItem={null}
        selectInspectionAnnotationItem={() => {}}
        setInspectionItemVisibility={() => {}}
        croppingAnnotationId={null}
        cropBoxAnnotation={() => {}}
        openInspectionItemConfigModal={() => {}}
        deleteMeasurementAnnotation={() => {}}
      />,
    );
    expect(screen.getByText('1.000"')).toBeInTheDocument();
    expect(screen.getByText('0.500" x 0.250"')).toBeInTheDocument();
    expect(screen.queryByText(/mm$/)).not.toBeInTheDocument();
    expect(screen.getByText('1.000"').closest('li').getAttribute('title')).toContain('1.000"');
  });
});
