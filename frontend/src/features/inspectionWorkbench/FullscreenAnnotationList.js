export function FullscreenAnnotationList({ readOnly, projectType, model, tools, annotations, fullscreenHandlers, handlers }) {
  const {
    isMprFullscreen,
    fullscreenAnnotationItems,
  } = model;
  const {
    croppingAnnotationId,
  } = tools;
  const {
    selectedAnnotationId,
  } = annotations;
  const {
    setSelectedAnnotationId,
    setFullscreenBoundsEditAnnotationId,
    cropBoxAnnotation,
    deleteMeasurementAnnotation,
  } = fullscreenHandlers;
  const {
    setInspectionItemVisibility,
  } = handlers;
  return (
	              <aside className="inspection-fullscreen-annotations" aria-label="Annotations" data-testid="fullscreen-annotation-list">
	                <h4>Annotations</h4>
	                {fullscreenAnnotationItems.length === 0 ? (
	                  <p className="muted">No annotations.</p>
	                ) : (
	                  <ul className="inspection-fullscreen-annotation-list">
	                    {fullscreenAnnotationItems.map((annotation, index) => {
	                      const inspectionItem = annotation.inspectionItem;
	                      const itemVisible = inspectionItem?.visible !== false;
	                      return (
	                        <li
	                          key={`${annotation.annotationType}-${annotation.id}`}
	                          className={`inspection-fullscreen-annotation ${selectedAnnotationId === annotation.id ? 'selected' : ''} ${itemVisible ? '' : 'annotation-entry-hidden'}`}
	                          style={{ borderColor: annotation.color }}
	                        >
	                        <button
	                          type="button"
	                          className="inspection-fullscreen-annotation-body"
	                          onClick={() => {
	                            if (inspectionItem?.source.resource === 'annotation') {
	                              setSelectedAnnotationId(annotation.id);
	                              if (!readOnly && ['measurement', 'box'].includes(annotation.annotationType)) {
	                                setFullscreenBoundsEditAnnotationId(annotation.id);
	                              }
	                            }
	                          }}
	                        >
	                          <span className="inspection-fullscreen-annotation-title">{annotation.title || `Annotation ${index + 1}`}</span>
	                          <span className="inspection-fullscreen-annotation-length">{annotation.summary}</span>
	                        </button>
	                        {inspectionItem && (
	                          <button
	                            type="button"
	                            className="inspection-fullscreen-annotation-visibility"
	                            aria-label={`${itemVisible ? 'Hide' : 'Show'} fullscreen annotation ${annotation.title || index + 1}`}
	                            aria-pressed={itemVisible}
	                            onClick={(event) => {
	                              event.stopPropagation();
	                              setInspectionItemVisibility(inspectionItem, !itemVisible);
	                            }}
	                          >
	                            {itemVisible ? 'Hide' : 'Show'}
	                          </button>
	                        )}
	                        {!readOnly && projectType !== 'PT3' && annotation.annotationType === 'box' && !isMprFullscreen && (
	                          <button
	                            type="button"
	                            className="inspection-fullscreen-annotation-crop"
	                            aria-label={`Crop ${annotation.title || `annotation ${index + 1}`}`}
	                            disabled={croppingAnnotationId === annotation.id}
	                            onClick={(event) => {
	                              event.stopPropagation();
	                              cropBoxAnnotation(annotation);
	                            }}
	                          >
	                            {croppingAnnotationId === annotation.id ? '…' : 'Crop'}
	                          </button>
	                        )}
	                        {!readOnly && inspectionItem?.source.resource !== 'source_image' && (
	                          <button
	                            type="button"
	                            className="inspection-fullscreen-annotation-delete"
	                            aria-label={`Delete ${annotation.title || `annotation ${index + 1}`}`}
	                            onClick={() => deleteMeasurementAnnotation(annotation.id)}
	                          >
	                            ×
	                          </button>
	                        )}
	                      </li>
	                      );
	                    })}
                  </ul>
                )}
              </aside>
  );
}
