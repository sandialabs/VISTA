import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import Pt3GaussianSplatViewer from '../Pt3GaussianSplatViewer';
import { normalizePt3Segmentation } from '../pt3Segmentation';
import { createThreeMechanicalRenderer } from '../pt3ThreeRenderer';

jest.mock('../pt3ThreeRenderer', () => ({
  ...jest.requireActual('../pt3ThreeRenderer'),
  createThreeMechanicalRenderer: jest.fn(),
}));

describe('PT3 Real 3DGS red-team boundaries', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    createThreeMechanicalRenderer.mockReset();
    createThreeMechanicalRenderer.mockResolvedValue(null);
    // Keep the incidental status poll pending; neither adversarial assertion
    // depends on it, and this avoids racing an unrelated React state update.
    global.fetch = jest.fn(() => new Promise(() => {}));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('normalizes the full label volume accepted by direct fitting for ray marching', () => {
    const contract = normalizePt3Segmentation({
      metadata: {
        pt3_segmentation: {
          segments: [{ id: 1, label: 'Shell' }, { id: 2, label: 'Core' }],
          labels: [
            [[1, 0], [0, 2]],
            [[0, 1], [2, 0]],
          ],
        },
      },
    });

    expect(contract.labelSlices).toEqual([
      { sliceIndex: 0, labels: [1, 0, 0, 2] },
      { sliceIndex: 1, labels: [0, 1, 2, 0] },
    ]);
  });

  test('does not call arbitrary objects calibrated views or enable view fitting', async () => {
    const part = {
      id: 'part-invalid-cameras',
      metadata: {
        volume_shape: { sagittal: 2, coronal: 2, axial: 1 },
        pt3_real_3dgs: { cameras: [{}, {}] },
      },
    };
    render(<Pt3GaussianSplatViewer part={part} projectId="project-red" mode="real-splat" />);

    fireEvent.change(await screen.findByLabelText('Real 3DGS fitting strategy'), {
      target: { value: 'synthetic_views' },
    });

    expect(screen.getByRole('button', { name: 'Train 3DGS splats' })).toBeDisabled();
    expect(screen.getByText('At least two calibrated or generated views are required')).toBeInTheDocument();
  });
});
