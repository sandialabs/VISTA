function compactDiagnosticValue(value) {
  if (Array.isArray(value)) return value.join(' | ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

export function nodeDiagnosticRows(node) {
  const diagnostics = node?.summary?.fastapi_diagnostics;
  const rows = diagnostics && typeof diagnostics === 'object'
    ? [
      ['Connected', diagnostics.endpoint_connected],
      ['Attempted execution', diagnostics.endpoint_attempted_execution],
      ['Result returned', diagnostics.result_returned],
      ['Overlay ready', diagnostics.result_usable_for_overlay],
      ['HTTP status', diagnostics.http_status],
      ['Poll HTTP status', diagnostics.status_probe_http_status],
      ['Job ID', diagnostics.remote_job_id],
      ['Job status', diagnostics.remote_job_status],
      ['Return code', diagnostics.remote_return_code],
      ['Poll count', diagnostics.remote_poll_count],
      ['Remote log lines', diagnostics.remote_log_count],
      ['Failure stage', diagnostics.failure_stage],
      ['Detail', diagnostics.detail],
      ['Log tail', diagnostics.remote_log_tail],
    ]
    : [
      ['Backend', node?.summary?.backend],
      ['Runtime', node?.summary?.metrics?.runtime],
      ['Fallback reason', node?.summary?.metrics?.fallback_reason],
      ['Detections', node?.summary?.detection_count],
      ['Segments', node?.summary?.instance_count ?? node?.summary?.segment_count],
      ['Classes', node?.summary?.detection_classes],
      ['First detection', Array.isArray(node?.summary?.detections) ? node.summary.detections[0] : null],
    ];
  return rows
    .map(([label, value]) => [label, compactDiagnosticValue(value)])
    .filter(([, value]) => value);
}

export function statusDetailNodes(result) {
  const nodes = Array.isArray(result?.node_results) ? result.node_results : [];
  return nodes.filter((node) => (
    node?.status === 'failed'
    || node?.summary?.runtime_warning
    || Number(node?.summary?.detection_count) > 0
    || Number(node?.summary?.instance_count) > 0
    || Number(node?.summary?.segment_count) > 0
  ));
}

export function remoteJobDetailNodes(remoteJobs) {
  if (!Array.isArray(remoteJobs)) return [];
  return remoteJobs.map((job, index) => ({
    node_id: job.job_id || `remote-job-${index + 1}`,
    method_id: 'remote_fastapi_job',
    status: job.remote_status || 'running',
    message: `Remote FastAPI job ${job.job_id || index + 1} is ${job.remote_status || 'running'}.`,
    summary: {
      fastapi_diagnostics: {
        endpoint_connected: true,
        endpoint_attempted_execution: 'yes',
        result_returned: Boolean(job.remote_status),
        result_usable_for_overlay: Array.isArray(job.uploaded_outputs) && job.uploaded_outputs.length > 0,
        status_probe_http_status: job.status_probe_http_status,
        remote_job_id: job.job_id,
        remote_job_status: job.remote_status,
        remote_return_code: job.return_code,
        remote_log_count: job.log_count,
        remote_log_tail: job.log_tail,
        detail: job.status_probe_error,
      },
    },
  }));
}

export function workflowHasRemoteFastapi(nodes) {
  return nodes.some((node) => node.method_id === 'segmentation.fastapi.remote');
}

function latestFastapiDiagnostics(result) {
  const nodes = Array.isArray(result?.node_results) ? result.node_results : [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const diagnostics = nodes[index]?.summary?.fastapi_diagnostics;
    if (diagnostics && typeof diagnostics === 'object') return diagnostics;
  }
  return null;
}

export function fastapiChecklistItems(status) {
  const diagnostics = latestFastapiDiagnostics(status.result);
  if (!diagnostics) return [];
  const jobStatus = String(diagnostics.remote_job_status || '').toLowerCase();
  const pollCount = Number(diagnostics.remote_poll_count) || 0;
  const logCount = Number(diagnostics.remote_log_count) || 0;
  return [
    {
      label: 'Sent',
      state: diagnostics.endpoint_connected === false ? 'failed' : diagnostics.endpoint_connected ? 'done' : 'pending',
      detail: diagnostics.http_status ? `HTTP ${diagnostics.http_status}` : 'Waiting',
    },
    {
      label: 'Received',
      state: diagnostics.remote_job_id ? 'done' : 'pending',
      detail: diagnostics.remote_job_id ? `Job ${diagnostics.remote_job_id}` : 'Waiting',
    },
    {
      label: 'Responding',
      state: diagnostics.status_probe_error ? 'failed' : (pollCount > 0 || diagnostics.status_probe_http_status ? 'done' : 'pending'),
      detail: diagnostics.status_probe_error || (diagnostics.status_probe_http_status ? `HTTP ${diagnostics.status_probe_http_status}` : 'Waiting'),
    },
    {
      label: 'Processing',
      state: jobStatus === 'failed' || jobStatus === 'timeout' ? 'failed' : jobStatus === 'completed' ? 'done' : 'active',
      detail: jobStatus
        ? `${jobStatus}${pollCount ? `, ${pollCount} poll${pollCount === 1 ? '' : 's'}` : ''}${logCount ? `, ${logCount} log${logCount === 1 ? '' : 's'}` : ''}`
        : 'Waiting',
    },
    {
      label: 'Files',
      state: diagnostics.result_usable_for_overlay ? 'done' : (jobStatus === 'completed' ? 'failed' : 'pending'),
      detail: diagnostics.result_usable_for_overlay ? 'Uploaded' : 'Waiting',
    },
    {
      label: 'Overlay',
      state: status.loading ? 'pending' : diagnostics.result_usable_for_overlay ? 'done' : 'pending',
      detail: status.loading ? 'Waiting' : 'Check Inspection',
    },
  ];
}

export function statusProgressResult(status) {
  if (!status.loading) return status.result;
  if (status.result) return status.result;
  if (!/^VISTA received|^Analyze run/.test(status.message || '')) return null;
  return {
    status: 'running',
    image_count: 0,
    node_results: [{
      node_id: 'vista-request',
      method_id: 'segmentation.fastapi.remote',
      status: 'running',
      summary: {
        fastapi_diagnostics: {
          endpoint_connected: true,
          result_returned: false,
          result_usable_for_overlay: false,
          remote_job_status: 'starting',
        },
      },
    }],
  };
}
