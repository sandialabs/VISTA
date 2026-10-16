import React from 'react';
import { progressLabel, progressPercent } from '../features/imageUpload/uploadFormatting';

// Upload/cancel/test-data action buttons, upload progress bar, and the
// resulting test-data success alerts. State is owned by ImageUploader.
function UploadActionsPanel({
  dataOperationBusy,
  extractorValid,
  associatedMetadataParsing,
  associatedMetadataError,
  uploading,
  loadingTestData,
  onLoadTestData,
  showNistButton,
  loadingNistTestData,
  onLoadNistTestData,
  onCancel,
  uploadProgress,
  testDataResult,
  nistTestDataResult,
  projectType,
}) {
  return (
    <>
      <div className="form-group">
        <button
          type="submit"
          className="btn btn-success"
          disabled={dataOperationBusy || !extractorValid || associatedMetadataParsing || Boolean(associatedMetadataError)}
        >
          {uploading ? 'Uploading...' : 'Upload Images'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginLeft: '8px' }}
          disabled={dataOperationBusy}
          onClick={onLoadTestData}
        >
          {loadingTestData ? 'Loading Test Data...' : 'Load Test Data'}
        </button>
        {showNistButton && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginLeft: '8px' }}
            disabled={dataOperationBusy}
            onClick={onLoadNistTestData}
          >
            {loadingNistTestData ? 'Loading NIST CoCr Volume...' : 'Load NIST CoCr Volume'}
          </button>
        )}
        {uploading && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginLeft: '8px' }}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
      {uploadProgress && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
            <span>{progressLabel(uploadProgress)}</span>
            {uploadProgress.failed > 0 && (
              <span style={{ color: '#dc3545' }}>{uploadProgress.failed} failed</span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label="Image upload data progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progressPercent(uploadProgress)}
            style={{ width: '100%', height: '8px', backgroundColor: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }}
          >
            <div
              style={{
                width: `${progressPercent(uploadProgress)}%`,
                height: '100%',
                backgroundColor: uploadProgress.failed > 0 ? '#ffc107' : '#28a745',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}
      {testDataResult && (
        <div className="alert alert-success" data-testid="load-test-data-result">
          Loaded {testDataResult.images_created || 0} new {projectType || 'project'} test images;
          {' '}
          created {testDataResult.ingest?.counters?.parts_created || 0} parts.
        </div>
      )}
      {nistTestDataResult && (
        <div className="alert alert-success" data-testid="load-nist-cocr-result">
          Loaded {nistTestDataResult.images_created || 0} new NIST CoCr test images;
          {' '}
          created {nistTestDataResult.ingest?.counters?.parts_created || 0}
          {' '}
          {(nistTestDataResult.ingest?.counters?.parts_created || 0) === 1 ? 'part' : 'parts'}.
        </div>
      )}
    </>
  );
}

export default UploadActionsPanel;
