import CalibrationManager from '../../components/CalibrationManager';
import { getAnnotationCreator, formatAnnotationTimestamp, getAnnotationCreatedAt, getAnnotationListType, getAnnotationListValue, getAnnotationTooltip } from './annotationListHelpers';
import { isBoundingBoxAnnotation } from './inspectionAnnotationGeometry';

export function AnnotationsPane(props) {
  const {
    inspectionHierarchy,
    annotationsVisible,
    setAnnotationsVisible,
    selectedPart,
    readOnly,
    annotationToolMode,
    setTileAnnotationMode,
    projectType,
    openOtherAnnotationModal,
    tileCalibrationPromptImageId,
    projectId,
    projectImageLookup,
    handleTileCalibrationChange,
    annotationsLoading,
    inspectionAnnotationItems,
    selectedInspectionItem,
    selectInspectionAnnotationItem,
    setInspectionItemVisibility,
    croppingAnnotationId,
    cropBoxAnnotation,
    openInspectionItemConfigModal,
    deleteMeasurementAnnotation,
  } = props;
  return (
	    <section
	      className="workbench-tabbed-panel"
	      data-layout-region={inspectionHierarchy.rightColumn}
	    >
	      <div className="annotation-controls" data-testid="annotation-controls">
	        <label className="annotation-display-toggle">
	          <input
	            type="checkbox"
	            checked={annotationsVisible}
	            onChange={(event) => setAnnotationsVisible(event.target.checked)}
	          />
	          Show annotations
	        </label>
	        <p className="muted">For selected part: {selectedPart?.serial_number || 'No part selected'}</p>
	        {!readOnly && <div className="annotation-tool-buttons" aria-label="Annotation tools">
	          <button
	            type="button"
	            className={`btn btn-secondary ${annotationToolMode === 'measure' ? 'active' : ''}`}
	            aria-label="Measure on tiles"
	            onClick={() => setTileAnnotationMode('measure')}
	            disabled={!selectedPart}
	          >
	            Measure
	          </button>
	          <button
	            type="button"
	            className={`btn btn-secondary ${annotationToolMode === 'box' ? 'active' : ''}`}
	            aria-label={projectType === 'PT3' ? 'Draw box on MPR slices' : 'Draw box on tiles'}
	            onClick={() => setTileAnnotationMode('box')}
	            disabled={!selectedPart}
	          >
	            Draw box
	          </button>
          {projectType !== 'PT3' && (
            <button
              type="button"
              className={`btn btn-secondary ${annotationToolMode === 'crop' ? 'active' : ''}`}
              aria-label="New Crop on tiles"
              onClick={() => setTileAnnotationMode('crop')}
              disabled={!selectedPart}
            >
              New Crop
            </button>
          )}
	          {projectType === 'PT3' && (
	            <button
	              type="button"
	              className={`btn btn-secondary ${annotationToolMode === 'cube' ? 'active' : ''}`}
	              aria-label="Draw 3D box on MPR slices"
	              onClick={() => setTileAnnotationMode('cube')}
	              disabled={!selectedPart}
	            >
	              3D Box
	            </button>
	          )}
	          <button
	            type="button"
	            className="btn btn-secondary"
	            onClick={() => {
	              openOtherAnnotationModal();
	            }}
	            disabled={!selectedPart}
	          >
	            Other
	          </button>
	        </div>}
	        {annotationToolMode === 'measure' && (
	          <p className="muted annotation-tool-hint">
	            Click two points {projectType === 'PT3' ? 'on an MPR slice' : 'on a tile'} to place a measurement line.
	          </p>
	        )}
	        {annotationToolMode === 'box' && (
	          <p className="muted annotation-tool-hint">
	            Drag two corners {projectType === 'PT3' ? 'on the active MPR slice' : 'on a tile'} to draw a bounding box.
	          </p>
        )}
        {annotationToolMode === 'crop' && (
          <p className="muted annotation-tool-hint">
            Drag around part of a parent image to create a child crop tile.
          </p>
        )}
	        {annotationToolMode === 'cube' && (
	          <p className="muted annotation-tool-hint">
	            Draw one box, move to another slice on the same axis, then draw the second box.
	          </p>
	        )}
        {tileCalibrationPromptImageId && (
          <div className="inspection-fullscreen-calibration-panel" role="dialog" aria-label="Measurement calibration required">
            <div className="workbench-notice">
              <strong>No Calibration Set</strong>
              <p>Set calibration before placing measurement annotations.</p>
            </div>
            <CalibrationManager
              projectId={projectId}
              imageId={tileCalibrationPromptImageId}
              image={projectImageLookup[tileCalibrationPromptImageId]}
              onCalibrationChange={handleTileCalibrationChange}
              readOnly={readOnly}
            />
          </div>
        )}
        <ul className="measurement-list" data-testid="annotation-list">
          {annotationsLoading ? (
            <li className="muted">Loading annotations…</li>
          ) : inspectionAnnotationItems.length === 0 ? (
            <li className="muted">No annotations captured.</li>
          ) : (
            inspectionAnnotationItems.map((item) => {
              const annotation = item.annotation;
              const isAnnotation = item.source.resource === 'annotation';
              const creator = isAnnotation ? getAnnotationCreator(annotation) : '';
              const createdAt = isAnnotation ? formatAnnotationTimestamp(getAnnotationCreatedAt(annotation)) : '';
              const selected = selectedInspectionItem?.key === item.key;
              const typeLabel = item.typeLabel || (isAnnotation
                ? getAnnotationListType(annotation)
                : 'External overlay');
              const displayName = item.displayName || (isAnnotation
                ? getAnnotationListValue(annotation)
                : `External: ${item.label}`);
              return (
                <li
                  key={item.key}
                  className={`annotation-entry ${selected ? 'selected' : ''} ${item.visible ? '' : 'annotation-entry-hidden'}`}
                  role="button"
                  tabIndex={0}
                  title={isAnnotation ? getAnnotationTooltip(annotation) : item.label}
                  onClick={() => {
                    selectInspectionAnnotationItem(item);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectInspectionAnnotationItem(item);
                    }
                  }}
                >
                  <div className="annotation-entry-content">
                    <span className="annotation-entry-type">{typeLabel}</span>
                    <span className="annotation-entry-value">{displayName}</span>
                    {item.kind === 'vista_segment' && (
                      <span className="annotation-entry-meta">
                        {annotation?.geometry?.segment?.axis || 'axial'} slices {annotation?.geometry?.segment?.min_slice ?? 0}-{annotation?.geometry?.segment?.max_slice ?? 0}
                      </span>
                    )}
                    {isAnnotation ? (
                      <>
                        <span className="annotation-entry-meta">Created by {creator}</span>
                        <span className="annotation-entry-meta">{createdAt}</span>
                      </>
                    ) : (
                      <span className="annotation-entry-meta">Assigned external image or volume</span>
                    )}
                  </div>
                  <div className="annotation-entry-actions">
                    <button
                      type="button"
                      className="annotation-entry-visibility"
                      aria-label={`${item.visible ? 'Hide' : 'Show'} ${typeLabel.toLowerCase()} ${
                        item.kind === 'external_overlay' ? item.label : displayName
                      }`}
                      aria-pressed={item.visible}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setInspectionItemVisibility(item, !item.visible);
                      }}
                    >
                      {item.visible ? 'Hide' : 'Show'}
                    </button>
                    {!readOnly && projectType !== 'PT3' && isAnnotation && isBoundingBoxAnnotation(annotation) && (
                      <button
                        type="button"
                        className="annotation-entry-crop"
                        aria-label={`Crop annotation ${annotation.comment || annotation.defect_class || annotation.id}`}
                        disabled={croppingAnnotationId === annotation.id}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          cropBoxAnnotation(annotation);
                        }}
                      >
                        {croppingAnnotationId === annotation.id ? 'Cropping…' : 'Crop'}
                      </button>
                    )}
                    {isAnnotation && (
                      <button
                        type="button"
                        className="annotation-entry-edit"
                        aria-label={`Edit annotation ${annotation.comment || annotation.defect_class || annotation.id}`}
                        disabled={readOnly}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openInspectionItemConfigModal(item);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {item.kind === 'external_overlay' && (
                      <button
                        type="button"
                        className="annotation-entry-edit"
                        aria-label={`Edit overlay ${item.label || item.id}`}
                        disabled={readOnly}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openInspectionItemConfigModal(item);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {!readOnly && isAnnotation && (
                      <button
                        type="button"
                        className="annotation-entry-delete"
                        aria-label={`Delete annotation ${annotation.comment || annotation.defect_class || annotation.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deleteMeasurementAnnotation(annotation.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </section>
  );
}
