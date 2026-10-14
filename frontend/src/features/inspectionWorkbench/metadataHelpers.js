const NSIPRO_METADATA_PATTERN = /nsi[\s_-]*pro|\.nsipro/i;

function isPlainMetadataObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNsiproMetadataKey(key) {
  return NSIPRO_METADATA_PATTERN.test(String(key || ''));
}

function isNsiproMetadataString(value) {
  return typeof value === 'string' && NSIPRO_METADATA_PATTERN.test(value);
}

function formatMetadataPath(parentPath, key) {
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  return parentPath ? `${parentPath}.${key}` : String(key);
}


export function collectMetadataLeafEntries(value, path = 'metadata') {
  if (Array.isArray(value)) {
    if (!value.length) return [{ path, value }];
    return value.flatMap((entry, index) => collectMetadataLeafEntries(entry, formatMetadataPath(path, index)));
  }
  if (isPlainMetadataObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return [{ path, value }];
    return entries.flatMap(([key, entryValue]) => collectMetadataLeafEntries(entryValue, formatMetadataPath(path, key)));
  }
  return [{ path, value }];
}

function collectNsiproMetadataEntries(value, path = 'metadata', inNsiproContext = false) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectNsiproMetadataEntries(
      entry,
      formatMetadataPath(path, index),
      inNsiproContext
    ));
  }
  if (isPlainMetadataObject(value)) {
    return Object.entries(value).flatMap(([key, entryValue]) => {
      const nextPath = formatMetadataPath(path, key);
      const keyStartsNsiproContext = isNsiproMetadataKey(key);
      const valueIsNsiproReference = isNsiproMetadataString(entryValue);
      const shouldFlattenNsiproObject = keyStartsNsiproContext && (
        isPlainMetadataObject(entryValue) || Array.isArray(entryValue)
      );

      if (shouldFlattenNsiproObject) {
        return collectNsiproMetadataEntries(entryValue, nextPath, true);
      }

      return collectNsiproMetadataEntries(
        entryValue,
        nextPath,
        inNsiproContext || keyStartsNsiproContext || valueIsNsiproReference
      );
    });
  }
  if (inNsiproContext || isNsiproMetadataString(value)) {
    return [{ path, value }];
  }
  return [];
}

function omitNsiproMetadata(value, key = '') {
  if (isNsiproMetadataKey(key) || isNsiproMetadataString(value)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => omitNsiproMetadata(entry))
      .filter((entry) => entry !== undefined);
  }
  if (isPlainMetadataObject(value)) {
    return Object.entries(value).reduce((acc, [entryKey, entryValue]) => {
      const nextValue = omitNsiproMetadata(entryValue, entryKey);
      if (nextValue !== undefined) acc[entryKey] = nextValue;
      return acc;
    }, {});
  }
  return value;
}

export function getPartMetadataBreakout(part) {
  const metadata = isPlainMetadataObject(part?.metadata) ? part.metadata : {};
  return {
    nsiproEntries: collectNsiproMetadataEntries(metadata),
    otherMetadata: omitNsiproMetadata(metadata) || {},
  };
}

export function formatMetadataValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}
