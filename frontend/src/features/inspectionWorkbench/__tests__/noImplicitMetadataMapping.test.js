// User-supplied image metadata must reach the inspection UI exactly as
// uploaded: no key renaming, no synonym coalescing, no value rewriting, and
// no placeholder values. These tests pin the three examples from the
// "implicit metadata mapping" issue plus the generalized replacements.
import {
  getConfiguredImageDescriptorFilterKeys,
  getDefaultMetadataFilterKeys,
  getImageMetadataFilterOptions,
  getImageRefMetadata,
} from '../imageLookup';
import {
  getModalities,
  getPartImageRefs,
  getPartSummaryModalities,
  getShellImageLayers,
} from '../partImageRefs';
import { getVolumeOverlayStacks } from '../volumeDescriptors';
import { buildPartSummaryChipModel } from '../partSummaryChipModel';

const refsFor = (sourceImages, extraMetadata = {}) => getPartImageRefs({
  id: 'part-1',
  metadata: { source_images: sourceImages, ...extraMetadata },
});

describe('no implicit mapping of user metadata in the inspection UI', () => {
  test('{"modality": "optical"} is not binned into a part-level modalities group', () => {
    const part = {
      id: 'part-1',
      metadata: {
        source_images: [{ filename: 'a.png', image_id: 'a', modality: 'optical' }],
      },
    };
    expect(part.metadata).not.toHaveProperty('modalities');
    // Modality choices come from the images themselves, spelled as uploaded.
    expect(getModalities(part)).toEqual(['optical']);
    // No hardcoded default list (formerly visual/infrared/uv) is invented.
    expect(getModalities({ id: 'empty', metadata: { source_images: [] } })).toEqual([]);
  });

  test('{"side": "B"} stays {"side": "B"} and no "view" key is derived', () => {
    const [entry] = refsFor([{ filename: 'b.png', image_id: 'b', side: 'B' }]);
    const metadata = getImageRefMetadata(entry, {});
    expect(metadata.side).toBe('B');
    expect(metadata).not.toHaveProperty('view');
  });

  test('{"view": 18} stays 18 and is never replaced by "image"', () => {
    const [entry] = refsFor([{ filename: 'c.png', image_id: 'c', view: 18 }]);
    const metadata = getImageRefMetadata(entry, {});
    expect(metadata.view).toBe(18);
    expect(metadata).not.toHaveProperty('side');
    expect(entry).not.toHaveProperty('viewName');
    expect(entry.label).toBe('c.png');
  });

  test('falsy-but-meaningful values are preserved, and missing values stay missing', () => {
    const refs = refsFor([
      { filename: 'zero.png', image_id: 'z', side: 0, modality: 0 },
      { filename: 'none.png', image_id: 'n' },
    ]);
    const zero = getImageRefMetadata(refs[0], {});
    const none = getImageRefMetadata(refs[1], {});
    expect(zero.side).toBe(0);
    expect(zero.modality).toBe(0);
    expect(none).not.toHaveProperty('side');
    expect(none).not.toHaveProperty('modality');
    expect(none).not.toHaveProperty('view');
    // Labels come from the file, never from a placeholder such as "IMAGE 2".
    expect(refs.map((entry) => entry.label)).toEqual(['zero.png', 'none.png']);
  });

  test('arbitrary user keys are filterable exactly like side/modality', () => {
    const refs = refsFor([
      { filename: 'a.png', image_id: 'a', angle: 'Oblique-45', channel: 'R' },
      { filename: 'b.png', image_id: 'b', angle: 'Normal', channel: 'G' },
    ]);
    const options = getImageMetadataFilterOptions(refs, {});
    expect(options.keys).toEqual(expect.arrayContaining(['angle', 'channel']));
    expect(options.keys).not.toContain('image_id');
    const model = buildPartSummaryChipModel({
      imageRefs: refs,
      effectivePrimaryImageFilterKey: 'angle',
      effectiveModalityImageFilterKey: '',
      effectiveSecondaryImageFilterKey: 'layer',
    });
    expect(model.primaryFilterKey).toBe('angle');
    // Values are displayed exactly as supplied (no upper-casing).
    expect(model.primaryFilterValues.map((value) => model.getDisplayValue('angle', value)))
      .toEqual(['Normal', 'Oblique-45']);
  });

  test('alternate key spellings are distinct keys, not synonyms', () => {
    const [entry] = refsFor([{ filename: 'd.png', image_id: 'd', view_name: 'Top', image_modality: 'CT' }]);
    const metadata = getImageRefMetadata(entry, {});
    expect(metadata).toEqual(expect.objectContaining({ view_name: 'Top', image_modality: 'CT' }));
    expect(metadata).not.toHaveProperty('side');
    expect(metadata).not.toHaveProperty('modality');
  });
});

