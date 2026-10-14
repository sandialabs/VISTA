import { isUiSectionEnabled } from '../../utils/uiSections';
import { getPartReviewState, isRejectPartAnnotation, getPartRejectAnnotation } from './useInspectionPartSelection';
import { getPartImageRefs, isInspectionImageRefLoaded, getPartSummaryModalities } from './partImageRefs';
import { REVIEW_LABELS } from './inspectionConstants';
import { PartSummaryChipRows } from './PartSummaryChipRows';

export function PartSummaryPane({ chipFilters, partRows }) {
  const {
    projectConfiguration,
    collapsedPartIdSet,
    selectedBatchId,
    setSelectedBatchId,
    batches,
    filteredParts,
    togglePartCollapsed,
    setSelectedPartId,
    selectedPart,
    projectImageLookup,
    annotations,
    setInspectionFocusRequest,
    setReviewFilter,
    setPartFilter,
    inspectionHierarchy,
    reviewFilter,
    manualFilterNotice,
    partFilter,
    sortMode,
    setSortMode,
    normalizationTriageField,
    normalizationTriageMatchCount,
  } = partRows;
  const showViewsRow = isUiSectionEnabled(projectConfiguration, 'inspection.part_summary.views_row');
  const showModalitiesRow = isUiSectionEnabled(projectConfiguration, 'inspection.part_summary.modalities_row');
  const showLayersRow = isUiSectionEnabled(projectConfiguration, 'inspection.part_summary.layers_row');
  const renderCollapseButton = (partId, label, collapsed) => (
    <button
      type="button"
      className="btn btn-secondary btn-sm part-collapse-toggle"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} row`}
      onClick={(event) => {
        event.stopPropagation();
        togglePartCollapsed(partId);
      }}
    >
      {collapsed ? 'Expand' : 'Collapse'}
    </button>
  );
  const renderSummaryHeader = ({ partId, label, detail, collapsed }) => (
    <div className="part-summary-row-header">
      <div className="part-summary-row-title">
        <div className="group-row-name">{label}</div>
        {detail && <div className="workbench-defect-count">{detail}</div>}
      </div>
      {renderCollapseButton(partId, label, collapsed)}
    </div>
  );
  const renderRealPartRow = (part) => {
    const state = getPartReviewState(part);
    const partLabel = part.display_name || part.serial_number || part.id;
    const isSelected = String(part.id) === String(selectedPart?.id);
    const isCollapsed = collapsedPartIdSet.has(String(part.id));
    const viewImages = part?.metadata?.view_images || {};
    const partImageRefs = getPartImageRefs(part)
      .filter((entry) => isInspectionImageRefLoaded(entry, projectImageLookup));
    const imageRefByViewName = new Map();
    partImageRefs.forEach((entry) => {
      const viewName = String(entry?.viewName || '').toLowerCase();
      if (viewName && !entry.overlay && !entry.cropChild && !imageRefByViewName.has(viewName)) {
        imageRefByViewName.set(viewName, entry);
      }
    });
    const imageEntries = Object.entries(viewImages)
      .map(([viewName, imageRef]) => [
        viewName,
        imageRefByViewName.get(String(viewName).toLowerCase()) || imageRef,
      ])
      .filter(([viewName, imageRef]) => (
        imageRefByViewName.has(String(viewName).toLowerCase())
        || isInspectionImageRefLoaded({
          imageId: imageRef && typeof imageRef === 'object' ? imageRef.image_id : '',
          imageRef: imageRef && typeof imageRef === 'object'
            ? imageRef.filename
            : String(imageRef || ''),
          filename: imageRef && typeof imageRef === 'object'
            ? imageRef.filename
            : String(imageRef || ''),
          viewName,
        }, projectImageLookup)
      ));
    const partModalities = getPartSummaryModalities(part, partImageRefs, projectConfiguration);
    const rejectAnnotation = isSelected
      ? annotations.find(isRejectPartAnnotation) || getPartRejectAnnotation(part)
      : getPartRejectAnnotation(part);
    const layerAvailability = {
      source: partImageRefs.some((entry) => !entry.overlay && !entry.cropChild),
      overlay: partImageRefs.some((entry) => entry.overlay),
      annotation: Array.isArray(part.metadata?.annotations) && part.metadata.annotations.length > 0,
      crop: partImageRefs.some((entry) => entry.cropChild),
    };
    return (
      <article
        key={part.id}
        className={`workbench-part-row ${isSelected ? 'selected' : ''} ${isCollapsed ? 'collapsed' : ''}`}
        onClick={() => {
          setSelectedPartId(part.id);
          setInspectionFocusRequest(null);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            setSelectedPartId(part.id);
            setInspectionFocusRequest(null);
          }
        }}
      >
        <div>
          {renderSummaryHeader({
            partId: part.id,
            label: partLabel,
            detail: '',
            collapsed: isCollapsed,
          })}
          <PartSummaryChipRows chipFilters={chipFilters} row={{
            rowId: part.id,
            label: partLabel,
            isSelected,
            collapsed: isCollapsed,
            imageEntries,
            imageRefs: partImageRefs,
            modalities: partModalities,
            layerAvailability,
            showViewsRow,
            showModalitiesRow,
            showLayersRow,
            onSelect: () => setSelectedPartId(part.id),
          }} />
          {rejectAnnotation && (
            <button
              type="button"
              className="btn btn-danger btn-sm part-summary-reject-annotation"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedBatchId(part.batch_id || '');
                setReviewFilter(getPartReviewState(part));
                setPartFilter(String(part.id || part.serial_number || part.display_name || ''));
                setSelectedPartId(part.id);
                setInspectionFocusRequest({ partId: part.id, annotationId: rejectAnnotation.id });
              }}
            >
              View Reject Annotation
            </button>
          )}
        </div>
        <span className={`group-status-badge group-status-${state}`} data-testid="part-review-state">
          {REVIEW_LABELS[state] || REVIEW_LABELS.unreviewed}
        </span>
      </article>
    );
  };

  return (
    <section
      className="workbench-tabbed-panel"
      data-layout-region={inspectionHierarchy.leftColumn}
    >
      <div className="workspace-panel-layout">
        <div className="workbench-controls workbench-controls-compact">
          <label htmlFor="batchFilter" className="form-label">Batch</label>
          <select
            id="batchFilter"
            className="form-control"
            value={selectedBatchId}
            onChange={(e) => setSelectedBatchId(e.target.value)}
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.name}</option>
            ))}
          </select>

          <label htmlFor="reviewFilter" className="form-label">Status</label>
          <select
            id="reviewFilter"
            className="form-control"
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="pass">Pass</option>
            <option value="reject_confirmed">Reject</option>
            <option value="manual">Manual</option>
            <option value="none">None</option>
          </select>
          {manualFilterNotice && reviewFilter === 'manual' && (
            <p className="muted">{manualFilterNotice}</p>
          )}

          <label htmlFor="partFilter" className="form-label">Filter</label>
          <input
            id="partFilter"
            className="form-control"
            type="text"
            value={partFilter}
            onChange={(e) => setPartFilter(e.target.value)}
            placeholder="Filter by batch # or part #"
          />

          <label htmlFor="sortMode" className="form-label">Sort</label>
          <select
            id="sortMode"
            className="form-control"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
          >
            <option value="part_asc">Part # (A -> Z)</option>
            <option value="batch_asc">Batch # (A -> Z)</option>
            <option value="status_asc">Inspection status</option>
            <option value="defect_desc">Defect count (high -> low)</option>
          </select>
        </div>
        <div className="workbench-list">
          {filteredParts.length === 0 ? (
            <div>
              <p className="muted">No parts found for the current filters.</p>
              {normalizationTriageField && (
                <p className="muted" data-testid="normalization-triage-empty-guidance">
                  {normalizationTriageMatchCount > 0
                    ? `Triage matches exist for ${normalizationTriageField}, but they are hidden by the active filters.`
                    : `No parts in this project contain mixed ${normalizationTriageField} metadata values.`}
                </p>
              )}
            </div>
          ) : (
            (() => {
              const partsByBatch = filteredParts.reduce((acc, part) => {
                const key = String(part.batch_id || 'No Batch');
                if (!acc.has(key)) acc.set(key, []);
                acc.get(key).push(part);
                return acc;
              }, new Map());
              return (
                <>
                  {Array.from(partsByBatch.entries()).map(([batchKey, batchParts]) => (
                    <div key={batchKey} className="part-summary-batch">
                      {batchParts.map(renderRealPartRow)}
                    </div>
                  ))}
                </>
              );
            })()
          )}
        </div>
      </div>
    </section>
  );
}
