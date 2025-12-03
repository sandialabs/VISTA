import React, { useEffect, useState, useCallback } from 'react';

/**
 * MLAnalysisPanel
 * Phase 3 implementation: Read-only panel for listing ML analyses and annotations.
 * Users cannot trigger analyses - all analyses are created by external systems (cron, ML pipelines).
 */
export default function MLAnalysisPanel({ imageId, onSelect, onAnalysesLoaded, autoSelectLatest = true, onAutoSelectChange }) {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [annLoading, setAnnLoading] = useState(false);

  const fetchAnalyses = useCallback(async () => {
    if (!imageId) return;
    setLoading(true);
    setError(null); // Clear previous errors
    try {
      const resp = await fetch(`/api/images/${imageId}/analyses`);
      if (!resp.ok) throw new Error(`List analyses failed: ${resp.status}`);
      const data = await resp.json();
      const list = data.analyses || [];
      setAnalyses(list);
      if (onAnalysesLoaded) {
        try { onAnalysesLoaded(list.length); } catch (_) { /* noop */ }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [imageId, onAnalysesLoaded]);

  const selectAnalysis = useCallback(async (id) => {
    setSelected(id);
    setAnnLoading(true);
    setAnnotations([]);
    setError(null); // Clear previous errors
    try {
      const resp = await fetch(`/api/analyses/${id}`);
      if (!resp.ok) throw new Error(`Detail fetch failed: ${resp.status}`);
      const data = await resp.json();
      const anns = data.annotations || [];
      setAnnotations(anns);
      if (onSelect) {
        onSelect({ analysis: data, annotations: anns });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setAnnLoading(false);
    }
  }, [onSelect]);

  const exportAnalysis = useCallback(async (id, format = 'json') => {
    setError(null); // Clear previous errors
    try {
      const resp = await fetch(`/api/analyses/${id}/export?format=${format}`);
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);

      const contentDisposition = resp.headers.get('content-disposition');

      // Extract filename from Content-Disposition or generate one
      let filename = `analysis_export_${Date.now()}.${format}`;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${e.message}`);
    }
  }, []);

  // Poll while there are non-terminal analyses
  useEffect(() => {
    const active = analyses.some(a => ['queued','processing'].includes(a.status));
    if (!active) return;
    const t = setInterval(() => {
      fetchAnalyses();
      if (selected) {
        // Refresh annotations for selected analysis if still selected
        selectAnalysis(selected);
      }
    }, 8000); // 8s cadence
    return () => clearInterval(t);
  }, [analyses, fetchAnalyses, selected, selectAnalysis]);

  useEffect(() => { fetchAnalyses(); }, [fetchAnalyses]);

  // Reset selection when imageId changes
  useEffect(() => {
    setSelected(null);
    setAnnotations([]);
  }, [imageId]);

  // Auto-select latest analysis when analyses load and autoSelectLatest is enabled
  useEffect(() => {
    if (autoSelectLatest && analyses.length > 0 && !selected) {
      // Find the most recent completed analysis
      const latestCompleted = analyses.find(a => a.status === 'completed');
      if (latestCompleted) {
        selectAnalysis(latestCompleted.id);
      }
    }
  }, [analyses, autoSelectLatest, selected, selectAnalysis]);

  const hasAnalyses = analyses.length > 0;

  if (!hasAnalyses) {
    // No analyses yet - show nothing (analyses are triggered externally)
    return null;
  }

  return (
    <div className="ml-analysis-panel" style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: '0.75rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>ML Analyses</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {onAutoSelectChange && (
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoSelectLatest}
                onChange={(e) => onAutoSelectChange(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Auto-select
            </label>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted, #666)', fontStyle: 'italic' }}>Read-only</span>
        </div>
      </div>
      {error && <div className="alert alert-error" style={{ margin: '0.5rem 0' }}>{error}</div>}
      {loading ? <div>Loading analyses…</div> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0', maxHeight: 160, overflowY: 'auto' }}>
          {analyses.map(a => (
            <li key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 2px', cursor: 'pointer', background: selected === a.id ? 'var(--bg-accent, #f3f6fa)' : 'transparent' }} onClick={()=>selectAnalysis(a.id)}>
              <span style={{ fontSize: 12, display: 'flex', flexDirection: 'column' }}>
                <span><strong>{a.model_name}</strong> <span style={{ opacity: 0.7 }}>v{a.model_version}</span></span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{a.status}</span>
              </span>
              <StatusBadge status={a.status} />
            </li>
          ))}
        </ul>
      )}
      <hr style={{ margin: '0.5rem 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h4 style={{ margin: 0, fontSize: 13 }}>Annotations</h4>
        {selected && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => exportAnalysis(selected, 'json')}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                background: '#0d6efd',
                color: 'white',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer'
              }}
              title="Export as JSON"
            >
              JSON
            </button>
            <button
              onClick={() => exportAnalysis(selected, 'csv')}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                background: '#198754',
                color: 'white',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer'
              }}
              title="Export as CSV"
            >
              CSV
            </button>
          </div>
        )}
      </div>
      {annLoading ? <div>Loading…</div> : (
        <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 12 }}>
          {annotations.length === 0 && <div style={{ opacity: 0.7 }}>None.</div>}
          {annotations.map(ann => (
            <div key={ann.id} style={{ borderBottom: '1px solid #eee', padding: '2px 0' }}>
              <code>{ann.annotation_type}</code>{ann.class_name ? `: ${ann.class_name}` : ''} {ann.confidence != null && `( ${(ann.confidence*100).toFixed(1)}% )`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const colorMap = {
    queued: '#888',
    processing: '#0d6efd',
    completed: '#198754',
    failed: '#dc3545',
    canceled: '#6c757d'
  };
  const bg = colorMap[status] || '#444';
  return <span style={{ background: bg, color: 'white', borderRadius: 4, padding: '2px 6px', fontSize: 11, textTransform: 'uppercase' }}>{status}</span>;
}
