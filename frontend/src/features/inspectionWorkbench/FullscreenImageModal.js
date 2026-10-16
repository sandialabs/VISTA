import { buildFullscreenModalModel } from './fullscreenModalModel';
import { FullscreenModalHeader } from './FullscreenModalHeader';
import { FullscreenCalibrationPrompt } from './FullscreenCalibrationPrompt';
import { FullscreenImageStage } from './FullscreenImageStage';
import { FullscreenAnnotationList } from './FullscreenAnnotationList';

export function FullscreenImageModal({ readOnly, projectId, projectType, modal, tools, display, annotations, navigation, volume, tileView, selection, fullscreenHandlers, handlers }) {
  if (!modal.fullscreenBackingImageId) return null;
  const model = buildFullscreenModalModel({
    ...selection,
    ...tileView,
    ...navigation,
    ...volume,
    ...display,
    ...annotations,
    ...modal,
    ...tools,
    ...handlers,
    ...fullscreenHandlers,
  });
  const {
    fullscreenCalibrationPromptVisible,
  } = modal;
  const {
    fullscreenMeasureActive,
    fullscreenBoxActive,
    fullscreenCropActive,
    fullscreenEditingEndpoint,
    fullscreenEditingBoxCorner,
  } = tools;
  const {
    closeFullscreenImageModal,
  } = fullscreenHandlers;
  return (
      <div className="modal inspection-fullscreen-modal" style={{ display: 'flex' }} onClick={closeFullscreenImageModal}>
        <div className="modal-content inspection-fullscreen-modal-content" onClick={(event) => event.stopPropagation()}>
          <FullscreenModalHeader
            readOnly={readOnly}
            model={model}
            modal={modal}
            tools={tools}
            display={display}
            fullscreenHandlers={fullscreenHandlers}
            handlers={handlers}
          />
          {fullscreenCalibrationPromptVisible && (
            <FullscreenCalibrationPrompt
              readOnly={readOnly}
              projectId={projectId}
              model={model}
              fullscreenHandlers={fullscreenHandlers}
            />
          )}
	          <div className="inspection-fullscreen-stage">
            {(fullscreenMeasureActive || fullscreenBoxActive || fullscreenCropActive || fullscreenEditingEndpoint || fullscreenEditingBoxCorner) && (
              <div className="inspection-fullscreen-tool-notice" aria-live="polite">
                {fullscreenMeasureActive && <div className="workbench-notice">Click and drag to draw a measurement line.</div>}
                {fullscreenBoxActive && <div className="workbench-notice">Press and drag to draw a bounding box.</div>}
                {fullscreenCropActive && <div className="workbench-notice">Press and drag around the parent image feature to create a child crop.</div>}
                {(fullscreenEditingEndpoint || fullscreenEditingBoxCorner) && <div className="workbench-notice">Click the new endpoint or corner position to update the selected annotation.</div>}
              </div>
            )}
            <div className="inspection-fullscreen-workspace">
              <FullscreenImageStage
                readOnly={readOnly}
                model={model}
                modal={modal}
                tools={tools}
                display={display}
                annotations={annotations}
                navigation={navigation}
                volume={volume}
                fullscreenHandlers={fullscreenHandlers}
              />
              <FullscreenAnnotationList
                readOnly={readOnly}
                projectType={projectType}
                model={model}
                tools={tools}
                annotations={annotations}
                fullscreenHandlers={fullscreenHandlers}
                handlers={handlers}
              />
            </div>
          </div>
        </div>
      </div>
  );
}
