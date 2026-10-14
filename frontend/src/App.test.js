import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { getProjectTypeLabel } from './projectTypes';

jest.setTimeout(30000);

beforeEach(() => {
  window.localStorage.removeItem('vista.dashboard.debugMode');
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function projectTypeCardMatcher(projectType) {
  const expected = `Type: ${getProjectTypeLabel(projectType, { short: true })}`;
  return (_content, element) => element?.classList?.contains('project-card-meta')
    && element.textContent.includes(expected);
}

test('renders image management platform header', async () => {
  global.fetch = jest.fn((input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/users/me')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) });
    }
    if (url.endsWith('/api/users/me/groups')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }
    if (url.endsWith('/api/projects/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  await act(async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    await Promise.resolve();
  });
  const headerElement = screen.getByText('VISTA an Image Management System');
  expect(headerElement).toBeInTheDocument();
});


test('renders project dashboard cards with loaded image and part counts from the projects API', async () => {
  window.scrollTo = jest.fn();
  global.fetch = jest.fn((input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/users/me')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'counts@example.com' }) });
    }
    if (url.endsWith('/api/users/me/groups')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ['counts-group'] });
    }
    if (url.endsWith('/api/projects/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ([
          {
            id: 'counts-project',
            name: 'Dashboard Counts Project',
            description: 'Project card count regression',
            meta_group_id: 'counts-group',
            project_type: 'PT1',
            image_count: 7,
            part_count: 3,
          },
        ]),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  await act(async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    await Promise.resolve();
  });

  expect(await screen.findByText('Dashboard Counts Project')).toBeInTheDocument();
  expect(screen.getByText('Images: 7 • Parts: 3')).toBeInTheDocument();
});

test('stops loading and shows an error when projects request fails', async () => {
  global.fetch = jest.fn((input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/users/me')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) });
    }
    if (url.endsWith('/api/users/me/groups')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }
    if (url.endsWith('/api/projects/')) {
      return Promise.reject(new Error('Request timed out after 1ms'));
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  await act(async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    await Promise.resolve();
  });

  expect(await screen.findByText(/Failed to fetch projects: Request timed out/i)).toBeInTheDocument();
  expect(screen.queryByText('Loading your projects...')).not.toBeInTheDocument();
});


test('dashboard debug mode surfaces detailed persistent project load errors', async () => {
  jest.useFakeTimers();
  window.localStorage.setItem('vista.dashboard.debugMode', 'true');
  global.fetch = jest.fn((input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/users/me')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) });
    }
    if (url.endsWith('/api/users/me/groups')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }
    if (url.endsWith('/api/projects/')) {
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => 'application/json' },
        json: async () => ({ detail: 'database relation "projects" does not exist', trace_id: 'trace-500' }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );

  expect(await screen.findByText(/database relation "projects" does not exist/i)).toBeInTheDocument();
  expect(screen.getByText(/Debug details: GET \/api\/projects\/ failed with HTTP 500 Internal Server Error/i)).toBeInTheDocument();
  expect(screen.getByText(/trace-500/i)).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(6000);
  });
  expect(screen.getByText(/database relation "projects" does not exist/i)).toBeInTheDocument();

  await userEvent.setup({ advanceTimers: jest.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Close notification' }));
  expect(screen.queryByText(/database relation "projects" does not exist/i)).not.toBeInTheDocument();
  jest.useRealTimers();
});

describe('project type UI exposure', () => {
  const projectTypes = ['PT1', 'PT2', 'PT3'];
  const simulatedUsers = [
    { label: 'basic', complexity: 1 },
    { label: 'intermediate', complexity: 2 },
    { label: 'advanced', complexity: 3 },
  ];

  function mockDashboardFetches({ projectType, userScenario }) {
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ email: `${userScenario.label}-${projectType.toLowerCase()}@example.com` }),
        });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [`${projectType.toLowerCase()}-${userScenario.label}-group`],
        });
      }

      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ([
            {
              id: `proj-${projectType.toLowerCase()}-${userScenario.label}`,
              name: `${projectType} ${userScenario.label} synthetic`,
              description: `complexity-${userScenario.complexity}`,
              meta_group_id: `${projectType.toLowerCase()}-${userScenario.label}-group`,
              project_type: projectType,
            },
          ]),
        });
      }

      if (url.endsWith('/api/projects/') && method === 'POST') {
        const payload = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: `new-${projectType.toLowerCase()}-${userScenario.label}`,
            ...payload,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    });
  }

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('previews and accepts a session Postgres URL from dashboard settings', async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = jest.fn(() => Promise.resolve());
    let projects = [];
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'settings@example.com' }) });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ['settings-group'] });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => projects });
      }
      if (url.endsWith('/api/dashboard/settings/version') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ gitlab_commit_sha: 'abc123def4567890abc123def4567890abc123de' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://old:secret@localhost:5432/vista' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/preview') && method === 'POST') {
        expect(JSON.parse(init.body)).toEqual({ database_url: 'postgresql+asyncpg://new:secret@localhost:5432/vista' });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            database_url: 'postgresql+asyncpg://new:secret@localhost:5432/vista',
            project_count: 1,
            projects: [{
              id: 'preview-project-1',
              name: 'Preview Project',
              description: 'from new database',
              meta_group_id: 'settings-group',
              project_type: 'PT1',
              image_count: 3,
              part_count: 2,
            }],
          }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/accept') && method === 'POST') {
        projects = [{
          id: 'accepted-project-1',
          name: 'Accepted Project',
          description: 'active database',
          meta_group_id: 'settings-group',
          project_type: 'PT2',
          image_count: 4,
          part_count: 1,
        }];
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://new:secret@localhost:5432/vista' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await screen.findByText('No projects yet');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));

    const settingsModal = screen.getByRole('dialog', { name: 'Dashboard Settings' });
    const settingsBody = settingsModal.querySelector('.dashboard-settings-body');
    expect(settingsBody).toBeInTheDocument();
    expect(settingsBody).toHaveAttribute('role', 'region');
    expect(settingsBody).toHaveAttribute('aria-label', 'Dashboard settings options');
    expect(settingsBody).toHaveAttribute('tabindex', '0');
    expect(settingsBody).toHaveClass('dashboard-settings-body');
    expect(await within(settingsModal).findByText('Version Information')).toBeInTheDocument();
    expect(await within(settingsModal).findByText('abc123def4567890abc123def4567890abc123de')).toBeInTheDocument();
    await user.click(within(settingsModal).getByRole('button', { name: 'Copy SHA' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc123def4567890abc123def4567890abc123de'));
    expect(screen.getByText('GitLab commit SHA copied to clipboard.')).toBeInTheDocument();
    expect(await within(settingsModal).findByText('Debug Mode')).toBeInTheDocument();
    const debugToggle = within(settingsModal).getByRole('switch', { name: 'Enable dashboard debug mode' });
    expect(debugToggle).not.toBeChecked();
    await user.click(debugToggle);
    expect(window.localStorage.getItem('vista.dashboard.debugMode')).toBe('true');
    expect(screen.getByText('Dashboard debug mode enabled.')).toBeInTheDocument();
    expect(await screen.findByText('Change Postgres')).toBeInTheDocument();
    const refreshedSettingsModal = screen.getByRole('dialog', { name: 'Dashboard Settings' });
    expect(within(refreshedSettingsModal).getByText('postgresql+asyncpg://old:secret@localhost:5432/vista')).toBeInTheDocument();

    expect(within(refreshedSettingsModal).getByRole('button', { name: 'Submit Postgres URL' })).toBeDisabled();
    const urlInput = within(refreshedSettingsModal).getByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://new:secret@localhost:5432/vista');
    await user.click(within(refreshedSettingsModal).getByRole('button', { name: 'Preview' }));

    const previewModal = await screen.findByRole('dialog', { name: 'Dashboard Preview' });
    expect(previewModal.querySelector('.database-preview-body')).toBeInTheDocument();
    expect(within(previewModal).getByText('Preview Project')).toBeInTheDocument();
    expect(within(previewModal).getByText('ID: preview-project-1')).toBeInTheDocument();
    expect(within(previewModal).getByText('Group: settings-group')).toBeInTheDocument();
    expect(within(previewModal).getByText('Images: 3')).toBeInTheDocument();
    expect(within(previewModal).getByText('Parts: 2')).toBeInTheDocument();

    await user.click(within(previewModal).getByRole('button', { name: 'Submit This URL' }));

    expect(await screen.findByText('Accepted Project')).toBeInTheDocument();
    expect(screen.getByText(/Postgres database URL updated for this backend session/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dashboard/settings/database-url/accept',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ database_url: 'postgresql+asyncpg://new:secret@localhost:5432/vista' }) })
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  test('ignores a stale dashboard preview after the database URL changes', async () => {
    const firstPreview = createDeferred();
    const previewBodies = [];
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'settings@example.com' }) });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ['settings-group'] });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (url.endsWith('/api/dashboard/settings/database-url') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://old/db' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/preview') && method === 'POST') {
        const body = JSON.parse(init.body);
        previewBodies.push(body);
        if (previewBodies.length === 1) return firstPreview.promise;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            database_url: body.database_url,
            project_count: 1,
            projects: [{
              id: 'fresh-project',
              name: 'Fresh Preview',
              description: '',
              meta_group_id: 'settings-group',
              project_type: 'PT1',
              image_count: 0,
              part_count: 0,
            }],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BrowserRouter><App /></BrowserRouter>);
    await screen.findByText('No projects yet');
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));

    const urlInput = await screen.findByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://first/db');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('button', { name: 'Previewing…' })).toBeDisabled();

    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://second/db');

    await act(async () => {
      firstPreview.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          database_url: 'postgresql+asyncpg://first/db',
          project_count: 1,
          projects: [{
            id: 'stale-project',
            name: 'Stale Preview',
            description: '',
            meta_group_id: 'settings-group',
            project_type: 'PT1',
          }],
        }),
      });
      await firstPreview.promise;
    });

    expect(screen.queryByText('Stale Preview')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Fresh Preview')).toBeInTheDocument();
    expect(previewBodies).toEqual([
      { database_url: 'postgresql+asyncpg://first/db' },
      { database_url: 'postgresql+asyncpg://second/db' },
    ]);
  });

  test('accepts exactly the displayed preview URL once and locks unsafe controls while switching', async () => {
    const acceptRequest = createDeferred();
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'settings@example.com' }) });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ['settings-group'] });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (url.endsWith('/api/dashboard/settings/database-url') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://old/db' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/preview') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            database_url: 'postgresql+asyncpg://previewed/db',
            project_count: 0,
            projects: [],
          }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/accept') && method === 'POST') {
        return acceptRequest.promise;
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BrowserRouter><App /></BrowserRouter>);
    await screen.findByText('No projects yet');
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));

    const urlInput = await screen.findByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql://requested/db');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const previewModal = await screen.findByRole('dialog', { name: 'Dashboard Preview' });
    expect(within(previewModal).getByText('postgresql+asyncpg://previewed/db')).toBeInTheDocument();
    const submitPreview = within(previewModal).getByRole('button', { name: 'Submit This URL' });
    await user.click(submitPreview);
    await user.click(submitPreview);

    const acceptCalls = global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/database-url/accept'));
    expect(acceptCalls).toHaveLength(1);
    expect(JSON.parse(acceptCalls[0][1].body)).toEqual({
      database_url: 'postgresql+asyncpg://previewed/db',
    });
    expect(urlInput).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close dashboard settings' })).toBeDisabled();
    expect(within(previewModal).getByRole('button', { name: 'Keep Editing' })).toBeDisabled();

    await act(async () => {
      acceptRequest.resolve({
        ok: true,
        status: 200,
        json: async () => ({ database_url: 'postgresql+asyncpg://previewed/db' }),
      });
      await acceptRequest.promise;
    });

    expect(await screen.findByText(/Postgres database URL updated for this backend session/i)).toBeInTheDocument();
  });

  test('reports a malformed dashboard preview response without rendering a broken modal', async () => {
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'settings@example.com' }) });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ['settings-group'] });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (url.endsWith('/api/dashboard/settings/database-url') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://old/db' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/preview') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://malformed/db', project_count: 1 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BrowserRouter><App /></BrowserRouter>);
    await screen.findByText('No projects yet');
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));

    const urlInput = await screen.findByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://malformed/db');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The dashboard preview response was invalid.');
    expect(screen.queryByRole('dialog', { name: 'Dashboard Preview' })).not.toBeInTheDocument();
  });

  test('keeps a successful database switch successful when the dashboard refresh fails', async () => {
    const refreshRequest = createDeferred();
    let projectLoadCount = 0;
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'settings@example.com' }) });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ['settings-group'] });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        projectLoadCount += 1;
        if (projectLoadCount === 1) {
          return Promise.resolve({ ok: true, status: 200, json: async () => [] });
        }
        return refreshRequest.promise;
      }
      if (url.endsWith('/api/dashboard/settings/database-url') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://old/db' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/accept') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://accepted/db' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BrowserRouter><App /></BrowserRouter>);
    await screen.findByText('No projects yet');
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));
    const urlInput = await screen.findByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://accepted/db');
    await user.click(screen.getByRole('button', { name: 'Submit Postgres URL' }));
    await waitFor(() => expect(projectLoadCount).toBe(2));

    await act(async () => {
      refreshRequest.resolve({
        ok: false,
        status: 503,
        json: async () => ({ detail: 'refresh unavailable' }),
      });
      await refreshRequest.promise;
    });

    expect(await screen.findByText(/Postgres database URL updated for this backend session/i)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Database switched successfully, but dashboard projects could not be refreshed.',
    );
    expect(screen.queryByText(/Unable to switch to that Postgres URL/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('postgresql+asyncpg://accepted/db').length).toBeGreaterThan(0);
  });

  test('handles a malformed accepted database URL without putting a non-string into state', async () => {
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ email: 'settings@example.com' }) });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ['settings-group'] });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      if (url.endsWith('/api/dashboard/settings/database-url') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 'postgresql+asyncpg://old/db' }),
        });
      }
      if (url.endsWith('/api/dashboard/settings/database-url/accept') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ database_url: 42 }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(<BrowserRouter><App /></BrowserRouter>);
    await screen.findByText('No projects yet');
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));
    const urlInput = await screen.findByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://submitted/db');
    await user.click(screen.getByRole('button', { name: 'Submit Postgres URL' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Database switched successfully, but the backend returned an invalid database URL.',
    );
    expect(urlInput).toHaveValue('postgresql+asyncpg://submitted/db');
    expect(screen.getAllByText('postgresql+asyncpg://submitted/db').length).toBeGreaterThan(0);
    expect(await screen.findByText(/Postgres database URL updated for this backend session/i)).toBeInTheDocument();
  });

  test.each(projectTypes.flatMap((projectType) => simulatedUsers.map((userScenario) => ({ projectType, userScenario }))))(
    'shows selected project type for $projectType $userScenario.label simulated workflow',
    async ({ projectType, userScenario }) => {
      mockDashboardFetches({ projectType, userScenario });
      const user = userEvent.setup();

      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );

      expect(await screen.findByText(projectTypeCardMatcher(projectType))).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'New Project' }));
      await user.type(screen.getByLabelText('Project Name *'), `${projectType} ${userScenario.label} created`);
      await user.type(screen.getByLabelText('Access Group *'), `${projectType.toLowerCase()}-${userScenario.label}-new-group`);
      await user.selectOptions(screen.getByLabelText('Project Type *'), projectType);
      await user.click(screen.getByRole('button', { name: 'Create Project' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/projects/',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining(`"project_type":"${projectType}"`),
          })
        );
      });
    }
  );

  test('keeps selected project type on dashboard card even if create response omits project_type', async () => {
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ email: 'pt2-user@example.com' }),
        });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ['pt2-group'],
        });
      }

      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ([]),
        });
      }

      if (url.endsWith('/api/projects/') && method === 'POST') {
        const payload = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            id: 'created-pt2',
            name: payload.name,
            description: payload.description,
            meta_group_id: payload.meta_group_id,
          }),
        });
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await user.click(await screen.findByRole('button', { name: 'Create Your First Project' }));
    await user.type(screen.getByLabelText('Project Name *'), 'Test PT2');
    await user.type(screen.getByLabelText('Access Group *'), 'pt2-group');
    await user.selectOptions(screen.getByLabelText('Project Type *'), 'PT2');
    await user.click(screen.getByRole('button', { name: 'Create Project' }));

    expect(await screen.findByText(projectTypeCardMatcher('PT2'))).toBeInTheDocument();
  });

  test('shows project card ellipsis menu and allows editing name and type', async () => {
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ email: 'editor@example.com' }),
        });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ['g1'],
        });
      }

      if (url.endsWith('/api/projects/') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ([
            {
              id: 'project-1',
              name: 'Project Original',
              description: 'Original description',
              meta_group_id: 'g1',
              project_type: 'PT1',
            },
          ]),
        });
      }

      if (url.endsWith('/api/projects/project-1') && method === 'PUT') {
        const payload = JSON.parse(init.body || '{}');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'project-1',
            meta_group_id: 'g1',
            ...payload,
          }),
        });
      }

      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await screen.findByText('Project Original');
    await user.click(screen.getByRole('button', { name: /Project options for Project Original/i }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const nameInput = screen.getByLabelText('Project Name *');
    await user.clear(nameInput);
    await user.type(nameInput, 'Project Edited');
    await user.selectOptions(screen.getByLabelText('Project Type *'), 'PT2');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText('Project Edited')).toBeInTheDocument();
    expect(screen.getByText(projectTypeCardMatcher('PT2'))).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/projects/project-1',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"project_type":"PT2"'),
        })
      );
    });
  });


  test('opens a file chooser modal from the single Import Dashboard button', async () => {
    let projectsRequestCount = 0;
    global.fetch = jest.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method || 'GET').toUpperCase();

      if (url.endsWith('/api/users/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ email: 'importer@example.com' }),
        });
      }
      if (url.endsWith('/api/users/me/groups')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ['import-group'],
        });
      }
      if (url.endsWith('/api/projects/') && method === 'GET') {
        projectsRequestCount += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ([]),
        });
      }
      if (url.endsWith('/api/dashboard/import/preview') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ project_count: 2, missing_artifacts: [] }),
        });
      }
      if (url.endsWith('/api/dashboard/import') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ project_count: 2, dashboard_state: { gallery_state: {} } }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await screen.findByText('No projects yet');
    expect(screen.queryByRole('button', { name: 'Choose Import File' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));

    const settingsModal = screen.getByRole('dialog', { name: 'Dashboard Settings' });
    expect(within(settingsModal).getByText('Dashboard Backup')).toBeInTheDocument();
    await user.click(within(settingsModal).getByRole('button', { name: 'Import Dashboard' }));

    const modal = screen.getByRole('dialog', { name: 'Import Dashboard' });
    const modalImportButton = within(modal).getByRole('button', { name: 'Import Dashboard' });
    expect(within(modal).getByLabelText('Dashboard backup file')).toBeInTheDocument();
    expect(modalImportButton).toBeDisabled();

    await user.upload(
      within(modal).getByLabelText('Dashboard backup file'),
      new File(['dashboard-backup'], 'dashboard.vistabundle', { type: 'application/zip' })
    );

    expect(await within(modal).findByText('Backup ready: 2 project(s), 0 missing artifact(s).')).toBeInTheDocument();
    expect(modalImportButton).toBeEnabled();

    await user.click(modalImportButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Import Dashboard' })).not.toBeInTheDocument();
      expect(projectsRequestCount).toBeGreaterThanOrEqual(2);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dashboard/import/preview',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dashboard/import',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
    );
  });

  test.each(projectTypes.flatMap((projectType) => simulatedUsers.map((userScenario) => ({ projectType, userScenario }))))(
    'requires checkbox confirmation for $projectType $userScenario.label simulated delete workflow',
    async ({ projectType, userScenario }) => {
      let isDeleted = false;
      const projectName = `${projectType} ${userScenario.label} delete target`;
      const expectedPhrase = `DELETE ${projectName}`;
      global.fetch = jest.fn((input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method || 'GET').toUpperCase();

        if (url.endsWith('/api/users/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ email: `${userScenario.label}-${projectType.toLowerCase()}@example.com` }),
          });
        }
        if (url.endsWith('/api/users/me/groups')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [`${projectType.toLowerCase()}-${userScenario.label}-group`],
          });
        }

        if (url.endsWith('/api/projects/') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => (isDeleted ? [] : [
              {
                id: `project-${projectType.toLowerCase()}-${userScenario.label}`,
                name: projectName,
                description: `complexity-${userScenario.complexity}`,
                meta_group_id: `${projectType.toLowerCase()}-${userScenario.label}-group`,
                project_type: projectType,
              },
            ]),
          });
        }

        if (url.endsWith(`/api/projects/project-${projectType.toLowerCase()}-${userScenario.label}`) && method === 'DELETE') {
          const payload = JSON.parse(init.body || '{}');
          if (payload.confirmation_phrase !== expectedPhrase) {
            return Promise.resolve({
              ok: false,
              status: 400,
              json: async () => ({ detail: `Invalid confirmation phrase. Expected '${expectedPhrase}'.` }),
            });
          }
          isDeleted = true;
          return Promise.resolve({
            ok: true,
            status: 204,
            json: async () => ({}),
          });
        }

        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const user = userEvent.setup();
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );

      await screen.findByText(new RegExp(`${projectType} ${userScenario.label} delete target`));
      await user.click(screen.getByRole('button', { name: new RegExp(`Project options for ${projectType} ${userScenario.label} delete target`) }));
      await user.click(screen.getByRole('button', { name: 'Delete' }));

      const deleteProjectButton = screen.getByRole('button', { name: 'Delete Project' });
      const confirmationCheckbox = screen.getByRole('checkbox', {
        name: new RegExp(`I understand that deleting ${projectName} is irreversible`, 'i'),
      });
      expect(screen.queryByLabelText('Confirmation phrase *')).not.toBeInTheDocument();
      expect(deleteProjectButton).toBeDisabled();
      expect(confirmationCheckbox).not.toBeChecked();

      await user.click(confirmationCheckbox);
      expect(deleteProjectButton).toBeEnabled();
      await user.click(deleteProjectButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/projects/project-${projectType.toLowerCase()}-${userScenario.label}`,
          expect.objectContaining({
            method: 'DELETE',
            body: expect.stringContaining(`DELETE ${projectType} ${userScenario.label} delete target`),
          })
        );
      });
      await waitFor(() => {
        expect(screen.queryByText(`${projectType} ${userScenario.label} delete target`)).not.toBeInTheDocument();
      });
    }
  );

  test.each(projectTypes.flatMap((projectType) => simulatedUsers.map((userScenario) => ({ projectType, userScenario }))))(
    'disables delete menu action when user lacks group authorization for $projectType $userScenario.label workflow',
    async ({ projectType, userScenario }) => {
      global.fetch = jest.fn((input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method || 'GET').toUpperCase();

        if (url.endsWith('/api/users/me')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ email: `${userScenario.label}-${projectType.toLowerCase()}@example.com` }),
          });
        }
        if (url.endsWith('/api/users/me/groups')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [`${projectType.toLowerCase()}-other-group`],
          });
        }
        if (url.endsWith('/api/projects/') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ([
              {
                id: `project-${projectType.toLowerCase()}-${userScenario.label}`,
                name: `${projectType} ${userScenario.label} restricted project`,
                description: `complexity-${userScenario.complexity}`,
                meta_group_id: `${projectType.toLowerCase()}-${userScenario.label}-group`,
                project_type: projectType,
              },
            ]),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const user = userEvent.setup();
      render(
        <BrowserRouter>
          <App />
        </BrowserRouter>
      );

      await screen.findByText(`${projectType} ${userScenario.label} restricted project`);
      await user.click(screen.getByRole('button', { name: new RegExp(`Project options for ${projectType} ${userScenario.label} restricted project`) }));
      const deleteMenuItem = screen.getByRole('button', { name: 'Delete' });
      expect(deleteMenuItem).toBeDisabled();
      expect(deleteMenuItem).toHaveAttribute('title', 'You do not have access to delete this project.');
    }
  );
});
