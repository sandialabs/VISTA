import { isFiniteAnnotationBox, isFiniteMeasurementLine } from './inspectionAnnotationGeometry';
import { getExternalOverlayOpacity } from './inspectionAnnotationDisplay';
import { getProjectImageRecord, getInspectionTileFilename, getImageMetadataOverlayLines } from './imageLookup';
import { safeDecodeFilename, stopMiddleMouseDefault } from './inspectionUtils';
import { getAnnotationSourceImageId, isInspectionItemForImageEntry } from './partImageRefs';
import { renderAnnotationOverlay, renderTileAnnotationEditingTargets } from './annotationOverlayRendering';

export function InspectionImageTile({ entry, tabKey, readOnly, selection, tileView, handlers }) {
  const {
    isAllImagesSelection,
    selectedImageRef,
    selectedInspectionItem,
    projectImageLookup,
  } = selection;
  const {
    imageEnabled,
    normalizedInspectorViewport,
    tileViewportStyle,
    annotationOpacityMultiplier,
    measurementLinesByImageId,
    boxAnnotationsByImageId,
    tileGeometryDragPreview,
    tileAnnotationPreview,
    selectedAnnotationId,
    deletingOverlayId,
    suppressNextTileClickRef,
    getBoxWithDerivedDimensions,
    getUnitForImage,
  } = tileView;
  const {
    setSelectedImageRef,
    updateCropChildSubtitle,
    deleteAnalyzeOverlay,
    handleTileBoxPointerDown,
    handleTileAnnotationPointerMove,
    handleTileBoxPointerUp,
    finishTileViewportPan,
    handleTileBoxPointerCancel,
    handleTileImageWheel,
    handleTileAnnotationPointerDown,
    setFullscreenImageModal,
    startTileAnnotationGeometryDrag,
    handleTileAnnotationGeometryDragMove,
    finishTileAnnotationGeometryDrag,
  } = handlers;
                const viewName = entry.viewName || 'image';
                const imageRef = String(entry.imageRef || '');
                const isSelectedTileImage = String(selectedImageRef || '') === imageRef;
                const tileViewportAttributes = isSelectedTileImage
                  ? {
                    'data-viewport-zoom': normalizedInspectorViewport.zoom,
                    'data-viewport-pan-x': normalizedInspectorViewport.panX,
                    'data-viewport-pan-y': normalizedInspectorViewport.panY,
                    style: tileViewportStyle,
                  }
                  : {
                    'data-viewport-zoom': 1,
                    'data-viewport-pan-x': 0,
                    'data-viewport-pan-y': 0,
                  };
                const imageRecord = getProjectImageRecord(projectImageLookup, {
                  image_id: entry.imageId,
                  filename: entry.filename || imageRef,
                });
                const imageId = imageRecord?.id ? String(imageRecord.id) : '';
                const baseRecord = entry.overlay
                  ? getProjectImageRecord(projectImageLookup, {
                    image_id: entry.overlayBaseImageId,
                    filename: entry.overlayBaseFilename,
                  })
                  : null;
                const baseImageId = baseRecord?.id ? String(baseRecord.id) : '';
                const imageDisplayName = getInspectionTileFilename(entry, projectImageLookup);
                const metadataOverlayLines = tabKey === 'image_metadata'
                  ? getImageMetadataOverlayLines(entry, projectImageLookup)
                  : [];
                const annotationSourceImageId = getAnnotationSourceImageId(entry, projectImageLookup);
                const tileAnnotationSourceImageId = String(annotationSourceImageId || imageId);
	                const tileMeasurementLines = (measurementLinesByImageId[tileAnnotationSourceImageId] || [])
	                  .filter(isFiniteMeasurementLine)
                      .map((line) => (
                        tileGeometryDragPreview?.kind === 'line'
                        && String(tileGeometryDragPreview.imageId || '') === tileAnnotationSourceImageId
                        && String(tileGeometryDragPreview.geometry?.id || '') === String(line.id || '')
                          ? tileGeometryDragPreview.geometry
                          : line
                      ));
		                const tileBoxes = (boxAnnotationsByImageId[tileAnnotationSourceImageId] || [])
		                  .filter(isFiniteAnnotationBox)
		                  .map((box) => (
                        tileGeometryDragPreview?.kind === 'box'
                        && String(tileGeometryDragPreview.imageId || '') === tileAnnotationSourceImageId
                        && String(tileGeometryDragPreview.geometry?.id || '') === String(box.id || '')
                          ? tileGeometryDragPreview.geometry
                          : box
                      ))
		                  .map((box) => getBoxWithDerivedDimensions(box, tileAnnotationSourceImageId));
	                const tilePreviewLines = tileAnnotationPreview?.mode === 'measure' && tileAnnotationPreview.imageId === tileAnnotationSourceImageId
	                  ? [tileAnnotationPreview.line].filter(isFiniteMeasurementLine)
	                  : [];
	                const tilePreviewBoxes = ['box', 'crop'].includes(tileAnnotationPreview?.mode) && tileAnnotationPreview.imageId === tileAnnotationSourceImageId
		                  ? [tileAnnotationPreview.box].filter(isFiniteAnnotationBox).map((box) => getBoxWithDerivedDimensions(box, tileAnnotationSourceImageId))
		                  : [];
                const tileAnnotationUnit = getUnitForImage(tileAnnotationSourceImageId);
                const tileOverlayGeometry = [...tileMeasurementLines, ...tileBoxes, ...tilePreviewLines, ...tilePreviewBoxes][0];
                const tileOverlayWidth = Math.max(1, Number(tileOverlayGeometry?.imageWidth) || 1000);
                const tileOverlayHeight = Math.max(1, Number(tileOverlayGeometry?.imageHeight) || 1000);
                const isSelectedInspectionTile = isInspectionItemForImageEntry(selectedInspectionItem, entry, projectImageLookup);
                const tileOverlayOpacity = Math.min(1, annotationOpacityMultiplier * getExternalOverlayOpacity(entry, 1));
                const metadataImageOpacity = tabKey === 'image_metadata' ? 0.5 : 1;
                return (
                  <div
                    key={entry.id}
                    className={`view-cell ${isSelectedTileImage ? 'selected' : ''} ${isSelectedInspectionTile ? 'inspection-item-highlighted' : ''} ${tabKey === 'image_metadata' ? 'inspection-tile-metadata-mode' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedImageRef(imageRef);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedImageRef(imageRef);
                      }
                    }}
                  >
                    <div className={`view-cell-title ${entry.cropChild ? 'view-cell-title-crop-child' : ''}`}>
                      <div className="view-cell-title-text">
                        <span aria-label={`Filename ${safeDecodeFilename(imageDisplayName)}`}>
                          {safeDecodeFilename(imageDisplayName)}
                        </span>
                        {entry.aggregatePartLabel && (
                          <small className="inspection-image-part-label">
                            {entry.aggregatePartLabel}
                          </small>
                        )}
                        {entry.overlay && entry.overlaySourceLabel && (
                          <small className="inspection-image-overlay-kind">
                            {entry.overlaySourceLabel}
                          </small>
                        )}
                        {entry.cropChild && (
                          <input
                            type="text"
                            className="view-cell-subtitle-input"
                            aria-label={`Subtitle for ${entry.label || 'crop child image'}`}
                            placeholder="Add subtitle (e.g. Feature 1)"
                            value={entry.cropSubtitle || ''}
                            disabled={readOnly}
                            readOnly={readOnly}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onChange={(event) => updateCropChildSubtitle(entry, event.target.value)}
                          />
                        )}
                      </div>
                      {!readOnly && !isAllImagesSelection && entry.overlay && entry.imageId && (
                        <button
                          type="button"
                          className="inspection-overlay-delete"
                          aria-label={`Delete overlay ${entry.label || viewName}`}
                          disabled={deletingOverlayId === String(entry.imageId)}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteAnalyzeOverlay(entry);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="view-cell-body">
                      {!imageEnabled ? (
                        <span className="view-cell-empty">Image hidden</span>
                      ) : entry.overlay && imageId && baseImageId ? (
                        <div
                          className="inspection-overlay-composite inspection-image-annotation-surface"
	                          data-testid="inspection-overlay-composite"
	                          {...tileViewportAttributes}
	                          onPointerDown={(event) => handleTileBoxPointerDown(event, imageId)}
	                          onPointerMove={(event) => handleTileAnnotationPointerMove(event, imageId)}
	                          onPointerUp={(event) => handleTileBoxPointerUp(event, imageId)}
	                          onPointerCancel={(event) => { if (!finishTileViewportPan(event)) handleTileBoxPointerCancel(event); }}
		                          onAuxClick={stopMiddleMouseDefault}
                              onWheel={(event) => handleTileImageWheel(event, imageRef)}
	                          onClick={(event) => {
	                            event.stopPropagation();
	                            if (suppressNextTileClickRef.current) {
	                              suppressNextTileClickRef.current = false;
	                              return;
	                            }
	                            if (handleTileAnnotationPointerDown(event, imageId)) return;
	                            setSelectedImageRef(imageRef);
	                            setFullscreenImageModal({
	                              imageId: String(imageId),
	                              baseImageId: String(baseImageId),
                              label: entry.label || viewName.toUpperCase(),
                            });
                          }}
                        >
                          <img
                            className="inspection-view-image"
                            src={`/api/images/${encodeURIComponent(String(baseImageId))}/content`}
                            alt={`${viewName} source`}
                            loading="lazy"
                            style={tabKey === 'image_metadata' ? { opacity: metadataImageOpacity } : undefined}
                          />
                          <img
                            className="inspection-view-image analysis-overlay-image"
                            src={`/api/images/${encodeURIComponent(String(imageId))}/content`}
                            alt={`${viewName} overlay`}
                            loading="lazy"
                            style={{ opacity: tileOverlayOpacity * metadataImageOpacity }}
                          />
                          {tabKey === 'image_metadata' && metadataOverlayLines.length > 0 && (
                            <div className="inspection-tile-metadata-overlay" aria-label={`Metadata for ${imageDisplayName}`}>
                              {metadataOverlayLines.map(([key, value]) => (
                                <div key={`${key}-${value}`} className="inspection-tile-metadata-row">
                                  <strong>{key}</strong>
                                  <span>{value}</span>
                                </div>
                              ))}
                            </div>
                          )}
	                          <svg className="inspection-fullscreen-measurement-overlay" viewBox={`0 0 ${tileOverlayWidth} ${tileOverlayHeight}`} preserveAspectRatio="xMidYMid meet" aria-label="tile measurement overlay">
	                            <g transform={`scale(${tileOverlayWidth / 1000} ${tileOverlayHeight / 1000})`}>
	                              {renderAnnotationOverlay({ measurementLines: [...tileMeasurementLines, ...tilePreviewLines], boxes: [...tileBoxes, ...tilePreviewBoxes], fontSize: 30, selectedAnnotationId, opacityMultiplier: annotationOpacityMultiplier, unit: tileAnnotationUnit })}
                                  {!readOnly && renderTileAnnotationEditingTargets({
                                    measurementLines: tileMeasurementLines,
                                    boxes: tileBoxes,
                                    selectedAnnotationId,
                                    onStartDrag: (event, kind, operation, geometry) => startTileAnnotationGeometryDrag(
                                      event,
                                      kind,
                                      operation,
                                      geometry,
                                      tileAnnotationSourceImageId,
                                    ),
                                    onDragMove: handleTileAnnotationGeometryDragMove,
                                    onDragFinish: finishTileAnnotationGeometryDrag,
                                    onDragCancel: (event) => finishTileAnnotationGeometryDrag(event, { cancel: true }),
                                  })}
	                            </g>
	                          </svg>
	                        </div>
	                      ) : imageId ? (
                        <div
                          className="inspection-image-annotation-surface"
	                          {...tileViewportAttributes}
	                          onPointerDown={(event) => handleTileBoxPointerDown(event, imageId)}
	                          onPointerMove={(event) => handleTileAnnotationPointerMove(event, imageId)}
	                          onPointerUp={(event) => handleTileBoxPointerUp(event, imageId)}
	                          onPointerCancel={(event) => { if (!finishTileViewportPan(event)) handleTileBoxPointerCancel(event); }}
                          onAuxClick={stopMiddleMouseDefault}
                          onWheel={(event) => handleTileImageWheel(event, imageRef)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressNextTileClickRef.current) {
                              suppressNextTileClickRef.current = false;
                              return;
                            }
                            if (handleTileAnnotationPointerDown(event, imageId)) return;
                            setSelectedImageRef(imageRef);
                            setFullscreenImageModal({ imageId: String(imageId), label: entry.label || viewName.toUpperCase() });
                          }}
                        >
                          <img
                            className="inspection-view-image"
                            src={`/api/images/${encodeURIComponent(String(imageId))}/content`}
                            alt={`${viewName} view`}
                            loading="lazy"
	                            style={entry.overlay || tabKey === 'image_metadata' ? { opacity: entry.overlay ? tileOverlayOpacity * metadataImageOpacity : metadataImageOpacity } : undefined}
	                          />
                          {tabKey === 'image_metadata' && metadataOverlayLines.length > 0 && (
                            <div className="inspection-tile-metadata-overlay" aria-label={`Metadata for ${imageDisplayName}`}>
                              {metadataOverlayLines.map(([key, value]) => (
                                <div key={`${key}-${value}`} className="inspection-tile-metadata-row">
                                  <strong>{key}</strong>
                                  <span>{value}</span>
                                </div>
                              ))}
                            </div>
                          )}
	                          <svg className="inspection-fullscreen-measurement-overlay" viewBox={`0 0 ${tileOverlayWidth} ${tileOverlayHeight}`} preserveAspectRatio="xMidYMid meet" aria-label="tile measurement overlay">
	                            <g transform={`scale(${tileOverlayWidth / 1000} ${tileOverlayHeight / 1000})`}>
	                              {renderAnnotationOverlay({ measurementLines: [...tileMeasurementLines, ...tilePreviewLines], boxes: [...tileBoxes, ...tilePreviewBoxes], fontSize: 30, selectedAnnotationId, opacityMultiplier: annotationOpacityMultiplier, unit: tileAnnotationUnit })}
                                  {!readOnly && renderTileAnnotationEditingTargets({
                                    measurementLines: tileMeasurementLines,
                                    boxes: tileBoxes,
                                    selectedAnnotationId,
                                    onStartDrag: (event, kind, operation, geometry) => startTileAnnotationGeometryDrag(
                                      event,
                                      kind,
                                      operation,
                                      geometry,
                                      tileAnnotationSourceImageId,
                                    ),
                                    onDragMove: handleTileAnnotationGeometryDragMove,
                                    onDragFinish: finishTileAnnotationGeometryDrag,
                                    onDragCancel: (event) => finishTileAnnotationGeometryDrag(event, { cancel: true }),
                                  })}
	                            </g>
	                          </svg>
	                        </div>
                      ) : imageRef ? (
                        <span className="view-cell-empty">Image not found: {safeDecodeFilename(imageRef)}</span>
                      ) : (
                        <span className="view-cell-empty">No image mapped</span>
                      )}
                    </div>
                  </div>
                );
}
