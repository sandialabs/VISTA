// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

// The real factory uses `new URL(..., import.meta.url)`, which Jest cannot parse.
// jsdom has no Worker, so this throws and the viewer takes its unavailable path
// unless a test installs a Worker stub on the global object.
jest.mock('./components/pt3SplatAssetWorker', () => ({
  createSplatWorker: () => {
    const WorkerImpl = global.Worker;
    if (typeof WorkerImpl !== 'function') throw new Error('Worker is not available');
    return new WorkerImpl('pt3SplatAsset.worker.js');
  },
}));

jest.mock('flexlayout-react', () => {
  const React = require('react');

  class TestModel {
    constructor(json) {
      this.json = json;
    }

    toJson() {
      return this.json;
    }
  }

  const Model = {
    fromJson: (json) => new TestModel(json),
  };

  const Actions = {
    SELECT_TAB: 'FlexLayout_SelectTab',
    ADJUST_WEIGHTS: 'FlexLayout_AdjustWeights',
  };

  function TestTabSet({ tabset, factory, onAction, onModelChange, model }) {
    const initialSelected = Number.isFinite(tabset.selected) ? tabset.selected : 0;
    const [selected, setSelected] = React.useState(initialSelected);
    const tabs = Array.isArray(tabset.children) ? tabset.children : [];
    React.useEffect(() => {
      const nextSelected = Number.isFinite(tabset.selected) ? tabset.selected : 0;
      setSelected((current) => (current === nextSelected ? current : nextSelected));
    }, [tabset.selected]);
    const selectedTab = tabs[Math.min(selected, Math.max(0, tabs.length - 1))];

    return (
      <section className="flexlayout__tabset" data-testid={tabset.id || undefined}>
        <div className="flexlayout__tabset_tabbar_outer" role="tablist">
          {tabs.map((tab, index) => (
            <button
              type="button"
              key={tab.id || tab.component || tab.name}
              className={`flexlayout__tab_button ${index === selected ? 'flexlayout__tab_button--selected' : ''}`}
              role="tab"
              aria-selected={index === selected}
              onClick={() => {
                setSelected(index);
                const action = { type: Actions.SELECT_TAB, data: { tabNode: tab.id } };
                const nextAction = onAction ? onAction(action) : action;
                if (nextAction) onModelChange?.(model, nextAction);
              }}
            >
              {tab.name}
            </button>
          ))}
        </div>
        <div className="flexlayout__tabset_content">
          {selectedTab
            ? factory({
              getComponent: () => selectedTab.component,
              getName: () => selectedTab.name,
            })
            : null}
        </div>
      </section>
    );
  }

  function Layout({ model, factory, onAction, onModelChange }) {
    const json = model.toJson();
    const tabsets = Array.isArray(json?.layout?.children) ? json.layout.children : [];

    const notifyResize = () => {
      const nextJson = {
        ...json,
        layout: {
          ...json.layout,
          children: tabsets.map((tabset, index) => ({
            ...tabset,
            weight: Number(tabset.weight || 0) + (index === 0 ? 40 : index === tabsets.length - 1 ? -20 : 0),
          })),
        },
      };
      model.json = nextJson;
      onModelChange?.(model, { type: Actions.ADJUST_WEIGHTS });
    };

    return (
      <div className="flexlayout__layout">
        {tabsets.map((tabset, index) => (
          <React.Fragment key={tabset.id}>
            {index > 0 && (
              <button
                type="button"
                data-testid={index === 1 ? 'inspection-divider-left' : 'inspection-divider-right'}
                onPointerDown={notifyResize}
                onPointerUp={notifyResize}
              >
                splitter
              </button>
            )}
            <TestTabSet
              tabset={tabset}
              factory={factory}
              onAction={onAction}
              onModelChange={onModelChange}
              model={model}
            />
          </React.Fragment>
        ))}
      </div>
    );
  }

  return { Actions, Layout, Model };
});

// Polyfill for crypto.randomUUID in Jest environment
if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}
if (typeof global.crypto.randomUUID === 'undefined') {
  global.crypto.randomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  };
}

// Provide a minimal canvas mock for tests that trigger histogram rendering paths.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    putImageData: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    setLineDash: jest.fn(),
    arc: jest.fn(),
    fillRect: jest.fn(),
    fillText: jest.fn(),
    }),
  });
}

// Keep every test hermetic. Individual suites used to restore fetch, fake
// timers, and viewport mutations inconsistently, so one early failure could
// change the behavior of every test that followed it.
const originalConsole = {
  error: console.error,
  log: console.log,
  warn: console.warn,
};
const viewportProperties = ['innerWidth', 'innerHeight', 'devicePixelRatio'];
let suiteEnvironment;
let reactActWarnings = [];
let unexpectedConsoleErrors = [];
let unhandledRejections = [];
let unhandledRejectionListener = null;

const propertyDescriptor = (target, property) => (
  Object.getOwnPropertyDescriptor(target, property)
);

const restoreProperty = (target, property, descriptor) => {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    delete target[property];
  }
};

const messageFrom = (args) => (
  typeof args[0] === 'string' ? args[0] : ''
);

