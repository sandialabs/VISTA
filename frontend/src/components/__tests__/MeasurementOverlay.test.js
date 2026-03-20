import React from 'react';
import { render } from '@testing-library/react';
import MeasurementOverlay from '../MeasurementOverlay';

describe('MeasurementOverlay', () => {
  const defaultProps = {
    measurements: [
      {
        id: 'measurement-1',
        name: 'Length A',
        x1: 100,
        y1: 100,
        x2: 200,
        y2: 100,
        distance_pixels: 100,
        distance_mm: 10,
        distance_inches: 0.394
      },
      {
        id: 'measurement-2',
        name: 'Length B',
        x1: 300,
        y1: 300,
        x2: 400,
        y2: 400,
        distance_pixels: 141.42,
        distance_mm: 14.14,
        distance_inches: 0.557
      }
    ],
    naturalSize: { width: 1000, height: 800 },
    containerSize: { width: 500, height: 400 },
    calibration: {
      pixels_per_mm: 10,
      pixels_per_inch: 254,
      unit: 'mm'
    },
    selectedMeasurementId: null,
    visibleMeasurementIds: null,
    onSelectMeasurement: jest.fn(),
    zoomLevel: 1
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('returns null when no measurements', () => {
      const { container } = render(
        <MeasurementOverlay {...defaultProps} measurements={[]} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('returns null when measurements is null', () => {
      const { container } = render(
        <MeasurementOverlay {...defaultProps} measurements={null} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders SVG container with correct dimensions', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('width', '500');
      expect(svg).toHaveAttribute('height', '400');
    });

    it('renders lines for each measurement', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      // Each measurement has a transparent hit-area line + visible line when onSelectMeasurement is provided
      const lines = container.querySelectorAll('line');
      expect(lines).toHaveLength(4);
      const visibleLines = Array.from(lines).filter(l => l.getAttribute('stroke') !== 'transparent');
      expect(visibleLines).toHaveLength(2);
    });

    it('renders endpoint circles for each measurement', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      // Each measurement has 2 endpoint circles
      const circles = container.querySelectorAll('circle');
      expect(circles).toHaveLength(4);
    });
  });

  describe('coordinate transformation', () => {
    it('scales coordinates from natural to container size', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      const lines = container.querySelectorAll('line');
      const firstLine = lines[0];

      // Natural (100, 100) to (200, 100) with scale 0.5 -> Container (50, 50) to (100, 50)
      expect(firstLine.getAttribute('x1')).toBe('50');
      expect(firstLine.getAttribute('y1')).toBe('50');
      expect(firstLine.getAttribute('x2')).toBe('100');
      expect(firstLine.getAttribute('y2')).toBe('50');
    });

    it('applies correct scale factor for endpoint circles', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      const circles = container.querySelectorAll('circle');
      const firstCircle = circles[0];

      // First measurement start point: natural (100, 100) -> container (50, 50)
      expect(firstCircle.getAttribute('cx')).toBe('50');
      expect(firstCircle.getAttribute('cy')).toBe('50');
    });
  });

  describe('visibility filtering', () => {
    it('shows all measurements when visibleMeasurementIds is null', () => {
      const { container } = render(
        <MeasurementOverlay {...defaultProps} visibleMeasurementIds={null} />
      );

      const lines = container.querySelectorAll('line');
      const visibleLines = Array.from(lines).filter(l => l.getAttribute('stroke') !== 'transparent');
      expect(visibleLines).toHaveLength(2);
    });

    it('filters measurements by visibleMeasurementIds', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          visibleMeasurementIds={['measurement-1']}
        />
      );

      const lines = container.querySelectorAll('line');
      const visibleLines = Array.from(lines).filter(l => l.getAttribute('stroke') !== 'transparent');
      expect(visibleLines).toHaveLength(1);
    });

    it('shows no measurements when visibleMeasurementIds is empty array', () => {
      const { container } = render(
        <MeasurementOverlay {...defaultProps} visibleMeasurementIds={[]} />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('selection state', () => {
    it('applies thicker line width to selected measurement', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          selectedMeasurementId="measurement-1"
        />
      );

      const lines = container.querySelectorAll('line');
      const visibleLines = Array.from(lines).filter(l => l.getAttribute('stroke') !== 'transparent');

      // First visible line (selected) should have width 3
      expect(visibleLines[0].getAttribute('stroke-width')).toBe('3');

      // Second visible line (not selected) should have width 2
      expect(visibleLines[1].getAttribute('stroke-width')).toBe('2');
    });

    it('shows tooltip only for selected measurement', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          selectedMeasurementId="measurement-1"
        />
      );

      // Should find the selected measurement name in a text element
      const texts = container.querySelectorAll('text');
      const nameText = Array.from(texts).find(t => t.textContent === 'Length A');
      expect(nameText).toBeInTheDocument();

      // Should NOT find the unselected measurement name
      const otherNameText = Array.from(texts).find(t => t.textContent === 'Length B');
      expect(otherNameText).not.toBeDefined();
    });

    it('applies full opacity to selected measurement', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          selectedMeasurementId="measurement-1"
        />
      );

      // Find groups with opacity attribute (measurement groups)
      const groupsWithOpacity = container.querySelectorAll('g[opacity]');

      // Should have 2 measurement groups
      expect(groupsWithOpacity.length).toBe(2);

      // First group (selected) should have opacity 1
      expect(groupsWithOpacity[0].getAttribute('opacity')).toBe('1');
      // Second group (not selected) should have opacity 0.8
      expect(groupsWithOpacity[1].getAttribute('opacity')).toBe('0.8');
    });
  });

  describe('distance formatting', () => {
    it('formats distance with calibration (mm and inches)', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          selectedMeasurementId="measurement-1"
        />
      );

      const texts = container.querySelectorAll('text');
      const distanceText = Array.from(texts).find(t =>
        t.textContent.includes('mm') && t.textContent.includes('"')
      );

      expect(distanceText).toBeInTheDocument();
      expect(distanceText.textContent).toContain('10.00 mm');
      expect(distanceText.textContent).toContain('0.394"');
    });

    it('formats distance in pixels when no calibration', () => {
      const measurementsWithoutMM = [
        {
          id: 'measurement-1',
          name: 'Length A',
          x1: 100,
          y1: 100,
          x2: 200,
          y2: 100,
          distance_pixels: 100,
          distance_mm: null,
          distance_inches: null
        }
      ];

      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          measurements={measurementsWithoutMM}
          calibration={null}
          selectedMeasurementId="measurement-1"
        />
      );

      const texts = container.querySelectorAll('text');
      const distanceText = Array.from(texts).find(t =>
        t.textContent.includes('px')
      );

      expect(distanceText).toBeInTheDocument();
      expect(distanceText.textContent).toBe('100.0 px');
    });
  });

  describe('tooltip positioning', () => {
    it('positions tooltip above the line by default', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          selectedMeasurementId="measurement-1"
        />
      );

      // Find tooltip background rect
      const rects = container.querySelectorAll('rect');
      const tooltipRect = Array.from(rects).find(r =>
        r.getAttribute('fill') === '#1f2937'
      );

      expect(tooltipRect).toBeInTheDocument();

      // Tooltip Y should be above the line center
      // Line center Y is (50 + 50) / 2 = 50 (after container scaling)
      // Tooltip should be at centerY - tooltipHeight - 15 = 50 - 40 - 15 = -5
      // But since -5 < padding (10), it should be adjusted to centerY + 15 = 65
      const tooltipY = parseFloat(tooltipRect.getAttribute('y'));
      expect(tooltipY).toBeGreaterThanOrEqual(10); // Should respect padding
    });
  });

  describe('zoom level', () => {
    it('applies inverse zoom scale to tooltip', () => {
      const { container } = render(
        <MeasurementOverlay
          {...defaultProps}
          selectedMeasurementId="measurement-1"
          zoomLevel={2}
        />
      );

      // Find the transform group for tooltip
      const groups = container.querySelectorAll('g');
      const tooltipGroup = Array.from(groups).find(g =>
        g.getAttribute('transform')?.includes('scale(0.5)')
      );

      expect(tooltipGroup).toBeInTheDocument();
    });
  });

  describe('SVG styling', () => {
    it('uses correct line color', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      const lines = container.querySelectorAll('line');
      const visibleLines = Array.from(lines).filter(l => l.getAttribute('stroke') !== 'transparent');
      expect(visibleLines[0].getAttribute('stroke')).toBe('#3b82f6');
    });

    it('circles have correct fill and stroke', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      const circles = container.querySelectorAll('circle');
      expect(circles[0].getAttribute('fill')).toBe('#3b82f6');
      expect(circles[0].getAttribute('stroke')).toBe('white');
    });
  });

  describe('pointer events', () => {
    it('enables pointer events when onSelectMeasurement is provided', () => {
      const { container } = render(<MeasurementOverlay {...defaultProps} />);

      const overlayDiv = container.firstChild;
      expect(overlayDiv).toHaveStyle({ pointerEvents: 'auto' });
    });

    it('disables pointer events when onSelectMeasurement is not provided', () => {
      const { container } = render(
        <MeasurementOverlay {...defaultProps} onSelectMeasurement={null} />
      );

      const overlayDiv = container.firstChild;
      expect(overlayDiv).toHaveStyle({ pointerEvents: 'none' });
    });
  });
});
