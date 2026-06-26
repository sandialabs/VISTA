import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FilenameMetadataExtractor, { applyOverlayIndicatorMetadata, buildConfiguredFilenameFields } from '../FilenameMetadataExtractor';

const makeFile = (name) => new File([''], name, { type: 'image/png' });

const renderExtractor = (props = {}) => {
  const defaultProps = {
    files: [],
    onConfigChange: jest.fn(),
    ...props,
  };
  return render(<FilenameMetadataExtractor {...defaultProps} />);
};



describe('filename configuration helpers', () => {
  test('maps arbitrary custom hierarchy and image descriptor labels to metadata keys', () => {
    const fields = buildConfiguredFilenameFields({
      hierarchy_levels: [
        { id: 'other', label: 'Work Cell', abbreviation: 'WC' },
        { id: 'drawing_number', label: 'Drawing', abbreviation: 'D' },
      ],
      image_descriptors: [
        { id: 'other', label: 'Capture Version', abbreviation: 'v' },
        { id: 'image_identifier', label: 'Image Identifier', abbreviation: 'IMG' },
      ],
    });

    expect(fields.map((field) => field.key)).toEqual([
      'work_cell',
      'design_number',
      'capture_version',
      'image_identifier',
      'overlay',
    ]);
  });

  test('derives overlay truth and base filename from configured overlay specifier', () => {
    const metadata = applyOverlayIndicatorMetadata(
      'D100_LOT1_SET2_SN3_front_visual_v1_overlay.png',
      {
        design_number: 'D100',
        lot_number: 'LOT1',
        set_number: 'SET2',
        serial_number: 'SN3',
        side: 'front',
        modality: 'visual',
        version: 'v1',
        overlay_role: 'overlay',
      },
      ['D100', 'LOT1', 'SET2', 'SN3', 'front', 'visual', 'v1', 'overlay'],
      ['design_number', 'lot_number', 'set_number', 'serial_number', 'side', 'modality', 'version', 'overlay_role'],
      'simple',
      '_',
      { overlay_indicator: { enabled: true, field_key: 'overlay_role', values: ['overlay'], remove_from_base_filename: true } },
    );

    expect(metadata).toEqual(expect.objectContaining({
      overlay: true,
      version: 'v1',
      overlay_base_filename: 'D100_LOT1_SET2_SN3_front_visual_v1.png',
    }));
  });
});

