import { InspectionImageTile } from './InspectionImageTile';
import { findHighlightedInspectionTileId } from './inspectionTileHighlight';

export function InspectionViewBoard({ tabKey, readOnly, selection, tileColumns, tileView, handlers }) {
  const {
    visibleSelectedPartImageRefs,
    selectedInspectionItem,
    selectedImageRef,
    projectImageLookup,
  } = selection;
  const highlightedTileId = findHighlightedInspectionTileId(
    selectedInspectionItem,
    visibleSelectedPartImageRefs,
    selectedImageRef,
    projectImageLookup,
  );
  const {
    normalizedTileColumnCount,
  } = tileColumns;
  return (
            <div
              className="view-board"
              data-layout-region="visual_workspace"
              style={{
                '--inspection-tile-columns': normalizedTileColumnCount,
                '--inspection-tile-min-height': `${Math.max(240, Math.round(560 / normalizedTileColumnCount))}px`,
              }}
            >
              {visibleSelectedPartImageRefs.length === 0 && (
                <p className="inspection-image-filter-empty" role="status">
                  No mapped images match the current filters.
                </p>
              )}
              {visibleSelectedPartImageRefs.map((entry) => (
                <InspectionImageTile
                  key={entry.id}
                  entry={entry}
                  tabKey={tabKey}
                  readOnly={readOnly}
                  isHighlighted={highlightedTileId !== '' && String(entry.id) === highlightedTileId}
                  selection={selection}
                  tileView={tileView}
                  handlers={handlers}
                />
              ))}
            </div>
  );
}
