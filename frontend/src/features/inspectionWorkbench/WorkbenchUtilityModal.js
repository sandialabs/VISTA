import { AnnotationsPane } from './AnnotationsPane';
import { PartMetadataModalBody } from './PartMetadataModalBody';
import { PartSummaryPane } from './PartSummaryPane';

export function WorkbenchUtilityModal(props) {
  const {
    activeWorkbenchModal,
    setActiveWorkbenchModal,
    partPaneProps,
    metadataModalBodyProps,
    annotationsPaneProps,
  } = props;
  if (!activeWorkbenchModal) return null;
  const modalTitleByType = {
    parts: 'Part Selection',
    annotations: 'Annotations',
    metadata: 'Part Metadata',
  };
  const modalTitle = modalTitleByType[activeWorkbenchModal] || 'Workbench';
  const renderBody = () => {
    if (activeWorkbenchModal === 'parts') return <PartSummaryPane {...partPaneProps} />;
    if (activeWorkbenchModal === 'metadata') return <PartMetadataModalBody {...metadataModalBodyProps} />;
    return <AnnotationsPane {...annotationsPaneProps} />;
  };
  return (
    <div className="modal" style={{ display: 'flex' }} onClick={() => setActiveWorkbenchModal(null)}>
      <div className="modal-content workbench-utility-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{modalTitle}</h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label={`Close ${modalTitle}`}
            onClick={() => setActiveWorkbenchModal(null)}
          >
            &times;
          </button>
        </div>
        <div className="modal-body">
          {renderBody()}
        </div>
      </div>
    </div>
  );
}
