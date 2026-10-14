import React from 'react';

export default function DefectTypesSection({
  config,
  saving,
  addDefectType,
  updateDefectType,
  removeDefectType,
}) {
  return (
    <section className="part-detail-panel" aria-label="Defect types">
      <h3>Defect Types</h3>
      <p>Define the defect taxonomy used in annotations and review workflows.</p>
      <div className="workbench-controls-row">
        <button className="btn btn-secondary" type="button" onClick={addDefectType} disabled={saving}>
          Add Defect Type
        </button>
      </div>
      {config.defect_types.length === 0 ? (
        <p>No defect types configured yet.</p>
      ) : (
        config.defect_types.map((defectType, index) => (
          <div className="workbench-controls-row config-entry-grid" key={`defect-type-${index}`}>
            <label htmlFor={`defect-type-name-${index}`}>Name</label>
            <input
              id={`defect-type-name-${index}`}
              aria-label={`Defect type name ${index + 1}`}
              type="text"
              value={defectType.name}
              onChange={(event) => updateDefectType(index, { name: event.target.value })}
            />
            <label htmlFor={`defect-type-color-${index}`}>Color</label>
            <input
              id={`defect-type-color-${index}`}
              aria-label={`Defect type color ${index + 1}`}
              type="text"
              value={defectType.color}
              onChange={(event) => updateDefectType(index, { color: event.target.value })}
            />
            <label htmlFor={`defect-type-definition-${index}`}>Definition</label>
            <input
              id={`defect-type-definition-${index}`}
              aria-label={`Defect type definition ${index + 1}`}
              type="text"
              value={defectType.definition || ''}
              onChange={(event) => updateDefectType(index, { definition: event.target.value })}
            />
            <button
              className="btn btn-secondary"
              type="button"
              aria-label={`Remove defect type ${index + 1}`}
              onClick={() => removeDefectType(index)}
              disabled={saving}
            >
              Remove
            </button>
          </div>
        ))
      )}
    </section>
  );
}
