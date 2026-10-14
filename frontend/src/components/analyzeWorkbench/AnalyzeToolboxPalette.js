import React from 'react';

function AnalyzeToolboxPalette({
  orderedCategories,
  collapsedCategories,
  onToggleCategory,
  selectedToolboxMethodId,
  onSelectMethod,
}) {
  return (
    <aside className="analyze-toolbox" aria-label="Analyze toolbox">
      {orderedCategories.map(([category, categoryMethods]) => (
        <section key={category} className="analyze-toolbox-group">
          <button
            type="button"
            className="analyze-toolbox-group-toggle"
            onClick={() => onToggleCategory(category)}
            aria-expanded={!collapsedCategories[category]}
          >
            <h3>{category}</h3>
            <span aria-hidden="true">{collapsedCategories[category] ? '+' : '−'}</span>
          </button>
          <div className={`analyze-method-list ${collapsedCategories[category] ? 'collapsed' : ''}`}>
            {categoryMethods.map((method) => (
              <button
                key={method.id}
                type="button"
                className={`analyze-method-button ${selectedToolboxMethodId === method.id ? 'selected' : ''}`}
                aria-pressed={selectedToolboxMethodId === method.id}
                draggable
                onClick={() => onSelectMethod(method)}
                onDragStart={(event) => {
                  onSelectMethod(method);
                  event.dataTransfer.setData('text/x-vista-method-id', method.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                title={method.description}
              >
                <span>{method.name}</span>
                <small>{method.output_types.join(' + ')}</small>
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}

export default AnalyzeToolboxPalette;
