import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageMetadata from '../ImageMetadata';

function renderImageMetadata(props = {}) {
  const defaultProps = {
    imageId: 'img-1',
    image: {
      id: 'img-1',
      project_id: 'proj-1',
      filename: 'slice-001.png',
      size_bytes: 1024,
      content_type: 'image/png',
      uploaded_by_user_id: 'user-1',
      created_at: '2026-06-12T00:00:00Z',
      metadata: { exposure: 'bright' },
    },
    setImage: jest.fn(),
    loading: false,
    setLoading: jest.fn(),
    setError: jest.fn(),
    ...props,
  };
  return { ...render(<ImageMetadata {...defaultProps} />), props: defaultProps };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ImageMetadata project metadata display', () => {
  test('loads and displays project metadata with the image metadata interface', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        'associated_upload_metadata:project:abc123': {
          filename: 'project.json',
          metadata: { operator: 'qa' },
        },
      }),
    });

    renderImageMetadata();

    expect(await screen.findByText('Project Metadata')).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/metadata-dict', expect.any(Object));
    });
    expect(await screen.findByText('associated_upload_metadata:project:abc123')).toBeInTheDocument();
    expect(await screen.findByText(/"operator": "qa"/)).toBeInTheDocument();
  });

  test('read-only mode displays metadata without exposing mutation controls', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ project_field: 'project value' }),
    });

    renderImageMetadata({ readOnly: true });

    expect(screen.getByText('exposure')).toBeInTheDocument();
    expect(screen.getByText('bright')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Metadata' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    expect(await screen.findByText('project_field')).toBeInTheDocument();
    expect(screen.getByText('project value')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).startsWith('/api/images/'))).toBe(false);
  });

  test('switching to read-only mode closes and clears an open metadata dialog', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { rerender, props } = renderImageMetadata();
    expect(await screen.findByText('No project metadata available')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Metadata' })).toBeInTheDocument();

    rerender(<ImageMetadata {...props} readOnly />);
    expect(screen.queryByRole('heading', { name: 'Edit Metadata' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Metadata' })).not.toBeInTheDocument();

    rerender(<ImageMetadata {...props} />);
    expect(screen.queryByRole('heading', { name: 'Edit Metadata' })).not.toBeInTheDocument();
  });

  test('writable dialog save and delete paths still perform their intended requests', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    const { props } = renderImageMetadata();

    fireEvent.click(screen.getByRole('button', { name: 'Add Metadata' }));
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'gain' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/images/img-1/metadata', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ key: 'gain', value: 12 }),
      }));
    });
    expect(props.setImage).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/images/img-1/metadata/exposure',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    expect(window.confirm).toHaveBeenCalledWith(
      'Are you sure you want to delete the metadata key "exposure"?'
    );
  });
});
