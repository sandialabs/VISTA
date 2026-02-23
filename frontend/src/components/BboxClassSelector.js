import React, { useState } from 'react';

function BboxClassSelector({
  bboxClasses,
  selectedClassId,
  onSelect,
  collectionId,
  onClassCreated,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#FF0000');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const resp = await fetch(`/api/collections/${collectionId}/bbox-classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, color: newColor }),
      });
      if (resp.ok) {
        const created = await resp.json();
        if (onClassCreated) onClassCreated(created);
        onSelect(created.id);
        setShowCreate(false);
        setNewName('');
      }
    } catch (err) {
      console.error('Failed to create bbox class:', err);
    }
  };

  return (
    <div className="bbox-class-selector">
      <label className="bbox-class-label">Bounding Box Class</label>
      <div className="bbox-class-options">
        {bboxClasses.map(cls => (
          <button
            key={cls.id}
            className={`bbox-class-option ${selectedClassId === cls.id ? 'selected' : ''}`}
            onClick={() => onSelect(cls.id)}
            title={cls.description || cls.name}
          >
            <span
              className="bbox-class-swatch"
              style={{ backgroundColor: cls.color }}
            />
            {cls.name}
          </button>
        ))}
        <button
          className="bbox-class-option bbox-class-add"
          onClick={() => setShowCreate(!showCreate)}
        >
          + New
        </button>
      </div>
      {showCreate && (
        <form className="bbox-class-create-form" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Class name"
            className="form-control"
            required
          />
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            className="bbox-color-input"
          />
          <button type="submit" className="btn btn-primary btn-small">Add</button>
        </form>
      )}
    </div>
  );
}

export default BboxClassSelector;
