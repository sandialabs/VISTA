import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

test('renders image management platform header', () => {
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
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
  const headerElement = screen.getByText('VISTA an Image Management System');
  expect(headerElement).toBeInTheDocument();
});

test('stops loading and shows an error when projects request stalls', async () => {
  jest.useFakeTimers();
  window.__VISTA_DASHBOARD_FETCH_TIMEOUT_MS = 25;
  global.fetch = jest.fn((input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/users/me')) {
      return Promise.resolve({ ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) });
    }
    if (url.endsWith('/api/users/me/groups')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }
    if (url.endsWith('/api/projects/')) {
      return new Promise(() => {});
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });

  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );

  expect(screen.getByText('Loading your projects...')).toBeInTheDocument();

  await act(async () => {
    jest.advanceTimersByTime(30);
    await Promise.resolve();
  });

  expect(await screen.findByText(/Failed to fetch projects: Request timed out/i)).toBeInTheDocument();
  expect(screen.queryByText('Loading your projects...')).not.toBeInTheDocument();

  delete window.__VISTA_DASHBOARD_FETCH_TIMEOUT_MS;
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
    await user.click(screen.getByRole('button', { name: 'Open dashboard settings' }));

    const settingsModal = screen.getByRole('dialog', { name: 'Dashboard Settings' });
    expect(await within(settingsModal).findByText('Change Postgres')).toBeInTheDocument();
    expect(within(settingsModal).getByText('postgresql+asyncpg://old:secret@localhost:5432/vista')).toBeInTheDocument();

    const urlInput = within(settingsModal).getByLabelText('New Postgres URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'postgresql+asyncpg://new:secret@localhost:5432/vista');
    await user.click(within(settingsModal).getByRole('button', { name: 'Preview' }));

    const previewModal = await screen.findByRole('dialog', { name: 'Dashboard Preview' });
    expect(within(previewModal).getByText('Preview Project')).toBeInTheDocument();
    expect(within(previewModal).getByText(/Images: 3 • Parts: 2/)).toBeInTheDocument();

    await user.click(within(previewModal).getByRole('button', { name: 'Accept This URL' }));

    expect(await screen.findByText('Accepted Project')).toBeInTheDocument();
    expect(screen.getByText(/Postgres database URL updated for this backend session/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/dashboard/settings/database-url/accept',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ database_url: 'postgresql+asyncpg://new:secret@localhost:5432/vista' }) })
    );
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

      expect(await screen.findByText(new RegExp(`Type: ${projectType}`))).toBeInTheDocument();

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

    expect(await screen.findByText(/Type: PT2/)).toBeInTheDocument();
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
    expect(screen.getByText(/Type: PT2/)).toBeInTheDocument();
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
    'requires explicit delete confirmation phrase for $projectType $userScenario.label simulated workflow',
    async ({ projectType, userScenario }) => {
      let isDeleted = false;
      global.fetch = jest.fn((input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method || 'GET').toUpperCase();
        const projectName = `${projectType} ${userScenario.label} delete target`;
        const expectedPhrase = `DELETE ${projectName}`;

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

      expect(screen.getByRole('button', { name: 'Delete Project' })).toBeDisabled();
      const deleteProjectButton = screen.getByRole('button', { name: 'Delete Project' });
      await user.type(screen.getByLabelText('Confirmation phrase *'), 'DELETE wrong phrase');
      await user.click(screen.getByLabelText(/I understand this is irreversible/i));
      expect(deleteProjectButton).toBeDisabled();

      const refreshedPhraseInput = screen.getByLabelText('Confirmation phrase *');
      await user.clear(refreshedPhraseInput);
      await user.type(refreshedPhraseInput, `DELETE ${projectType} ${userScenario.label} delete target`);
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
