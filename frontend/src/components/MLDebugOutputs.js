import React, { useEffect, useState } from 'react';

/**
 * MLDebugOutputs
 * Read-only debug view listing existing ML analyses & annotations for an image.
 * No ability to create new analyses from here.
 */
export default function MLDebugOutputs({ imageId }) {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (!imageId) return;
    let ignore = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const resp = await fetch(`/api/images/${imageId}/analyses`);
        if (!resp.ok) throw new Error(`List analyses failed: ${resp.status}`);
        const data = await resp.json();
        if (!ignore) setAnalyses(data.analyses || []);
      } catch (e) {
        if (!ignore) setError(e.message);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [imageId]);

  const toggleExpand = async (id) => {
    // If not expanded, fetch full details (includes annotations)
    if (!expanded[id]) {
      try {
        const resp = await fetch(`/api/analyses/${id}`);
        if (resp.ok) {
          const data = await resp.json();
          setAnalyses(prev => prev.map(a => a.id === id ? data : a));
        }
      } catch (e) {
        // non-fatal
      }
    }
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (!imageId) return null;

  return (
    <div style={{ border: '1px solid var(--border-color)', padding: '0.75rem', borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>ML Outputs (Debug)</h3>
        <button className="btn btn-tiny" onClick={() => {
          // manual refresh
          setLoading(true);
          fetch(`/api/images/${imageId}/analyses`).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => {
            setAnalyses(d.analyses || []);
          }).catch(e => setError(String(e))).finally(() => setLoading(false));
        }}>↻</button>
      </div>
      {error && <div className="alert alert-error" style={{ margin: '0.5rem 0' }}>{error}</div>}
      {loading && <div style={{ fontSize: 12 }}>Loading analyses…</div>}
      {!loading && analyses.length === 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>None.</div>}
      {analyses.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0', maxHeight: 260, overflowY: 'auto' }}>
          {analyses.map(a => {
            const isOpen = !!expanded[a.id];
            return (
              <li key={a.id} style={{ borderBottom: '1px solid #eee', padding: '4px 2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => toggleExpand(a.id)}>
                  <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column' }}>
                    <span><strong>{a.model_name}</strong> <span style={{ opacity: 0.6 }}>v{a.model_version}</span></span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{a.status}{a.error_message ? ` – ${a.error_message}` : ''}</span>
                  </div>
                  <span style={{ fontSize: 12 }}>{isOpen ? '▾' : '▸'}</span>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 4, background: 'var(--bg-alt, #fafafa)', padding: '4px 6px', borderRadius: 4 }}>
                    {(a.annotations || []).length === 0 && <div style={{ fontSize: 11, opacity: 0.7 }}>No annotations.</div>}
                    {(a.annotations || []).map(ann => (
                      <div key={ann.id} style={{ fontSize: 11, padding: '2px 0', borderBottom: '1px dashed #ddd' }}>
                        <div>
                          <code>{ann.annotation_type}</code>{ann.class_name ? `:${ann.class_name}` : ''} {ann.confidence != null && `( ${(ann.confidence*100).toFixed(1)}% )`}
                        </div>
                        {renderAnnotationDataSummary(ann)}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function renderAnnotationDataSummary(ann) {
  const t = (ann.annotation_type || '').toLowerCase();
  if (t === 'detection' && ann.data) {
    const { x_min, y_min, x_max, y_max } = ann.data;
    return <div style={{ fontSize: 11, opacity: 0.8 }}>bbox=({x_min},{y_min})-({x_max},{y_max})</div>;
  }
  if ((t === 'heatmap' || t === 'segmentation') && ann.storage_path) {
    return <div style={{ fontSize: 11, opacity: 0.8 }}>artifact: {ann.storage_path}</div>;
  }
  if (t === 'heatmap' && ann.data) {
    return <div style={{ fontSize: 11, opacity: 0.8 }}>matrix: {ann.data.width}x{ann.data.height}</div>;
  }
  if (t === 'classification' && ann.data?.topk) {
    return <div style={{ fontSize: 11, opacity: 0.8 }}>topk: {ann.data.topk.join(', ')}</div>;
  }
  return null;
}
