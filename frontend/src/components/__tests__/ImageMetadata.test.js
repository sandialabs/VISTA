import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
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
      expect(global.fetch).toHaveBeenCalledWith('/api/projects/proj-1/metadata-dict');
    });
    expect(screen.getByText('associated_upload_metadata:project:abc123')).toBeInTheDocument();
    expect(screen.getByText(/"operator": "qa"/)).toBeInTheDocument();
  });
});
