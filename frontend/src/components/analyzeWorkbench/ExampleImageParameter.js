import React from 'react';
import { imageIdFor } from '../../features/analyzeWorkbench/workflowSerialization';
import { imageLabel } from '../../features/analyzeWorkbench/inputSelectionHelpers';

function ExampleImageParameter({ images, value, onChange, inputId = 'analyze-param-example-image' }) {
  return (
    <label className="analyze-field" htmlFor={inputId}>
      <span>Choose Example</span>
      <select
        id={inputId}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">No example selected</option>
        {images.map((image) => {
          const id = imageIdFor(image);
          return <option key={id} value={id}>{imageLabel(image)}</option>;
        })}
      </select>
    </label>
  );
}

export default ExampleImageParameter;
