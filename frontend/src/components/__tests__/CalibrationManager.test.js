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
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // Save

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
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // Save

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

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false });

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
        expect(defaultProps.onCalibrationChange).toHaveBeenLastCalledWith(null);
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
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

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
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

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
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // Save rule
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
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // Save updated rules
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

  describe('read-only mode', () => {
    it('hides calibration creation and save controls', async () => {
      global.fetch.mockResolvedValue({ ok: false });

      const { rerender } = render(
        <CalibrationManager {...defaultProps} readOnly={false} />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));
      expect(screen.getByRole('button', { name: 'Save as Project Default' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save for This Image Only' })).toBeInTheDocument();

      rerender(<CalibrationManager {...defaultProps} readOnly />);

      await waitFor(() => {
        expect(screen.queryByText('Pixels per:')).not.toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'Set Calibration' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save as Project Default' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save for This Image Only' })).not.toBeInTheDocument();
    });

    it('hides edit and clear controls for an image override', async () => {
      const imageWithOverride = {
        metadata: {
          calibration_override: {
            pixels_per_mm: 20,
            pixels_per_inch: 508,
            unit: 'mm'
          }
        }
      };

      render(
        <CalibrationManager
          {...defaultProps}
          image={imageWithOverride}
          readOnly
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Using image-specific calibration')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clear Image Override' })).not.toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('hides edit and delete controls for a matched metadata rule', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          calibration_rules: [{
            metadata_key: 'camera',
            metadata_value: 'a47',
            calibration: {
              pixels_per_mm: 15,
              pixels_per_inch: 381,
              unit: 'mm'
            }
          }]
        })
      });

      render(
        <CalibrationManager
          {...defaultProps}
          image={{ metadata: { camera: 'a47' } }}
          readOnly
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Using metadata rule/)).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove Metadata Rule' })).not.toBeInTheDocument();
    });
  });

  describe('async route ownership', () => {
    it('aborts image A loading and ignores its response after image B is active', async () => {
      let resolveImageA;
      let resolveImageB;
      const imageAResponse = new Promise(resolve => {
        resolveImageA = resolve;
      });
      const imageBResponse = new Promise(resolve => {
        resolveImageB = resolve;
      });
      const imageACalibration = {
        pixels_per_mm: 11,
        pixels_per_inch: 279.4,
        unit: 'mm'
      };
      const imageBCalibration = {
        pixels_per_mm: 22,
        pixels_per_inch: 558.8,
        unit: 'mm'
      };

      global.fetch
        .mockReturnValueOnce(imageAResponse)
        .mockReturnValueOnce(imageBResponse);

      const { rerender } = render(
        <CalibrationManager
          {...defaultProps}
          projectId="project-a"
          imageId="image-a"
        />
      );

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      const imageASignal = global.fetch.mock.calls[0][1].signal;

      rerender(
        <CalibrationManager
          {...defaultProps}
          projectId="project-b"
          imageId="image-b"
        />
      );

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
      expect(imageASignal.aborted).toBe(true);

      resolveImageB({
        ok: true,
        json: () => Promise.resolve({ calibration_default: imageBCalibration })
      });

      await waitFor(() => {
        expect(screen.getByText('22.00 px/mm')).toBeInTheDocument();
      });

      resolveImageA({
        ok: true,
        json: () => Promise.resolve({ calibration_default: imageACalibration })
      });

      await waitFor(() => {
        expect(screen.getByText('22.00 px/mm')).toBeInTheDocument();
      });
      expect(screen.queryByText('11.00 px/mm')).not.toBeInTheDocument();
      expect(defaultProps.onCalibrationChange).not.toHaveBeenCalledWith(imageACalibration);
      expect(defaultProps.onCalibrationChange).toHaveBeenLastCalledWith(imageBCalibration);
    });

    it('ignores a completed image A override save after navigating to image B', async () => {
      let resolveImageASave;
      const imageASave = new Promise(resolve => {
        resolveImageASave = resolve;
      });
      const imageBCalibration = {
        pixels_per_mm: 22,
        pixels_per_inch: 558.8,
        unit: 'mm'
      };

      global.fetch.mockImplementation((url, options = {}) => {
        if (url === '/api/images/image-a/metadata' && options.method === 'PUT') {
          return imageASave;
        }
        if (url === '/api/projects/project-b/metadata-dict') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ calibration_default: imageBCalibration })
          });
        }
        return Promise.resolve({ ok: false });
      });

      const { rerender } = render(
        <CalibrationManager
          {...defaultProps}
          projectId="project-a"
          imageId="image-a"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Set Calibration' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set Calibration' }));
      fireEvent.change(screen.getByRole('spinbutton'), {
        target: { value: '15' }
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save for This Image Only' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/images/image-a/metadata',
          expect.objectContaining({ method: 'PUT' })
        );
      });
      const saveCall = global.fetch.mock.calls.find(
        ([url, options]) => url === '/api/images/image-a/metadata' && options?.method === 'PUT'
      );

      rerender(
        <CalibrationManager
          {...defaultProps}
          projectId="project-b"
          imageId="image-b"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('22.00 px/mm')).toBeInTheDocument();
      });
      expect(saveCall[1].signal.aborted).toBe(true);

      resolveImageASave({ ok: true, json: async () => ({}) });

      await waitFor(() => {
        expect(screen.getByText('22.00 px/mm')).toBeInTheDocument();
      });
      expect(screen.queryByText('15.00 px/mm')).not.toBeInTheDocument();
      expect(screen.queryByText('Image-specific calibration saved successfully')).not.toBeInTheDocument();
      expect(defaultProps.onCalibrationChange).toHaveBeenLastCalledWith(imageBCalibration);
    });
  });
});
