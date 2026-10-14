import CalibrationManager from '../../components/CalibrationManager';

export function FullscreenCalibrationPrompt({ readOnly, projectId, model, fullscreenHandlers }) {
  const {
    fullscreenImageId,
    fullscreenImageRecord,
  } = model;
  const {
    handleFullscreenCalibrationChange,
  } = fullscreenHandlers;
  return (
            <div className="inspection-fullscreen-calibration-panel" role="dialog" aria-label="Measurement calibration required">
              <div className="workbench-notice">
                <strong>No Calibration Set</strong>
                <p>Set calibration before placing a measurement line.</p>
              </div>
              <CalibrationManager
                projectId={projectId}
                imageId={fullscreenImageId}
                image={fullscreenImageRecord}
                onCalibrationChange={handleFullscreenCalibrationChange}
                readOnly={readOnly}
              />
            </div>
  );
}
