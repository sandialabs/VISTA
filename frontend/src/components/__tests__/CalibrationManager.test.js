import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CalibrationManager from '../CalibrationManager';

describe('CalibrationManager', () => {
  const defaultProps = {
    projectId: 'project-123',
    imageId: 'image-456',
    image: null,
    onCalibrationChange: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when no calibration exists', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({
        ok: false
      });
    });

    it('shows "No calibration set" message', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(/No calibration set/)).toBeInTheDocument();
      });
    });

    it('shows "Set Calibration" button', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });
    });

    it('calls onCalibrationChange with null', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(defaultProps.onCalibrationChange).toHaveBeenCalledWith(null);
      });
    });
  });

  describe('when project default calibration exists', () => {
    const projectCalibration = {
      pixels_per_mm: 10,
      pixels_per_inch: 254,
      unit: 'mm'
    };

    beforeEach(() => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ calibration_default: projectCalibration })
      });
    });

    it('displays calibration values', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('10.00 px/mm')).toBeInTheDocument();
      });
    });

    it('shows "Using project default calibration" label', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Using project default calibration')).toBeInTheDocument();
      });
    });

    it('shows Edit button', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      });
    });

    it('calls onCalibrationChange with calibration data', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(defaultProps.onCalibrationChange).toHaveBeenCalledWith(projectCalibration);
      });
    });
  });

  describe('when image has calibration override', () => {
    const imageCalibration = {
      pixels_per_mm: 20,
      pixels_per_inch: 508,
      unit: 'mm'
    };

    it('uses image override instead of project default', async () => {
      const imageWithOverride = {
        metadata: {
          calibration_override: imageCalibration
        }
      };

      render(<CalibrationManager {...defaultProps} image={imageWithOverride} />);

      await waitFor(() => {
        expect(screen.getByText('20.00 px/mm')).toBeInTheDocument();
        expect(screen.getByText('Using image-specific calibration')).toBeInTheDocument();
      });

      // Should not fetch project default when image has override
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('also checks metadata_ field for compatibility', async () => {
      const imageWithOverride = {
        metadata_: {
          calibration_override: imageCalibration
        }
      };

      render(<CalibrationManager {...defaultProps} image={imageWithOverride} />);

      await waitFor(() => {
        expect(screen.getByText('20.00 px/mm')).toBeInTheDocument();
      });
    });

    it('shows "Clear Image Override" button', async () => {
      const imageWithOverride = {
        metadata: {
          calibration_override: imageCalibration
        }
      };

      render(<CalibrationManager {...defaultProps} image={imageWithOverride} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Clear Image Override' })).toBeInTheDocument();
      });
    });
  });

  describe('edit form', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({
        ok: false
      });
    });

    it('opens edit form when Set Calibration is clicked', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      expect(screen.getByText('Pixels per:')).toBeInTheDocument();
      expect(screen.getByLabelText('Millimeter')).toBeInTheDocument();
      expect(screen.getByLabelText('Inch')).toBeInTheDocument();
    });

    it('opens edit form when Edit button is clicked', async () => {
      const projectCalibration = {
        pixels_per_mm: 10,
        pixels_per_inch: 254,
        unit: 'mm'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ calibration_default: projectCalibration })
      });

      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByText('Pixels per:')).toBeInTheDocument();
      // Should pre-fill with existing value
      const input = screen.getByRole('spinbutton');
      expect(input.value).toBe('10');
    });

    it('closes edit form when Cancel is clicked', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));
      expect(screen.getByText('Pixels per:')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByText('Pixels per:')).not.toBeInTheDocument();
    });

    it('shows unit conversion preview', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '10' } });

      // Should show conversion to inches (10 * 25.4 = 254)
      expect(screen.getByText('= 254.00 px/inch')).toBeInTheDocument();
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({
        ok: false
      });
    });

    it('shows error for non-positive numbers', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '-5' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save as Project Default' }));

      expect(screen.getByText('Calibration must be a positive number')).toBeInTheDocument();
    });

    it('shows error for zero', async () => {
      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '0' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save as Project Default' }));

      expect(screen.getByText('Calibration must be a positive number')).toBeInTheDocument();
    });
  });

  describe('saving calibration', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({
        ok: false
      });
    });

    it('saves project default calibration', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false }) // Initial load
        .mockResolvedValueOnce({ ok: true }); // Save

      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '15' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save as Project Default' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/project-123/metadata',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('calibration_default')
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Project calibration saved successfully')).toBeInTheDocument();
      });
    });

    it('saves image-specific calibration', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false }) // Initial load
        .mockResolvedValueOnce({ ok: true }); // Save

      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '20' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save for This Image Only' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/images/image-456/metadata',
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('calibration_override')
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText('Image-specific calibration saved successfully')).toBeInTheDocument();
      });
    });

    it('shows error when save fails', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false }) // Initial load
        .mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error' }); // Save fails

      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '15' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save as Project Default' }));

      await waitFor(() => {
        expect(screen.getByText(/Failed to save project calibration/)).toBeInTheDocument();
      });
    });
  });

  describe('clearing image override', () => {
    const imageCalibration = {
      pixels_per_mm: 20,
      pixels_per_inch: 508,
      unit: 'mm'
    };

    it('clears override when confirmed', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(true);

      global.fetch.mockResolvedValue({ ok: true });

      const imageWithOverride = {
        metadata: {
          calibration_override: imageCalibration
        }
      };

      render(<CalibrationManager {...defaultProps} image={imageWithOverride} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Clear Image Override' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear Image Override' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/images/image-456/metadata/calibration_override',
          expect.objectContaining({ method: 'DELETE' })
        );
      });
    });

    it('does not clear override when cancelled', async () => {
      jest.spyOn(window, 'confirm').mockReturnValue(false);

      const imageWithOverride = {
        metadata: {
          calibration_override: imageCalibration
        }
      };

      render(<CalibrationManager {...defaultProps} image={imageWithOverride} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Clear Image Override' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear Image Override' }));

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('unit conversion', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({ ok: false });
    });

    it('correctly converts mm to inches when saving', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      // Enter 10 px/mm
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '10' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save as Project Default' }));

      await waitFor(() => {
        const fetchCall = global.fetch.mock.calls[1];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.value.pixels_per_mm).toBe(10);
        expect(body.value.pixels_per_inch).toBe(254); // 10 * 25.4
        expect(body.value.unit).toBe('mm');
      });
    });

    it('correctly converts inches to mm when saving', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      render(<CalibrationManager {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      // Switch to inches
      fireEvent.click(screen.getByLabelText('Inch'));

      // Enter 254 px/inch
      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '254' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save as Project Default' }));

      await waitFor(() => {
        const fetchCall = global.fetch.mock.calls[1];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.value.pixels_per_inch).toBe(254);
        expect(body.value.pixels_per_mm).toBe(10); // 254 / 25.4
        expect(body.value.unit).toBe('inches');
      });
    });
  });

  describe('metadata-based calibration rules', () => {
    const ruleCalibration = {
      pixels_per_mm: 15,
      pixels_per_inch: 381,
      unit: 'mm'
    };
    const projectCalibration = {
      pixels_per_mm: 10,
      pixels_per_inch: 254,
      unit: 'mm'
    };

    it('uses metadata rule when image metadata matches a project rule', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'a47' }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_rules: [
            { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
          ]
        })
      });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByText('15.00 px/mm')).toBeInTheDocument();
        expect(screen.getByText('Using metadata rule: camera = a47')).toBeInTheDocument();
      });

      expect(defaultProps.onCalibrationChange).toHaveBeenCalledWith(ruleCalibration);
    });

    it('metadata rule takes priority over project default', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'a47' }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_default: projectCalibration,
          calibration_rules: [
            { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
          ]
        })
      });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByText('15.00 px/mm')).toBeInTheDocument();
        expect(screen.getByText('Using metadata rule: camera = a47')).toBeInTheDocument();
      });
    });

    it('image override takes priority over metadata rule', async () => {
      const imageCalibration = { pixels_per_mm: 20, pixels_per_inch: 508, unit: 'mm' };
      const imageWithOverrideAndMetadata = {
        metadata: {
          calibration_override: imageCalibration,
          camera: 'a47'
        }
      };

      render(<CalibrationManager {...defaultProps} image={imageWithOverrideAndMetadata} />);

      await waitFor(() => {
        expect(screen.getByText('20.00 px/mm')).toBeInTheDocument();
        expect(screen.getByText('Using image-specific calibration')).toBeInTheDocument();
      });

      // Should not fetch project data when image has override
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls back to project default when no metadata rule matches', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'other-camera' }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_default: projectCalibration,
          calibration_rules: [
            { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
          ]
        })
      });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByText('10.00 px/mm')).toBeInTheDocument();
        expect(screen.getByText('Using project default calibration')).toBeInTheDocument();
      });
    });

    it('ignores rules when image has no metadata', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_default: projectCalibration,
          calibration_rules: [
            { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
          ]
        })
      });

      render(<CalibrationManager {...defaultProps} image={{}} />);

      await waitFor(() => {
        expect(screen.getByText('Using project default calibration')).toBeInTheDocument();
      });
    });

    it('saves a new metadata calibration rule', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'a47' }
      };

      global.fetch
        .mockResolvedValueOnce({ ok: false }) // Initial load (no calibration)
        .mockResolvedValueOnce({ // Fetch current rules before saving
          ok: true,
          json: () => Promise.resolve({ calibration_rules: [] })
        })
        .mockResolvedValueOnce({ ok: true }) // Save rule
        .mockResolvedValueOnce({ // Reload after save
          ok: true,
          json: () => Promise.resolve({
            calibration_rules: [
              { metadata_key: 'camera', metadata_value: 'a47', calibration: { pixels_per_mm: 12, pixels_per_inch: 304.8, unit: 'mm' } }
            ]
          })
        });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '12' } });

      // Select metadata key in the form
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'camera' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save for camera = a47' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/project-123/metadata',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('calibration_rules')
          })
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Metadata calibration rule saved/)).toBeInTheDocument();
      });
    });

    it('shows Remove Metadata Rule button when a rule is matched', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'a47' }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_rules: [
            { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
          ]
        })
      });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Remove Metadata Rule' })).toBeInTheDocument();
      });
    });

    it('does not show Remove Metadata Rule button for project default', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_default: projectCalibration
        })
      });

      render(<CalibrationManager {...defaultProps} image={{}} />);

      await waitFor(() => {
        expect(screen.getByText('Using project default calibration')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: 'Remove Metadata Rule' })).not.toBeInTheDocument();
    });

    it('deletes a metadata rule after confirmation', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'a47' }
      };

      jest.spyOn(window, 'confirm').mockReturnValue(true);

      global.fetch
        .mockResolvedValueOnce({ // Initial load
          ok: true,
          json: () => Promise.resolve({
            calibration_rules: [
              { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
            ]
          })
        })
        .mockResolvedValueOnce({ // Fetch rules before delete
          ok: true,
          json: () => Promise.resolve({
            calibration_rules: [
              { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration },
              { metadata_key: 'lens', metadata_value: '50mm', calibration: projectCalibration }
            ]
          })
        })
        .mockResolvedValueOnce({ ok: true }) // Save updated rules
        .mockResolvedValueOnce({ // Reload after delete
          ok: true,
          json: () => Promise.resolve({
            calibration_rules: [
              { metadata_key: 'lens', metadata_value: '50mm', calibration: projectCalibration }
            ]
          })
        });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Remove Metadata Rule' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Remove Metadata Rule' }));

      expect(window.confirm).toHaveBeenCalledWith(
        'Remove calibration rule for camera = a47?'
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/project-123/metadata',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('calibration_rules')
          })
        );
      });

      // Verify the saved rules don't include the deleted one
      const saveCall = global.fetch.mock.calls.find(
        ([url, opts]) => url === '/api/projects/project-123/metadata' && opts?.method === 'POST'
      );
      const savedBody = JSON.parse(saveCall[1].body);
      expect(savedBody.value).toHaveLength(1);
      expect(savedBody.value[0].metadata_key).toBe('lens');

      await waitFor(() => {
        expect(screen.getByText(/Metadata rule removed/)).toBeInTheDocument();
      });
    });

    it('does not delete when confirmation is cancelled', async () => {
      const imageWithMetadata = {
        metadata: { camera: 'a47' }
      };

      jest.spyOn(window, 'confirm').mockReturnValue(false);

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_rules: [
            { metadata_key: 'camera', metadata_value: 'a47', calibration: ruleCalibration }
          ]
        })
      });

      render(<CalibrationManager {...defaultProps} image={imageWithMetadata} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Remove Metadata Rule' })).toBeInTheDocument();
      });

      global.fetch.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Remove Metadata Rule' }));

      expect(window.confirm).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
