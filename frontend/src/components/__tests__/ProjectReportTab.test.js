import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectReportTab from '../ProjectReportTab';
import { downloadExcel } from '../../utils/downloadExcel';

jest.mock('../../utils/downloadExcel', () => ({
  downloadExcel: jest.fn(),
}));

const PROJECT_ID = 'project-123';

function makeReport(parts = [
  ['part-pass', 'SERIAL-PASS', 'pass'],
  ['part-reject', 'SERIAL-REJECT', 'reject'],
  ['part-open', 'SERIAL-UNREVIEWED', 'unreviewed'],
]) {
  const rows = parts.map(([partId, partIdentifier, inspectionResult]) => ({
    part_id: partId,
    part_identifier: partIdentifier,
    inspection_result: inspectionResult,
  }));
  const partStatusCounts = {
    pass: rows.filter((part) => part.inspection_result === 'pass').length,
    reject: rows.filter((part) => part.inspection_result === 'reject').length,
    unreviewed: rows.filter((part) => part.inspection_result === 'unreviewed').length,
  };
  return {
    schema_version: 3,
    project: {
      id: PROJECT_ID,
      name: 'Turbine Cell A',
      project_type: 'PT2',
      meta_group_id: 'quality',
    },
    summary: {
      total_parts: rows.length,
      reviewed_parts: partStatusCounts.pass + partStatusCounts.reject,
      unreviewed_parts: partStatusCounts.unreviewed,
      part_status_counts: partStatusCounts,
    },
    parts: rows,
  };
}

function jsonResponse(payload, overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(payload),
    headers: { get: jest.fn(() => null) },
    ...overrides,
  };
}

function pdfResponse(blob, contentType = 'application/pdf', overrides = {}) {
  return {
    ok: true,
    status: 200,
    blob: jest.fn().mockResolvedValue(blob),
    headers: { get: jest.fn(() => contentType) },
    ...overrides,
  };
}

function chooseAction(label) {
  fireEvent.change(screen.getByLabelText(/export\/report mode/i), { target: { value: label } });
  fireEvent.click(screen.getByRole('button', { name: /run export\/report/i }));
}