describe('generalized grouping defaults', () => {
  test('default grouping key follows the project filename convention descriptors', () => {
    const projectConfiguration = {
      file_naming_scheme: {
        hierarchy_levels: [{ id: 'serial_number', label: 'Serial', abbreviation: 'S' }],
        image_descriptors: [
          { id: 'other', label: 'Angle', abbreviation: 'A' },
          { id: 'channel', label: 'Channel', abbreviation: 'C' },
        ],
      },
    };
    const configured = getConfiguredImageDescriptorFilterKeys(projectConfiguration);
    expect(configured).toEqual(['angle', 'channel']);
    const refs = refsFor([
      { filename: 'a.png', image_id: 'a', angle: 'x', channel: 'R', station: 1 },
      { filename: 'b.png', image_id: 'b', angle: 'y', channel: 'G', station: 2 },
    ]);
    const defaults = getDefaultMetadataFilterKeys(getImageMetadataFilterOptions(refs, {}), configured);
    expect(defaults.primary).toBe('angle');
    expect(defaults.modality).toBe('');
  });

  test('without a configured descriptor, the first user key is used (never a system key)', () => {
    const refs = refsFor([
      { filename: 'a.png', image_id: 'a', station: 'alpha' },
      { filename: 'b.png', image_id: 'b', station: 'beta' },
    ]);
    const defaults = getDefaultMetadataFilterKeys(getImageMetadataFilterOptions(refs, {}), []);
    expect(defaults.primary).toBe('station');
  });

  test('a disabled filename convention contributes no default keys', () => {
    expect(getConfiguredImageDescriptorFilterKeys({
      file_naming_scheme: { use_filename_convention: false, image_descriptors: [{ id: 'view' }] },
    })).toEqual([]);
  });
});

describe('explicit-only overlay pairing', () => {
  const lookup = {
    base: { id: 'base', filename: 'base.png' },
    ov: { id: 'ov', filename: 'ov.png' },
  };

  test('an overlay with no explicit base reference is not attached to a lone base image', () => {
    const part = {
      id: 'p',
      metadata: {
        source_images: [
          { filename: 'base.png', image_id: 'base', side: 'front', modality: 'ct' },
          { filename: 'ov.png', image_id: 'ov', overlay: true, side: 'front', modality: 'ct' },
        ],
      },
    };
    expect(getVolumeOverlayStacks(part, lookup)).toEqual([]);
  });

  test('an overlay with an explicit base reference is attached', () => {
    const part = {
      id: 'p',
      metadata: {
        source_images: [
          { filename: 'base.png', image_id: 'base' },
          { filename: 'ov.png', image_id: 'ov', overlay: true, overlay_base_image_id: 'base' },
        ],
      },
    };
    expect(getVolumeOverlayStacks(part, lookup).map((stack) => stack.id)).toEqual(['ov']);
  });
});

describe('MPR fallback projection is not chosen by assumed view names', () => {
  test('shell layers follow the part image order, excluding overlays and crops', () => {
    const part = {
      id: 'p',
      metadata: {
        source_images: [
          { filename: 'z.png', image_id: 'z', side: 'Underside' },
          { filename: 'top.png', image_id: 't', side: 'top' },
          { filename: 'mask.png', image_id: 'm', overlay: true, overlay_base_image_id: 'z' },
        ],
      },
    };
    const lookup = {
      z: { id: 'z', filename: 'z.png' },
      t: { id: 't', filename: 'top.png' },
      m: { id: 'm', filename: 'mask.png' },
    };
    expect(getShellImageLayers(part, lookup).map((layer) => layer.id)).toEqual(['z', 't']);
  });
});

describe('part summary modalities', () => {
  test('only modalities present on the part images are listed, in project order', () => {
    const imageRefs = refsFor([
      { filename: 'a.png', image_id: 'a', modality: 'Thermal' },
      { filename: 'b.png', image_id: 'b', modality: 'optical' },
    ]);
    expect(getPartSummaryModalities({}, imageRefs, {
      image_modalities: [{ id: 'optical' }, { id: 'thermal' }, { id: 'uv' }],
    })).toEqual(['optical', 'thermal']);
    expect(getPartSummaryModalities({}, imageRefs, null)).toEqual(['thermal', 'optical']);
    expect(getPartSummaryModalities({}, [], null)).toEqual([]);
  });
});
