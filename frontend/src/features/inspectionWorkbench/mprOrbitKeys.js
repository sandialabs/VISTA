const ORBIT_STEP_DEGREES = 5;
const ORBIT_PITCH_LIMIT_DEGREES = 72;
const ZOOM_STEP = 0.12;

const OPEN_KEYS = ['Enter', ' '];

const FULLSCREEN_KEY_ACTIONS = {
  ArrowLeft: { type: 'rotate', direction: 'left' },
  ArrowRight: { type: 'rotate', direction: 'right' },
  ArrowUp: { type: 'rotate', direction: 'up' },
  ArrowDown: { type: 'rotate', direction: 'down' },
  '+': { type: 'zoom', delta: ZOOM_STEP },
  '=': { type: 'zoom', delta: ZOOM_STEP },
  '-': { type: 'zoom', delta: -ZOOM_STEP },
  _: { type: 'zoom', delta: -ZOOM_STEP },
  0: { type: 'reset' },
};

export function getMprOrbitKeyAction(key, fullscreenOpen) {
  if (!fullscreenOpen) {
    return OPEN_KEYS.includes(key) ? { type: 'open' } : null;
  }
  return Object.prototype.hasOwnProperty.call(FULLSCREEN_KEY_ACTIONS, key)
    ? FULLSCREEN_KEY_ACTIONS[key]
    : null;
}

export function rotateMprOrbit(rotation, direction) {
  if (direction === 'left') return { ...rotation, y: rotation.y - ORBIT_STEP_DEGREES };
  if (direction === 'right') return { ...rotation, y: rotation.y + ORBIT_STEP_DEGREES };
  if (direction === 'up') {
    return { ...rotation, x: Math.max(-ORBIT_PITCH_LIMIT_DEGREES, rotation.x - ORBIT_STEP_DEGREES) };
  }
  if (direction === 'down') {
    return { ...rotation, x: Math.min(ORBIT_PITCH_LIMIT_DEGREES, rotation.x + ORBIT_STEP_DEGREES) };
  }
  return rotation;
}

export function handleMprOrbitKeyDown(event, {
  fullscreenOpen,
  openFullscreen,
  applyNavigationSession,
  adjustZoom,
  resetViewport,
}) {
  const action = getMprOrbitKeyAction(event.key, fullscreenOpen);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (action.type === 'open') {
    openFullscreen(event);
  } else if (action.type === 'rotate') {
    applyNavigationSession((previous) => ({
      rotation: rotateMprOrbit(previous.rotation, action.direction),
    }));
  } else if (action.type === 'zoom') {
    adjustZoom(action.delta);
  } else {
    resetViewport();
  }
}
