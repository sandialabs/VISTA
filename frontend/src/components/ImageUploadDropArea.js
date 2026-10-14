import React from 'react';
import { formatUploadSize } from '../features/imageUpload/uploadFormatting';

// Drag-and-drop / click-to-select file input area. Selection state and the
// drop handlers themselves are owned by ImageUploader.
function ImageUploadDropArea({
  isDragOver,
  dataOperationBusy,
  selectedFilesCount,
  selectedFilesTotalBytes,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
}) {
  return (
    <div
      className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => {
        if (!dataOperationBusy) document.getElementById('file-input').click();
      }}
    >
      <div className="upload-area-content">
        <div className="upload-area-icon">
          +
        </div>
        <div className="upload-area-text">
          Drag and drop images/voxel data here, or click to select files
        </div>
        <div className="upload-area-subtext">
          Supports image files, 3D voxel arrays (.npy, .npz, .inspiro), and one associated .nsipro/.json metadata file
        </div>
        <div className={`upload-area-status ${selectedFilesCount > 0 ? 'has-files' : 'no-files'}`}>
          {selectedFilesCount > 0
            ? `${selectedFilesCount} ${selectedFilesCount === 1 ? 'file' : 'files'} selected (${formatUploadSize(selectedFilesTotalBytes)})`
            : 'No files selected'}
        </div>
      </div>
      <input
        type="file"
        id="file-input"
        accept="image/*,image/tiff,.tiff,.tif,.npy,.npz,.inspiro,.json,.nsipro,application/json"
        multiple
        style={{ display: 'none' }}
        onChange={onFileChange}
        disabled={dataOperationBusy}
      />
    </div>
  );
}

export default ImageUploadDropArea;
