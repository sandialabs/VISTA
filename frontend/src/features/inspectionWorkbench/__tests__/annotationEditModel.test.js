import { buildAnnotationEditModel } from '../annotationEditModel';

const annotation = {
  id: 'ann-1',
  defect_class: 'crack',
  comment: 'Edge crack',
  disposition: 'open',
};

const baseInput = {
  annotationEditDraft: null,
  selectedInspectionOverlayStyleTarget: null,
  inspectionAnnotationItems: [],
  annotations: [annotation],
  selectedAnnotationId: 'ann-1',
  configuredDefectTypes: ['Crack', 'other'],
};

describe('buildAnnotationEditModel', () => {
  test('returns null when no annotation or external overlay is selected', () => {
    expect(buildAnnotationEditModel({ ...baseInput, selectedAnnotationId: 'missing' })).toBeNull();
  });

  test('builds a draft from the selected annotation and normalizes defect types', () => {
    const model = buildAnnotationEditModel(baseInput);
    expect(model.selected).toBe(annotation);
    expect(model.isExternalOverlayConfig).toBe(false);
    expect(model.draft).toEqual(expect.objectContaining({
      defect_class: 'crack',
      comment: 'Edge crack',
      disposition: 'open',
    }));
    expect(model.currentDefectClass).toBe('crack');
    expect(model.editDefectTypes).toEqual(['crack', 'Other']);
  });

  test('prefers an existing draft and keeps its transparency', () => {
    const draft = { defect_class: 'Porosity', comment: '', disposition: 'open', transparency_percent: 40 };
    const model = buildAnnotationEditModel({ ...baseInput, annotationEditDraft: draft });
    expect(model.draft).toBe(draft);
    expect(model.transparencyPercent).toBe(40);
    expect(model.editDefectTypes).toEqual(['Crack', 'Other', 'Porosity']);
  });

  test('treats a source image draft as an external overlay configuration', () => {
    const overlayItem = { kind: 'external_overlay', source: { resource: 'source_image', resourceId: 'img-1' }, overlay: { id: 'img-1' } };
    const model = buildAnnotationEditModel({
      ...baseInput,
      annotations: [],
      inspectionAnnotationItems: [overlayItem],
      annotationEditDraft: { resource: 'source_image', resourceId: 'img-1', defect_class: '' },
    });
    expect(model.selectedItem).toBe(overlayItem);
    expect(model.isExternalOverlayConfig).toBe(true);
    expect(model.editDefectTypes).toEqual(['Crack', 'Other']);
  });
});
