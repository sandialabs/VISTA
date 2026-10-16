import { act, renderHook } from '@testing-library/react';

import useInspectionImageSortControls from '../useInspectionImageSortControls';

const sortOptions = [
  { id: 'filename_asc', label: 'Filename A-Z' },
  { id: 'filename_desc', label: 'Filename Z-A' },
  { id: 'view_asc', label: 'View A-Z' },
];

function normalizeSortLayers(sortLayers, options = sortOptions) {
  const ids = new Set(options.map((option) => option.id));
  const normalized = (Array.isArray(sortLayers) ? sortLayers : [sortLayers])
    .map((sortId) => String(sortId || '').trim())
    .filter((sortId) => ids.has(sortId));
  return normalized.length > 0 ? normalized : ['filename_asc'];
}

// Shared so the identity stays stable across rerenders; an unstable
// resetImageOrderProgress would retrigger the project/part reset effect.
const defaultResetImageOrderProgress = jest.fn();

function buildProps(overrides = {}) {
  return {
    activeSelectionId: 'part-a',
    defaultSortId: 'filename_asc',
    imageOrderSaving: false,
    imageSortOptions: sortOptions,
    isAllImagesSelection: false,
    normalizeSortLayers,
    projectId: 'project-1',
    readOnly: false,
    selectedPart: { id: 'part-a' },
    selectedPartId: 'part-a',
    selectedPartImageOrderKeyCount: 3,
    setImageOrderError: jest.fn(),
    resetImageOrderProgress: defaultResetImageOrderProgress,
    tileSizeRangeInputRef: { current: null },
    ...overrides,
  };
}

describe('useInspectionImageSortControls', () => {
  beforeEach(() => {
    defaultResetImageOrderProgress.mockClear();
  });

  test('opens and closes the sort menu only when sorting is available', () => {
    const blockedProps = buildProps({ readOnly: true });
    const { result, rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: blockedProps,
    });

    act(() => {
      result.current.toggleImageSortMenu();
    });
    expect(result.current.imageSortMenuOpen).toBe(false);
    expect(blockedProps.setImageOrderError).not.toHaveBeenCalled();

    const allowedProps = buildProps();
    rerender(allowedProps);
    act(() => {
      result.current.toggleImageSortMenu();
    });
    expect(result.current.imageSortMenuOpen).toBe(true);
    expect(allowedProps.setImageOrderError).toHaveBeenCalledWith('');
  });

  test('updates, adds, removes, and normalizes sort layers', () => {
    const { result, rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: buildProps(),
    });

    act(() => {
      result.current.updateImageSortLayer(0, 'filename_desc');
    });
    expect(result.current.imageSortLayers).toEqual(['filename_desc']);

    act(() => {
      result.current.addImageSortLayer();
    });
    expect(result.current.imageSortLayers).toEqual(['filename_desc', 'filename_asc']);

    act(() => {
      result.current.removeImageSortLayer();
    });
    expect(result.current.imageSortLayers).toEqual(['filename_desc']);

    rerender(buildProps({ imageSortOptions: [sortOptions[0]] }));
    expect(result.current.imageSortLayers).toEqual(['filename_asc']);
  });

  test('closes an open menu when sorting becomes unavailable', () => {
    const { result, rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: buildProps(),
    });

    act(() => {
      result.current.toggleImageSortMenu();
    });
    expect(result.current.imageSortMenuOpen).toBe(true);

    rerender(buildProps({ selectedPartImageOrderKeyCount: 1 }));

    expect(result.current.imageSortMenuOpen).toBe(false);
  });

  test('restores focus after saving closes the menu', () => {
    const sortButton = document.createElement('button');
    const tileSizeInput = document.createElement('input');
    document.body.append(sortButton, tileSizeInput);
    const tileSizeRangeInputRef = { current: tileSizeInput };
    const { result, rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: buildProps({ imageOrderSaving: true, tileSizeRangeInputRef }),
    });

    act(() => {
      result.current.imageSortButtonRef.current = sortButton;
      result.current.imageOrderFocusRestoreRef.current = { projectId: 'project-1', partId: 'part-a' };
    });

    rerender(buildProps({ imageOrderSaving: false, tileSizeRangeInputRef }));

    expect(document.activeElement).toBe(sortButton);
    sortButton.remove();
    tileSizeInput.remove();
  });

  test('clears menu, focus-restore, and save progress when the part changes', () => {
    const { result, rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: buildProps(),
    });
    expect(defaultResetImageOrderProgress).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.toggleImageSortMenu();
      result.current.imageOrderFocusRestoreRef.current = { projectId: 'project-1', partId: 'part-a' };
    });
    expect(result.current.imageSortMenuOpen).toBe(true);

    rerender(buildProps({ activeSelectionId: 'part-b', selectedPart: { id: 'part-b' }, selectedPartId: 'part-b' }));

    expect(result.current.imageSortMenuOpen).toBe(false);
    expect(result.current.imageOrderFocusRestoreRef.current).toBeNull();
    expect(defaultResetImageOrderProgress).toHaveBeenCalledTimes(2);
  });

  test('clears menu and save progress when the project changes', () => {
    const { result, rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: buildProps(),
    });

    act(() => {
      result.current.toggleImageSortMenu();
    });
    expect(result.current.imageSortMenuOpen).toBe(true);

    rerender(buildProps({ projectId: 'project-2' }));

    expect(result.current.imageSortMenuOpen).toBe(false);
    expect(defaultResetImageOrderProgress).toHaveBeenCalledTimes(2);
  });

  test('does not reset while the same project and part are rendered', () => {
    const { rerender } = renderHook((props) => useInspectionImageSortControls(props), {
      initialProps: buildProps(),
    });
    expect(defaultResetImageOrderProgress).toHaveBeenCalledTimes(1);

    rerender(buildProps({ imageOrderSaving: true }));
    rerender(buildProps({ selectedPartImageOrderKeyCount: 5 }));

    expect(defaultResetImageOrderProgress).toHaveBeenCalledTimes(1);
  });
});
