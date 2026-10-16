import React from 'react';
import { checkpointLabel } from '../../features/analyzeWorkbench/checkpointDiagnostics';
import {
  clampParameterValue,
  normalizedParameterValue,
  numericParameterStep,
  numericParameterValue,
  parseNumericParameterValue,
  roundParameterValue,
} from '../../features/analyzeWorkbench/workflowParameters';

function displayIntegrationMode(value) {
  const mode = String(value || '').toLowerCase();
  if (mode === 'remote' || mode === 'fastapi') return 'Remote';
  return 'Local';
}

function wheelIncrementForEvent(event) {
  const magnitude = Math.abs(Number(event.deltaY) || 0);
  return magnitude >= 40 ? 0.05 : 0.01;
}

function CheckpointParameter({ id, parameter, value, onChange, checkpoints, checkpointScope, onCheckpointScopeChange }) {
  return (
    <div className="analyze-checkpoint-parameter">
      <label className="analyze-field" htmlFor={id}>
        <span>{parameter.label}</span>
        <select id={id} value={value || ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">No checkpoint selected</option>
          {checkpoints.map((checkpoint) => (
            <option key={checkpoint.id} value={checkpoint.id}>{checkpointLabel(checkpoint)}</option>
          ))}
        </select>
      </label>
      <label className="analyze-switch analyze-checkpoint-scope" htmlFor={`${id}-scope`}>
        <input
          id={`${id}-scope`}
          type="checkbox"
          checked={checkpointScope === 'authorized'}
          onChange={(event) => onCheckpointScopeChange?.(event.target.checked ? 'authorized' : 'project')}
        />
        <span>Show authorized group checkpoints</span>
      </label>
      {checkpoints.length === 0 && <p className="muted">No matching checkpoints are available.</p>}
    </div>
  );
}

function BooleanParameter({ id, parameter, value, onChange }) {
  return (
    <label className="analyze-switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{parameter.label}</span>
    </label>
  );
}

function SelectParameter({ id, parameter, value, onChange }) {
  const selectValue = parameter.name === 'integration_mode'
    ? normalizedParameterValue(value, parameter)
    : value || parameter.default || '';
  return (
    <label className="analyze-field" htmlFor={id}>
      <span>{parameter.label}</span>
      <select id={id} value={selectValue} onChange={(event) => onChange(event.target.value)}>
        {parameter.options.map((option) => (
          <option key={option} value={option}>{parameter.name === 'integration_mode' ? displayIntegrationMode(option) : option}</option>
        ))}
      </select>
    </label>
  );
}

function JsonParameter({ id, parameter, value, onChange }) {
  const jsonValue = typeof value === 'string'
    ? value
    : JSON.stringify(value ?? parameter.default ?? {}, null, 2);
  return (
    <label className="analyze-field" htmlFor={id}>
      <span>{parameter.label}</span>
      <textarea
        id={id}
        value={jsonValue}
        rows={4}
        onChange={(event) => {
          const nextValue = event.target.value;
          try {
            onChange(nextValue.trim() ? JSON.parse(nextValue) : {});
          } catch (_err) {
            onChange(nextValue);
          }
        }}
      />
    </label>
  );
}

function NumericOrTextParameter({ id, parameter, value, onChange }) {
  const numeric = parameter.type === 'integer' || parameter.type === 'float' || parameter.type === 'range';
  const step = numericParameterStep(parameter);
  const inputValue = numeric ? numericParameterValue(value, parameter) : value ?? '';
  const handleWheel = numeric && parameter.type !== 'integer'
    ? (event) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const currentValue = Number.isFinite(Number(inputValue))
        ? Number(inputValue)
        : Number.isFinite(Number(parameter.default))
          ? Number(parameter.default)
          : 0;
      const direction = event.deltaY < 0 ? 1 : -1;
      const increment = wheelIncrementForEvent(event);
      onChange(roundParameterValue(clampParameterValue(currentValue + (direction * increment), parameter)));
    }
    : undefined;
  return (
    <label className="analyze-field" htmlFor={id} onWheel={handleWheel}>
      <span>{parameter.label}</span>
      <input
        id={id}
        type={numeric ? 'number' : 'text'}
        step={step}
        min={parameter.min_value ?? undefined}
        max={parameter.max_value ?? undefined}
        value={inputValue}
        onChange={(event) => {
          if (!numeric) {
            onChange(event.target.value);
            return;
          }
          onChange(parseNumericParameterValue(event.target.value, parameter));
        }}
      />
    </label>
  );
}

function ParameterInput({ parameter, value, onChange, checkpoints = [], checkpointScope = 'project', onCheckpointScopeChange }) {
  const id = `analyze-param-${parameter.name}`;
  if (parameter.name === 'checkpoint_id') {
    return (
      <CheckpointParameter
        id={id}
        parameter={parameter}
        value={value}
        onChange={onChange}
        checkpoints={checkpoints}
        checkpointScope={checkpointScope}
        onCheckpointScopeChange={onCheckpointScopeChange}
      />
    );
  }
  if (parameter.type === 'boolean') {
    return <BooleanParameter id={id} parameter={parameter} value={value} onChange={onChange} />;
  }

  if (parameter.type === 'select' && Array.isArray(parameter.options) && parameter.options.length > 0) {
    return <SelectParameter id={id} parameter={parameter} value={value} onChange={onChange} />;
  }

  if (parameter.type === 'json') {
    return <JsonParameter id={id} parameter={parameter} value={value} onChange={onChange} />;
  }

  return <NumericOrTextParameter id={id} parameter={parameter} value={value} onChange={onChange} />;
}

export default ParameterInput;
