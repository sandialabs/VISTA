// Shared numeric helpers. Behaviour is intentionally minimal; callers that need
// coercion or fallbacks should use the explicit variants below.

// Clamps a number into [minimum, maximum]. Does not coerce: NaN stays NaN.
export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

// Coerces value with Number() and clamps it, substituting fallback (default
// minimum) when the coerced value is not finite.
export function clampFinite(value, minimum, maximum, fallback = minimum) {
  const numeric = Number(value);
  return clamp(Number.isFinite(numeric) ? numeric : fallback, minimum, maximum);
}

// Returns Number(value) when finite, otherwise fallback (default null).
export function finiteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
