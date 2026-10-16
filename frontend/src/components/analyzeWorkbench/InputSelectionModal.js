import React from 'react';
import { imageIdFor } from '../../features/analyzeWorkbench/workflowSerialization';
import { imageLabel, partIdFor, partLabel } from '../../features/analyzeWorkbench/inputSelectionHelpers';
import ExampleImageParameter from './ExampleImageParameter';

function SourceImageRow({ image, mode, processImageSet, onChooseExample, onDragStart, onMoveImage, onRemoveImage }) {
  const id = imageIdFor(image);
  const inProcess = processImageSet.has(String(id));
  return (
    <div key={`${mode}-${id}`} className="analyze-source-image-row">
      <button
        type="button"
        className="analyze-source-image-name"
        draggable
        onDragStart={(event) => {
          event.dataTransfer?.setData('text/plain', id);
          onDragStart({ type: 'image', id });
        }}
        onClick={() => onChooseExample(id)}
        title="Click to use as the example image, or drag between columns."
      >
        {imageLabel(image)}
      </button>
      <button
        type="button"
        className="btn btn-small btn-secondary"
        onClick={() => (inProcess ? onRemoveImage(id) : onMoveImage(id))}
      >
        {inProcess ? 'Remove' : 'Process'}
      </button>
    </div>
  );
}

function SourcePartColumn({
  title,
  description,
  parts,
  inputSource,
  filterImage,
  dropzoneTestId,
  partClick,
  emptyMessage,
  processImageSet,
  onChooseExample,
  onDragStart,
  onDrop,
  onMoveImage,
  onRemoveImage,
  hasVisibleContent,
}) {
  return (
    <section
      className={`analyze-source-column${title === 'Process' ? ' process' : ''}`}
      data-testid={dropzoneTestId}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <h4>{title}</h4>
      <p className="muted">{description}</p>
      {parts.map((part) => {
        const id = partIdFor(part);
        const partImages = (inputSource?.images || []).filter((image) => String(image.part_id || '') === String(id));
        const visibleImages = partImages.filter((image) => filterImage(image));
        if (visibleImages.length === 0) return null;
        return (
          <article className="analyze-source-part" key={`${dropzoneTestId}-${id}`}>
            <button
              type="button"
              className="analyze-source-part-name"
              draggable
              onDragStart={(event) => {
                event.dataTransfer?.setData('text/plain', id);
                onDragStart({ type: 'part', id });
              }}
              onClick={() => partClick(id)}
            >
              {partLabel(part)}
            </button>
            <div>
              {visibleImages.map((image) => (
                <SourceImageRow
                  key={imageIdFor(image)}
                  image={image}
                  mode={dropzoneTestId}
                  processImageSet={processImageSet}
                  onChooseExample={onChooseExample}
                  onDragStart={onDragStart}
                  onMoveImage={onMoveImage}
                  onRemoveImage={onRemoveImage}
                />
              ))}
            </div>
          </article>
        );
      })}
      {!hasVisibleContent && <p className="muted">{emptyMessage}</p>}
    </section>
  );
}

function InputSelectionModal({
  inputSource,
  processImageSet,
  availableImages,
  stagedImages,
  exampleImageId,
  onChooseExample,
  onClose,
  onDragStart,
  onDrop,
  onMoveImage,
  onRemoveImage,
  onMovePart,
  onRemovePart,
}) {
  const parts = inputSource?.parts || [];

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-content analyze-input-modal" role="dialog" aria-modal="true" aria-labelledby="analyze-input-title">
        <div className="modal-header">
          <div>
            <p className="analyze-eyebrow">Input Source</p>
            <h3 id="analyze-input-title">Loaded Images to Process</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close input source chooser">&times;</button>
        </div>

        <div className="analyze-example-select">
          <ExampleImageParameter
            images={stagedImages.length > 0 ? stagedImages : (inputSource?.images || [])}
            value={exampleImageId}
            onChange={onChooseExample}
            inputId="analyze-param-example-image-modal"
          />
        </div>

        <div className="analyze-source-modal-grid">
          <SourcePartColumn
            title="Loaded"
            description="Images available in loaded parts but not currently in the processing set."
            parts={parts}
            inputSource={inputSource}
            filterImage={(image) => !processImageSet.has(String(imageIdFor(image)))}
            dropzoneTestId="analyze-loaded-dropzone"
            partClick={onMovePart}
            emptyMessage="All loaded images are in Process."
            processImageSet={processImageSet}
            onChooseExample={onChooseExample}
            onDragStart={onDragStart}
            onDrop={() => onDrop('loaded')}
            onMoveImage={onMoveImage}
            onRemoveImage={onRemoveImage}
            hasVisibleContent={availableImages.length > 0}
          />

          <SourcePartColumn
            title="Process"
            description="Run Example uses the chosen example. Run uses this full processing set."
            parts={parts}
            inputSource={inputSource}
            filterImage={(image) => processImageSet.has(String(imageIdFor(image)))}
            dropzoneTestId="analyze-process-dropzone"
            partClick={onRemovePart}
            emptyMessage="Drop loaded images or part names here."
            processImageSet={processImageSet}
            onChooseExample={onChooseExample}
            onDragStart={onDragStart}
            onDrop={() => onDrop('process')}
            onMoveImage={onMoveImage}
            onRemoveImage={onRemoveImage}
            hasVisibleContent={stagedImages.length > 0}
          />
        </div>
      </div>
    </div>
  );
}

export default InputSelectionModal;
