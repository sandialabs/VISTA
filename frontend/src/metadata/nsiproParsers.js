const DEFAULT_NSIPRO_PARSER_ID = 'default';
const GENERIC_NSIPRO_PARSER_VERSION = '1.0.0';

function parseScalarMetadataValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^null$/i.test(value)) return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch (err) {
    return value.replace(/^['"]|['"]$/g, '');
  }
}

function buildNsiproResult({ parser, parserVersion, metadata, warnings = [], sourceFilename = '' }) {
  return {
    parser,
    parser_id: DEFAULT_NSIPRO_PARSER_ID,
    parser_version: parserVersion,
    metadata,
    warnings,
    source_filename: sourceFilename,
  };
}

export function parseGenericNsiproKeyValueText(text, filename = '') {
  const root = {};
  const warnings = [];
  let currentSection = root;

  String(text || '').split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) return;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      if (!sectionName) return;
      if (!root[sectionName] || typeof root[sectionName] !== 'object') root[sectionName] = {};
      currentSection = root[sectionName];
      return;
    }

    const delimiterIndex = ['=', ':']
      .map((delimiter) => line.indexOf(delimiter))
      .filter((candidateIndex) => candidateIndex > 0)
      .sort((left, right) => left - right)[0];

    if (delimiterIndex === undefined) {
      warnings.push(`Skipped line ${index + 1}: no key/value delimiter found.`);
      return;
    }

    const key = line.slice(0, delimiterIndex).trim();
    if (!key) {
      warnings.push(`Skipped line ${index + 1}: metadata key is empty.`);
      return;
    }

    currentSection[key] = parseScalarMetadataValue(line.slice(delimiterIndex + 1));
  });

  if (Object.keys(root).length === 0) {
    throw new Error('No metadata entries were found in the .nsipro file.');
  }

  return buildNsiproResult({
    parser: 'nsipro-key-value',
    parserVersion: GENERIC_NSIPRO_PARSER_VERSION,
    metadata: root,
    warnings,
    sourceFilename: filename,
  });
}

function parseNsiproJsonText(text, filename = '') {
  return buildNsiproResult({
    parser: 'nsipro-json',
    parserVersion: GENERIC_NSIPRO_PARSER_VERSION,
    metadata: JSON.parse(String(text || '').trim()),
    warnings: [],
    sourceFilename: filename,
  });
}

function parseDefaultNsiproText(text, filename = '') {
  try {
    return parseNsiproJsonText(text, filename);
  } catch (jsonError) {
    return parseGenericNsiproKeyValueText(text, filename);
  }
}

export const NSIPRO_PARSERS = {
  default: {
    id: DEFAULT_NSIPRO_PARSER_ID,
    version: GENERIC_NSIPRO_PARSER_VERSION,
    parse: parseDefaultNsiproText,
  },
  deployment_a: {
    id: 'deployment_a',
    version: GENERIC_NSIPRO_PARSER_VERSION,
    parse: parseDefaultNsiproText,
  },
  deployment_b: {
    id: 'deployment_b',
    version: GENERIC_NSIPRO_PARSER_VERSION,
    parse: parseDefaultNsiproText,
  },
};

export function getConfiguredNsiproParserId(projectConfiguration) {
  const candidates = [
    projectConfiguration?.metadata_parsers?.nsipro?.parser_id,
    projectConfiguration?.nsipro_parser,
    projectConfiguration?.nsipro_parser_id,
    projectConfiguration?.metadata?.nsipro_parser,
    projectConfiguration?.metadata?.nsipro_parser_id,
    projectConfiguration?.metadata_ingest?.nsipro_parser,
    projectConfiguration?.metadata_ingest?.nsipro_parser_id,
    projectConfiguration?.associated_metadata?.nsipro_parser,
    projectConfiguration?.associated_metadata?.nsipro_parser_id,
    projectConfiguration?.associated_metadata?.parser_id,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() || '';
}

function getEnvNsiproParserId() {
  return process.env.REACT_APP_NSIPRO_PARSER || '';
}

function normalizeParserId(parserId) {
  return String(parserId || '').trim() || DEFAULT_NSIPRO_PARSER_ID;
}

export function parseNsiproText(text, filename = '', options = {}) {
  const parserId = normalizeParserId(
    options.parserId
      || getConfiguredNsiproParserId(options.projectConfiguration)
      || getEnvNsiproParserId(),
  );
  const failClosed = Boolean(options.failClosed || options.failOnUnknownParser);
  const parserEntry = NSIPRO_PARSERS[parserId];

  if (!parserEntry) {
    if (failClosed) {
      throw new Error(`Unknown .nsipro parser configured: ${parserId}.`);
    }
    const fallbackResult = NSIPRO_PARSERS[DEFAULT_NSIPRO_PARSER_ID].parse(text, filename, options);
    return {
      ...fallbackResult,
      parser_id: DEFAULT_NSIPRO_PARSER_ID,
      requested_parser_id: parserId,
      warnings: [
        ...fallbackResult.warnings,
        `Unknown .nsipro parser "${parserId}"; used default parser instead.`,
      ],
    };
  }

  const result = parserEntry.parse(text, filename, options);
  return {
    ...result,
    parser_id: parserEntry.id,
  };
}
