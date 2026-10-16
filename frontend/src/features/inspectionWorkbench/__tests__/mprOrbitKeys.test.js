import { getMprOrbitKeyAction, handleMprOrbitKeyDown, rotateMprOrbit } from '../mprOrbitKeys';

function buildEvent(key) {
  return { key, preventDefault: jest.fn(), stopPropagation: jest.fn() };
}

function buildContext(fullscreenOpen) {
  return {
    fullscreenOpen,
    openFullscreen: jest.fn(),
    applyNavigationSession: jest.fn(),
    adjustZoom: jest.fn(),
    resetViewport: jest.fn(),
  };
}

describe('getMprOrbitKeyAction', () => {
  test('opens fullscreen only from Enter or Space when closed', () => {
    expect(getMprOrbitKeyAction('Enter', false)).toEqual({ type: 'open' });
    expect(getMprOrbitKeyAction(' ', false)).toEqual({ type: 'open' });
    expect(getMprOrbitKeyAction('ArrowLeft', false)).toBeNull();
    expect(getMprOrbitKeyAction('Enter', true)).toBeNull();
  });

  test('maps fullscreen orbit, zoom, and reset keys', () => {
    expect(getMprOrbitKeyAction('ArrowLeft', true)).toEqual({ type: 'rotate', direction: 'left' });
    expect(getMprOrbitKeyAction('=', true)).toEqual({ type: 'zoom', delta: 0.12 });
    expect(getMprOrbitKeyAction('_', true)).toEqual({ type: 'zoom', delta: -0.12 });
    expect(getMprOrbitKeyAction('0', true)).toEqual({ type: 'reset' });
    expect(getMprOrbitKeyAction('a', true)).toBeNull();
  });
});

describe('rotateMprOrbit', () => {
  test('steps yaw freely and clamps pitch to 72 degrees', () => {
    expect(rotateMprOrbit({ x: 0, y: 10 }, 'left')).toEqual({ x: 0, y: 5 });
    expect(rotateMprOrbit({ x: 0, y: 10 }, 'right')).toEqual({ x: 0, y: 15 });
    expect(rotateMprOrbit({ x: -70, y: 0 }, 'up')).toEqual({ x: -72, y: 0 });
    expect(rotateMprOrbit({ x: 70, y: 0 }, 'down')).toEqual({ x: 72, y: 0 });
  });
});

describe('handleMprOrbitKeyDown', () => {
  test('opens fullscreen and stops the event when closed', () => {
    const event = buildEvent('Enter');
    const context = buildContext(false);
    handleMprOrbitKeyDown(event, context);
    expect(context.openFullscreen).toHaveBeenCalledWith(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  test('ignores unmapped keys without stopping the event', () => {
    const event = buildEvent('a');
    const context = buildContext(true);
    handleMprOrbitKeyDown(event, context);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.applyNavigationSession).not.toHaveBeenCalled();
  });

  test('applies rotation updaters, zoom deltas, and reset in fullscreen', () => {
    const context = buildContext(true);
    handleMprOrbitKeyDown(buildEvent('ArrowUp'), context);
    const updater = context.applyNavigationSession.mock.calls[0][0];
    expect(updater({ rotation: { x: -12, y: 42 } })).toEqual({ rotation: { x: -17, y: 42 } });
    handleMprOrbitKeyDown(buildEvent('-'), context);
    expect(context.adjustZoom).toHaveBeenCalledWith(-0.12);
    handleMprOrbitKeyDown(buildEvent('0'), context);
    expect(context.resetViewport).toHaveBeenCalledTimes(1);
  });
});
