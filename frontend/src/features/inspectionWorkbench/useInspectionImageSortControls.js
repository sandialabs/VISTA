import { useCallback, useEffect, useRef, useState } from 'react';

export default function useInspectionImageSortControls({
  activeSelectionId,
  defaultSortId,
  imageOrderSaving,
  imageSortOptions,
  isAllImagesSelection,
  normalizeSortLayers,
  projectId,
  readOnly,
  selectedPart,
  selectedPartId,
  selectedPartImageOrderKeyCount,
  setImageOrderError,
  resetImageOrderProgress,
  tileSizeRangeInputRef,
}) {
  const [imageSortMenuOpen, setImageSortMenuOpen] = useState(false);
  const [imageSortLayers, setImageSortLayers] = useState([defaultSortId]);
  const imageSortButtonRef = useRef(null);
  const imageSortMenuRef = useRef(null);
  const imageOrderFocusRestoreRef = useRef(null);

  // Clear menu and in-flight save progress when the active project or part changes.
  // Owning this here keeps the sort-menu refs and setters in one hook, so the panel
  // no longer needs a dependency on values declared after its effects.
  useEffect(() => {
    imageOrderFocusRestoreRef.current = null;
    setImageSortMenuOpen(false);
    resetImageOrderProgress();
  }, [projectId, selectedPartId, resetImageOrderProgress]);

  const canOpenImageSortMenu = !readOnly
    && (isAllImagesSelection || selectedPart)
    && selectedPartImageOrderKeyCount >= 2;

  const toggleImageSortMenu = useCallback(() => {
    if (!canOpenImageSortMenu) return;
    setImageSortMenuOpen((previous) => !previous);
    setImageOrderError('');
  }, [canOpenImageSortMenu, setImageOrderError]);

  useEffect(() => {
    if (!imageSortMenuOpen) return;
    if (!canOpenImageSortMenu) setImageSortMenuOpen(false);
  }, [canOpenImageSortMenu, imageSortMenuOpen]);

  useEffect(() => {
    if (!imageSortMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (
        imageSortMenuRef.current?.contains(event.target)
        || imageSortButtonRef.current?.contains(event.target)
      ) return;
      setImageSortMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setImageSortMenuOpen(false);
        imageSortButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [imageSortMenuOpen]);

  useEffect(() => {
    if (imageSortMenuOpen) return;
    const focusScope = imageOrderFocusRestoreRef.current;
    if (
      !focusScope
      || focusScope.projectId !== String(projectId)
      || focusScope.partId !== String(activeSelectionId || '')
    ) return;
    if (imageOrderSaving) return;
    imageOrderFocusRestoreRef.current = null;
    if (imageSortButtonRef.current && !imageSortButtonRef.current.disabled) {
      imageSortButtonRef.current.focus();
    } else {
      tileSizeRangeInputRef.current?.focus();
    }
  }, [activeSelectionId, imageOrderSaving, imageSortMenuOpen, projectId, tileSizeRangeInputRef]);

  useEffect(() => {
    setImageSortLayers((previous) => normalizeSortLayers(previous, imageSortOptions, false));
  }, [imageSortOptions, normalizeSortLayers]);

  const updateImageSortLayer = useCallback((index, sortId) => {
    setImageSortLayers((previous) => {
      const next = normalizeSortLayers(previous, imageSortOptions, false);
      next[index] = sortId;
      return normalizeSortLayers(next, imageSortOptions, false);
    });
  }, [imageSortOptions, normalizeSortLayers]);

  const addImageSortLayer = useCallback(() => {
    setImageSortLayers((previous) => {
      const next = normalizeSortLayers(previous, imageSortOptions, false);
      const used = new Set(next);
      const nextOption = imageSortOptions.find((option) => !used.has(option.id)) || imageSortOptions[0];
      return nextOption ? [...next, nextOption.id] : next;
    });
  }, [imageSortOptions, normalizeSortLayers]);

  const removeImageSortLayer = useCallback(() => {
    setImageSortLayers((previous) => {
      const next = normalizeSortLayers(previous, imageSortOptions, false);
      return next.length > 1 ? next.slice(0, -1) : next;
    });
  }, [imageSortOptions, normalizeSortLayers]);

  return {
    imageOrderFocusRestoreRef,
    imageSortButtonRef,
    imageSortLayers,
    imageSortMenuOpen,
    imageSortMenuRef,
    setImageSortLayers,
    setImageSortMenuOpen,
    toggleImageSortMenu,
    updateImageSortLayer,
    addImageSortLayer,
    removeImageSortLayer,
  };
}
