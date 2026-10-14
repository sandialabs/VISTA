import { imageIdFor } from './workflowSerialization';

export const SUPPORTED_ANALYZE_SOURCE_EXTENSIONS = new Set([
  '.bmp', '.gif', '.inspiro', '.jpeg', '.jpg', '.npy', '.npz', '.png', '.tif', '.tiff', '.webp',
]);

export function analyzeSourceExtension(image) {
  const match = /\.[^.]+$/.exec(String(image?.filename || '').toLowerCase());
  return match ? match[0] : '';
}

export function isSupportedAnalyzeSourceImage(image) {
  return SUPPORTED_ANALYZE_SOURCE_EXTENSIONS.has(analyzeSourceExtension(image));
}

export function sanitizeAnalyzeInputSource(inputSource) {
  if (!inputSource || !Array.isArray(inputSource.images)) return inputSource;
  const images = inputSource.images.filter(isSupportedAnalyzeSourceImage);
  const imageCountByPart = images.reduce((counts, image) => {
    const partId = String(image.part_id || '');
    if (!partId) return counts;
    counts.set(partId, (counts.get(partId) || 0) + 1);
    return counts;
  }, new Map());
  const parts = Array.isArray(inputSource.parts)
    ? inputSource.parts.map((part) => ({
      ...part,
      image_count: imageCountByPart.get(String(part.part_id || part.id || '')) || 0,
    }))
    : inputSource.parts;
  return {
    ...inputSource,
    source: inputSource.source ? { ...inputSource.source, image_count: images.length } : inputSource.source,
    images,
    parts,
  };
}

export function imageLabel(image) {
  const filename = image?.filename || 'Image';
  const side = image?.side ? ` / ${image.side}` : '';
  const slice = image?.slice_index !== null && image?.slice_index !== undefined ? ` / slice ${image.slice_index}` : '';
  return `${filename}${side}${slice}`;
}

export function partIdFor(part) {
  return part?.part_id || part?.id || '';
}

export function partLabel(part) {
  return part?.display_name || part?.serial_number || 'Part';
}

export function imageIdsForPart(inputSource, partId) {
  return (inputSource?.images || [])
    .filter((image) => String(image.part_id || '') === String(partId))
    .map(imageIdFor)
    .filter(Boolean);
}