describe('FilenameMetadataExtractor', () => {
  describe('Initial render', () => {
    test('renders mode radio buttons', () => {
      renderExtractor();
      expect(screen.getByLabelText('Simple')).toBeInTheDocument();
      expect(screen.getByLabelText('Advanced (Regex)')).toBeInTheDocument();
    });

    test('Simple mode is selected by default', () => {
      renderExtractor();
      expect(screen.getByLabelText('Simple')).toBeChecked();
      expect(screen.getByLabelText('Advanced (Regex)')).not.toBeChecked();
    });

    test('pattern input shows Delimiter label in simple mode', () => {
      renderExtractor();
      expect(screen.getByLabelText('Delimiter')).toBeInTheDocument();
    });

    test('does not show keys input when pattern is empty', () => {
      renderExtractor();
      expect(screen.queryByLabelText('Keys (comma-separated)')).not.toBeInTheDocument();
    });

    test('calls onConfigChange with isValid=true and hasPattern=false on mount', () => {
      const onConfigChange = jest.fn();
      renderExtractor({ onConfigChange });
      expect(onConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({ isValid: true, hasPattern: false })
      );
    });
  });

  describe('Mode switching', () => {
    test('switching to advanced mode changes label to Regex Pattern', () => {
      renderExtractor();
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      expect(screen.getByLabelText('Regex Pattern')).toBeInTheDocument();
    });

    test('switching back to simple mode restores Delimiter label', () => {
      renderExtractor();
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.click(screen.getByLabelText('Simple'));
      expect(screen.getByLabelText('Delimiter')).toBeInTheDocument();
    });
  });

  describe('Simple mode - delimiter split', () => {
    test('auto-applies VISTA hierarchy preset for matching filenames', async () => {
      const onConfigChange = jest.fn();
      const files = [makeFile('D1001_LOT01_SET01_SN0001_front_visual_false.jpg')];
      renderExtractor({ files, onConfigChange });

      await waitFor(() => {
        expect(screen.getByLabelText('Delimiter')).toHaveValue('_');
        expect(screen.getByLabelText('Keys (comma-separated)')).toHaveValue(
          'design_number, lot_number, set_number, serial_number, side, modality, overlay',
        );
      });

      const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
      expect(lastCall.extractMetadata('D1001_LOT01_SET01_SN0001_front_visual_false.jpg')).toEqual({
        design_number: 'D1001',
        lot_number: 'LOT01',
        set_number: 'SET01',
        serial_number: 'SN0001',
        side: 'front',
        modality: 'visual',
        overlay: 'false',
      });
    });

    test('keeps legacy batch number preset for matching batch filenames', async () => {
      const onConfigChange = jest.fn();
      const files = [makeFile('D1001_LOT01_BATCH01_SN0001_front_visual_false.jpg')];
      renderExtractor({ files, onConfigChange });

      await waitFor(() => {
        expect(screen.getByLabelText('Keys (comma-separated)')).toHaveValue(
          'design_number, lot_number, batch_number, serial_number, side, modality, overlay',
        );
      });

      const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
      expect(lastCall.extractMetadata('D1001_LOT01_BATCH01_SN0001_front_visual_false.jpg')).toEqual(
        expect.objectContaining({
          batch_number: 'BATCH01',
          serial_number: 'SN0001',
        }),
      );
    });

    test('shows keys input after delimiter is entered', () => {
      renderExtractor();
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      expect(screen.getByLabelText('Keys (comma-separated)')).toBeInTheDocument();
    });

    test('shows extracted values array preview when files are selected', async () => {
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });

      await waitFor(() => {
        expect(
          screen.getByText('["123abc","001","front","optical"]')
        ).toBeInTheDocument();
      });
    });

    test('shows JSON preview when keys match value count', async () => {
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial_number, side_identifier, modality' },
      });

      await waitFor(() => {
        expect(screen.getByText(/"lot": "123abc"/)).toBeInTheDocument();
        expect(screen.getByText(/"serial_number": "001"/)).toBeInTheDocument();
      });
    });

    test('shows mismatch warning when key count does not match value count', async () => {
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial_number' },
      });

      await waitFor(() => {
        expect(
          screen.getByText(/Number of values \(4\) does not match number of keys \(2\)/)
        ).toBeInTheDocument();
      });
    });

    test('reports isValid=false on mismatch', async () => {
      const onConfigChange = jest.fn();
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files, onConfigChange });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial_number' },
      });

      await waitFor(() => {
        const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
        expect(lastCall.isValid).toBe(false);
      });
    });

    test('reports isValid=true when key count matches value count', async () => {
      const onConfigChange = jest.fn();
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files, onConfigChange });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial_number, side_identifier, modality' },
      });

      await waitFor(() => {
        const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
        expect(lastCall.isValid).toBe(true);
      });
    });

    test('extractMetadata returns correct object for a matching file', async () => {
      const onConfigChange = jest.fn();
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files, onConfigChange });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial_number, side_identifier, modality' },
      });

      await waitFor(() => {
        const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
        const result = lastCall.extractMetadata('123abc_001_front_optical.png');
        expect(result).toEqual({
          lot: '123abc',
          serial_number: '001',
          side_identifier: 'front',
          modality: 'optical',
        });
      });
    });

    test('extractMetadata returns null when no pattern is set', async () => {
      const onConfigChange = jest.fn();
      renderExtractor({ onConfigChange });

      await waitFor(() => {
        const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
        expect(lastCall.extractMetadata('any_file.png')).toBeNull();
      });
    });
  });

  describe('Advanced (Regex) mode', () => {
    test('shows Regex Pattern label in advanced mode', () => {
      renderExtractor();
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      expect(screen.getByLabelText('Regex Pattern')).toBeInTheDocument();
    });

    test('shows extracted values from capture groups', async () => {
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files });
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.change(screen.getByLabelText('Regex Pattern'), {
        target: { value: '(.+)_(.+)_(.+)_(.+)' },
      });

      await waitFor(() => {
        expect(
          screen.getByText('["123abc","001","front","optical"]')
        ).toBeInTheDocument();
      });
    });

    test('shows error message for invalid regex', async () => {
      renderExtractor();
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.change(screen.getByLabelText('Regex Pattern'), {
        target: { value: '*invalid' },
      });

      await waitFor(() => {
        expect(screen.getByText(/Invalid regex:/)).toBeInTheDocument();
      });
    });

    test('reports isValid=false for invalid regex', async () => {
      const onConfigChange = jest.fn();
      renderExtractor({ onConfigChange });
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.change(screen.getByLabelText('Regex Pattern'), {
        target: { value: '*invalid' },
      });

      await waitFor(() => {
        const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
        expect(lastCall.isValid).toBe(false);
      });
    });

    test('shows "Pattern does not match filename" when regex has no match', async () => {
      const files = [makeFile('123abc_001_front_optical.png')];
      renderExtractor({ files });
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.change(screen.getByLabelText('Regex Pattern'), {
        target: { value: '^nomatch$' },
      });

      await waitFor(() => {
        expect(screen.getByText('Pattern does not match filename')).toBeInTheDocument();
      });
    });

    test('falls back to full match when no capture groups', async () => {
      const files = [makeFile('sample.png')];
      renderExtractor({ files });
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.change(screen.getByLabelText('Regex Pattern'), {
        target: { value: 'sample' },
      });

      await waitFor(() => {
        expect(screen.getByText('["sample"]')).toBeInTheDocument();
      });
    });

    test('extractMetadata uses regex capture groups correctly', async () => {
      const onConfigChange = jest.fn();
      const files = [makeFile('lot123-SN001_front_optical.png')];
      renderExtractor({ files, onConfigChange });
      fireEvent.click(screen.getByLabelText('Advanced (Regex)'));
      fireEvent.change(screen.getByLabelText('Regex Pattern'), {
        target: { value: 'lot(\\w+)-SN(\\d+)_(\\w+)_(\\w+)' },
      });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial_number, side_identifier, modality' },
      });

      await waitFor(() => {
        const lastCall = onConfigChange.mock.calls[onConfigChange.mock.calls.length - 1][0];
        const result = lastCall.extractMetadata('lot123-SN001_front_optical.png');
        expect(result).toEqual({
          lot: '123',
          serial_number: '001',
          side_identifier: 'front',
          modality: 'optical',
        });
      });
    });
  });

  describe('File extension handling', () => {
    test('strips extension before splitting', async () => {
      const files = [makeFile('a_b_c.png')];
      renderExtractor({ files });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });

      await waitFor(() => {
        // Should be ["a","b","c"] not ["a","b","c.png"]
        expect(screen.getByText('["a","b","c"]')).toBeInTheDocument();
      });
    });

    test('handles files without extension', async () => {
      const files = [makeFile('a_b_c')];
      renderExtractor({ files });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });

      await waitFor(() => {
        expect(screen.getByText('["a","b","c"]')).toBeInTheDocument();
      });
    });
  });

  describe('No files selected', () => {
    test('does not show value preview when no files are selected', () => {
      renderExtractor({ files: [] });
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      expect(screen.queryByText(/Extracted Values/)).not.toBeInTheDocument();
    });
  });
});
