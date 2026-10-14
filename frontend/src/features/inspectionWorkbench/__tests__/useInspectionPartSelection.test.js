import { renderHook } from '@testing-library/react';

import useInspectionPartSelection, {
  ALL_PARTS_ID,
  filterInspectionParts,
  getPartRejectAnnotation,
  getPartReviewState,
  hasDroppedMetadataField,
} from '../useInspectionPartSelection';

const parts = [
  {
    id: 'part-b',
    serial_number: 'B-200',
    display_name: 'Bracket',
    batch_id: 'batch-2',
    review_state: 'pass',
    metadata: {
      defects: [{ id: 1 }, { id: 2 }],
      manual_flagged: true,
      dropped_names: ['unexpected'],
    },
  },
  {
    id: 'part-a',
    serial_number: 'A-100',
    display_name: 'Axle',
    batch_id: 'batch-1',
    review_state: 'unreviewed',
    metadata: {
      defect_count: 5,
      annotations: [{ id: 'reject-1', disposition: 'reject_part' }],
    },
  },
  {
    id: 'part-c',
    serial_number: 'C-300',
    display_name: 'Coupler',
    batch_id: 'batch-1',
    review_state: 'reject_pending',
    metadata: {
      defect_count: 1,
      dropped_names: [{ valid: true }],
    },
  },
];

describe('inspection part selection helpers', () => {
  test('detects reject annotations as confirmed review state', () => {
    expect(getPartRejectAnnotation(parts[1])).toEqual({ id: 'reject-1', disposition: 'reject_part' });
    expect(getPartReviewState(parts[1])).toBe('reject_confirmed');
    expect(getPartReviewState(parts[0])).toBe('pass');
  });

  test('filters by batch, review state, search text, and dropped metadata field', () => {
    expect(filterInspectionParts({ parts, selectedBatchId: 'batch-1' }).map((part) => part.id)).toEqual([
      'part-a',
      'part-c',
    ]);
    expect(filterInspectionParts({ parts, reviewFilter: 'manual' }).map((part) => part.id)).toEqual(['part-b']);
    expect(filterInspectionParts({ parts, reviewFilter: 'reject_confirmed' }).map((part) => part.id)).toEqual(['part-a']);
    expect(filterInspectionParts({ parts, partFilter: 'coupler' }).map((part) => part.id)).toEqual(['part-c']);
    expect(filterInspectionParts({ parts, normalizationTriageField: 'dropped_names' }).map((part) => part.id)).toEqual(['part-b']);
    expect(hasDroppedMetadataField(parts[0], 'dropped_names')).toBe(true);
    expect(hasDroppedMetadataField(parts[2], 'dropped_names')).toBe(false);
  });

  test('sorts filtered parts by configured sort modes', () => {
    expect(filterInspectionParts({ parts }).map((part) => part.id)).toEqual([
      'part-a',
      'part-b',
      'part-c',
    ]);
    expect(filterInspectionParts({ parts, sortMode: 'batch_asc' }).map((part) => part.id)).toEqual([
      'part-a',
      'part-c',
      'part-b',
    ]);
    expect(filterInspectionParts({ parts, sortMode: 'defect_desc' }).map((part) => part.id)).toEqual([
      'part-a',
      'part-b',
      'part-c',
    ]);
  });
});

describe('useInspectionPartSelection', () => {
  test('selects the requested real part or falls back to the first filtered part', () => {
    const { result, rerender } = renderHook(
      (props) => useInspectionPartSelection(props),
      {
        initialProps: {
          activeInspectionViewTab: 'view_parts',
          inspectionViewAllImagesTab: 'view_all_images',
          normalizationTriageField: '',
          partFilter: '',
          parts,
          reviewFilter: 'all',
          selectedBatchId: '',
          selectedPartId: 'part-b',
          sortMode: 'part_asc',
        },
      },
    );

    expect(result.current.isAllImagesSelection).toBe(false);
    expect(result.current.selectedPart.id).toBe('part-b');
    expect(result.current.activeSelectionId).toBe('part-b');

    rerender({
      activeInspectionViewTab: 'view_parts',
      inspectionViewAllImagesTab: 'view_all_images',
      normalizationTriageField: '',
      partFilter: '',
      parts,
      reviewFilter: 'all',
      selectedBatchId: '',
      selectedPartId: 'missing-part',
      sortMode: 'part_asc',
    });

    expect(result.current.selectedPart.id).toBe('part-a');
    expect(result.current.activeSelectionId).toBe('part-a');
  });

  test('uses the reserved All parts ID for the frontend-only aggregate view', () => {
    const { result } = renderHook(() => useInspectionPartSelection({
      activeInspectionViewTab: 'view_all_images',
      inspectionViewAllImagesTab: 'view_all_images',
      normalizationTriageField: 'dropped_names',
      partFilter: '',
      parts,
      reviewFilter: 'all',
      selectedBatchId: '',
      selectedPartId: 'part-b',
      sortMode: 'part_asc',
    }));

    expect(result.current.isAllImagesSelection).toBe(true);
    expect(result.current.selectedPart).toBeNull();
    expect(result.current.activeSelectionId).toBe(ALL_PARTS_ID);
    expect(result.current.normalizationTriageMatchCount).toBe(1);
  });
});
