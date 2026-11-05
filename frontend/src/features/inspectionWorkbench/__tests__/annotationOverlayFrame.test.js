import { render, screen } from '@testing-library/react';
import { AnnotationOverlaySvg } from '../AnnotationOverlaySvg';
import { renderTileAnnotationEditingTargets } from '../annotationOverlayRendering';
import {
  DEFAULT_ANNOTATION_FRAME,
  getAnnotationOverlayFrame,
  getAnnotationTextRotation,
  projectAnnotationBox,
  projectAnnotationLine,
} from '../annotationOverlayFrame';

// Screen pixels per design unit for an image letterboxed into a container.
function screenPixelsPerUnit(imageWidth, imageHeight, containerWidth, containerHeight) {
  const frame = getAnnotationOverlayFrame(imageWidth, imageHeight, containerWidth, containerHeight);
  const fit = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  return { x: frame.scale * fit, y: frame.scale * fit, frame };
}

describe('annotation overlay frame', () => {
  test('square images keep the legacy 1000-unit frame', () => {
    expect(getAnnotationOverlayFrame(400, 400, 300, 200)).toEqual({ width: 1000, height: 1000, scale: 0.4 });
    expect(getAnnotationOverlayFrame(2000, 2000)).toEqual({ width: 1000, height: 1000, scale: 2 });
  });

  test('uses one uniform scale so marks are identical across aspect ratios', () => {
    const sizes = [[1000, 1000], [400, 1600], [3000, 500], [123, 77]].map(([w, h]) => screenPixelsPerUnit(w, h, 320, 240));
    sizes.forEach(({ x, y }) => {
      expect(x).toBeCloseTo(y, 10);
      expect(x).toBeCloseTo(240 / 1000, 10);
    });
  });

  test('frame extents preserve the image aspect ratio', () => {
    const frame = getAnnotationOverlayFrame(500, 1000, 400, 400);
    expect(frame.width / frame.height).toBeCloseTo(0.5, 10);
    expect(frame.height).toBeCloseTo(1000, 10);
  });

  test('falls back to a square-container assumption when unmeasured', () => {
    expect(getAnnotationOverlayFrame(500, 1000, 0, 0)).toEqual({ width: 500, height: 1000, scale: 1 });
    expect(getAnnotationOverlayFrame(undefined, null)).toEqual(DEFAULT_ANNOTATION_FRAME);
  });

  test('projects lines and boxes from image pixels into the frame', () => {
    const frame = { width: 500, height: 1000, scale: 1 };
    expect(projectAnnotationLine({ x1: 0, y1: 50, x2: 100, y2: 100, imageWidth: 100, imageHeight: 100 }, frame))
      .toEqual({ x1: 0, y1: 500, x2: 500, y2: 1000 });
    expect(projectAnnotationBox({ x: 10, y: 10, width: 20, height: 40, imageWidth: 100, imageHeight: 200 }, frame))
      .toEqual({ x: 50, y: 50, width: 100, height: 200 });
    expect(getAnnotationTextRotation(1, 2)).toBeUndefined();
    expect(getAnnotationTextRotation(1, 2, 90)).toBe('rotate(90 1 2)');
  });

  test('overlay svg applies only a uniform scale to annotation content', () => {
    const line = { id: 'l1', x1: 10, y1: 10, x2: 90, y2: 190, imageWidth: 100, imageHeight: 200, color: '#f00' };
    render(
      <AnnotationOverlaySvg
        imageWidth={100}
        imageHeight={200}
        ariaLabel="overlay"
        renderContent={(frame) => renderTileAnnotationEditingTargets({
          measurementLines: [line],
          selectedAnnotationId: 'l1',
          frame,
          onStartDrag: () => {},
        })}
      />,
    );
    const svg = screen.getByLabelText('overlay');
    expect(svg).toHaveAttribute('viewBox', '0 0 100 200');
    expect(screen.getByTestId('annotation-overlay-content')).toHaveAttribute('transform', 'scale(0.2)');
    const dot = screen.getByRole('button', { name: /start endpoint/ });
    expect(dot).toHaveAttribute('r', '11');
    expect(Number(dot.getAttribute('cx'))).toBeCloseTo(50, 10);
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(50, 10);
  });
});
