import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MeasurementList from '../MeasurementList';

describe('MeasurementList', () => {
  const mockCalibration = {
    pixels_per_mm: 10,
    pixels_per_inch: 254,
    unit: 'mm'
  };

  const mockMeasurements = [
    {
      id: 'measurement-1',
      name: 'Measurement 1',
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 100,
      distance_pixels: 100,
      distance_mm: 10,
      distance_inches: 0.394,
      created_at: '2026-01-13T10:00:00Z'
    },
    {
      id: 'measurement-2',
      name: 'Measurement 2',
      x1: 50,
      y1: 50,
      x2: 150,
      y2: 50,
      distance_pixels: 100,
      distance_mm: 10,
      distance_inches: 0.394,
      created_at: '2026-01-13T11:00:00Z'
    }
  ];

  const defaultProps = {
    measurements: mockMeasurements,
    calibration: mockCalibration,
    onDeleteMeasurement: jest.fn(),
    onRenameMeasurement: jest.fn(),
    onToggleVisibility: jest.fn(),
    visibleMeasurementIds: ['measurement-1', 'measurement-2'],
    selectedMeasurementId: null,
    onSelectMeasurement: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
  });

  test('renders measurements list', () => {
    render(<MeasurementList {...defaultProps} />);

    expect(screen.getByText('Measurements (2) -')).toBeInTheDocument();
    expect(screen.getByText('Measurement 1')).toBeInTheDocument();
    expect(screen.getByText('Measurement 2')).toBeInTheDocument();
  });

  test('delete button stops event propagation', () => {
    const onSelectMeasurement = jest.fn();
    render(<MeasurementList {...defaultProps} onSelectMeasurement={onSelectMeasurement} />);

    const deleteButtons = screen.getAllByTitle('Delete');

    // Click delete button
    fireEvent.click(deleteButtons[0]);

    // onSelectMeasurement should NOT be called due to stopPropagation
    expect(onSelectMeasurement).not.toHaveBeenCalled();
    expect(defaultProps.onDeleteMeasurement).toHaveBeenCalledWith('measurement-1');
  });

  test('calls onDeleteMeasurement with correct ID when delete is confirmed', () => {
    render(<MeasurementList {...defaultProps} />);

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith('Delete measurement "Measurement 1"?');
    expect(defaultProps.onDeleteMeasurement).toHaveBeenCalledWith('measurement-1');
  });

  test('does not call onDeleteMeasurement when delete is cancelled', () => {
    window.confirm = jest.fn(() => false);

    render(<MeasurementList {...defaultProps} />);

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(defaultProps.onDeleteMeasurement).not.toHaveBeenCalled();
  });

  test('visibility toggle stops event propagation', () => {
    const onSelectMeasurement = jest.fn();
    render(<MeasurementList {...defaultProps} onSelectMeasurement={onSelectMeasurement} />);

    const visibilityButtons = screen.getAllByTitle('Hide');

    // Click visibility button
    fireEvent.click(visibilityButtons[0]);

    // onSelectMeasurement should NOT be called due to stopPropagation
    expect(onSelectMeasurement).not.toHaveBeenCalled();
    expect(defaultProps.onToggleVisibility).toHaveBeenCalledWith('measurement-1');
  });

  test('displays measurement details when clicked', () => {
    render(<MeasurementList {...defaultProps} />);

    // Click on distance box to expand
    const distanceBoxes = screen.getAllByText(/10.00 mm/);
    fireEvent.click(distanceBoxes[0]);

    // Should show expanded details
    expect(screen.getByText('Measurement Details')).toBeInTheDocument();
    expect(screen.getByText(/Start Point:/)).toBeInTheDocument();
    expect(screen.getByText(/End Point:/)).toBeInTheDocument();
    expect(screen.getByText(/Distance \(pixels\):/)).toBeInTheDocument();
  });

  test('rename functionality stops event propagation', () => {
    const onSelectMeasurement = jest.fn();
    render(<MeasurementList {...defaultProps} onSelectMeasurement={onSelectMeasurement} />);

    const measurementName = screen.getAllByText('Measurement 1')[0];

    // Click on measurement name to start rename
    fireEvent.click(measurementName);

    // onSelectMeasurement should NOT be called due to stopPropagation
    expect(onSelectMeasurement).not.toHaveBeenCalled();

    // Should show input field
    const input = screen.getByDisplayValue('Measurement 1');
    expect(input).toBeInTheDocument();
  });

  test('exports measurements to CSV', () => {
    const createObjectURL = jest.fn(() => 'blob:mock-url');
    const revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;

    const mockClick = jest.fn();
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = mockClick;

    // Spy on appendChild/removeChild instead of replacing them
    const appendChildSpy = jest.spyOn(document.body, 'appendChild');
    const removeChildSpy = jest.spyOn(document.body, 'removeChild');

    render(<MeasurementList {...defaultProps} />);

    const exportButton = screen.getByText('Export CSV');
    fireEvent.click(exportButton);

    expect(createObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    // Restore original click
    HTMLAnchorElement.prototype.click = originalClick;
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  test('shows message when no measurements exist', () => {
    render(<MeasurementList {...defaultProps} measurements={[]} />);

    expect(screen.getByText(/No measurements yet/)).toBeInTheDocument();
  });

  test('formats distances correctly with calibration', () => {
    render(<MeasurementList {...defaultProps} />);

    const mmElements = screen.getAllByText(/10.00 mm/);
    expect(mmElements.length).toBe(2);
  });

  test('formats distances as pixels when no calibration', () => {
    render(<MeasurementList {...defaultProps} calibration={null} />);

    const pxElements = screen.getAllByText(/100.0 px/);
    expect(pxElements.length).toBe(2);
  });

  test('collapses and expands section', () => {
    render(<MeasurementList {...defaultProps} />);

    const header = screen.getByText('Measurements (2) -');

    // Should show measurements initially
    expect(screen.getByText('Measurement 1')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(header);

    // Measurements should be hidden
    expect(screen.queryByText('Measurement 1')).not.toBeInTheDocument();

    // Header should show +
    expect(screen.getByText('Measurements (2) +')).toBeInTheDocument();
  });
});