const isReactActWarning = (args) => (
  messageFrom(args).includes('not wrapped in act')
);

const rememberReactActWarning = (args) => {
  reactActWarnings.push(new Error(args.map((arg) => String(arg)).join(' ')));
};

const formatConsoleArgs = (args) => (
  args.map((arg) => (
    arg instanceof Error ? (arg.stack || arg.message) : String(arg)
  )).join(' ')
);

const usingFakeTimers = () => {
  const timer = global.setTimeout;
  return Boolean(
    jest.isMockFunction(timer)
    || (timer && Object.prototype.hasOwnProperty.call(timer, 'clock')),
  );
};

const installConsoleGuards = () => {
  console.warn = (...args) => {
    if (messageFrom(args).includes('React Router Future Flag Warning')) {
      return;
    }
    return originalConsole.warn(...args);
  };

  console.log = (...args) => {
    const message = messageFrom(args);
    if (
      message.startsWith('Fetching images for project:') ||
      message.startsWith('Authentication is disabled or user is not logged in') ||
      message.startsWith('Starting download for image') ||
      message.startsWith('Trying endpoint:') ||
      message.startsWith('Direct image fetch failed') ||
      message.startsWith('Download completed successfully:') ||
      message.startsWith('App render count:')
    ) {
      return;
    }
    return originalConsole.log(...args);
  };

  console.error = (...args) => {
    if (isReactActWarning(args)) {
      rememberReactActWarning(args);
      return;
    }
    unexpectedConsoleErrors.push(new Error(formatConsoleArgs(args)));
    return originalConsole.error(...args);
  };
};

beforeEach(() => {
  // This hook runs after suite-level beforeAll hooks and before file-level
  // beforeEach hooks. Capture the suite baseline once so module-level mocks are
  // preserved while per-test replacements are always discarded.
  if (!suiteEnvironment) {
    suiteEnvironment = {
      fetch: propertyDescriptor(global, 'fetch'),
      viewport: Object.fromEntries(
        viewportProperties.map((property) => [
          property,
          propertyDescriptor(window, property),
        ]),
      ),
    };
  }
  reactActWarnings = [];
  unexpectedConsoleErrors = [];
  unhandledRejections = [];
  unhandledRejectionListener = (event) => {
    const reason = event?.reason;
    unhandledRejections.push(
      reason instanceof Error
        ? reason
        : new Error(`Unhandled promise rejection: ${String(reason)}`),
    );
  };
  window.addEventListener('unhandledrejection', unhandledRejectionListener);
  installConsoleGuards();
});

afterEach(() => {
  // Unmount first so lifecycle warnings raised during cleanup are attributed to
  // the test that created the component.
  cleanup();

  // Tests that intentionally spy on console.error still cannot hide React's
  // lifecycle warning from the harness.
  if (jest.isMockFunction(console.error)) {
    console.error.mock.calls
      .filter(isReactActWarning)
      .forEach(rememberReactActWarning);
  }

  const actWarnings = [...reactActWarnings];
  const consoleErrors = [...unexpectedConsoleErrors];
  const rejectionErrors = [...unhandledRejections];
  let pendingTimerCount = 0;

  if (unhandledRejectionListener) {
    window.removeEventListener('unhandledrejection', unhandledRejectionListener);
    unhandledRejectionListener = null;
  }

  // Count and clear queued fake timers without executing them. This keeps
  // teardown bounded even when a leaked callback recursively schedules more.
  if (usingFakeTimers()) {
    pendingTimerCount = jest.getTimerCount();
    if (pendingTimerCount > 0) {
      jest.clearAllTimers();
    }
  }
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();

  restoreProperty(global, 'fetch', suiteEnvironment.fetch);
  viewportProperties.forEach((property) => {
    restoreProperty(window, property, suiteEnvironment.viewport[property]);
  });

  console.warn = originalConsole.warn;
  console.log = originalConsole.log;
  console.error = originalConsole.error;

  const testName = expect.getState().currentTestName || 'Unknown test';
  const failures = [];
  if (actWarnings.length > 0) {
    failures.push(
      `React act warning in "${testName}":\n${actWarnings
        .map((warning) => warning.message)
        .join('\n')}`,
    );
  }
  if (consoleErrors.length > 0) {
    failures.push(
      `Unexpected console.error in "${testName}":\n${consoleErrors
        .map((error) => error.message)
        .join('\n')}`,
    );
  }
  if (rejectionErrors.length > 0) {
    failures.push(
      `Unhandled promise rejection in "${testName}":\n${rejectionErrors
        .map((error) => error.stack || error.message)
        .join('\n')}`,
    );
  }
  if (pendingTimerCount > 0) {
    failures.push(
      `Fake timer leak in "${testName}": ${pendingTimerCount} timer(s) remained queued after cleanup.`,
    );
  }
  if (failures.length > 0) {
    throw new Error(failures.join('\n\n'));
  }
});

afterAll(() => {
  console.warn = originalConsole.warn;
  console.log = originalConsole.log;
  console.error = originalConsole.error;
});
