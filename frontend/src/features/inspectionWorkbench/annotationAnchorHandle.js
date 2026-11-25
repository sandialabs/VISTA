// Shared appearance for the endpoint and corner anchor handles on the tile and
// single image views. The ring has a transparent fill so the image under the
// anchor stays visible, and a small dot marks the exact anchor point. The ring
// keeps pointer-events="all" so the whole circle is still a hit target even
// though its fill is transparent.
export const ANCHOR_HANDLE_RADIUS = 11;
export const ANCHOR_HANDLE_STROKE_WIDTH = 3;
export const ANCHOR_CENTER_DOT_RADIUS = 2.5;

export const anchorRingProps = (color) => ({
  r: String(ANCHOR_HANDLE_RADIUS),
  fill: 'transparent',
  stroke: color,
  strokeWidth: String(ANCHOR_HANDLE_STROKE_WIDTH),
  pointerEvents: 'all',
});

export function AnchorCenterDot({ x, y, color }) {
  return (
    <circle
      className="inspection-anchor-center-dot"
      cx={x}
      cy={y}
      r={ANCHOR_CENTER_DOT_RADIUS}
      fill={color}
      pointerEvents="none"
      aria-hidden="true"
    />
  );
}
