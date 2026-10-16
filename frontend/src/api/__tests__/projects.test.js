import {
  archiveProject,
  cloneProjectConfiguration,
  createProject,
  deleteProjectMetadata,
  deleteProject,
  fetchProjects,
  fetchProjectsResponse,
  fetchProject,
  fetchProjectConfiguration,
  fetchProjectDataSummary,
  fetchProjectMetadataDictionary,
  fetchProjectMetadata,
  fetchProjectWorkspaceState,
  importProjectS3ObjectsResponse,
  listProjectS3ObjectsResponse,
  loadProjectTestData,
  fetchProjectReviewStatus,
  runProjectIngest,
  unarchiveProject,
  updateProjectMetadata,
  updateProjectMetadataDictionary,
  setProjectMetadata,
  updateProjectConfiguration,
  updateProjectWorkspaceState,
  saveProjectInterfaceLayoutDefault,
  saveProjectTypeInterfaceLayoutDefault,
  updateProject,
} from '../projects';

describe('project API helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('archives a project with an encoded project id', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'project/id', is_archived: true }),
    }));

    await expect(archiveProject('project/id')).resolves.toEqual({
      id: 'project/id',
      is_archived: true,
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/archive', expect.objectContaining({
      method: 'PATCH',
    }));
  });

  test('unarchives a project with an encoded project id', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'project/id', is_archived: false }),
    }));

    await expect(unarchiveProject('project/id')).resolves.toEqual({
      id: 'project/id',
      is_archived: false,
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/unarchive', expect.objectContaining({
      method: 'PATCH',
    }));
  });

  test('fetches active projects by default', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    await expect(fetchProjects()).resolves.toEqual([]);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/', expect.any(Object));
  });

  test('fetches archived projects when requested', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
    }));

    await fetchProjects({ includeArchived: true });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/?include_archived=true', expect.any(Object));
  });

  test('fetches a raw projects response when callers need custom parsing', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectsResponse({ includeArchived: true })).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/?include_archived=true');
  });

  test('fetches project details', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'project 1' }),
    }));

    await expect(fetchProject('project 1')).resolves.toEqual({ id: 'project 1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201', {});
  });

  test('throws ApiError with status and payload when project details fail', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Project not found' }),
    }));

    await expect(fetchProject('project 1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      payload: { detail: 'Project not found' },
    });
  });

  test('fetches project data summary', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ active_image_count: 2 }),
    }));

    await fetchProjectDataSummary('project 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/data-summary', expect.any(Object));
  });

  test('returns a parsed ingest response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const payload = { batches: [{ name: 'Batch 1' }] };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(runProjectIngest('project/id', payload)).resolves.toEqual({ id: 'result-1' });

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/ingest', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  test('returns a raw S3 object listing response', async () => {
    const response = { ok: true, status: 200 };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(listProjectS3ObjectsResponse('project/id', 's3://bucket/prefix'))
      .resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/s3/list', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ s3_url: 's3://bucket/prefix' });
  });

  test('returns a raw S3 object import response', async () => {
    const response = { ok: true, status: 200 };
    const payload = {
      s3_url: 's3://bucket/prefix',
      keys: ['a.png'],
      per_file_metadata: { 'a.png': { side: 'front' } },
      group_identifiers: { 'a.png': 'group-1' },
    };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(importProjectS3ObjectsResponse('project/id', payload)).resolves.toBe(response);

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/s3/import', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(payload);
  });

  test('returns parsed project test-data responses', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(loadProjectTestData('project/id')).resolves.toEqual({ id: 'result-1' });
    await expect(loadProjectTestData('project/id', { fixture: 'nist-cocr' })).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/projects/project%2Fid/load-test-data', expect.objectContaining({
      method: 'POST',
    }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/projects/project%2Fid/load-test-data?fixture=nist-cocr', expect.objectContaining({
      method: 'POST',
    }));
  });

  test('fetches project configuration', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: {} }),
    }));

    await fetchProjectConfiguration('project 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/configuration', expect.any(Object));
  });

  test('returns parsed project configuration and workspace state responses', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectConfiguration('project/id')).resolves.toEqual({ id: 'result-1' });
    await expect(fetchProjectWorkspaceState('project/id')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch.mock.calls.map(([url, init]) => [url, init])).toEqual([
      ['/api/projects/project%2Fid/configuration', {}],
      ['/api/projects/project%2Fid/workspace-state', {}],
    ]);
  });

  test('supports project configuration request timeouts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    await expect(fetchProjectConfiguration('project/id', { timeoutMs: 1000 })).rejects.toThrow('network down');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/project%2Fid/configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  test('updates project configuration', async () => {
    const config = { display_settings: { theme: 'dark' } };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config }),
    }));

    await updateProjectConfiguration('project 1', config);

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/configuration', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(init.body)).toEqual({ config });
  });

  test('returns a parsed update project configuration response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const config = { display_settings: { theme: 'dark' } };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updateProjectConfiguration('project 1', config)).resolves.toEqual({ id: 'result-1' });

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/configuration', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(init.body)).toEqual({ config });
  });

  test('returns a parsed workspace state update response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const state = { selected_part_id: 'part 1' };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updateProjectWorkspaceState('project/id', state)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/workspace-state', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ state });
  });

  test('guards project write responses when read-only', async () => {
    global.fetch = jest.fn();

    await expect(updateProjectConfiguration('project/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });
    await expect(updateProjectWorkspaceState('project/id', {}, { readOnly: true })).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('saves project interface layout defaults', async () => {
    const layout = { global: { tabsets: [] } };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: {} }),
    }));

    await saveProjectInterfaceLayoutDefault('project 1', layout);
    await saveProjectTypeInterfaceLayoutDefault('project 1', layout);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project%201/configuration/interface-layout/default',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project%201/configuration/interface-layout/project-type-default',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ layout_model: layout });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ layout_model: layout });
  });

  test('returns parsed interface layout default responses', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    const layout = { global: { tabsets: [] } };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(saveProjectInterfaceLayoutDefault('project 1', layout)).resolves.toEqual({ id: 'result-1' });
    await expect(saveProjectTypeInterfaceLayoutDefault('project 1', layout)).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/projects/project%201/configuration/interface-layout/default',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/projects/project%201/configuration/interface-layout/project-type-default',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ layout_model: layout });
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ layout_model: layout });
  });

  test('clones project configuration', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ config: {} }),
    }));

    await cloneProjectConfiguration('target/project', 'source/project');

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/target%2Fproject/configuration/clone', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(init.body)).toEqual({ source_project_id: 'source/project' });
  });

  test('fetches project review status summary', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ total_images: 1 }),
    }));

    await fetchProjectReviewStatus('project 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/review-status', expect.any(Object));
  });

  test('fetches project metadata dictionary', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ field: 'value' }),
    }));

    await fetchProjectMetadataDictionary('project 1');

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/metadata-dict', expect.any(Object));
  });

  test('returns a parsed project metadata dictionary response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectMetadataDictionary('project/id')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/metadata-dict', {});
  });

  test('updates project metadata dictionary', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ field: 'value' }),
    }));

    await updateProjectMetadataDictionary('project 1', { field: 'value' });

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%201/metadata-dict', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(init.body)).toEqual({ field: 'value' });
  });

  test('updates and deletes a project metadata key with encoded path segments', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ field: 'value' }),
    }));

    await updateProjectMetadata('project 1', 'field/name', 'value');
    await deleteProjectMetadata('project 1', 'field/name');

    const [, updateInit] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/projects/project%201/metadata/field%2Fname', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(updateInit.body)).toEqual({ key: 'field/name', value: 'value' });
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/projects/project%201/metadata/field%2Fname', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('returns parsed project metadata key responses', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(fetchProjectMetadata('project/id', 'field/name')).resolves.toEqual({ id: 'result-1' });
    await expect(updateProjectMetadata('project/id', 'field/name', 'value')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/projects/project%2Fid/metadata/field%2Fname', {});
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/projects/project%2Fid/metadata/field%2Fname', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ key: 'field/name', value: 'value' });
  });

  test('returns a parsed project metadata set response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(setProjectMetadata('project/id', 'calibration_default', { pixels_per_mm: 2 }))
      .resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid/metadata', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      key: 'calibration_default',
      value: { pixels_per_mm: 2 },
    });
  });

  test('creates a project with a JSON payload', async () => {
    const project = { name: 'New Project', project_type: 'PT1' };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({ id: 'new-project', ...project }),
    }));

    await expect(createProject(project)).resolves.toEqual({ id: 'new-project', ...project });

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(init.body)).toEqual(project);
  });

  test('updates a project with an encoded project id', async () => {
    const update = { name: 'Updated Project' };
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ id: 'project/id', ...update }),
    }));

    await expect(updateProject('project/id', update)).resolves.toEqual({ id: 'project/id', ...update });

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid', expect.objectContaining({
      method: 'PUT',
    }));
    expect(JSON.parse(init.body)).toEqual(update);
  });

  test('returns a parsed update project response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(updateProject('project/id', { name: 'Updated' })).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
  });

  test('returns a parsed clone configuration response', async () => {
    const response = { ok: true, status: 200, json: async () => ({ id: 'result-1' }) };
    global.fetch = jest.fn(() => Promise.resolve(response));

    await expect(cloneProjectConfiguration('target/project', 'source/project')).resolves.toEqual({ id: 'result-1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/projects/target%2Fproject/configuration/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_project_id: 'source/project' }),
    });
  });

  test('deletes a project with a confirmation phrase', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      status: 204,
    }));

    await expect(deleteProject('project/id', 'DELETE Example')).resolves.toBeNull();

    const [, init] = global.fetch.mock.calls[0];
    expect(global.fetch).toHaveBeenCalledWith('/api/projects/project%2Fid', expect.objectContaining({
      method: 'DELETE',
    }));
    expect(JSON.parse(init.body)).toEqual({ confirmation_phrase: 'DELETE Example' });
  });
});
