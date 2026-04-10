import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MeasurementListItem from '../MeasurementListItem';

const mockMeasurement = {
  id: 'test-id-1',
  name: 'Test Measurement',
  x1: 100,
  y1: 200,
  x2: 300,
  y2: 400,
  distance_pixels: 282.84,
  distance_mm: 28.284,
  distance_inches: 1.1135,
  created_at: '2024-01-15T10:30:00Z',
  created_by: 'test@example.com'
};

const mockCalibration = {
  pixels_per_mm: 10,
  pixels_per_inch: 254  // 10 * 25.4
};

const defaultProps = {
  measurement: mockMeasurement,
  calibration: mockCalibration,
  isSelected: false,
  isEditing: false,
  editingName: '',
  setEditingName: jest.fn(),
  isExpanded: false,
  isVisible: true,
  onStartRename: jest.fn(),
  onSaveRename: jest.fn(),
  onCancelRename: jest.fn(),
  onDelete: jest.fn(),
  onToggleVisibility: jest.fn(),
  onToggleExpanded: jest.fn(),
  onMouseEnter: jest.fn(),
  onMouseLeave: jest.fn()
};

describe('MeasurementListItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Normal mode rendering', () => {
    test('renders measurement name', () => {
      render(<MeasurementListItem {...defaultProps} />);
      expect(screen.getByText('Test Measurement')).toBeInTheDocument();
    });

    test('renders visibility toggle button', () => {
      render(<MeasurementListItem {...defaultProps} />);
      const visibilityButton = screen.getByTitle('Hide');
      expect(visibilityButton).toBeInTheDocument();
    });

    test('renders delete button', () => {
      render(<MeasurementListItem {...defaultProps} />);
      const deleteButton = screen.getByTitle('Delete');
      expect(deleteButton).toBeInTheDocument();
    });

    test('shows filled circle when visible', () => {
      render(<MeasurementListItem {...defaultProps} isVisible={true} />);
      expect(screen.getByTitle('Hide').textContent).toBe('\u25CF');
    });

    test('shows empty circle when not visible', () => {
      render(<MeasurementListItem {...defaultProps} isVisible={false} />);
      expect(screen.getByTitle('Show').textContent).toBe('\u25CB');
    });

    test('applies selected styling when isSelected is true', () => {
      const { container } = render(<MeasurementListItem {...defaultProps} isSelected={true} />);
      const wrapper = container.firstChild;
      expect(wrapper).toHaveStyle({ background: '#eff6ff' });
    });

    test('shows created_at timestamp when not expanded', () => {
      render(<MeasurementListItem {...defaultProps} />);
      // The date is formatted using toLocaleString
      expect(screen.getByText(/2024/)).toBeInTheDocument();
    });
  });

  describe('Distance formatting', () => {
    test('formats distance with calibration (mm and inches)', () => {
      render(<MeasurementListItem {...defaultProps} />);
      expect(screen.getByText('28.28 mm')).toBeInTheDocument();
    });

    test('formats distance as pixels when no calibration', () => {
      render(<MeasurementListItem {...defaultProps} calibration={null} />);
      expect(screen.getByText('282.8 px')).toBeInTheDocument();
    });

    test('formats distance as pixels when calibration lacks pixels_per_mm', () => {
      const incompleteCalibration = { someOtherField: 123 };
      render(<MeasurementListItem {...defaultProps} calibration={incompleteCalibration} />);
      expect(screen.getByText('282.8 px')).toBeInTheDocument();
    });

    test('recalculates distance when calibration changes', () => {
      // With original calibration (10 pixels_per_mm), 282.84 px = 28.284 mm
      const { rerender } = render(<MeasurementListItem {...defaultProps} />);
      expect(screen.getByText('28.28 mm')).toBeInTheDocument();

      // With new calibration (5 pixels_per_mm), 282.84 px = 56.568 mm
      const newCalibration = { pixels_per_mm: 5, pixels_per_inch: 127 };
      rerender(<MeasurementListItem {...defaultProps} calibration={newCalibration} />);
      expect(screen.getByText('56.57 mm')).toBeInTheDocument();
    });
  });

  describe('Editing mode', () => {
    test('renders input field when editing', () => {
      render(
        <MeasurementListItem
          {...defaultProps}
          isEditing={true}
          editingName="Test Measurement"
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('Test Measurement');
    });

    test('renders Save and Cancel buttons when editing', () => {
      render(<MeasurementListItem {...defaultProps} isEditing={true} />);
      expect(screen.getByText('Save')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    test('calls setEditingName when input changes', () => {
      render(
        <MeasurementListItem
          {...defaultProps}
          isEditing={true}
          editingName="Test"
        />
      );
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'New Name' } });
      expect(defaultProps.setEditingName).toHaveBeenCalledWith('New Name');
    });

    test('calls onSaveRename when Enter key is pressed', () => {
      render(
        <MeasurementListItem
          {...defaultProps}
          isEditing={true}
          editingName="Test"
        />
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(defaultProps.onSaveRename).toHaveBeenCalled();
    });

    test('calls onCancelRename when Escape key is pressed', () => {
      render(
        <MeasurementListItem
          {...defaultProps}
          isEditing={true}
          editingName="Test"
        />
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(defaultProps.onCancelRename).toHaveBeenCalled();
    });

    test('calls onSaveRename when Save button is clicked', () => {
      render(<MeasurementListItem {...defaultProps} isEditing={true} />);
      fireEvent.click(screen.getByText('Save'));
      expect(defaultProps.onSaveRename).toHaveBeenCalled();
    });

    test('calls onCancelRename when Cancel button is clicked', () => {
      render(<MeasurementListItem {...defaultProps} isEditing={true} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(defaultProps.onCancelRename).toHaveBeenCalled();
    });

    test('does not call handlers for other keys', () => {
      render(
        <MeasurementListItem
          {...defaultProps}
          isEditing={true}
          editingName="Test"
        />
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(defaultProps.onSaveRename).not.toHaveBeenCalled();
      expect(defaultProps.onCancelRename).not.toHaveBeenCalled();
    });
  });

  describe('Button click handlers', () => {
    test('calls onStartRename when name is clicked', () => {
      render(<MeasurementListItem {...defaultProps} />);
      fireEvent.click(screen.getByText('Test Measurement'));
      expect(defaultProps.onStartRename).toHaveBeenCalled();
    });

    test('calls onDelete when delete button is clicked', () => {
      render(<MeasurementListItem {...defaultProps} />);
      fireEvent.click(screen.getByTitle('Delete'));
      expect(defaultProps.onDelete).toHaveBeenCalled();
    });

    test('calls onToggleVisibility when visibility button is clicked', () => {
      render(<MeasurementListItem {...defaultProps} />);
      fireEvent.click(screen.getByTitle('Hide'));
      expect(defaultProps.onToggleVisibility).toHaveBeenCalled();
    });

    test('calls onToggleExpanded when distance area is clicked', () => {
      render(<MeasurementListItem {...defaultProps} />);
      fireEvent.click(screen.getByText('28.28 mm'));
      expect(defaultProps.onToggleExpanded).toHaveBeenCalled();
    });
  });

  describe('Event propagation', () => {
    test('stops propagation on name click', () => {
      render(<MeasurementListItem {...defaultProps} />);
      const nameElement = screen.getByText('Test Measurement');

      // Create a real click event and check stopPropagation was called
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'stopPropagation', { value: jest.fn() });
      nameElement.dispatchEvent(clickEvent);

      expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });

    test('stops propagation on delete button click', () => {
      render(<MeasurementListItem {...defaultProps} />);
      const deleteButton = screen.getByTitle('Delete');

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'stopPropagation', { value: jest.fn() });
      deleteButton.dispatchEvent(clickEvent);

      expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });

    test('stops propagation on visibility toggle click', () => {
      render(<MeasurementListItem {...defaultProps} />);
      const visibilityButton = screen.getByTitle('Hide');

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'stopPropagation', { value: jest.fn() });
      visibilityButton.dispatchEvent(clickEvent);

      expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });

    test('stops propagation on distance area click', () => {
      render(<MeasurementListItem {...defaultProps} />);
      const distanceArea = screen.getByText('28.28 mm');

      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'stopPropagation', { value: jest.fn() });
      distanceArea.dispatchEvent(clickEvent);

      expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('Mouse events', () => {
    test('calls onMouseEnter when mouse enters', () => {
      const { container } = render(<MeasurementListItem {...defaultProps} />);
      fireEvent.mouseEnter(container.firstChild);
      expect(defaultProps.onMouseEnter).toHaveBeenCalled();
    });

    test('calls onMouseLeave when mouse leaves', () => {
      const { container } = render(<MeasurementListItem {...defaultProps} />);
      fireEvent.mouseLeave(container.firstChild);
      expect(defaultProps.onMouseLeave).toHaveBeenCalled();
    });
  });

  describe('Expanded details view', () => {
    test('shows measurement details when expanded', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} />);

      expect(screen.getByText('Measurement Details')).toBeInTheDocument();
      expect(screen.getByText('Start Point:')).toBeInTheDocument();
      expect(screen.getByText('End Point:')).toBeInTheDocument();
      expect(screen.getByText('Distance (pixels):')).toBeInTheDocument();
    });

    test('shows start and end coordinates when expanded', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} />);

      expect(screen.getByText('(100, 200)')).toBeInTheDocument();
      expect(screen.getByText('(300, 400)')).toBeInTheDocument();
    });

    test('shows calibrated distances when expanded with calibration', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} />);

      expect(screen.getByText('Distance (mm):')).toBeInTheDocument();
    });

    test('does not show calibrated distances when expanded without calibration', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} calibration={null} />);

      expect(screen.queryByText('Distance (mm):')).not.toBeInTheDocument();
      expect(screen.queryByText('Distance (inches):')).not.toBeInTheDocument();
    });

    test('shows created_at in expanded view', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} />);
      expect(screen.getByText('Created:')).toBeInTheDocument();
    });

    test('shows created_by in expanded view', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} />);
      expect(screen.getByText('Created By:')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    test('shows collapse instruction when expanded', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={true} />);
      expect(screen.getByText('Click to collapse')).toBeInTheDocument();
    });

    test('does not show details when collapsed', () => {
      render(<MeasurementListItem {...defaultProps} isExpanded={false} />);
      expect(screen.queryByText('Measurement Details')).not.toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    test('handles measurement without created_at', () => {
      const measurementWithoutDate = {
        ...mockMeasurement,
        created_at: null
      };
      render(<MeasurementListItem {...defaultProps} measurement={measurementWithoutDate} />);
      expect(screen.queryByText('Created:')).not.toBeInTheDocument();
    });

    test('handles measurement without created_by in expanded view', () => {
      const measurementWithoutCreator = {
        ...mockMeasurement,
        created_by: null
      };
      render(<MeasurementListItem {...defaultProps} measurement={measurementWithoutCreator} isExpanded={true} />);
      expect(screen.queryByText('Created By:')).not.toBeInTheDocument();
    });

    test('handles measurement with undefined coordinates gracefully', () => {
      const measurementWithUndefinedCoords = {
        ...mockMeasurement,
        x1: undefined,
        y1: undefined
      };
      render(<MeasurementListItem {...defaultProps} measurement={measurementWithUndefinedCoords} isExpanded={true} />);
      // Should still render without crashing
      expect(screen.getByText('Measurement Details')).toBeInTheDocument();
    });
  });
});
