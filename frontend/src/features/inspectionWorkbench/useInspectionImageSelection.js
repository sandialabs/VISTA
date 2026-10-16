import { useEffect, useState } from 'react';

export function findFallbackInspectionImageRef(imageRefs = []) {
  const firstEntry = imageRefs[0];
  return firstEntry ? String(firstEntry.imageRef || '') : '';
}

export default function useInspectionImageSelection({
  selectedPartImageRefs,
}) {
  const [selectedImageRef, setSelectedImageRef] = useState('');

  useEffect(() => {
    if (selectedPartImageRefs.length === 0) {
      setSelectedImageRef('');
      return;
    }
    const hasCurrentImage = selectedPartImageRefs.some(
      (entry) => String(entry.imageRef || '') === String(selectedImageRef || ''),
    );
    if (!hasCurrentImage) {
      setSelectedImageRef(findFallbackInspectionImageRef(selectedPartImageRefs));
    }
  }, [selectedPartImageRefs, selectedImageRef]);

  return {
    selectedImageRef,
    setSelectedImageRef,
  };
}
