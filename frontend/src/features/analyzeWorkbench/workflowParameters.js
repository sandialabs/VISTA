import { clamp } from '../../utils/numbers';

export const CHECKPOINT_METHOD_FAMILIES = {
  'segmentation.yolo.placeholder': 'yolo',
  'segmentation.sam.placeholder': 'sam',
  'segmentation.anomalib.placeholder': 'anomalib',
  'ml.yolov8.detect': 'yolo',
  'ml.yolov8.segment': 'yolo',
  'ml.yolo.ultralytics': 'yolo',
  'ml.sam.segment_anything': 'sam',
};

const DEFAULT_YOLO_CHECKPOINT_FILENAME = 'yolo11n-seg.pt';

const DEFAULT_ANOMALIB_CHECKPOINT_FILENAME = 'patchcore_default.ckpt';

const DEFAULT_CHECKPOINT_FILENAMES = {
  yolo: DEFAULT_YOLO_CHECKPOINT_FILENAME,
  anomalib: DEFAULT_ANOMALIB_CHECKPOINT_FILENAME,
};

const HIDDEN_FASTAPI_PARAMETER_NAMES = new Set([
  'timeout_seconds',
  'job_stall_timeout_seconds',
  'poll_interval_seconds',
]);

const SEGMENTATION_LOCAL_REMOTE_METHOD_IDS = new Set([
  'segmentation.yolo.placeholder',
  'segmentation.sam.placeholder',
  'segmentation.anomalib.placeholder',
  'segmentation.opencv.placeholder',
]);

export function defaultCheckpointIdForMethod(methodId, checkpoints) {
  const family = CHECKPOINT_METHOD_FAMILIES[methodId];
  if (!family || !Array.isArray(checkpoints)) return '';
  const matches = checkpoints.filter((checkpoint) => checkpoint?.model_family === family);
  const defaultFilename = DEFAULT_CHECKPOINT_FILENAMES[family];
  const preferred = matches.find((checkpoint) => isDefaultCheckpoint(checkpoint, family))
    || matches.find((checkpoint) => defaultFilename && checkpoint.filename === defaultFilename)
    || matches[0];
  return preferred?.id || '';
}

function isDefaultCheckpoint(checkpoint, family) {
  const defaultFilename = DEFAULT_CHECKPOINT_FILENAMES[family];
  if (!checkpoint || checkpoint.model_family !== family || checkpoint.filename !== defaultFilename) return false;
  const diagnostics = checkpoint.diagnostics && typeof checkpoint.diagnostics === 'object' ? checkpoint.diagnostics : {};
  return checkpoint.id === 'ots-yolo11n-seg'
    || checkpoint.id === 'ots-anomalib-patchcore-default'
    || checkpoint.uploaded_by_user_id === 'system'
    || Boolean(diagnostics.builtin_checkpoint_path)
    || String(checkpoint.object_storage_key || '').includes('/checkpoints/default/');
}

export function parameterDefaults(method) {
  return visibleMethodParameters(method, {}).reduce((acc, parameter) => {
    acc[parameter.name] = parameter.default;
    return acc;
  }, {});
}

export function parametersWithDefaultCheckpoint(parameters, methodId, checkpoints) {
  if (!CHECKPOINT_METHOD_FAMILIES[methodId] || parameters?.checkpoint_id) return parameters;
  const checkpointId = defaultCheckpointIdForMethod(methodId, checkpoints);
  return checkpointId ? { ...parameters, checkpoint_id: checkpointId } : parameters;
}

export function visibleMethodParameters(method, parameterValues = {}) {
  const parameters = method?.parameters || [];
  if (SEGMENTATION_LOCAL_REMOTE_METHOD_IDS.has(method?.id)) {
    const mode = String(parameterValues.integration_mode ?? parameterDefaultsWithoutVisibility(method).integration_mode ?? 'local');
    return parameters.filter((parameter) => (
      parameter.name !== 'function_path'
      && (parameter.name !== 'fastapi_url' || mode === 'remote' || mode === 'fastapi')
    ));
  }
  if (method?.id !== 'segmentation.fastapi.remote') return parameters.filter((parameter) => parameter.name !== 'function_path');
  return parameters.filter((parameter) => !HIDDEN_FASTAPI_PARAMETER_NAMES.has(parameter.name));
}

