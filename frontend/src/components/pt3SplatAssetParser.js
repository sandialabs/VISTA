// Pure parsing logic for PT3 Gaussian splat assets. Shared by the splat asset
// worker (pt3SplatAsset.worker.js) and unit tests; must stay free of DOM and
// React dependencies so it can run inside a dedicated worker.

export const REAL_3DGS_CONTRACT_VERSION = 'pt3_real_3dgs/v1';

const SH_C0 = 0.28209479177387814;

const STRIPPED_CANONICAL_METADATA_KEYS = [
  'means',
  'scales',
  'rotations',
  'opacities',
  'sh_coefficients',
  'covariances',
  'scalar_values',
  'group_sizes',
  'segment_ids',
];

export function parsePly(text) {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((line) => line.trim() === 'end_header');
  const countLine = lines.find((line) => line.startsWith('element vertex '));
  const count = Number((countLine || '').split(/\s+/).pop() || 0);
  const vertexLine = lines.findIndex((line) => line.startsWith('element vertex '));
  const properties = lines
    .slice(vertexLine + 1, end)
    .filter((line) => line.trim().startsWith('property '))
    .map((line) => line.trim().split(/\s+/).pop());
  const propertyIndex = (name, fallback) => {
    const found = properties.indexOf(name);
    return found >= 0 ? found : fallback;
  };
  const segmentIndex = ['segment_id', 'segmentId', 'label_id', 'label']
    .reduce((found, name) => (found >= 0 ? found : properties.indexOf(name)), -1);
  const positions = [];
  const scales = [];
  const colors = [];
  const segmentIds = [];
  for (let index = end + 1; index < lines.length && positions.length / 3 < count; index += 1) {
    const values = lines[index].trim().split(/\s+/).map(Number);
    if (values.length >= 8 && values.slice(0, 8).every(Number.isFinite)) {
      positions.push(values[propertyIndex('x', 0)], values[propertyIndex('y', 1)], values[propertyIndex('z', 2)]);
      scales.push(values[propertyIndex('scale', 3)]);
      colors.push(
        values[propertyIndex('red', 5)] / 255,
        values[propertyIndex('green', 6)] / 255,
        values[propertyIndex('blue', 7)] / 255,
        Math.max(0, Math.min(1, values[propertyIndex('opacity', 4)])),
      );
      segmentIds.push(segmentIndex >= 0 ? values[segmentIndex] : null);
    }
  }
  return {
    positions: new Float32Array(positions),
    scales: new Float32Array(scales),
    colors: new Float32Array(colors),
    segmentIds,
    layers: [{ id: 'baked', label: 'Baked splats', count: positions.length / 3, visible: true, opacity: 1 }],
  };
}

function parseCanonicalJson(payload) {
  const count = payload.means.length;
  const shDegree = Math.max(0, Math.min(4, Number(payload.sh_degree) || 0));
  const shValuesPerSplat = 3 * (shDegree + 1) * (shDegree + 1);
  const positions = new Float32Array(count * 3);
  const scaleVectors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 4);
  const shCoefficients = new Float32Array(count * shValuesPerSplat);
  for (let index = 0; index < count; index += 1) {
    positions.set(payload.means[index], index * 3);
    scaleVectors.set(payload.scales[index], index * 3);
    scales[index] = Math.max(...payload.scales[index]);
    rotations.set(payload.rotations[index], index * 4);
    shCoefficients.set(payload.sh_coefficients[index], index * shValuesPerSplat);
    const shOffset = index * shValuesPerSplat;
    colors.set([
      Math.max(0, Math.min(1, 0.5 + SH_C0 * shCoefficients[shOffset])),
      Math.max(0, Math.min(1, 0.5 + SH_C0 * shCoefficients[shOffset + 1])),
      Math.max(0, Math.min(1, 0.5 + SH_C0 * shCoefficients[shOffset + 2])),
      payload.opacities[index],
    ], index * 4);
  }
  const metadata = { ...payload, splat_count: count };
  STRIPPED_CANONICAL_METADATA_KEYS.forEach((key) => delete metadata[key]);
  return {
    positions,
    scales,
    scaleVectors,
    rotations,
    colors,
    shCoefficients,
    shDegree,
    shValuesPerSplat,
    segmentIds: Array.isArray(payload.segment_ids) ? payload.segment_ids : new Array(count).fill(null),
    layers: [{ id: 'canonical', label: 'Canonical Gaussians', count, visible: true, opacity: 1 }],
    metadata,
  };
}

function parseLegacyJson(payload) {
  const splats = Array.isArray(payload.splats) ? payload.splats : [];
  const positions = new Float32Array(splats.length * 3);
  const scales = new Float32Array(splats.length);
  const colors = new Float32Array(splats.length * 4);
  const segmentIds = new Array(splats.length);
  const layerCounts = new Map();
  splats.forEach((splat, index) => {
    positions.set([Number(splat.x) || 0, Number(splat.y) || 0, Number(splat.z) || 0], index * 3);
    scales[index] = Number.isFinite(Number(splat.scale)) ? Number(splat.scale) : 1;
    colors.set([
      (Number(splat.red) || 0) / 255,
      (Number(splat.green) || 0) / 255,
      (Number(splat.blue) || 0) / 255,
      Number(splat.opacity) || 0.5,
    ], index * 4);
    segmentIds[index] = splat.segment_id ?? splat.segmentId ?? null;
    const intensity = Number(splat.intensity);
    const layer = String(splat.layer || (intensity > 180 ? 'surface' : intensity < 80 ? 'void' : 'core'));
    layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
  });
  return {
    positions,
    scales,
    colors,
    segmentIds,
    layers: [...layerCounts].map(([id, count]) => ({ id, label: id, count, visible: true, opacity: 1 })),
    metadata: payload.metadata || {},
  };
}

export function parseJson(text) {
  const payload = JSON.parse(text);
  if (payload.contract_version === REAL_3DGS_CONTRACT_VERSION && payload.representation === 'real_3dgs') {
    return parseCanonicalJson(payload);
  }
  return parseLegacyJson(payload);
}

// Parses fetched asset text into typed arrays. Throws when a canonical asset
// is required but the text is not canonical v1 JSON.
export function parseSplatAssetText(text, { requireCanonical = false } = {}) {
  const isJson = text.trim().startsWith('{');
  if (requireCanonical && !isJson) throw new Error('Real 3DGS requires canonical JSON');
  const parsed = isJson ? parseJson(text) : parsePly(text);
  if (requireCanonical && parsed.metadata?.contract_version !== REAL_3DGS_CONTRACT_VERSION) {
    throw new Error('Real 3DGS asset is not canonical v1 JSON');
  }
  return parsed;
}

export function collectTransferables(parsed) {
  return [
    parsed.positions.buffer,
    parsed.scales.buffer,
    parsed.colors.buffer,
    ...(parsed.scaleVectors ? [parsed.scaleVectors.buffer, parsed.rotations.buffer] : []),
    ...(parsed.shCoefficients ? [parsed.shCoefficients.buffer] : []),
  ];
}

// Message handler body for the worker: fetches the asset, parses it, and posts
// the result (or an error) back with transferable buffers.
export async function handleSplatAssetMessage(data, { fetchImpl, postMessage }) {
  const { id, url, requireCanonical } = data || {};
  try {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    const parsed = parseSplatAssetText(text, { requireCanonical });
    postMessage({ id, ok: true, ...parsed }, collectTransferables(parsed));
  } catch (error) {
    postMessage({ id, ok: false, error: error.message || 'Failed to parse splat asset' });
  }
}
