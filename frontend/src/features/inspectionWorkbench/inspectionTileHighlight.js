import { getProjectImageRecord } from './imageLookup';
import { isInspectionItemForImageEntry } from './partImageRefs';

function getEntryOwnImageIds(entry, projectImageLookup) {
  const record = getProjectImageRecord(projectImageLookup, {
    image_id: entry?.imageId,
    filename: entry?.filename || entry?.imageRef,
  });
  return [entry?.imageId, entry?.imageRef, record?.id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getItemImageId(item) {
  if (!item) return '';
  if (item.kind === 'external_overlay') return String(item.source?.resourceId || item.overlay?.imageId || '').trim();
  return String(item.annotation?.image_id || '').trim();
}

// Returns the id of the single tile that should carry the selected inspection
// item highlight, or '' when no visible tile shows the item. Several tiles can
// display the same annotation (every overlay assigned to one base image shares
// that base's annotations), but only one tile is ever highlighted: the
// selected tile when it shows the item, then the tile for the item's exact
// image, then the first matching tile.
export function findHighlightedInspectionTileId(item, entries = [], selectedImageRef = '', projectImageLookup = {}) {
  if (!item) return '';
  const matches = entries.filter((entry) => isInspectionItemForImageEntry(item, entry, projectImageLookup));
  if (matches.length === 0) return '';
  const selectedRef = String(selectedImageRef || '');
  const itemImageId = getItemImageId(item);
  const chosen = (selectedRef && matches.find((entry) => String(entry.imageRef || '') === selectedRef))
    || (itemImageId && matches.find((entry) => getEntryOwnImageIds(entry, projectImageLookup).includes(itemImageId)))
    || matches[0];
  return String(chosen.id || '');
}
