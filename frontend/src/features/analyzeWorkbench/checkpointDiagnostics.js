import { formatFileSizeFixed as formatFileSize } from '../../utils/formatFileSize';

export function formatParameterCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 'Unknown';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(2)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function checkpointLabel(checkpoint) {
  if (!checkpoint) return '';
  const version = checkpoint.model_version ? `, ${checkpoint.model_version}` : '';
  return `${checkpoint.filename} (${checkpoint.model_type || checkpoint.model_family}${version}, ${formatFileSize(checkpoint.size_bytes)})`;
}

export function graphRows(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  return nodes.map((node, index) => ({ ...node, order: index })).sort((left, right) => {
    const leftPath = left.path || left.label || '';
    const rightPath = right.path || right.label || '';
    if (left.depth !== right.depth && (left.parent || right.parent)) return left.order - right.order;
    return left.order - right.order || leftPath.localeCompare(rightPath);
  });
}

function checkpointFamilyCounts(checkpoints) {
  const counts = { yolo: 0, sam: 0, anomalib: 0, other: 0 };
  (Array.isArray(checkpoints) ? checkpoints : []).forEach((checkpoint) => {
    const family = checkpoint?.model_family || 'other';
    counts[family] = (counts[family] || 0) + 1;
  });
  return counts;
}

function compactCheckpointCounts(label, checkpoints) {
  const counts = checkpointFamilyCounts(checkpoints);
  const total = (Array.isArray(checkpoints) ? checkpoints : []).length;
  return `${label} ${total} total, yolo ${counts.yolo || 0}, sam ${counts.sam || 0}, anomalib ${counts.anomalib || 0}, other ${counts.other || 0}`;
}

export function checkpointStatusText(checkpointState, checkpointScope) {
  const state = checkpointState || {};
  const diagnostics = state.projectDiagnostics || state.authorizedDiagnostics || {};
  const callStatus = state.loading ? 'loading' : state.error ? `error: ${state.error}` : state.requested ? 'ok' : 'not called';
  const yoloStatus = defaultCheckpointStatusText(diagnostics, 'yolo', 'YOLO');
  const anomalibStatus = defaultCheckpointStatusText(diagnostics, 'anomalib', 'Anomalib');
  return `Checkpoint status: /analyze/checkpoints ${callStatus}; ${yoloStatus}; ${anomalibStatus}; ${compactCheckpointCounts('project', state.project)}; ${compactCheckpointCounts('authorized', state.authorized)}; active ${checkpointScope}.`;
}

function defaultCheckpointStatusText(diagnostics, key, label) {
  const fileStatus = diagnostics[`default_${key}_file_present`] === true
    ? 'file present'
    : diagnostics[`default_${key}_file_present`] === false
      ? 'file missing'
      : 'file unknown';
  const registrationStatus = diagnostics[`default_${key}_registered`] === true
    ? 'registered'
    : diagnostics[`default_${key}_registered`] === false
      ? 'not registered'
      : 'registration unknown';
  return `default ${label} ${fileStatus}, ${registrationStatus}`;
}
