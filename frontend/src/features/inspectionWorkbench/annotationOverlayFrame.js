// Annotation overlays are authored in "design units": a 1000-unit reference
// length that maps to the short side of the overlay container. Positions are
// normalized to the image (0..frame.width, 0..frame.height) and the content is
// mapped into the image-pixel viewBox with one uniform scale, so strokes, handle
// dots, and text keep the same shape and on-screen size for every aspect ratio.
export const ANNOTATION_DESIGN_UNITS = 1000;
export const DEFAULT_ANNOTATION_FRAME = Object.freeze({ width: 1000, height: 1000, scale: 1 });

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function getAnnotationOverlayFrame(imageWidth, imageHeight, containerWidth, containerHeight) {
  const width = positiveNumber(imageWidth, ANNOTATION_DESIGN_UNITS);
  const height = positiveNumber(imageHeight, ANNOTATION_DESIGN_UNITS);
  const boxWidth = positiveNumber(containerWidth, 0);
  const boxHeight = positiveNumber(containerHeight, 0);
  let scale;
  if (boxWidth > 0 && boxHeight > 0) {
    // Screen pixels per image pixel under preserveAspectRatio="xMidYMid meet".
    const fit = Math.min(boxWidth / width, boxHeight / height);
    scale = Math.min(boxWidth, boxHeight) / (ANNOTATION_DESIGN_UNITS * fit);
  } else {
    // Unmeasured (first render, tests): assume a square container.
    scale = Math.max(width, height) / ANNOTATION_DESIGN_UNITS;
  }
  return { width: width / scale, height: height / scale, scale };
}

export function projectAnnotationX(value, imageWidth, frame = DEFAULT_ANNOTATION_FRAME) {
  return (Number(value) / Number(imageWidth)) * frame.width;
}

export function projectAnnotationY(value, imageHeight, frame = DEFAULT_ANNOTATION_FRAME) {
  return (Number(value) / Number(imageHeight)) * frame.height;
}

export function projectAnnotationLine(line, frame = DEFAULT_ANNOTATION_FRAME) {
  return {
    x1: projectAnnotationX(line.x1, line.imageWidth, frame),
    y1: projectAnnotationY(line.y1, line.imageHeight, frame),
    x2: projectAnnotationX(line.x2, line.imageWidth, frame),
    y2: projectAnnotationY(line.y2, line.imageHeight, frame),
  };
}

export function projectAnnotationBox(box, frame = DEFAULT_ANNOTATION_FRAME) {
  return {
    x: projectAnnotationX(box.x, box.imageWidth, frame),
    y: projectAnnotationY(box.y, box.imageHeight, frame),
    width: projectAnnotationX(box.width, box.imageWidth, frame),
    height: projectAnnotationY(box.height, box.imageHeight, frame),
  };
}

export function getAnnotationTextRotation(x, y, rotationDegrees = 0) {
  return rotationDegrees ? `rotate(${rotationDegrees} ${x} ${y})` : undefined;
}
