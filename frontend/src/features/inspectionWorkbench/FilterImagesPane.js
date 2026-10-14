import { isUiSectionEnabled } from '../../utils/uiSections';
import { ALL_PARTS_ID } from './useInspectionPartSelection';
import { INSPECTION_FILTER_IMAGES_COLUMN } from './inspectionConstants';
import { PartSummaryChipRows } from './PartSummaryChipRows';

export function FilterImagesPane({ chipFilters, partRows }) {
  const {
    projectConfiguration,
    collapsedPartIdSet,
    aggregatePartImageRefs,
    aggregateViews,
    selectedBatchId,
    setSelectedBatchId,
    batches,
    filteredParts,
    togglePartCollapsed,
    aggregateModalities,
    aggregateLayerAvailability,
    setSelectedPartId,
  } = partRows;
  const showViewsRow = isUiSectionEnabled(projectConfiguration, 'inspection.part_summary.views_row');
  const showModalitiesRow = isUiSectionEnabled(projectConfiguration, 'inspection.part_summary.modalities_row');
  const showLayersRow = isUiSectionEnabled(projectConfiguration, 'inspection.part_summary.layers_row');
  const isCollapsed = collapsedPartIdSet.has(ALL_PARTS_ID);
  const allImageEntryByViewName = new Map();
  aggregatePartImageRefs.forEach((entry) => {
    const viewName = String(entry?.viewName || '').toLowerCase();
    if (viewName && !entry.overlay && !entry.cropChild && !allImageEntryByViewName.has(viewName)) {
      allImageEntryByViewName.set(viewName, entry);
    }
  });
  const imageEntries = aggregateViews
    .map((viewName) => [viewName, allImageEntryByViewName.get(viewName)])
    .filter(([, entry]) => entry);

  return (
    <section
      className="workbench-tabbed-panel"
      data-layout-region={INSPECTION_FILTER_IMAGES_COLUMN}
    >
      <div className="workspace-panel-layout">
        <div className="workbench-controls workbench-controls-compact">
          <label htmlFor="imageBatchFilter" className="form-label">Batch</label>
          <select
            id="imageBatchFilter"
            className="form-control"
            value={selectedBatchId}
            onChange={(e) => setSelectedBatchId(e.target.value)}
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.name}</option>
            ))}
          </select>
        </div>
        <div className="workbench-list">
          {filteredParts.length === 0 ? (
            <p className="muted">No images found for the current batch filter.</p>
          ) : (
            <article
              className={`workbench-part-row workbench-part-row-all selected ${isCollapsed ? 'collapsed' : ''}`}
            >
              <div>
                <div className="part-summary-row-header">
                  <div className="part-summary-row-title">
                    <div className="group-row-name">All Images</div>
                    <div className="workbench-defect-count">
                      {filteredParts.length} parts • {aggregatePartImageRefs.length} mapped
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm part-collapse-toggle"
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} row`}
                    onClick={() => togglePartCollapsed(ALL_PARTS_ID)}
                  >
                    {isCollapsed ? 'Expand' : 'Collapse'}
                  </button>
                </div>
                <PartSummaryChipRows chipFilters={chipFilters} row={{
                  rowId: ALL_PARTS_ID,
                  label: 'All Images',
                  isSelected: true,
                  collapsed: isCollapsed,
                  imageEntries,
                  imageRefs: aggregatePartImageRefs,
                  modalities: aggregateModalities,
                  layerAvailability: aggregateLayerAvailability,
                  showViewsRow,
                  showModalitiesRow,
                  showLayersRow,
                  onSelect: () => setSelectedPartId(ALL_PARTS_ID),
                }} />
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
