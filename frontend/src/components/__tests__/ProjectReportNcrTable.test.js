import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ProjectReportTab from '../ProjectReportTab';
import ProjectReportNcrTable, { getReportNcrs } from '../ProjectReportNcrTable';

jest.mock('../../utils/downloadExcel', () => ({ downloadExcel: jest.fn() }));

const PROJECT_ID = 'project-ncr';

function makeReport(ncrs) {
  return {
    schema_version: 3,
    project: { id: PROJECT_ID, name: 'NCR Cell', project_type: 'PT2', meta_group_id: 'quality' },
    summary: {
      total_parts: 1,
      reviewed_parts: 0,
      unreviewed_parts: 1,
      part_status_counts: { pass: 0, reject: 0, unreviewed: 1 },
    },
    parts: [{ part_id: 'p1', part_identifier: 'SN-1', inspection_result: 'unreviewed' }],
    ...(ncrs === undefined ? {} : { ncrs }),
  };
}

const NCRS = [
  {
    ncr_id: 'n1',
    ncr_label: 'NCR-0001',
    part_identifier: 'SN-1',
    status: 'approved',
    failure_code: 'FC-01',
    failure_code_description: 'Porosity',
    disposition_code: 'RWK',
    disposition_code_description: 'Rework',
    comment: 'Porosity on flange',
    disposition_instructions: 'Blend and re-inspect',
    created_by: 'inspector@example.com',
    created_at: '2026-11-13T10:00:00Z',
    approved_by: 'approver@example.com',
    approved_at: '2026-11-13T11:00:00Z',
  },
  {
    ncr_id: 'n2',
    ncr_label: 'NCR-0002',
    part_identifier: 'SN-1',
    status: 'open',
    failure_code: 'FC-02',
    failure_code_description: '',
    disposition_code: 'SCR',
    disposition_code_description: 'Scrap',
    comment: 'Crack',
    disposition_instructions: 'Scrap',
    created_by: 'inspector@example.com',
    created_at: '2026-11-13T12:00:00Z',
    approved_by: null,
    approved_at: null,
  },
];

function jsonResponse(payload) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(payload), headers: { get: jest.fn(() => null) } };
}

async function runReport(report) {
  global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(report));
  render(<ProjectReportTab projectId={PROJECT_ID} projectName="NCR Cell" setError={jest.fn()} />);
  fireEvent.change(screen.getByLabelText(/export\/report mode/i), { target: { value: 'report_json' } });
  fireEvent.click(screen.getByRole('button', { name: /run export\/report/i }));
  await screen.findByRole('table', { name: /inspection results by part/i });
}

describe('Project report NCR section', () => {
  test('renders one row per NCR with codes, status, and approver', async () => {
    await runReport(makeReport(NCRS));
    const section = screen.getByRole('region', { name: 'Nonconformance reports' });
    const table = within(section).getByRole('table', { name: 'Nonconformance reports by number' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('NCR-0001');
    expect(rows[1]).toHaveTextContent('FC-01 - Porosity');
    expect(rows[1]).toHaveTextContent('RWK - Rework');
    expect(rows[1]).toHaveTextContent('Approved');
    expect(rows[1]).toHaveTextContent('approver@example.com');
    expect(rows[2]).toHaveTextContent('FC-02');
    expect(rows[2]).not.toHaveTextContent('FC-02 -');
    expect(rows[2]).toHaveTextContent('Open');
  });

  test('shows an empty state when the report has no NCRs', async () => {
    await runReport(makeReport([]));
    const section = screen.getByRole('region', { name: 'Nonconformance reports' });
    expect(within(section).getByRole('status')).toHaveTextContent('No nonconformance reports have been raised');
  });

  test('tolerates reports from servers without the ncrs field', async () => {
    await runReport(makeReport(undefined));
    expect(screen.getByRole('region', { name: 'Nonconformance reports' })).toHaveTextContent('does not include nonconformance report data');
  });

  test('drops malformed rows and renders text safely', () => {
    expect(getReportNcrs({ ncrs: [null, 'x', { ncr_label: 1 }, NCRS[0]] })).toEqual([NCRS[0]]);
    render(<ProjectReportNcrTable report={{ ncrs: [{ ...NCRS[1], comment: '<img src=x onerror=alert(1)>' }] }} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
