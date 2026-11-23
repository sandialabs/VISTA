import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { foldCode, formatNcrCodeOption } from '../projectConfiguration/ncrConfiguration';
import { NCR_TEXT_MAX_LENGTH } from './useInspectionNcrs';

// Keeps a code that is saved on the NCR but no longer configured selectable,
// so editing other fields never silently changes the recorded code.
function uniqueOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    const key = foldCode(option.code);
    if (!option.code || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withSavedCode(rawOptions, savedCode, savedDescription) {
  const options = uniqueOptions(rawOptions);
  if (!savedCode) return options;
  // The saved value must be an exact option value or the select would show
  // the placeholder; reuse the saved spelling when only the case differs.
  const index = options.findIndex((option) => foldCode(option.code) === foldCode(savedCode));
  if (index >= 0) {
    return options.map((option, i) => (i === index ? { ...option, code: savedCode } : option));
  }
  return [...options, { code: savedCode, description: savedDescription || '', retired: true }];
}

function CodeSelect({ id, label, value, options, onChange, disabled }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="form-control" value={value} onChange={onChange} disabled={disabled} required>
        <option value="">{`Select ${label.toLowerCase()}`}</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {formatNcrCodeOption(option)}{option.retired ? ' (no longer configured)' : ''}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Create/edit form for a nonconformance report. All four fields are required.
 */
export function NcrEditorModal({
  editor,
  readOnly,
  busy,
  error,
  failureCodes,
  dispositionCodes,
  selectedPart,
  setDraft,
  onSave,
  onClose,
}) {
  const commentRef = useRef(null);
  const open = Boolean(editor) && !readOnly;
  useEffect(() => {
    if (!open) return undefined;
    commentRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;
  const { mode, ncr, draft } = editor;
  const title = mode === 'create' ? 'Add NCR' : `Edit ${ncr.ncr_label}`;
  const failureOptions = withSavedCode(failureCodes, ncr?.failure_code, ncr?.failure_code_description);
  const dispositionOptions = withSavedCode(
    dispositionCodes,
    ncr?.disposition_code,
    ncr?.disposition_code_description,
  );
  const updateField = (field) => (event) => {
    const { value } = event.target;
    setDraft((previous) => ({ ...previous, [field]: value }));
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    onSave();
  };

  // Rendered into document.body: inside the flexlayout pane the dialog was
  // trapped below the project header's stacking context and clipped.
  return createPortal(
    <div className="modal ncr-editor-backdrop" style={{ display: 'flex' }} onClick={busy ? undefined : onClose}>
      <div
        className="modal-content workbench-utility-modal ncr-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close-btn" aria-label="Close NCR form" onClick={onClose} disabled={busy}>
            &times;
          </button>
        </div>
        <form className="modal-body ncr-editor-form" onSubmit={handleSubmit} noValidate>
          <div className="ncr-editor-fields">
            <p className="muted">
              {`Part: ${ncr?.part_serial_number || selectedPart?.serial_number || ''}`}
            </p>
            {mode === 'edit' && ncr.status === 'approved' && (
              <div className="alert alert-warning" role="note">
                This NCR is approved. Saving changes will revoke the approval and it must be approved again.
              </div>
            )}
            <label htmlFor="ncr-comment">Comment</label>
            <textarea
              ref={commentRef}
              id="ncr-comment"
              className="form-control"
              rows={4}
              maxLength={NCR_TEXT_MAX_LENGTH}
              placeholder="Describe the nonconformance"
              value={draft.comment}
              onChange={updateField('comment')}
              disabled={busy}
              required
            />
            <CodeSelect
              id="ncr-failure-code"
              label="Failure code"
              value={draft.failure_code}
              options={failureOptions}
              onChange={updateField('failure_code')}
              disabled={busy}
            />
            <CodeSelect
              id="ncr-disposition-code"
              label="Disposition code"
              value={draft.disposition_code}
              options={dispositionOptions}
              onChange={updateField('disposition_code')}
              disabled={busy}
            />
            <label htmlFor="ncr-disposition-instructions">Disposition Instructions</label>
            <textarea
              id="ncr-disposition-instructions"
              className="form-control"
              rows={4}
              maxLength={NCR_TEXT_MAX_LENGTH}
              placeholder="How should the part be dispositioned?"
              value={draft.disposition_instructions}
              onChange={updateField('disposition_instructions')}
              disabled={busy}
              required
            />
            {(failureCodes.length === 0 || dispositionCodes.length === 0) && (
              <p className="muted">
                {'No codes to choose from? Add them under Project Configuration > NCR Configuration.'}
              </p>
            )}
            {error && <div className="alert alert-error" role="alert">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
