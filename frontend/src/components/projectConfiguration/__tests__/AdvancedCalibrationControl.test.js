import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdvancedCalibrationControl from '../AdvancedCalibrationControl';

describe('AdvancedCalibrationControl', () => {
  const modalityOptions = [
    { id: 'optical', label: 'Optical' },
    { id: 'acoustic', label: 'Acoustic' },
  ];

  const defaultProps = {
    projectId: 'project-123',
    disabled: false,
    modalityOptions,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a message when no modalities are configured', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<AdvancedCalibrationControl {...defaultProps} modalityOptions={[]} />);

    await waitFor(() => {
      expect(screen.getByText(/Configure image modalities under Filename Convention/)).toBeInTheDocument();
    });
  });

  it('shows no rules configured when calibration_rules is empty', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    render(<AdvancedCalibrationControl {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No per-modality calibration configured yet.')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Modality')).toBeInTheDocument();
  });

  it('lists only modality calibration rules, ignoring other metadata-keyed rules', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        calibration_rules: [
          { metadata_key: 'camera', metadata_value: 'a47', calibration: { pixels_per_mm: 1, pixels_per_inch: 25.4, unit: 'mm' } },
          { metadata_key: 'modality', metadata_value: 'acoustic', calibration: { pixels_per_mm: 15, pixels_per_inch: 381, unit: 'mm' } },
        ],
      }),
    });

    render(<AdvancedCalibrationControl {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Acoustic')).toBeInTheDocument();
    });
    expect(screen.queryByText('a47')).not.toBeInTheDocument();
    expect(screen.getByText('15 px/mm')).toBeInTheDocument();
    // Only the still-uncalibrated modality is offered in the add form.
    expect(screen.getByRole('option', { name: 'Optical' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Acoustic' })).not.toBeInTheDocument();
  });

  it('adds a calibration rule for a selected modality', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // save

    render(<AdvancedCalibrationControl {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Modality')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Modality'), { target: { value: 'acoustic' } });
    fireEvent.change(screen.getByLabelText('Advanced calibration pixels per millimeter'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Calibration' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/project-123/metadata',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"metadata_value":"acoustic"'),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Calibration saved for Acoustic.')).toBeInTheDocument();
    });
  });

  it('replaces an existing rule for the same modality rather than duplicating it', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calibration_rules: [
            { metadata_key: 'modality', metadata_value: 'acoustic', calibration: { pixels_per_mm: 15, pixels_per_inch: 381, unit: 'mm' } },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    render(<AdvancedCalibrationControl {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Acoustic')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove calibration for Acoustic' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/project-123/metadata',
        expect.objectContaining({
          method: 'POST',
          body: '{"key":"calibration_rules","value":[]}',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Calibration removed for Acoustic.')).toBeInTheDocument();
    });
    expect(screen.getByText('No per-modality calibration configured yet.')).toBeInTheDocument();
  });

  it('shows an error when saving fails', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ detail: 'Server error' }) });

    render(<AdvancedCalibrationControl {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Modality')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Modality'), { target: { value: 'optical' } });
    fireEvent.change(screen.getByLabelText('Advanced calibration pixels per millimeter'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Calibration' }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });
});
