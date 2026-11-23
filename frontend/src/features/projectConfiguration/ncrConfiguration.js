// NCR code lists (failure codes and disposition codes) stored in the project
// configuration under `ncr_configuration`. Limits mirror the backend schema
// (backend/schemas/inspection_workspace.py).

export const NCR_CODE_MAX_LENGTH = 64;
export const NCR_CODE_DESCRIPTION_MAX_LENGTH = 255;
export const NCR_CODE_LIST_MAX_ENTRIES = 500;

export const NCR_CODE_LISTS = Object.freeze([
  {
    key: 'failure_codes',
    label: 'Failure Codes',
    singular: 'failure code',
    description: 'Codes that classify why a part is nonconforming.',
  },
  {
    key: 'disposition_codes',
    label: 'Disposition Codes',
    singular: 'disposition code',
    description: 'Codes that state what should be done with a nonconforming part.',
  },
]);

// Case-insensitive comparison key matching the backend's str.casefold() for
// the common cases (including German sharp s), so client and server agree on
// duplicate codes.
export function foldCode(value) {
  return String(value || '').trim().toLowerCase().replace(/\u00df/g, 'ss')
    .replace(/\u1e9e/g, 'ss');
}

// Code-point length, matching Python's len() used by backend limits.
export function codePointLength(value) {
  return Array.from(String(value || '')).length;
}

function hasControlCharacters(value) {
  return Array.from(String(value || '')).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 32 || codePoint === 127;
  });
}

export const DEFAULT_NCR_CONFIGURATION = Object.freeze({
  failure_codes: [],
  disposition_codes: [],
});

function normalizeNcrCodeEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    code: typeof source.code === 'string' ? source.code : '',
    description: typeof source.description === 'string' ? source.description : '',
  };
}

export function normalizeNcrConfiguration(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return NCR_CODE_LISTS.reduce((acc, { key }) => {
    acc[key] = Array.isArray(source[key]) ? source[key].map(normalizeNcrCodeEntry) : [];
    return acc;
  }, {});
}

export function validateNcrConfiguration(value) {
  const config = normalizeNcrConfiguration(value);
  return NCR_CODE_LISTS.flatMap(({ key, label }) => {
    const entries = config[key];
    const errors = [];
    if (entries.length > NCR_CODE_LIST_MAX_ENTRIES) {
      errors.push(`${label} support at most ${NCR_CODE_LIST_MAX_ENTRIES} entries.`);
    }
    const codes = entries.map((entry) => entry.code.trim());
    if (codes.some((code) => !code)) {
      errors.push(`Each entry in ${label} requires a code.`);
    }
    if (codes.some((code) => codePointLength(code) > NCR_CODE_MAX_LENGTH)) {
      errors.push(`${label} must be ${NCR_CODE_MAX_LENGTH} characters or fewer.`);
    }
    if (entries.some((entry) => codePointLength(entry.description.trim()) > NCR_CODE_DESCRIPTION_MAX_LENGTH)) {
      errors.push(`${label} descriptions must be ${NCR_CODE_DESCRIPTION_MAX_LENGTH} characters or fewer.`);
    }
    if (entries.some((entry) => hasControlCharacters(entry.code) || hasControlCharacters(entry.description))) {
      errors.push(`${label} must not contain control characters.`);
    }
    const folded = codes.filter(Boolean).map(foldCode);
    if (new Set(folded).size !== folded.length) {
      errors.push(`${label} must be unique (case-insensitive).`);
    }
    return errors;
  });
}

// Returns configured codes for a list as `{ code, description }` entries with
// blank codes removed, suitable for populating dropdowns.
export function getConfiguredNcrCodes(projectConfiguration, listKey) {
  const entries = normalizeNcrConfiguration(projectConfiguration?.ncr_configuration)[listKey] || [];
  const seen = new Set();
  return entries
    .map((entry) => ({ code: entry.code.trim(), description: entry.description.trim() }))
    .filter((entry) => {
      // Stored configs can bypass validation (clone, raw metadata writes), so
      // drop blanks and case-insensitive duplicates the server would not accept.
      const key = foldCode(entry.code);
      if (!entry.code || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function formatNcrCodeOption(entry) {
  if (!entry) return '';
  return entry.description ? `${entry.code} - ${entry.description}` : entry.code;
}

export function isValidOptionalNcrConfiguration(value) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return NCR_CODE_LISTS.every(({ key }) => {
    const entries = value[key];
    if (entries === undefined) return true;
    return Array.isArray(entries) && entries.every((entry) => (
      entry
      && typeof entry === 'object'
      && typeof entry.code === 'string'
      && entry.code.trim().length > 0
      && (entry.description === undefined || typeof entry.description === 'string')
    ));
  }) && validateNcrConfiguration(value).length === 0;
}
