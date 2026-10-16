import { metadataKeyFromFilenameEntry } from '../../components/FilenameMetadataExtractor';
import { normalizeConfigurationSection } from './configurationSchema';

export const FILE_NAME_ELEMENT_OPTIONS = [
  { id: 'drawing_number', label: 'Drawing Number', abbreviation: 'D' },
  { id: 'part_number', label: 'Part Number', abbreviation: 'P' },
  { id: 'lot_number', label: 'Lot Number', abbreviation: 'L' },
  { id: 'serial_number', label: 'Serial Number', abbreviation: 'S' },
  { id: 'revision', label: 'Revision', abbreviation: 'R' },
  { id: 'batch', label: 'Batch', abbreviation: 'B' },
  { id: 'sub_batch', label: 'Sub Batch', abbreviation: 'SB' },
  { id: 'timestamp', label: 'Timestamp', abbreviation: 'T' },
  { id: 'operator', label: 'Operator', abbreviation: 'O' },
  { id: 'version', label: 'Image Version', abbreviation: 'v' },
  { id: 'image_identifier', label: 'Image Identifier', abbreviation: 'IMG' },
  { id: 'image_sequence', label: 'Image Sequence', abbreviation: 'I' },
  { id: 'channel', label: 'Channel', abbreviation: 'C' },
  { id: 'wavelength', label: 'Wavelength', abbreviation: 'WL' },
  { id: 'exposure', label: 'Exposure', abbreviation: 'EXP' },
  { id: 'lighting', label: 'Lighting', abbreviation: 'LGT' },
  { id: 'view', label: 'View', abbreviation: 'V' },
  { id: 'side', label: 'Side', abbreviation: 'SIDE' },
  { id: 'modality', label: 'Modality', abbreviation: 'M' },
  { id: 'overlay', label: 'Overlay', abbreviation: 'OV' },
];

export function getFilenameEntryName(entry, fallback) {
  const candidate = (entry?.label || entry?.id || fallback || '').trim();
  return candidate || fallback;
}

export function normalizeFilenameToken(value, fallback) {
  const token = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

export function getFilenameEntryMetadataKey(entry, fallback) {
  return metadataKeyFromFilenameEntry(entry, fallback) || fallback;
}

export function getDisplayTokenForFilenameEntry(entry, fallback, { hierarchy = false } = {}) {
  const prefix = String(entry?.abbreviation || '').trim();
  if (hierarchy) return `${prefix || getFilenameEntryName(entry, fallback)}001`;
  const key = getFilenameEntryMetadataKey(entry, fallback);
  if (key === 'overlay') return prefix ? `${prefix}overlay` : 'overlay';
  if (key === 'version') return `${prefix || 'v'}1`;
  if (!hierarchy && (key === 'view' || key === 'side')) return 'side';
  return normalizeFilenameToken(getFilenameEntryName(entry, fallback), fallback);
}

export function buildExpectedFilenameExample(fileNamingScheme) {
  const normalizedScheme = normalizeConfigurationSection('file_naming_scheme', { file_naming_scheme: fileNamingScheme });
  const hierarchySegments = normalizedScheme.hierarchy_levels.map((level, index) =>
    getDisplayTokenForFilenameEntry(level, `level${index + 1}`, { hierarchy: true })
  );
  const descriptorSegments = normalizedScheme.image_descriptors.map((descriptor, index) =>
    getDisplayTokenForFilenameEntry(descriptor, `descriptor${index + 1}`)
  );
  const delimiter = normalizedScheme.delimiter || '_';
  return [...hierarchySegments, ...descriptorSegments].filter(Boolean).join(delimiter) + '.type';
}

const FILENAME_CONVENTION_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#16a34a',
  '#f97316',
  '#dc2626',
  '#4f46e5',
  '#0f766e',
];

export function getFilenameConventionSegments(fileNamingScheme) {
  const normalizedScheme = normalizeConfigurationSection('file_naming_scheme', { file_naming_scheme: fileNamingScheme });
  const delimiter = normalizedScheme.delimiter || '_';
  const hierarchySegments = normalizedScheme.hierarchy_levels.map((level, index) => {
    return {
      type: 'hierarchy',
      index,
      key: `hierarchy-${index}`,
      label: getFilenameEntryName(level, `Level ${index + 1}`),
      token: getDisplayTokenForFilenameEntry(level, `level${index + 1}`, { hierarchy: true }),
      color: FILENAME_CONVENTION_COLORS[index % FILENAME_CONVENTION_COLORS.length],
    };
  });
  const descriptorSegments = normalizedScheme.image_descriptors.map((descriptor, index) => {
    return {
      type: 'descriptor',
      index,
      key: `descriptor-${index}`,
      label: getFilenameEntryName(descriptor, `Descriptor ${index + 1}`),
      token: getDisplayTokenForFilenameEntry(descriptor, `descriptor${index + 1}`),
      color: FILENAME_CONVENTION_COLORS[(hierarchySegments.length + index) % FILENAME_CONVENTION_COLORS.length],
    };
  });
  return {
    delimiter,
    segments: [...hierarchySegments, ...descriptorSegments],
  };
}
