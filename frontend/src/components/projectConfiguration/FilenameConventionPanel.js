import React from 'react';
import {
  FILE_NAME_ELEMENT_OPTIONS,
  getFilenameEntryMetadataKey,
} from '../../features/projectConfiguration/filenameConventionHelpers';
import { normalizeConfigurationSection } from '../../features/projectConfiguration/configurationSchema';

export default function FilenameConventionPanel({
  expectedFilenameExample,
  filenameConvention,
  normalizedFileNamingScheme,
  setConfig,
  updateFileNameEntry,
  addFileNameEntry,
  removeFileNameEntry,
  updateOverlayIndicator,
  projectTypeUiSections,
  config,
  saving,
  addPartView,
  updatePartView,
  removePartView,
  addImageModality,
  updateImageModality,
  removeImageModality,
}) {
  return (
    <div
      id="configuration-filename-convention-panel"
      className="configuration-filename-convention-panel"
      role="tabpanel"
      aria-label="Filename Convention configuration"
    >
      <section className="part-detail-panel filename-convention-panel" aria-label="Filename convention">
        <div className="filename-convention-heading">
          <div>
            <h3>Filename Convention</h3>
          </div>
          <code data-testid="expected-filename-preview">{expectedFilenameExample}</code>
        </div>

        <div className="filename-breakdown" aria-label="Expected filename preview">
          {filenameConvention.segments.map((segment, index) => (
            <React.Fragment key={segment.key}>
              <div className="filename-breakdown-segment" style={{ '--segment-color': segment.color }}>
                <span className="filename-breakdown-label">{segment.label}</span>
                <strong>{segment.token}</strong>
                <span className="filename-breakdown-decodes">
                  {segment.type === 'hierarchy' ? 'ID value: 001' : 'Filename descriptor'}
                </span>
              </div>
              {index < filenameConvention.segments.length - 1 && (
                <span className="filename-breakdown-delimiter">{filenameConvention.delimiter}</span>
              )}
            </React.Fragment>
          ))}
          <span className="filename-breakdown-extension">.type</span>
        </div>

        <p>
          Configure each option directly under the filename part it controls. Numeric placeholders use
          <strong> 001 </strong> because these fields normally decode image or part identifiers from the filename.
        </p>

        <p className="muted">Part hierarchy assignment is configured in Project Data → Images to Parts → Automatically Assign Images to Parts.</p>

        <label className="filename-convention-toggle">
          <input
            type="checkbox"
            aria-label="Use filename convention"
            checked={normalizedFileNamingScheme.use_filename_convention !== false}
            onChange={(event) => setConfig((previous) => ({
              ...previous,
              file_naming_scheme: {
                ...normalizeConfigurationSection('file_naming_scheme', previous),
                use_filename_convention: event.target.checked,
              },
            }))}
          />
          Use filename convention for automatic metadata and part-assignment assumptions
        </label>
        {normalizedFileNamingScheme.use_filename_convention === false && (
          <p className="muted">
            Filename convention assumptions are disabled. VISTA will only use metadata explicitly supplied through regex/delimiter loading tools, associated metadata, or manual user assignments after loading.
          </p>
        )}

        <h4>Image Descriptors</h4>
        <div className="filename-option-grid">
          {normalizedFileNamingScheme.image_descriptors.map((descriptor, index) => {
            const segment = filenameConvention.segments.find((item) => item.type === 'descriptor' && item.index === index);
            return (
              <div className="filename-option-card" style={{ '--segment-color': segment?.color }} key={`image-descriptor-${index}`}>
                <div className="filename-option-card-header">
                  <span>{segment?.token}</span>
                  <button className="btn btn-secondary" type="button" onClick={() => removeFileNameEntry('image_descriptors', index)}>Remove</button>
                </div>
                <label htmlFor={`image-descriptor-select-${index}`}>Descriptor {index + 1}</label>
                <select
                  id={`image-descriptor-select-${index}`}
                  value={descriptor.id}
                  onChange={(event) => {
                    const selected = FILE_NAME_ELEMENT_OPTIONS.find((option) => option.id === event.target.value);
                    updateFileNameEntry('image_descriptors', index, selected
                      ? { id: selected.id, label: selected.label, abbreviation: selected.abbreviation }
                      : { id: 'other', label: '', abbreviation: '' });
                  }}
                >
                  {FILE_NAME_ELEMENT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  <option value="other">Other</option>
                </select>
                {descriptor.id === 'other' && (
                  <>
                    <label htmlFor={`image-descriptor-custom-label-${index}`}>Custom Label</label>
                    <input id={`image-descriptor-custom-label-${index}`} value={descriptor.label} onChange={(event) => updateFileNameEntry('image_descriptors', index, { label: event.target.value })} />
                  </>
                )}
                <small className="filename-metadata-key">Metadata key: {getFilenameEntryMetadataKey(descriptor, `descriptor_${index + 1}`)}</small>
                <label htmlFor={`image-descriptor-abbreviation-${index}`}>Abbreviation</label>
                <input id={`image-descriptor-abbreviation-${index}`} value={descriptor.abbreviation} onChange={(event) => updateFileNameEntry('image_descriptors', index, { abbreviation: event.target.value })} />
              </div>
            );
          })}
        </div>
        <div className="workbench-controls-row">
          <button className="btn btn-secondary" type="button" onClick={() => addFileNameEntry('image_descriptors')}>
            Add Image Descriptor
          </button>
        </div>

        <h4>Overlay Matching</h4>
        <p>
          Use this when a filename segment marks an image as an overlay. Overlay images are rendered
          on top of the non-overlay image with the same configured hierarchy/identifier values after
          the overlay specifier is removed.
        </p>
        <div className="filename-option-card filename-overlay-card">
          <label>
            <input
              type="checkbox"
              aria-label="Enable overlay filename matching"
              checked={normalizedFileNamingScheme.overlay_indicator.enabled}
              onChange={(event) => updateOverlayIndicator({ enabled: event.target.checked })}
            />
            Enable overlay filename matching
          </label>
          <label htmlFor="overlay-field-key">Overlay metadata key</label>
          <select
            id="overlay-field-key"
            value={normalizedFileNamingScheme.overlay_indicator.field_key}
            onChange={(event) => updateOverlayIndicator({ field_key: event.target.value })}
          >
            {[...normalizedFileNamingScheme.hierarchy_levels, ...normalizedFileNamingScheme.image_descriptors]
              .map((entry, index) => getFilenameEntryMetadataKey(entry, `filename_field_${index + 1}`))
              .filter(Boolean)
              .filter((key, index, keys) => keys.indexOf(key) === index)
              .map((key) => <option key={key} value={key}>{key}</option>)}
            {!([...normalizedFileNamingScheme.hierarchy_levels, ...normalizedFileNamingScheme.image_descriptors]
              .map((entry, index) => getFilenameEntryMetadataKey(entry, `filename_field_${index + 1}`))
              .includes(normalizedFileNamingScheme.overlay_indicator.field_key)) && (
              <option value={normalizedFileNamingScheme.overlay_indicator.field_key}>{normalizedFileNamingScheme.overlay_indicator.field_key}</option>
            )}
          </select>
          <label htmlFor="overlay-values">Overlay values</label>
          <input
            id="overlay-values"
            aria-label="Overlay values"
            type="text"
            value={normalizedFileNamingScheme.overlay_indicator.values.join(', ')}
            onChange={(event) => updateOverlayIndicator({ values: event.target.value.split(',') })}
          />
          <label>
            <input
              type="checkbox"
              aria-label="Remove overlay specifier when matching base image"
              checked={normalizedFileNamingScheme.overlay_indicator.remove_from_base_filename}
              onChange={(event) => updateOverlayIndicator({ remove_from_base_filename: event.target.checked })}
            />
            Match the base image by removing the overlay specifier from the filename
          </label>
        </div>


        {projectTypeUiSections['project_configuration.view_options'] !== false && (
          <section className="filename-value-section" aria-label="Sides">
            <h4>Sides</h4>
            <p>Specify the potential side labels that may appear in loaded image filenames.</p>
            <div className="workbench-controls-row">
              <button className="btn btn-secondary" type="button" onClick={addPartView} disabled={saving}>
                Add Side
              </button>
            </div>
            {(config.part_views || []).length === 0 ? (
              <p>No side labels configured yet.</p>
            ) : (
              (config.part_views || []).map((partView, index) => (
                <div className="workbench-controls-row config-entry-grid" key={`part-view-${index}`}>
                  <label htmlFor={`part-view-label-${index}`}>Side label</label>
                  <input
                    id={`part-view-label-${index}`}
                    aria-label={`Side label ${index + 1}`}
                    type="text"
                    value={partView.label || ''}
                    onChange={(event) => updatePartView(index, { label: event.target.value })}
                  />
                  <label htmlFor={`part-view-id-${index}`}>Filename value</label>
                  <input
                    id={`part-view-id-${index}`}
                    aria-label={`Side filename value ${index + 1}`}
                    type="text"
                    value={partView.id || ''}
                    onChange={(event) => updatePartView(index, { id: event.target.value })}
                  />
                  <button
                    className="btn btn-secondary"
                    type="button"
                    aria-label={`Remove side ${index + 1}`}
                    onClick={() => removePartView(index)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </section>
        )}

        <section className="filename-value-section" aria-label="Modalities">
          <h4>Modalities</h4>
          <p>Specify the potential modality labels that may appear in loaded image filenames.</p>
          <div className="workbench-controls-row">
            <button className="btn btn-secondary" type="button" onClick={addImageModality} disabled={saving}>
              Add Modality
            </button>
          </div>
          {(config.image_modalities || []).length === 0 ? (
            <p>No image modalities configured yet.</p>
          ) : (
            <div className="filename-option-grid modality-option-grid">
              {(config.image_modalities || []).map((modality, index) => (
                <div className="filename-option-card" style={{ '--segment-color': '#f97316' }} key={`image-modality-${index}`}>
                  <div className="filename-option-card-header">
                    <span>{modality.id || `modality-${index + 1}`}</span>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      aria-label={`Remove image modality ${index + 1}`}
                      onClick={() => removeImageModality(index)}
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </div>
                  <label htmlFor={`image-modality-label-${index}`}>Modality label</label>
                  <input
                    id={`image-modality-label-${index}`}
                    aria-label={`Modality label ${index + 1}`}
                    type="text"
                    value={modality.label || ''}
                    onChange={(event) => updateImageModality(index, { label: event.target.value })}
                  />
                  <label htmlFor={`image-modality-id-${index}`}>Filename value</label>
                  <input
                    id={`image-modality-id-${index}`}
                    aria-label={`Modality filename value ${index + 1}`}
                    type="text"
                    value={modality.id || ''}
                    onChange={(event) => updateImageModality(index, { id: event.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
