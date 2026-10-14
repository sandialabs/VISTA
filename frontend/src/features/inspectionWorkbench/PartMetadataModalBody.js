import { formatMetadataValue, getPartMetadataBreakout, collectMetadataLeafEntries } from './metadataHelpers';

function MetadataTable({ rows, emptyMessage }) {
  if (!rows.length) return <p className="metadata-modal-empty">{emptyMessage}</p>;
  return (
    <table className="metadata-modal-table">
      <thead>
        <tr>
          <th scope="col">Metadata path</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.path}>
            <td className="metadata-modal-path"><code>{row.path}</code></td>
            <td><pre>{formatMetadataValue(row.value)}</pre></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PartMetadataModalBody(props) {
  const {
    selectedPart,
    activeMetadataTab,
    setActiveMetadataTab,
  } = props;
  if (!selectedPart) return <p className="metadata-modal-empty">Select a part to view metadata.</p>;
  const { nsiproEntries, otherMetadata } = getPartMetadataBreakout(selectedPart);
  const otherRows = collectMetadataLeafEntries(otherMetadata);
  return (
    <div className="part-metadata-modal-body">
      <div className="metadata-modal-part-summary">
        <strong>{selectedPart.display_name || selectedPart.serial_number || selectedPart.id}</strong>
        <span>{selectedPart.serial_number || selectedPart.id}</span>
      </div>
      <div className="project-tabs metadata-modal-tabs" role="tablist" aria-label="Part metadata categories">
        <button
          type="button"
          role="tab"
          aria-selected={activeMetadataTab === 'nsipro'}
          className={`project-tab ${activeMetadataTab === 'nsipro' ? 'active' : ''}`}
          onClick={() => setActiveMetadataTab('nsipro')}
        >
          .nsipro
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeMetadataTab === 'other'}
          className={`project-tab ${activeMetadataTab === 'other' ? 'active' : ''}`}
          onClick={() => setActiveMetadataTab('other')}
        >
          Other
        </button>
      </div>
      <section
        className="metadata-modal-tab-panel"
        role="tabpanel"
        aria-label={activeMetadataTab === 'nsipro' ? '.nsipro metadata' : 'Other metadata'}
      >
        {activeMetadataTab === 'nsipro'
          ? <MetadataTable rows={nsiproEntries} emptyMessage={'No .nsipro metadata was found for the current part.'} />
          : <MetadataTable rows={otherRows} emptyMessage={'No other metadata was found for the current part.'} />}
      </section>
    </div>
  );
}