describe('ProjectReportTab', () => {
  let originalCreateObjectURL;
  let originalRevokeObjectURL;

  beforeEach(() => {
    global.fetch = jest.fn();
    downloadExcel.mockReset();
    originalCreateObjectURL = window.URL.createObjectURL;
    originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = jest.fn(() => 'blob:inspection-report');
    window.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  test('renders exactly one accessible result row per canonical part', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(makeReport()));
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Turbine Cell A" setError={jest.fn()} />);

    await chooseAction('report_json');

    const table = await screen.findByRole('table', { name: /inspection results by part/i });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getByText('SERIAL-PASS')).toBeInTheDocument();
    expect(within(table).getByText('SERIAL-REJECT')).toBeInTheDocument();
    expect(within(table).getByText('SERIAL-UNREVIEWED')).toBeInTheDocument();
    expect(within(table).getByText('Pass')).toBeInTheDocument();
    expect(within(table).getByText('Reject')).toBeInTheDocument();
    expect(within(table).getByText('Unreviewed')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Reviewed' })).not.toBeInTheDocument();
    expect(within(table).queryByText('Not reviewed')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Inspection result summary')).toHaveTextContent('Pass1Reject1Unreviewed1');
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/report-json?schema_version=3`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  }, 15_000);

  test('renders a clear empty inspection record', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(makeReport([])));
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Empty project" setError={jest.fn()} />);

    await chooseAction('report_json');

    expect(await screen.findByText('No parts to report')).toBeInTheDocument();
    expect(screen.getByText('This project has no inspection parts yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('announces loading while a report request is pending', async () => {
    const user = userEvent.setup();
    let resolveRequest;
    global.fetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Pending project" setError={jest.fn()} />);

    await user.selectOptions(screen.getByLabelText(/export\/report mode/i), 'report_json');
    await user.click(screen.getByRole('button', { name: /run export\/report/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Preparing export');
    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled();

    await act(async () => {
      resolveRequest(jsonResponse(makeReport()));
    });
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  test('reports request and malformed-contract errors and retries safely', async () => {
    const user = userEvent.setup();
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(jsonResponse({ schema_version: 1, parts: 'invalid' }))
      .mockResolvedValueOnce(jsonResponse(makeReport()));
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Retry project" setError={jest.fn()} />);

    await chooseAction('report_json');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Request failed (503) | attempted=GET /api/projects/project-123/report-json?schema_version=3'
    );

    await user.click(screen.getByRole('button', { name: /retry report/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not match the v3 inspection report contract');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry report/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test.each([
    {
      label: 'part id',
      parts: [
        ['duplicate', 'SERIAL-1', 'pass'],
        ['duplicate', 'SERIAL-2', 'reject'],
      ],
    },
    {
      label: 'part identifier',
      parts: [
        ['part-1', 'SERIAL-DUPLICATE', 'pass'],
        ['part-2', 'SERIAL-DUPLICATE', 'reject'],
      ],
    },
  ])('rejects a report with a duplicate $label', async ({ parts }) => {
    global.fetch.mockResolvedValueOnce(jsonResponse(makeReport(parts)));
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Duplicate project" setError={jest.fn()} />);

    await chooseAction('report_json');

    expect(await screen.findByRole('alert')).toHaveTextContent('did not match the v3 inspection report contract');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('downloads and revokes the PDF object URL without replacing the JSON table', async () => {
    const pdfBlob = new Blob(['%PDF-1.4 test bytes'], { type: 'application/pdf' });
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload() {
      expect(this.href).toBe('blob:inspection-report');
      expect(this.download).toBe('Turbine Cell A-report.pdf');
    });
    global.fetch
      .mockResolvedValueOnce(jsonResponse(makeReport()))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: jest.fn().mockResolvedValue(pdfBlob),
        headers: { get: jest.fn(() => 'application/pdf') },
      });
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Turbine Cell A" setError={jest.fn()} />);

    await chooseAction('report_json');
    const table = await screen.findByRole('table');
    await chooseAction('report_pdf');

    expect(await screen.findByText(`PDF report downloaded: ${pdfBlob.size} bytes.`)).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(pdfBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:inspection-report');
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${PROJECT_ID}/report-json?schema_version=3`,
      `/api/projects/${PROJECT_ID}/report-pdf?schema_version=3`,
    ]);
  });

  test('downloads the separate report with images and preserves the standard ledger', async () => {
    const user = userEvent.setup();
    const imageReportBlob = new Blob(['%PDF-1.4 image evidence'], { type: 'application/pdf' });
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload() {
      expect(this.href).toBe('blob:inspection-report');
      expect(this.download).toBe('Turbine Cell A-report-with-images.pdf');
    });
    global.fetch
      .mockResolvedValueOnce(jsonResponse(makeReport()))
      .mockResolvedValueOnce(pdfResponse(imageReportBlob));
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Turbine Cell A" setError={jest.fn()} />);

    await chooseAction('report_json');
    const table = await screen.findByRole('table', { name: /inspection results by part/i });
    await user.click(screen.getByRole('button', { name: /download report with images \(pdf\)/i }));

    expect(await screen.findByText(`Report with images downloaded: ${imageReportBlob.size} bytes.`)).toBeInTheDocument();
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(imageReportBlob);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:inspection-report');
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${PROJECT_ID}/report-json?schema_version=3`,
      `/api/projects/${PROJECT_ID}/report-with-images-pdf`,
    ]);
  });

  test.each([
    ['a request error', { ok: false, status: 503 }],
    ['a mislabeled response', pdfResponse(new Blob(['%PDF-1.4 evidence']), 'application/json')],
    ['an invalid PDF signature', pdfResponse(new Blob(['<html>not pdf</html>']))],
    ['an empty response', pdfResponse(new Blob([]))],
  ])('isolates %s from the existing report ledger', async (_label, imageReportResponse) => {
    const user = userEvent.setup();
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    global.fetch
      .mockResolvedValueOnce(jsonResponse(makeReport()))
      .mockResolvedValueOnce(imageReportResponse);
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Isolation project" setError={jest.fn()} />);

    await chooseAction('report_json');
    const table = await screen.findByRole('table', { name: /inspection results by part/i });
    await user.click(screen.getByRole('button', { name: /download report with images \(pdf\)/i }));

    const alert = await screen.findByRole('alert');
    if (_label === 'a request error') {
      expect(alert).toHaveTextContent('Failed to generate report with images (503)');
    } else {
      expect(alert).toHaveTextContent('valid PDF report with images');
    }
    expect(table).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
  });

  test('disables the image report action and suppresses duplicate clicks while pending', async () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let resolveRequest;
    const pendingResponse = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    global.fetch.mockReturnValueOnce(pendingResponse);
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Pending evidence" setError={jest.fn()} />);

    const button = screen.getByRole('button', { name: /download report with images \(pdf\)/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing image evidence report');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/report-with-images-pdf`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      resolveRequest(pdfResponse(new Blob(['%PDF-1.4 evidence'])));
    });
    expect(await screen.findByText(/Report with images downloaded:/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a JSON response', 'application/json', new Blob(['{"error":"no pdf"}'], { type: 'application/json' })],
    ['an HTML response', 'text/html; charset=utf-8', new Blob(['<h1>no pdf</h1>'], { type: 'text/html' })],
    ['HTML mislabeled as a PDF', 'application/pdf', new Blob(['<html>no pdf</html>'], { type: 'application/pdf' })],
    ['an empty response', 'application/pdf', new Blob([], { type: 'application/pdf' })],
  ])('does not download %s from the PDF endpoint', async (_label, contentType, responseBlob) => {
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: jest.fn().mockResolvedValue(responseBlob),
      headers: { get: jest.fn(() => contentType) },
    });
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Invalid PDF" setError={jest.fn()} />);

    await chooseAction('report_pdf');

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid PDF report/i);
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
  });

  test('preserves Excel, bundle summary, and bundle archive flows', async () => {
    const user = userEvent.setup();
    downloadExcel.mockResolvedValueOnce();
    const archiveBlob = new Blob(['archive'], { type: 'application/zip' });
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ bundle_summary: { images: 4 } }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: jest.fn().mockResolvedValue(archiveBlob),
        headers: { get: jest.fn(() => 'application/zip') },
      });
    render(<ProjectReportTab projectId={PROJECT_ID} projectName="Turbine Cell A" setError={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: /export data \(excel\)/i }));
    expect(downloadExcel).toHaveBeenCalledWith(PROJECT_ID, 'Turbine Cell A');

    await user.click(screen.getByRole('button', { name: /run export\/report/i }));
    expect(await screen.findByText('Export summary generated.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/export\/report mode/i), { target: { value: 'bundle_archive' } });
    await user.click(screen.getByRole('button', { name: /run export\/report/i }));
    expect(await screen.findByText(`Export archive ready: ${archiveBlob.size} bytes.`)).toBeInTheDocument();

    expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${PROJECT_ID}/export-bundle-json`,
      `/api/projects/${PROJECT_ID}/export-bundle`,
    ]);
  });

  test('project changes abort stale JSON and reset the inspection ledger', async () => {
    let resolveOld;
    const oldRequest = new Promise((resolve) => {
      resolveOld = resolve;
    });
    global.fetch
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce(jsonResponse(makeReport([
        ['new-part', 'NEW-SERIAL', 'pass'],
      ])));
    const view = render(
      <ProjectReportTab projectId={PROJECT_ID} projectName="Old project" setError={jest.fn()} />,
    );

    await chooseAction('report_json');
    const oldSignal = global.fetch.mock.calls[0][1].signal;
    view.rerender(
      <ProjectReportTab projectId="project-456" projectName="New project" setError={jest.fn()} />,
    );
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await act(async () => {
      resolveOld(jsonResponse(makeReport()));
    });
    expect(screen.queryByText('SERIAL-PASS')).not.toBeInTheDocument();

    await chooseAction('report_json');
    expect(await screen.findByText('NEW-SERIAL')).toBeInTheDocument();
    expect(global.fetch.mock.calls[1][0]).toBe(
      '/api/projects/project-456/report-json?schema_version=3',
    );
  });

  test.each([
    ['standard PDF', 'report_pdf'],
    ['image PDF', 'image_pdf'],
  ])('project changes prevent a stale %s download', async (_label, action) => {
    const user = userEvent.setup();
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let resolveOld;
    global.fetch.mockReturnValueOnce(new Promise((resolve) => {
      resolveOld = resolve;
    }));
    const view = render(
      <ProjectReportTab projectId={PROJECT_ID} projectName="Old project" setError={jest.fn()} />,
    );

    if (action === 'report_pdf') {
      await chooseAction('report_pdf');
    } else {
      await user.click(screen.getByRole('button', { name: /download report with images/i }));
    }
    const oldSignal = global.fetch.mock.calls[0][1].signal;
    view.rerender(
      <ProjectReportTab projectId="project-456" projectName="New project" setError={jest.fn()} />,
    );
    expect(oldSignal.aborted).toBe(true);

    await act(async () => {
      resolveOld(pdfResponse(new Blob(['%PDF-1.4 stale'])));
    });
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/downloaded:/i)).not.toBeInTheDocument();
  });
});
