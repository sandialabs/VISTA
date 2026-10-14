import { annotationToSegmentationHelperSegment } from './segmentationGeometry';

/**
 * Pure visibility patches for inspection annotation items: local hidden
 * flags for annotations and part source images, and segment lookup.
 */

export const setAnnotationHidden = (annotations, resourceId, hidden) => annotations.map((annotation) => (
  String(annotation.id) === String(resourceId)
    ? { ...annotation, hidden }
    : annotation
));

export const setPartSourceImageHidden = (part, item, hidden) => {
  const sourceImages = Array.isArray(part.metadata?.source_images)
    ? part.metadata.source_images
    : [];
  const resourceImageId = String(item.overlay?.imageId || '').trim();
  const resourceFilename = String(
    item.overlay?.filename
    || (!resourceImageId ? item.overlay?.imageRef : '')
    || (!resourceImageId ? item.source.resourceId : ''),
  ).trim();
  const filenameMatches = resourceImageId
    ? []
    : sourceImages.filter((entry) => (
      String(entry?.filename || '').trim() === resourceFilename
    ));
  return {
    ...part,
    metadata: {
      ...(part.metadata || {}),
      source_images: sourceImages.map((entry) => (
        (
          resourceImageId
            ? String(entry?.image_id || '').trim() === resourceImageId
            : (
              filenameMatches.length === 1
              && String(entry?.filename || '').trim() === resourceFilename
            )
        )
          ? { ...entry, hidden }
          : entry
      )),
    },
  };
};

export const findVisibilitySegment = (segmentationSegments, item) => segmentationSegments.find((candidate) => (
  String(candidate.id) === String(item.source.resourceId)
  || String(candidate.annotationId) === String(item.source.resourceId)
)) || annotationToSegmentationHelperSegment(item.annotation);
