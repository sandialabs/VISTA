import React from 'react';

function ProjectDataSummaryTab({ counts, loading }) {
  return (
    <section className="workbench-panel project-data-summary-panel" aria-label="Project data summary">
      {loading ? (
        <div className="loading-text">Loading data counts…</div>
      ) : (
        <div className="workbench-summary-grid" data-testid="project-data-summary">
          <article className="summary-card">
            <h3>Parts Loaded</h3>
            <p>{counts.partsLoaded}</p>
          </article>
          <article className="summary-card">
            <h3>Raw Images</h3>
            <p>{counts.rawImages}</p>
          </article>
          <article className="summary-card">
            <h3>Image Metadata</h3>
            <p>{counts.imageMetadata}</p>
          </article>
          <article className="summary-card">
            <h3>Overlay Images</h3>
            <p>{counts.overlayImages}</p>
          </article>
          <article className="summary-card">
            <h3>Annotations</h3>
            <p>{counts.annotations}</p>
          </article>
        </div>
      )}
    </section>
  );
}

export default ProjectDataSummaryTab;