function parameterDefaultsWithoutVisibility(method) {
  return (method?.parameters || []).reduce((acc, parameter) => {
    acc[parameter.name] = parameter.default;
    return acc;
  }, {});
}

export function normalizedParameterValue(value, parameter) {
  if (parameter.name === 'integration_mode') {
    const mode = String(value ?? parameter.default ?? 'local').toLowerCase();
    if (mode === 'remote' || mode === 'fastapi') return 'remote';
    return 'local';
  }
  if (parameter.type === 'boolean') return value ?? parameter.default ?? false;
  if (parameter.type === 'integer' || parameter.type === 'float' || parameter.type === 'range') {
    const parsed = value === '' || value === null || value === undefined
      ? NaN
      : Number(value);
    const defaultValue = Number(parameter.default);
    const min = Number(parameter.min_value);
    const max = Number(parameter.max_value);
    const defaultIsValid = Number.isFinite(defaultValue)
      && (!Number.isFinite(min) || defaultValue >= min)
      && (!Number.isFinite(max) || defaultValue <= max);
    if (!Number.isFinite(parsed)) return defaultIsValid ? defaultValue : '';
    if (Number.isFinite(min) && parsed < min) return defaultIsValid ? defaultValue : min;
    if (Number.isFinite(max) && parsed > max) return defaultIsValid ? defaultValue : max;
    return parameter.type === 'integer' ? Math.trunc(parsed) : parsed;
  }
  if (parameter.type === 'json') return value ?? parameter.default ?? {};
  return value ?? parameter.default ?? '';
}

function normalizeNodeParameters(node, method) {
  if (!method) return node.parameters || {};
  const current = { ...parameterDefaults(method), ...(node.parameters || {}) };
  return visibleMethodParameters(method, current).reduce((acc, parameter) => {
    acc[parameter.name] = normalizedParameterValue(current[parameter.name], parameter);
    return acc;
  }, {});
}

export function normalizeWorkflowNodes(nodes, methodById) {
  return nodes.map((node) => ({
    ...node,
    parameters: normalizeNodeParameters(node, methodById.get(node.method_id)),
  }));
}

export function numericParameterStep(parameter) {
  if (parameter?.type === 'integer') return 1;
  if (parameter?.type === 'float' || parameter?.type === 'range') return 0.05;
  return undefined;
}

export function clampParameterValue(value, parameter) {
  const min = Number(parameter?.min_value);
  const max = Number(parameter?.max_value);
  return clamp(value, Number.isFinite(min) ? min : -Infinity, Number.isFinite(max) ? max : Infinity);
}

export function roundParameterValue(value) {
  return Number(value.toFixed(4));
}

export function numericParameterValue(value, parameter) {
  return normalizedParameterValue(value, parameter);
}

export function parseNumericParameterValue(value, parameter) {
  if (value === '') return '';
  const parsed = parameter.type === 'integer'
    ? Number.parseInt(value, 10)
    : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : '';
}

// Fills checkpoint_id on checkpoint-backed nodes that have none; returns the same
// array when nothing changes so callers can skip a state update.
export function nodesWithDefaultCheckpoints(nodes, checkpoints) {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!CHECKPOINT_METHOD_FAMILIES[node.method_id] || node.parameters?.checkpoint_id) return node;
    const checkpointId = defaultCheckpointIdForMethod(node.method_id, checkpoints);
    if (!checkpointId) return node;
    changed = true;
    return { ...node, parameters: { ...(node.parameters || {}), checkpoint_id: checkpointId } };
  });
  return changed ? nextNodes : nodes;
}
