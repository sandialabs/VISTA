import {
  SEGMENTATION_ML_METHOD_GROUPS,
  getSegmentationMlMethods,
  getSegmentationMlParameterFields,
  segmentationExecutionModeLabel,
} from './segmentationConfig';

function SegmentationMlParameterField({ field, value, onChange }) {
  return (
    <label htmlFor={`segmentation-ml-${field.name}`}>
      {field.label}
      {field.type === 'select' ? (
        <select
          id={`segmentation-ml-${field.name}`}
          value={value ?? ''}
          onChange={(event) => onChange(field.name, event.target.value)}
        >
          {(field.options || []).map((option) => (
            <option key={option} value={option}>{field.name === 'integration_mode' ? segmentationExecutionModeLabel(option) : option}</option>
          ))}
        </select>
      ) : (
        <input
          id={`segmentation-ml-${field.name}`}
          type={field.type}
          min={field.min}
          max={field.max}
          step={field.step}
          value={value ?? ''}
          onChange={(event) => onChange(
            field.name,
            field.type === 'number' ? Number(event.target.value) : event.target.value,
          )}
        />
      )}
    </label>
  );
}

export function SegmentationMlPanel({ state, actions }) {
  const { mlGroup, mlMethod, mlParameters, mlLoading, mlStatus } = state;
  return (
    <div className="segmentation-ml-panel" aria-label="ML helper options">
      <label htmlFor="segmentation-ml-group">
        Method family
        <select
          id="segmentation-ml-group"
          value={mlGroup}
          onChange={(event) => actions.setMlGroup(event.target.value)}
        >
          {SEGMENTATION_ML_METHOD_GROUPS.map((group) => (
            <option key={group.id} value={group.id}>{group.label}</option>
          ))}
        </select>
      </label>
      <label htmlFor="segmentation-ml-method">
        Segment function
        <select
          id="segmentation-ml-method"
          value={mlMethod}
          onChange={(event) => actions.setMlMethod(event.target.value)}
        >
          {getSegmentationMlMethods(mlGroup).map((method) => (
            <option key={method.id} value={method.id}>{method.label}</option>
          ))}
        </select>
      </label>
      {getSegmentationMlParameterFields(mlMethod, mlParameters).map((field) => (
        <SegmentationMlParameterField
          key={field.name}
          field={field}
          value={mlParameters[field.name]}
          onChange={actions.setMlParameter}
        />
      ))}
      <p className="muted">
        {mlLoading ? 'Running analysis for this slice.' : (mlStatus || 'Click the slice to run once, cache this method result, and select the clicked segment.')}
      </p>
    </div>
  );
}
