import { getVisibleInspectionImageRefs } from '../visibleImageRefs';

const baseOptions = {
  annotationsVisible: true,
  effectiveModalityImageFilterKey: '',
  effectivePrimaryImageFilterKey: '',
  effectiveSecondaryImageFilterKey: '',
  enabledModalities: ['visual'],
  hiddenModalityImageFilterValues: [],
  hiddenPrimaryImageFilterValues: [],
  hiddenSecondaryImageFilterValues: [],
  projectConfiguration: { image_modalities: [{ id: 'visual' }] },
  projectImageLookup: {},
  projectType: 'PT1',
  renderCategories: ['source', 'crop'],
  selectedPartImageRefs: [],
};

const source = (id, extra = {}) => ({ id, imageId: `${id}-image`, filename: `${id}.png`, modality: 'visual', ...extra });
const ids = (entries) => entries.map((entry) => entry.id);

describe('getVisibleInspectionImageRefs', () => {
  test('filters by render category, hidden flag, and enabled modality', () => {
    const refs = [
      source('front'),
      source('hidden', { hidden: true }),
      source('xray', { modality: 'xray' }),
      source('overlay', { overlay: true }),
      source('crop', { cropChild: true, modality: 'xray' }),
    ];
    expect(ids(getVisibleInspectionImageRefs({ ...baseOptions, selectedPartImageRefs: refs }))).toEqual(['front', 'crop']);
  });

  test('hides entries whose metadata filter value is hidden', () => {
    const refs = [source('front', { metadata: { camera: 'front' } }), source('back', { metadata: { camera: 'back' } })];
    const visible = getVisibleInspectionImageRefs({
      ...baseOptions,
      effectivePrimaryImageFilterKey: 'camera',
      hiddenPrimaryImageFilterValues: ['BACK'],
      selectedPartImageRefs: refs,
    });
    expect(ids(visible)).toEqual(['front']);
  });

  test('suppresses the source image covered by a visible overlay', () => {
    const refs = [
      source('front'),
      source('back'),
      source('front-overlay', { overlay: true, overlayBaseImageId: 'front-image', modality: 'analyze-overlay' }),
      source('back-overlay', { overlay: true, overlayBaseFilename: 'back.png', modality: 'overlay' }),
    ];
    const visible = getVisibleInspectionImageRefs({
      ...baseOptions,
      renderCategories: ['source', 'overlay'],
      selectedPartImageRefs: refs,
    });
    expect(ids(visible)).toEqual(['front-overlay', 'back-overlay']);
  });

  test('keeps PT3 overlays regardless of render categories and hides them with annotations', () => {
    const refs = [source('volume'), source('mask', { overlay: true, overlayBaseImageId: 'volume-image', modality: 'segmentation' })];
    const options = { ...baseOptions, projectType: 'PT3', projectConfiguration: {}, enabledModalities: ['visual', 'segmentation'], selectedPartImageRefs: refs };
    expect(ids(getVisibleInspectionImageRefs(options))).toEqual(['mask']);
    expect(ids(getVisibleInspectionImageRefs({ ...options, annotationsVisible: false }))).toEqual(['volume']);
  });
});
