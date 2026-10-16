import { getProjectImageRecord } from './imageLookup';
import { getCropImageTitle, getCropUploadFilename } from './inspectionAnnotationGeometry';
import { canvasToBlob, loadImageElement } from './inspectionUtils';

/**
 * Crop child-image helpers: parent resolution, filename and title, source
 * rectangle math, upload metadata, the part source-image entry, and subtitle
 * patches. Only `renderCropImageBlob` touches the DOM.
 */

export const resolveCropParent = ({ parentImageId, cropBox, title, selectedPart, projectImageLookup }) => {
  const canonicalParentImageId = String(parentImageId).trim();
  const parentImage = getProjectImageRecord(
    projectImageLookup,
    { image_id: canonicalParentImageId },
  ) || {};
  const parentFilename = parentImage.filename || canonicalParentImageId || 'image';
  const parentSourceRecord = (Array.isArray(selectedPart?.metadata?.source_images) ? selectedPart.metadata.source_images : [])
    .find((record) => (
      String(record?.image_id || '').trim() === canonicalParentImageId
    ));
  const parentModality = String(parentImage.modality || parentImage.metadata?.modality || parentSourceRecord?.modality || parentSourceRecord?.metadata?.modality || 'visual').trim().toLowerCase() || 'visual';
  return {
    canonicalParentImageId,
    parentFilename,
    parentModality,
    cropFilename: getCropUploadFilename(cropBox, parentFilename),
    cropTitle: title || getCropImageTitle(cropBox, parentFilename),
  };
};

export const getCropSourceRect = (cropBox, naturalWidth, naturalHeight) => {
  const sourceWidth = cropBox.imageWidth || naturalWidth;
  const sourceHeight = cropBox.imageHeight || naturalHeight;
  const scaleX = naturalWidth / sourceWidth;
  const scaleY = naturalHeight / sourceHeight;
  const sx = Math.max(0, Math.min(naturalWidth - 1, cropBox.x * scaleX));
  const sy = Math.max(0, Math.min(naturalHeight - 1, cropBox.y * scaleY));
  const sw = Math.max(1, Math.min(naturalWidth - sx, cropBox.width * scaleX));
  const sh = Math.max(1, Math.min(naturalHeight - sy, cropBox.height * scaleY));
  return { sx, sy, sw, sh };
};

export const renderCropImageBlob = async (canonicalParentImageId, cropBox) => {
  const sourceImage = await loadImageElement(`/api/images/${encodeURIComponent(canonicalParentImageId)}/content`);
  const naturalWidth = Number(sourceImage.naturalWidth || sourceImage.width || cropBox.imageWidth || 0);
  const naturalHeight = Number(sourceImage.naturalHeight || sourceImage.height || cropBox.imageHeight || 0);
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error('Source image dimensions are unavailable for crop');
  }
  const { sx, sy, sw, sh } = getCropSourceRect(cropBox, naturalWidth, naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare crop canvas');
  context.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, 'image/png');
  return { blob, naturalWidth, naturalHeight };
};

export const buildCropMetadata = ({ parent, cropAnnotationId, cropBox, naturalWidth, naturalHeight, selectedPart }) => ({
  crop_child_image: true,
  parent_image_id: parent.canonicalParentImageId,
  parent_image_filename: parent.parentFilename,
  crop_annotation_id: cropAnnotationId ? String(cropAnnotationId) : '',
  crop_title: parent.cropTitle,
  crop_subtitle: '',
  crop_bbox: {
    x: cropBox.x,
    y: cropBox.y,
    width: cropBox.width,
    height: cropBox.height,
    imageWidth: cropBox.imageWidth || naturalWidth,
    imageHeight: cropBox.imageHeight || naturalHeight,
  },
  part_id: String(selectedPart.id),
  serial_number: selectedPart.serial_number || '',
  modality: parent.parentModality,
  side: 'crop',
});

export const buildCropSourceEntry = ({ createdImage, parent, cropAnnotationId, cropBbox }) => ({
  filename: createdImage.filename || parent.cropFilename,
  image_id: String(createdImage.id || ''),
  side: 'crop',
  modality: parent.parentModality,
  overlay: false,
  crop_child_image: true,
  parent_image_id: parent.canonicalParentImageId,
  parent_image_filename: parent.parentFilename,
  crop_annotation_id: cropAnnotationId ? String(cropAnnotationId) : '',
  crop_title: parent.cropTitle,
  crop_subtitle: '',
  crop_bbox: cropBbox,
});

export const appendCropSourceEntry = (parts, partId, sourceEntry) => parts.map((part) => {
  if (String(part.id) !== String(partId)) return part;
  const existingSourceImages = Array.isArray(part.metadata?.source_images) ? part.metadata.source_images : [];
  const withoutDuplicate = existingSourceImages.filter((record) => String(record?.image_id || record?.filename || '') !== String(sourceEntry.image_id));
  return {
    ...part,
    metadata: {
      ...(part.metadata || {}),
      source_images: [...withoutDuplicate, sourceEntry],
    },
  };
});

export const applyCropSubtitle = (parts, partId, imageKey, subtitle) => parts.map((part) => {
  if (String(part.id) !== String(partId)) return part;
  const sourceImages = Array.isArray(part.metadata?.source_images) ? part.metadata.source_images : [];
  return {
    ...part,
    metadata: {
      ...(part.metadata || {}),
      source_images: sourceImages.map((record) => {
        const recordKey = String(record?.image_id || record?.filename || '');
        return recordKey === imageKey ? { ...record, crop_subtitle: subtitle } : record;
      }),
    },
  };
});
