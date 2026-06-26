import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectDataMetadataTab from '../ProjectDataMetadataTab';
import InspectionWorkbenchPanel from '../InspectionWorkbenchPanel';

const nsiproProjectMetadata = {
  filename: 'sample.nsipro',
  file_type: 'nsipro',
  parser: 'nsipro-key-value',
  parser_id: 'default',
  metadata: {
    capture: {
      operator: 'alice',
      scanner: 'CT-9',
      exposure: 12,
    },
  },
};

const assignedPt3Images = [
  { id: 'img-axial-1', filename: 'slice-001.png', metadata: { side: 'axial', modality: 'ct' } },
];

function buildPt3Part(metadataPatch = {}) {
  return {
    id: 'part-pt3-1',
    batch_id: 'batch-pt3',
    serial_number: 'SN-PT3-001',
    display_name: 'PT3 assigned part',
    review_state: 'unreviewed',
    metadata: {
      configured_views: ['axial'],
      modalities: ['ct'],
      view_images: { axial: 'slice-001.png' },
      volume_shape: { axial: 8, coronal: 8, sagittal: 8 },
      source_images: [
        { filename: 'slice-001.png', image_id: 'img-axial-1', side: 'axial', modality: 'ct', overlay: false },
      ],
      ...metadataPatch,
    },
  };
}

describe('ProjectDataMetadataTab', () => {
  afterEach(() => {
    delete global.fetch;
  });

  test('associates a loaded sample .nsipro source to an assigned PT3 part and displays it in inspection metadata', async () => {
    let parts = [buildPt3Part()];
    const metadata = { 'associated_upload_metadata:sample.nsipro': nsiproProjectMetadata };

    global.fetch = jest.fn((url, options = {}) => {
      if (url.includes('/metadata-sources') && options.method === 'PUT') {
        const payload = JSON.parse(options.body || '{}');
        parts = parts.map((part) => (part.id === 'part-pt3-1'
          ? buildPt3Part({
            associated_metadata_refs: payload.metadata_source_keys,
            associated_metadata_ref: payload.metadata_source_keys[0],
            associated_metadata_sources: [{ project_metadata_key: payload.metadata_source_keys[0], filename: 'sample.nsipro', file_type: 'nsipro' }],
            nsipro_metadata_sources: [{ key: payload.metadata_source_keys[0], ...nsiproProjectMetadata }],
            nsipro_metadata: nsiproProjectMetadata.metadata,
          })
          : part));
        return Promise.resolve({ ok: true, json: async () => parts.find((part) => part.id === 'part-pt3-1') });
      }
      if (url.includes('/batches')) return Promise.resolve({ ok: true, json: async () => [{ id: 'batch-pt3', name: 'PT3 Batch' }] });
      if (url.includes('/parts/') && url.includes('/annotations') && (!options.method || options.method === 'GET')) {
        return Promise.resolve({ ok: true, json: async () => ({ part_id: 'part-pt3-1', annotations: [] }) });
      }
      if (url.includes('/parts')) return Promise.resolve({ ok: true, json: async () => parts });
      if (url.includes('/workspace-state')) return Promise.resolve({ ok: true, json: async () => ({ state: { selected_batch_id: 'batch-pt3', selected_part_id: 'part-pt3-1' } }) });
      if (url.includes('/configuration')) return Promise.resolve({ ok: true, json: async () => ({ config: {} }) });
      if (url.includes('/metadata-dict')) return Promise.resolve({ ok: true, json: async () => metadata });
      if (url.includes('/images?include_deleted=true&limit=5000')) return Promise.resolve({ ok: true, json: async () => assignedPt3Images });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { unmount } = render(
      <ProjectDataMetadataTab
        projectId="proj-1"
        metadata={metadata}
        parts={parts}
        onAssociationsChanged={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /associated_upload_metadata:sample\.nsipro/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /PT3 assigned part/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/parts/part-pt3-1/metadata-sources', expect.objectContaining({ method: 'PUT' })));
    expect(parts[0].metadata.nsipro_metadata.capture.scanner).toBe('CT-9');
    unmount();

    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" />);
    expect(await screen.findByText('PT3 assigned part')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }));

    expect(await screen.findByRole('heading', { name: 'Part Metadata' })).toBeInTheDocument();
    expect(screen.getByText('metadata.nsipro_metadata.capture.operator')).toBeInTheDocument();
    expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
    expect(screen.getByText('metadata.nsipro_metadata.capture.scanner')).toBeInTheDocument();
    expect(screen.getAllByText('CT-9').length).toBeGreaterThan(0);
  });

  test('view opens a user-friendly field table for a project-level metadata source', async () => {
    render(
      <ProjectDataMetadataTab
        projectId="proj-1"
        metadata={{ sample: nsiproProjectMetadata }}
        parts={[buildPt3Part()]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog', { name: /Metadata source sample/i });
    expect(within(dialog).getByText('metadata.capture.operator')).toBeInTheDocument();
    expect(within(dialog).getByText('alice')).toBeInTheDocument();
  });
});
