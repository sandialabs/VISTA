import { assignImageToPart, updatePartSourceImage } from '../../api/parts';
import { uploadProjectImage } from '../../api/images';
import { upsertProjectImageRecord } from './imageLookup';
import {
  getAnnotationCropBox,
  getCropImageTitle,
  isBoundingBoxAnnotation,
  isFiniteAnnotationBox,
} from './inspectionAnnotationGeometry';
import {
  appendCropSourceEntry,
  applyCropSubtitle,
  buildCropMetadata,
  buildCropSourceEntry,
  renderCropImageBlob,
  resolveCropParent,
} from './inspectionCropPayloads';

/**
 * Crop child-image creation from a box, cropping an existing bounding-box
 * annotation, and crop subtitle edits. Uses no React hooks.
 */
export function useInspectionCropActions({
  readOnly,
  projectId,
  selectedPart,
  projectImageLookup,
  setProjectImageLookup,
  setParts,
  setError,
  setSelectedImageRef,
  setCroppingAnnotationId,
  ensureEnabledModality,
  getAnnotationSourceImageIdForImage,
}) {
  const uploadCropChildImage = async ({ parent, cropBox, cropAnnotationId }) => {
    const { blob, naturalWidth, naturalHeight } = await renderCropImageBlob(parent.canonicalParentImageId, cropBox);
    const metadata = buildCropMetadata({ parent, cropAnnotationId, cropBox, naturalWidth, naturalHeight, selectedPart });
    const formData = new FormData();
    formData.append('file', blob, parent.cropFilename);
    formData.append('metadata', JSON.stringify(metadata));
    const createdImage = await uploadProjectImage(projectId, formData, { readOnly, errorLabel: 'Failed to upload cropped image' });
    await assignImageToPart(projectId, {
      filename: createdImage.filename || parent.cropFilename,
      image_id: createdImage.id,
      to_part_id: selectedPart.id,
    }, { readOnly, errorLabel: 'Failed to add crop to inspection workbench' });
    return { createdImage, cropBbox: metadata.crop_bbox };
  };

  const createCropChildImage = async ({ parentImageId, cropBox, cropAnnotationId = '', title = '' }) => {
    if (readOnly) return null;
    if (!selectedPart?.id || !parentImageId || !isFiniteAnnotationBox(cropBox)) return null;
    const parent = resolveCropParent({ parentImageId, cropBox, title, selectedPart, projectImageLookup });
    setError(null);
    try {
      const { createdImage, cropBbox } = await uploadCropChildImage({ parent, cropBox, cropAnnotationId });
      const sourceEntry = buildCropSourceEntry({ createdImage, parent, cropAnnotationId, cropBbox });
      setProjectImageLookup((prev) => upsertProjectImageRecord(prev, createdImage));
      setParts((prev) => appendCropSourceEntry(prev, selectedPart.id, sourceEntry));
      ensureEnabledModality(parent.parentModality);
      setSelectedImageRef(sourceEntry.image_id || sourceEntry.filename);
      return sourceEntry;
    } catch (err) {
      setError(err.message || 'Failed to create crop child image');
      return null;
    }
  };

  const cropBoxAnnotation = async (annotation) => {
    if (readOnly) return;
    if (!selectedPart?.id || !annotation?.id || !isBoundingBoxAnnotation(annotation)) return;
    const cropBox = getAnnotationCropBox(annotation);
    if (!cropBox) return;
    const annotationImageId = getAnnotationSourceImageIdForImage(annotation.image_id || annotation.imageId || annotation?.geometry?.image_id);
    if (!annotationImageId) throw new Error('Annotation source image is unavailable for crop');
    setCroppingAnnotationId(annotation.id);
    try {
      await createCropChildImage({
        parentImageId: annotationImageId,
        cropBox,
        cropAnnotationId: annotation.id,
        title: getCropImageTitle(annotation, (projectImageLookup[annotationImageId] || {}).filename || annotationImageId || 'image'),
      });
    } finally {
      setCroppingAnnotationId(null);
    }
  };

  const updateCropChildSubtitle = async (entry, subtitle) => {
    if (readOnly) return;
    if (!selectedPart?.id || !entry?.cropChild) return;
    const imageKey = String(entry.imageId || entry.imageRef || entry.filename || '');
    setParts((prev) => applyCropSubtitle(prev, selectedPart.id, imageKey, subtitle));
    try {
      await updatePartSourceImage(
        projectId,
        selectedPart.id,
        imageKey,
        { crop_subtitle: subtitle },
        { readOnly, errorLabel: 'Failed to save crop subtitle' },
      );
    } catch (err) {
      setError(err.message || 'Failed to save crop subtitle');
    }
  };

  return {
    createCropChildImage,
    cropBoxAnnotation,
    updateCropChildSubtitle,
  };
}
