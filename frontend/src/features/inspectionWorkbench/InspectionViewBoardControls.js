import { clampRange } from './inspectionUtils';

export function InspectionViewBoardControls({ readOnly, tileColumns, imageSort }) {
  const {
    tileSizeRangeInputRef,
    tileColumnMax,
    normalizedTileColumnCount,
    setTileColumnCount,
  } = tileColumns;
  const {
    imageSortButtonRef,
    selectedPartImageOrderKeys,
    imageOrderSaving,
    imageSortMenuOpen,
    toggleImageSortMenu,
    imageSortMenuRef,
    effectiveImageSortLayers,
    updateImageSortLayer,
    imageSortOptions,
    addImageSortLayer,
    removeImageSortLayer,
    saveImageSortOrder,
    imageOrderError,
    imageOrderAnnouncement,
  } = imageSort;
  return (
            <div className="view-board-controls">
              <div className="tile-size-control">
                <label htmlFor="inspection-tile-columns-slider">Tile size</label>
                <input
                  ref={tileSizeRangeInputRef}
                  id="inspection-tile-columns-slider"
                  type="range"
                  aria-label="Inspection tile columns"
                  min="1"
                  max={tileColumnMax}
                  step="1"
                  value={normalizedTileColumnCount}
                  onChange={(event) => setTileColumnCount(Number(event.target.value))}
                />
                <input
                  id="inspection-tile-columns-input"
                  className="tile-size-input"
                  type="number"
                  aria-label="Inspection tile columns value"
                  min="1"
                  max={tileColumnMax}
                  step="1"
                  value={normalizedTileColumnCount}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    setTileColumnCount(Math.round(clampRange(nextValue, 1, tileColumnMax, normalizedTileColumnCount)));
                  }}
                />
                <span>{normalizedTileColumnCount} / {tileColumnMax}</span>
              </div>
              {!readOnly && (
                <div className="inspection-image-order-control">
                  <button
                    ref={imageSortButtonRef}
                    type="button"
                    className="btn btn-secondary inspection-image-order-open"
                    disabled={selectedPartImageOrderKeys.length < 2 || imageOrderSaving}
                    aria-haspopup="dialog"
                    aria-expanded={imageSortMenuOpen}
                    onClick={toggleImageSortMenu}
                  >
                    {imageOrderSaving ? 'Sorting images...' : 'Sort images'}
                  </button>
                  {imageSortMenuOpen && (
                    <div
                      ref={imageSortMenuRef}
                      className="inspection-image-sort-menu"
                      role="dialog"
                      aria-label="Image sorting options"
                    >
                      <div className="inspection-image-sort-layer-list">
                        {effectiveImageSortLayers.map((sortId, index) => (
                          <div className="inspection-image-sort-layer" key={`${index}-${sortId}`}>
                            <label className="sr-only" htmlFor={`inspection-image-sort-layer-${index}`}>
                              {index === 0 ? 'Primary image sort' : `Image sort layer ${index + 1}`}
                            </label>
                            <select
                              id={`inspection-image-sort-layer-${index}`}
                              className="inspection-image-sort-select"
                              value={sortId}
                              disabled={imageOrderSaving}
                              onChange={(event) => updateImageSortLayer(index, event.target.value)}
                            >
                              {imageSortOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                            {index === effectiveImageSortLayers.length - 1 && (
                              <button
                                type="button"
                                className="btn btn-secondary inspection-image-sort-layer-button"
                                aria-label="Add image sort layer"
                                disabled={imageOrderSaving || imageSortOptions.length === 0}
                                onClick={addImageSortLayer}
                              >
                                +
                              </button>
                            )}
                            {index === effectiveImageSortLayers.length - 1 && effectiveImageSortLayers.length > 1 && (
                              <button
                                type="button"
                                className="btn btn-secondary inspection-image-sort-layer-button"
                                aria-label="Remove deepest image sort layer"
                                disabled={imageOrderSaving}
                                onClick={removeImageSortLayer}
                              >
                                -
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary inspection-image-sort-apply"
                        disabled={imageOrderSaving}
                        onClick={() => saveImageSortOrder(effectiveImageSortLayers)}
                      >
                        Apply sort
                      </button>
                    </div>
                  )}
                  {imageOrderError && (
                    <div className="inspection-image-order-error" role="alert">
                      {imageOrderError}
                    </div>
                  )}
                  <span className="inspection-image-order-live" aria-live="polite" aria-atomic="true">
                    {imageOrderAnnouncement}
                  </span>
                </div>
              )}
            </div>
  );
}
