import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MeasurementTool from '../MeasurementTool';

describe('MeasurementTool', () => {
  const defaultProps = {
    containerSize: { width: 800, height: 600 },
    naturalSize: { width: 1600, height: 1200 },
    zoomLevel: 1,
    calibration: {
      pixels_per_mm: 10,
      pixels_per_inch: 254,
      unit: 'mm'
    },
    onSaveMeasurement: jest.fn(),
    onCancel: jest.fn(),
    existingMeasurementCount: 0
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when no calibration is set', () => {
    it('shows "No Calibration Set" message when measure mode is active', () => {
      render(<MeasurementTool {...defaultProps} calibration={null} leftClickEnabled={true} />);

      expect(screen.getByText('No Calibration Set')).toBeInTheDocument();
      expect(screen.getByText(/Please set calibration/)).toBeInTheDocument();
    });

    it('shows Close button that calls onCancel when measure mode is active', () => {
      render(<MeasurementTool {...defaultProps} calibration={null} leftClickEnabled={true} />);

      const closeButton = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeButton);

      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not show calibration error on render when not in measure mode', () => {
      render(<MeasurementTool {...defaultProps} calibration={null} />);

      expect(screen.queryByText('No Calibration Set')).not.toBeInTheDocument();
    });
  });

  describe('when calibration is set', () => {
    it('renders the drawing overlay', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('width', '800');
      expect(svg).toHaveAttribute('height', '600');
    });

    it('has crosshair cursor on the overlay when in measure mode', () => {
      const { container } = render(<MeasurementTool {...defaultProps} leftClickEnabled={true} />);

      const overlay = container.querySelector('div[style*="cursor: crosshair"]');
      expect(overlay).toBeInTheDocument();
    });

    it('uses inherit cursor when not in measure mode (pan cursor shows through)', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);

      const overlay = container.querySelector('div[style*="cursor: inherit"]');
      expect(overlay).toBeInTheDocument();
    });
  });

  describe('keyboard shortcuts', () => {
    it('calls onCancel when Escape is pressed and no dialog is open', () => {
      render(<MeasurementTool {...defaultProps} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('drawing interaction', () => {
    it('does not show line before drawing', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);

      const line = container.querySelector('line');
      expect(line).not.toBeInTheDocument();
    });

    it('discards measurements shorter than 1 pixel', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);

      const overlay = container.querySelector('div[style*="cursor"]');

      // Mock getBoundingClientRect
      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600
      }));

      // Click without dragging (0-pixel line)
      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });
      fireEvent.mouseUp(overlay, { clientX: 100, clientY: 100 });

      // Save dialog should not appear
      expect(screen.queryByText('Save Measurement')).not.toBeInTheDocument();
    });

    it('shows save dialog after valid measurement', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);

      const overlay = container.querySelector('div[style*="cursor"]');

      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600
      }));

      // Draw a line longer than 5 pixels
      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });
      fireEvent.mouseMove(overlay, { clientX: 200, clientY: 100 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });

      expect(screen.getByText('Save Measurement')).toBeInTheDocument();
    });

    it('sets default measurement name based on existing count', () => {
      const { container } = render(
        <MeasurementTool {...defaultProps} existingMeasurementCount={5} />
      );

      const overlay = container.querySelector('div[style*="cursor"]');

      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600
      }));

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });

      const input = screen.getByRole('textbox');
      expect(input.value).toBe('Measurement 6');
    });
  });

  describe('save dialog', () => {
    const openSaveDialog = (container) => {
      const overlay = container.querySelector('div[style*="cursor"]');

      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600
      }));

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });
    };

    it('shows validation error when name is empty', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      openSaveDialog(container);

      // Clear the default name
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: '' } });

      // Click save
      const saveButton = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveButton);

      expect(screen.getByText('Please enter a name for this measurement')).toBeInTheDocument();
      expect(defaultProps.onSaveMeasurement).not.toHaveBeenCalled();
    });

    it('calls onSaveMeasurement with correct data when saved', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      openSaveDialog(container);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Test Measurement' } });

      const saveButton = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveButton);

      expect(defaultProps.onSaveMeasurement).toHaveBeenCalledTimes(1);
      expect(defaultProps.onSaveMeasurement).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          name: 'Test Measurement',
          distance_pixels: expect.any(Number),
          distance_mm: expect.any(Number),
          distance_inches: expect.any(Number),
          created_at: expect.any(String),
          x1: expect.any(Number),
          y1: expect.any(Number),
          x2: expect.any(Number),
          y2: expect.any(Number)
        })
      );
    });

    it('closes dialog when Cancel is clicked', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      openSaveDialog(container);

      expect(screen.getByText('Save Measurement')).toBeInTheDocument();

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(screen.queryByText('Save Measurement')).not.toBeInTheDocument();
    });

    it('closes dialog when Escape is pressed', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      openSaveDialog(container);

      expect(screen.getByText('Save Measurement')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByText('Save Measurement')).not.toBeInTheDocument();
      // Should not call onCancel when dialog is open
      expect(defaultProps.onCancel).not.toHaveBeenCalled();
    });

    it('saves when Enter is pressed in the input', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      openSaveDialog(container);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Enter Test' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(defaultProps.onSaveMeasurement).toHaveBeenCalledTimes(1);
    });

    it('clears validation error when user starts typing', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      openSaveDialog(container);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: '' } });

      const saveButton = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveButton);

      expect(screen.getByText('Please enter a name for this measurement')).toBeInTheDocument();

      // Start typing
      fireEvent.change(input, { target: { value: 'N' } });

      expect(screen.queryByText('Please enter a name for this measurement')).not.toBeInTheDocument();
    });
  });

  describe('coordinate scaling', () => {
    it('scales coordinates from container to natural size', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);

      const overlay = container.querySelector('div[style*="cursor"]');

      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600
      }));

      // Draw at container coords (100, 100) to (200, 200)
      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 200 });

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Scale Test' } });

      const saveButton = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveButton);

      const savedMeasurement = defaultProps.onSaveMeasurement.mock.calls[0][0];

      // Container is 800x600, natural is 1600x1200 (2x scale)
      // So container (100, 100) -> natural (200, 200)
      // And container (200, 200) -> natural (400, 400)
      expect(savedMeasurement.x1).toBe(200);
      expect(savedMeasurement.y1).toBe(200);
      expect(savedMeasurement.x2).toBe(400);
      expect(savedMeasurement.y2).toBe(400);
    });
  });

  describe('left-click vs right-click interaction modes', () => {
    const getOverlay = (container) => {
      const overlay = container.querySelector('div[style*="cursor"]');
      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0, top: 0, width: 800, height: 600
      }));
      return overlay;
    };

    it('right-click draws measurement without measure mode active', () => {
      const { container } = render(<MeasurementTool {...defaultProps} leftClickEnabled={false} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });

      expect(screen.getByText('Save Measurement')).toBeInTheDocument();
    });

    it('left-click does NOT draw measurement when measure mode is inactive', () => {
      const { container } = render(<MeasurementTool {...defaultProps} leftClickEnabled={false} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });

      expect(screen.queryByText('Save Measurement')).not.toBeInTheDocument();
    });

    it('left-click draws measurement when measure mode is active (leftClickEnabled)', () => {
      const { container } = render(<MeasurementTool {...defaultProps} leftClickEnabled={true} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });

      expect(screen.getByText('Save Measurement')).toBeInTheDocument();
    });

    it('ctrl+left-click draws measurement (trackpad support)', () => {
      const { container } = render(<MeasurementTool {...defaultProps} leftClickEnabled={false} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0, ctrlKey: true });
      fireEvent.mouseUp(overlay, { clientX: 200, clientY: 100 });

      expect(screen.getByText('Save Measurement')).toBeInTheDocument();
    });
  });

  describe('context menu prevention', () => {
    const getOverlay = (container) => {
      const overlay = container.querySelector('div[style*="cursor"]');
      overlay.getBoundingClientRect = jest.fn(() => ({
        left: 0, top: 0, width: 800, height: 600
      }));
      return overlay;
    };

    it('prevents context menu on the overlay div', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      const overlay = getOverlay(container);

      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      overlay.dispatchEvent(contextMenuEvent);

      expect(contextMenuEvent.defaultPrevented).toBe(true);
    });

    it('blocks the first contextmenu event on document after right-click measurement starts', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });

      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(contextMenuEvent);

      expect(contextMenuEvent.defaultPrevented).toBe(true);
    });

    it('blocks only the first contextmenu per gesture (one-shot)', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 2 });

      const firstEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(firstEvent);
      expect(firstEvent.defaultPrevented).toBe(true);

      const secondEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(secondEvent);
      expect(secondEvent.defaultPrevented).toBe(false);
    });

    it('does not prevent context menu on document when idle (not drawing, no dialog)', () => {
      render(<MeasurementTool {...defaultProps} />);

      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(contextMenuEvent);

      expect(contextMenuEvent.defaultPrevented).toBe(false);
    });

    it('blocks contextmenu for ctrl+click measurements (trackpad support)', () => {
      const { container } = render(<MeasurementTool {...defaultProps} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0, ctrlKey: true });

      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(contextMenuEvent);

      expect(contextMenuEvent.defaultPrevented).toBe(true);
    });

    it('does not block contextmenu for left-click measurements', () => {
      const { container } = render(<MeasurementTool {...defaultProps} leftClickEnabled={true} />);
      const overlay = getOverlay(container);

      fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100, button: 0 });

      const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.dispatchEvent(contextMenuEvent);

      expect(contextMenuEvent.defaultPrevented).toBe(false);
    });
  });
});
