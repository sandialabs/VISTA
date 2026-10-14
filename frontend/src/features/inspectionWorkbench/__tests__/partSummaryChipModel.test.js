import { buildPartSummaryChipModel } from '../partSummaryChipModel';
import {
  DEFAULT_MODALITY_IMAGE_FILTER_KEY,
  DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
  DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
} from '../inspectionConstants';

const baseInput = {
  imageRefs: [],
  modalities: ['CT', 'XR'],
  enabledModalities: ['CT'],
  projectImageLookup: new Map(),
  effectivePrimaryImageFilterKey: DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
  effectiveSecondaryImageFilterKey: DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
  effectiveModalityImageFilterKey: DEFAULT_MODALITY_IMAGE_FILTER_KEY,
  hiddenPrimaryImageFilterValues: ['Top'],
  hiddenModalityImageFilterValues: ['XR'],
  hiddenSecondaryImageFilterValues: ['Heatmap'],
};

describe('buildPartSummaryChipModel', () => {
  test('lowercases enabled modalities and hidden filter values', () => {
    const model = buildPartSummaryChipModel(baseInput);
    expect(model.enabledModalityKeys).toEqual(['ct']);
    expect([...model.hiddenPrimaryValueSet]).toEqual(['top']);
    expect([...model.hiddenModalityValueSet]).toEqual(['xr']);
    expect([...model.hiddenSecondaryValueSet]).toEqual(['heatmap']);
  });

  test('reports no visible view or layer toggles when the row has no images', () => {
    const model = buildPartSummaryChipModel(baseInput);
    expect(model.primaryFilterValues).toEqual([]);
    expect(model.secondaryFilterValues).toEqual([]);
    expect(model.allViewsToggleActive).toBe(false);
    expect(model.allLayersVisible).toBe(false);
    expect(model.allLayersToggleActive).toBe(false);
  });

  test('falls back to no modality filter key when the row has no image metadata', () => {
    const model = buildPartSummaryChipModel(baseInput);
    expect(model.modalityFilterKey).toBe('');
    expect(model.isDefaultModalityFilter).toBe(false);
    expect(model.modalityFilterValues).toEqual([]);
    expect(model.allModalitiesVisible).toBe(false);
    expect(model.allModalitiesToggleActive).toBe(false);
  });
});
