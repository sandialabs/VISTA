import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import ImageUploader from '../ImageUploader';
import { buildDuplicateFilenameMap, tagDuplicateFilename } from '../../features/imageUpload/filenameAliasing';
import { buildInspectionPartIngestPayload } from '../../features/imageUpload/inspectionPartIngest';
import { formatUploadSize } from '../../features/imageUpload/uploadFormatting';
import { parseAssociatedMetadataText } from '../../utils/associatedMetadataFile';
import { BATCH_UPLOAD_MAX_BYTES } from '../imageUploadBatches';

jest.setTimeout(30000);

const makeFile = (name) => new File(['data'], name, { type: 'image/png' });

const batchPayload = (images, failed = []) => ({
  uploaded: images.map((image, clientIndex) => ({ client_index: clientIndex, image })),
  failed,
});

const readBlobText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(reader.result));
  reader.addEventListener('error', () => reject(reader.error));
  reader.readAsText(blob);
});

const batchManifest = async (body) => JSON.parse(await readBlobText(body.get('manifest')));

// Helpers to select files via the hidden input.
function selectFiles(files) {
  const input = document.getElementById('file-input');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

function renderUploader(props = {}) {
  const defaultProps = {
    projectId: 'proj-1',
    onUploadComplete: jest.fn(),
    setError: jest.fn(),
    ...props,
  };
  return { ...render(<ImageUploader {...defaultProps} />), props: defaultProps };
}

const singleS3HierarchyFilename = 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg';

function mockSingleS3HierarchyImport(ingestResponse) {
  return jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        objects: [{
          key: `incoming/${singleS3HierarchyFilename}`,
          filename: singleS3HierarchyFilename,
          size: 12,
        }],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        imported: [{ id: 'img-front', filename: singleS3HierarchyFilename }],
        failed: [],
      }),
    })
    .mockResolvedValueOnce(ingestResponse);
}

async function loadSingleS3HierarchyFile() {
  fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
    target: { value: 's3://source-bucket/incoming' },
  });
  fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
  await screen.findByTestId('s3-file-picker');
  await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue('_'));
  fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));
}

async function waitForSuccessfulUpload(props) {
  await waitFor(() => {
    expect(props.onUploadComplete).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('ImageUploader', () => {

  describe('Duplicate filename tagging', () => {
    test('builds numeric display aliases without changing File names', () => {
      const first = makeFile('overlay.png');
      const second = makeFile('overlay.png');
      const third = makeFile('overlay.png');
      const filenameMap = buildDuplicateFilenameMap([first, second, third]);

      expect(tagDuplicateFilename('part.tif', 1)).toBe('part (1).tif');
      expect(formatUploadSize(1024 ** 2)).toBe('1.00 MB');
      expect(formatUploadSize(1024 ** 3)).toBe('1.00 GB');
      expect(filenameMap.get(first)).toBe('overlay.png');
      expect(filenameMap.get(second)).toBe('overlay (1).png');
      expect(filenameMap.get(third)).toBe('overlay (2).png');
      expect([first.name, second.name, third.name]).toEqual([
        'overlay.png',
        'overlay.png',
        'overlay.png',
      ]);
    });

    test('uploads duplicate selections under their exact original filenames', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
        const manifest = await batchManifest(options.body);
        return {
          ok: true,
          status: 201,
          json: async () => batchPayload(manifest.map((entry) => ({
            id: `img-${entry.client_index}`,
            filename: entry.filename,
          }))),
        };
      });

      const { props } = renderUploader();
      selectFiles([makeFile('overlay.png'), makeFile('overlay.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);

      const body = fetchSpy.mock.calls[0][1].body;
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/proj-1/images/batch');
      expect(body.getAll('files').map((file) => file.name)).toEqual([
        'overlay.png',
        'overlay.png',
      ]);
      const manifest = await batchManifest(body);
      expect(manifest).toEqual([
        { client_index: 0, filename: 'overlay.png', metadata: {} },
        { client_index: 1, filename: 'overlay.png', metadata: {} },
      ]);
      expect(manifest.flatMap((entry) => Object.keys(entry.metadata))).not.toEqual(
        expect.arrayContaining(['original_filename', 'duplicate_filename_tagged']),
      );
    });

    test('extracts metadata from each raw duplicate name and correlates reversed responses by client_index', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
        const manifest = await batchManifest(options.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            uploaded: [
              {
                client_index: 1,
                image: { id: 'img-second', filename: manifest[1].filename },
              },
              {
                client_index: 0,
                image: { id: 'img-first', filename: manifest[0].filename },
              },
            ],
            failed: [],
          }),
        };
      });

      const { props } = renderUploader();
      selectFiles([makeFile('lot1_SN001.png'), makeFile('lot1_SN001.png')]);
      fireEvent.change(screen.getByLabelText('Delimiter'), {
        target: { value: '_' },
      });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial' },
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      await waitForSuccessfulUpload(props);

      const manifest = await batchManifest(fetchSpy.mock.calls[0][1].body);
      expect(manifest).toEqual([
        {
          client_index: 0,
          filename: 'lot1_SN001.png',
          metadata: { lot: 'lot1', serial: 'SN001' },
        },
        {
          client_index: 1,
          filename: 'lot1_SN001.png',
          metadata: { lot: 'lot1', serial: 'SN001' },
        },
      ]);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [
          expect.objectContaining({ id: 'img-first', filename: 'lot1_SN001.png' }),
          expect.objectContaining({ id: 'img-second', filename: 'lot1_SN001.png' }),
        ],
        expect.objectContaining({ confirmedSucceeded: 2 }),
      );
    });


    test('reports selected upload data size and refreshes byte progress every five seconds', async () => {
      jest.useFakeTimers();
      const firstUpload = {};
      const secondUpload = {};
      firstUpload.promise = new Promise((resolve) => { firstUpload.resolve = resolve; });
      secondUpload.promise = new Promise((resolve) => { secondUpload.resolve = resolve; });
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockReturnValueOnce(firstUpload.promise)
        .mockReturnValueOnce(secondUpload.promise);

      renderUploader();
      const files = Array.from({ length: 101 }, (_, index) => (
        new File(['a'.repeat(1024)], `image-${index}.png`, { type: 'image/png' })
      ));
      selectFiles(files);

      expect(screen.getByText('101 files selected (101.00 KB)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      expect(screen.getByText('0 B / 101.00 KB uploaded')).toBeInTheDocument();

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      await act(async () => {
        firstUpload.resolve({
          ok: true,
          status: 201,
          json: async () => batchPayload(Array.from({ length: 100 }, (_, index) => ({ id: `img-${index}` }))),
        });
        await Promise.resolve();
      });
      expect(screen.getByText('0 B / 101.00 KB uploaded')).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(screen.getByText('100.00 KB / 101.00 KB uploaded')).toBeInTheDocument();

      await act(async () => {
        secondUpload.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            uploaded: [{ client_index: 100, image: { id: 'img-100' } }],
            failed: [],
          }),
        });
        await Promise.resolve();
      });
    });
  });
  describe('Upload button disabled state', () => {
    test('upload button is enabled by default', () => {
      renderUploader();
      expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
    });

    test('upload button is disabled during upload', async () => {
      // Simulate a slow upload so we can observe the disabled state
      let resolveUpload;
      global.fetch = jest.fn(() => new Promise((resolve) => { resolveUpload = resolve; }));
      renderUploader();
      selectFiles([makeFile('test.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      // Button should now show "Uploading..." and be disabled
      expect(screen.getByRole('button', { name: /uploading/i })).toBeDisabled();
      // Resolve the pending upload to clean up
      resolveUpload({ ok: true, json: async () => ({ id: '1', filename: 'test.png' }) });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });
    });

    test('upload button is disabled when extractor config is invalid', async () => {
      renderUploader();
      const files = [makeFile('a_b_c.png')];
      selectFiles(files);

      // Configure extractor with a delimiter and mismatched key count to
      // trigger isValid=false.
      fireEvent.change(screen.getByLabelText('Delimiter'), {
        target: { value: '_' },
      });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'only_one_key' },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).toBeDisabled();
      });
    });

    test('upload button re-enables when extractor mismatch is resolved', async () => {
      renderUploader();
      const files = [makeFile('a_b.png')];
      selectFiles(files);

      fireEvent.change(screen.getByLabelText('Delimiter'), {
        target: { value: '_' },
      });
      // Mismatch: 2 values, 1 key.
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'one' },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).toBeDisabled();
      });

      // Fix: provide 2 keys to match 2 values.
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'first, second' },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });
    });
  });

  describe('Upload with no extractor pattern', () => {
    test('sends file without metadata when no pattern or manual JSON set', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => batchPayload([{ id: 'img-1' }]),
      });

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/projects/proj-1/images/batch');
      expect(options.method).toBe('POST');

      const body = options.body;
      expect(body.getAll('files')).toHaveLength(1);
      expect((await batchManifest(body))[0].metadata).toEqual({});
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-1' }],
        expect.objectContaining({ source: 'local_upload', confirmedSucceeded: 1, completionUnknown: 0 }),
      );
    });
  });



  describe('S3 file loading', () => {
    test('lists S3 files and imports the selected files', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            bucket: 'source-bucket',
            prefix: 'incoming',
            objects: [
              { key: 'incoming/a.png', filename: 'a.png', size: 12 },
              { key: 'incoming/b.png', filename: 'b.png', size: 34 },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [{ id: 'img-a', filename: 'a.png' }],
            failed: [],
          }),
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));

      expect(await screen.findByTestId('s3-file-picker')).toBeInTheDocument();
      expect(screen.getByText('a.png')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText(/b\.png/i));
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/proj-1/s3/list');
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ s3_url: 's3://source-bucket/incoming' });
      expect(fetchSpy.mock.calls[1][0]).toBe('/api/projects/proj-1/s3/import');
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({
        s3_url: 's3://source-bucket/incoming',
        keys: ['incoming/a.png'],
        per_file_metadata: {},
        group_identifiers: {},
      });
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-a', filename: 'a.png' }],
        expect.objectContaining({ source: 's3_import', confirmedSucceeded: 1, completionUnknown: 0 }),
      );
      expect(props.setError).toHaveBeenCalledWith(null);
    });

    test('refreshes project metadata after saving an S3-associated metadata file', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }],
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'stored-metadata' }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ imported: [{ id: 'img-a', filename: 'a.png' }], failed: [] }),
        });
      const onProjectMetadataLoaded = jest.fn();
      renderUploader({ onProjectMetadataLoaded });

      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      const metadataFile = new File(['{"camera":"S3-A"}'], 'capture.json', { type: 'application/json' });
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);
      await screen.findByText(/parsed capture\.json/i);

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      expect(fetchSpy.mock.calls[1][0]).toBe('/api/projects/proj-1/metadata');
      expect(onProjectMetadataLoaded).toHaveBeenCalledWith(expect.objectContaining({
        filename: 'capture.json',
        reference_type: 'project_metadata',
      }));
    });

    test('locks before S3 metadata refresh so rapid clicks and other operations cannot overlap', async () => {
      let resolveMetadataRefresh;
      const metadataRefresh = new Promise((resolve) => {
        resolveMetadataRefresh = resolve;
      });
      const onProjectMetadataLoaded = jest.fn(() => metadataRefresh);
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (String(url).endsWith('/s3/list')) {
          return {
            ok: true,
            json: async () => ({ objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }] }),
          };
        }
        if (String(url).endsWith('/metadata')) {
          return { ok: true, json: async () => ({ key: 'stored-metadata' }) };
        }
        if (String(url).endsWith('/s3/import')) {
          return {
            ok: true,
            json: async () => ({ imported: [{ id: 'img-a', filename: 'a.png' }], failed: [] }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      renderUploader({ onProjectMetadataLoaded });

      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', {
        value: [new File(['{"camera":"locked"}'], 'locked.json', { type: 'application/json' })],
        configurable: true,
      });
      fireEvent.change(metadataInput);
      await screen.findByText(/parsed locked\.json/i);
      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');

      const importButton = screen.getByRole('button', { name: /load selected s3 files/i });
      fireEvent.click(importButton);
      fireEvent.click(importButton);

      await waitFor(() => expect(onProjectMetadataLoaded).toHaveBeenCalledTimes(1));
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/metadata'))).toHaveLength(1);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(0);
      expect(importButton).toBeDisabled();
      expect(screen.getByRole('button', { name: /load test data/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /upload images/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /load files from s3/i })).toBeDisabled();

      await act(async () => {
        resolveMetadataRefresh();
        await metadataRefresh;
      });

      await waitFor(() => {
        expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(1);
      });
    });

    test('treats an S3 import network rejection as completion unknown without retrying', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }],
          }),
        })
        .mockRejectedValueOnce(new TypeError('connection lost'));
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      expect(await screen.findByTestId('s3-file-picker')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 load finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Confirmed successes and completion-unknown files were removed from the retry selection; completion-unknown files require manual audit and explicit reselection.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(1);
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/ingest'))).toBe(false);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 's3_import', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
      expect(screen.getByTestId('s3-file-picker')).toBeInTheDocument();
      expect(screen.getByText(/0 \/ 1 selected/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load selected s3 files/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Select Retryable Failures' })).toBeDisabled();
      const unknownCheckbox = screen.getByLabelText(/a\.png/i);
      expect(unknownCheckbox).not.toBeDisabled();
      fireEvent.click(unknownCheckbox);
      expect(screen.getByText(/1 \/ 1 selected/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load selected s3 files/i })).not.toBeDisabled();
    });

    test('blocks an uncertain S3 retry until authoritative reconciliation succeeds', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }],
          }),
        })
        .mockRejectedValueOnce(new TypeError('connection lost'));
      let reconciliationAttempts = 0;
      const onUploadComplete = jest.fn(async () => {
        reconciliationAttempts += 1;
        return { reconciled: reconciliationAttempts > 1 };
      });
      const { props } = renderUploader({ projectType: 'PT2', onUploadComplete });

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 load finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Authoritative project reconciliation failed, so S3 retry is blocked until reconciliation succeeds. Confirmed successes and completion-unknown files were removed from the retry selection; completion-unknown files require manual audit and explicit reselection.',
      ));
      expect(screen.getByRole('button', { name: /load selected s3 files/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /load files from s3/i })).toBeDisabled();
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Retry Project Reconciliation' }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'Project reconciliation succeeded. Completion-unknown S3 files remain unselected; audit project data and explicitly reselect a file only if retrying is safe.',
      ));
      expect(onUploadComplete).toHaveBeenCalledTimes(2);
      expect(onUploadComplete.mock.calls[1][1]).toEqual(expect.objectContaining({
        source: 's3_import',
        retryReconciliation: true,
        requiresAuthoritativeReconciliation: true,
      }));
      expect(screen.getByText(/0 \/ 1 selected/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load selected s3 files/i })).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/a\.png/i));
      expect(screen.getByRole('button', { name: /load selected s3 files/i })).not.toBeDisabled();
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(1);
    });

    test('treats an S3 import HTTP 5xx as completion unknown without retrying', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ detail: 'database response lost' }),
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 load finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Confirmed successes and completion-unknown files were removed from the retry selection; completion-unknown files require manual audit and explicit reselection.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 's3_import', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
      expect(screen.getByTestId('s3-file-picker')).toBeInTheDocument();
    });

    test('treats an unreadable successful S3 response as completion unknown', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('invalid JSON'); },
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        expect.stringContaining('1 completion unknown'),
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 's3_import', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
    });

    test('treats a key omitted from a successful S3 response as completion unknown and blocks retry when reconciliation fails', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ imported: [], failed: [] }),
        });
      const onUploadComplete = jest.fn().mockResolvedValue({ reconciled: false });
      const { props } = renderUploader({ onUploadComplete });

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 load finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Authoritative project reconciliation failed, so S3 retry is blocked until reconciliation succeeds. Confirmed successes and completion-unknown files were removed from the retry selection; completion-unknown files require manual audit and explicit reselection.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          source: 's3_import',
          completionUnknown: 1,
          confirmedFailed: 0,
          requiresAuthoritativeReconciliation: true,
        }),
      );
      expect(screen.getByText(/0 \/ 1 selected/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load selected s3 files/i })).toBeDisabled();
    });

    test('correlates S3 imports with duplicate basenames to distinct selected keys', async () => {
      const objects = [
        { key: 'incoming/left/photo.png', filename: 'photo.png', size: 12 },
        { key: 'incoming/right/photo.png', filename: 'photo.png', size: 13 },
      ];
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ objects }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [
              {
                id: 'right-image',
                filename: 'photo.png',
                metadata: { source_s3_key: 'incoming/right/photo.png' },
              },
              {
                id: 'left-image',
                filename: 'photo.png',
                metadata: { source_s3_key: 'incoming/left/photo.png' },
              },
            ],
            failed: [],
          }),
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      expect(await screen.findByText(/2 \/ 2 selected/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body).keys).toEqual(objects.map((object) => object.key));
      expect(props.onUploadComplete).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'left-image' }),
        expect.objectContaining({ id: 'right-image' }),
      ], expect.objectContaining({
        source: 's3_import',
        confirmedSucceeded: 2,
        completionUnknown: 0,
      }));
    });

    test('does not infer duplicate-basename S3 success without source-key correlation', async () => {
      const objects = [
        { key: 'incoming/left/photo.png', filename: 'photo.png', size: 12 },
        { key: 'incoming/right/photo.png', filename: 'photo.png', size: 13 },
      ];
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ objects }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [
              { id: 'uncorrelated-left', filename: 'photo.png' },
              { id: 'uncorrelated-right', filename: 'photo.png' },
            ],
            failed: [],
          }),
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByText(/2 \/ 2 selected/);
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        expect.stringContaining('2 completion unknown'),
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 's3_import', completionUnknown: 2, requiresAuthoritativeReconciliation: true }),
      );
      expect(screen.getByTestId('s3-file-picker')).toBeInTheDocument();
      expect(screen.getByText(/0 \/ 2 selected/)).toBeInTheDocument();
    });

    test('does not filename-correlate a foreign explicit source key to a duplicate basename', async () => {
      const objects = [
        { key: 'incoming/left/photo.png', filename: 'photo.png', size: 12 },
        { key: 'incoming/right/photo.png', filename: 'photo.png', size: 13 },
      ];
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ objects }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [
              {
                id: 'left-image',
                filename: 'photo.png',
                metadata: { source_s3_key: objects[0].key },
              },
              {
                id: 'foreign-image',
                filename: 'photo.png',
                metadata: { source_s3_key: 'another-prefix/photo.png' },
              },
            ],
            failed: [],
          }),
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByText(/2 \/ 2 selected/);
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'left-image' })],
        expect.objectContaining({
          confirmedSucceeded: 1,
          confirmedFailed: 0,
          completionUnknown: 1,
          requiresAuthoritativeReconciliation: true,
        }),
      );
      expect(props.setError).toHaveBeenLastCalledWith(expect.stringContaining('1 completion unknown'));
      expect(screen.getByText(/0 \/ 2 selected/)).toBeInTheDocument();
    });

    test('treats duplicate and conflicting response outcomes as completion unknown', async () => {
      const objects = [
        { key: 'incoming/a.png', filename: 'a.png', size: 12 },
        { key: 'incoming/b.png', filename: 'b.png', size: 13 },
      ];
      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ objects }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [
              { id: 'a-first', filename: 'a.png', metadata: { source_s3_key: objects[0].key } },
              { id: 'a-duplicate', filename: 'a.png', metadata: { source_s3_key: objects[0].key } },
              { id: 'b-imported', filename: 'b.png', metadata: { source_s3_key: objects[1].key } },
            ],
            failed: [{ key: objects[1].key, error: 'copy was rejected' }],
          }),
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByText(/2 \/ 2 selected/);
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          confirmedSucceeded: 0,
          confirmedFailed: 0,
          completionUnknown: 2,
          requiresAuthoritativeReconciliation: true,
        }),
      );
      expect(props.setError).toHaveBeenLastCalledWith(expect.stringContaining('2 completion unknown'));
      expect(screen.getByText(/0 \/ 2 selected/)).toBeInTheDocument();
    });

    test('bounds and formats a structured S3 import rejection in the failure summary', async () => {
      const longReason = `invalid key ${'x'.repeat(500)}`;
      const importJson = jest.fn().mockResolvedValue({
        detail: [{
          loc: ['body', 'keys', 0],
          msg: longReason,
          type: 'value_error',
        }],
      });
      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          json: importJson,
        });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      const finalError = props.setError.mock.calls.at(-1)[0];
      expect(finalError).toContain('S3 load complete: 0 succeeded, 1 failed out of 1.');
      expect(finalError).toContain('First confirmed failure: body.keys.0: invalid key');
      expect(finalError).toContain('...');
      expect(finalError).not.toContain('[object Object]');
      expect(finalError.length).toBeLessThan(450);
      expect(importJson).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          confirmedFailed: 1,
          completionUnknown: 0,
          requiresAuthoritativeReconciliation: false,
        }),
      );
    });

    test('accumulates confirmed successes and preserves unattempted definite failures across retries', async () => {
      const objects = [
        { key: 'incoming/a.png', filename: 'a.png', size: 12 },
        { key: 'incoming/b.png', filename: 'b.png', size: 13 },
        { key: 'incoming/c.png', filename: 'c.png', size: 14 },
      ];
      const importBodies = [];
      let importAttempt = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
        if (String(url).endsWith('/s3/list')) {
          return { ok: true, json: async () => ({ objects }) };
        }
        if (String(url).endsWith('/s3/import')) {
          const body = JSON.parse(options.body);
          importBodies.push(body);
          importAttempt += 1;
          if (importAttempt === 1) {
            return {
              ok: true,
              json: async () => ({
                imported: [{
                  id: 'image-a',
                  filename: 'a.png',
                  metadata: { source_s3_key: objects[0].key },
                }],
                failed: [
                  { key: objects[1].key, error: 'retry b' },
                  { key: objects[2].key, error: 'retry c' },
                ],
              }),
            };
          }
          return {
            ok: true,
            json: async () => ({
              imported: [{
                id: 'image-b',
                filename: 'b.png',
                metadata: { source_s3_key: objects[1].key },
              }],
              failed: [],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const { props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByText(/3 \/ 3 selected/);
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      expect(screen.getByText(/2 \/ 3 selected/)).toBeInTheDocument();
      expect(screen.getByLabelText(/a\.png/i)).toBeDisabled();
      expect(screen.getByLabelText(/b\.png/i)).not.toBeDisabled();
      expect(screen.getByLabelText(/c\.png/i)).not.toBeDisabled();

      fireEvent.click(screen.getByLabelText(/c\.png/i));
      expect(screen.getByText(/1 \/ 3 selected/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(2));
      expect(importBodies.map((body) => body.keys)).toEqual([
        objects.map((object) => object.key),
        [objects[1].key],
      ]);
      expect(screen.getByTestId('s3-file-picker')).toBeInTheDocument();
      expect(screen.getByText(/0 \/ 3 selected/)).toBeInTheDocument();
      expect(screen.getByLabelText(/a\.png/i)).toBeDisabled();
      expect(screen.getByLabelText(/b\.png/i)).toBeDisabled();
      expect(screen.getByLabelText(/c\.png/i)).not.toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Select Retryable Failures' }));
      expect(screen.getByText(/1 \/ 3 selected/)).toBeInTheDocument();
      expect(screen.getByLabelText(/a\.png/i)).not.toBeChecked();
      expect(screen.getByLabelText(/b\.png/i)).not.toBeChecked();
      expect(screen.getByLabelText(/c\.png/i)).toBeChecked();
    });

    test('keeps PT1 S3 hierarchy imports unassigned until Images to Parts assignment', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{
              key: `incoming/${singleS3HierarchyFilename}`,
              filename: singleS3HierarchyFilename,
              size: 12,
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [{ id: 'img-front', filename: singleS3HierarchyFilename }],
            failed: [],
          }),
        });
      const { props } = renderUploader();

      await loadSingleS3HierarchyFile();

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body).per_file_metadata).toEqual({
        [`incoming/${singleS3HierarchyFilename}`]: {
          design_number: 'D1001',
          lot_number: 'LOT01',
          set_number: 'SET01',
          serial_number: 'SN0001',
          side: 'front',
          modality: 'visual',
          overlay: false,
        },
      });
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/ingest'))).toBe(false);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-front', filename: singleS3HierarchyFilename }],
        expect.objectContaining({
          source: 's3_import',
          confirmedSucceeded: 1,
          partsMayHaveChanged: false,
        }),
      );
    });

    test('loads S3 hierarchy filenames with extracted metadata and ingest payload', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [
              {
                key: 'incoming/D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
                filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
                size: 12,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            imported: [{ id: 'img-front', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' }],
            failed: [],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 } }),
        });

      renderUploader({ projectType: 'PT2' });
      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));

      await screen.findByTestId('s3-file-picker');
      await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue('_'));
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body).per_file_metadata).toEqual({
        'incoming/D1001_LOT01_SET01_SN0001_front_visual_false.jpg': {
          design_number: 'D1001',
          lot_number: 'LOT01',
          set_number: 'SET01',
          serial_number: 'SN0001',
          side: 'front',
          modality: 'visual',
          overlay: false,
        },
      });
      expect(fetchSpy.mock.calls[2][0]).toBe('/api/projects/proj-1/ingest');
      expect(JSON.parse(fetchSpy.mock.calls[2][1].body).unassigned_parts[0]).toEqual(expect.objectContaining({
        serial_number: 'SN0001',
        display_name: 'D1001 LOT01 SET01 SN0001',
      }));
    });

    test('surfaces a 422 ingest detail after confirming that S3 images are committed', async () => {
      const ingestJson = jest.fn().mockResolvedValue({
        detail: 'Inspection hierarchy payload is invalid',
      });
      const fetchSpy = mockSingleS3HierarchyImport({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: ingestJson,
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { props } = renderUploader({ projectType: 'PT2' });

      await loadSingleS3HierarchyFile();

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 image import complete: 1 loaded and committed, 0 failed out of 1. Part creation failed: Inspection hierarchy payload is invalid.',
      ));
      expect(ingestJson).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-front', filename: singleS3HierarchyFilename }],
        expect.objectContaining({
          ingestFailed: true,
          ingestCompletionUnknown: false,
          requiresAuthoritativeReconciliation: false,
        }),
      );
    });

    test('surfaces a 500 ingest detail and reconciles once without retrying image import', async () => {
      const ingestJson = jest.fn().mockResolvedValue({
        detail: 'Inspection database unavailable',
      });
      const fetchSpy = mockSingleS3HierarchyImport({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: ingestJson,
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const onUploadComplete = jest.fn().mockResolvedValue({ reconciled: true });
      const { props } = renderUploader({ projectType: 'PT2', onUploadComplete });

      await loadSingleS3HierarchyFile();

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 image import complete: 1 loaded and committed, 0 failed out of 1. Part creation completion is uncertain: Inspection database unavailable. Project data was authoritatively reconciled.',
      ));
      expect(ingestJson).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/s3/import'))).toHaveLength(1);
      expect(onUploadComplete).toHaveBeenCalledTimes(1);
      expect(onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-front', filename: singleS3HierarchyFilename }],
        expect.objectContaining({
          ingestFailed: true,
          ingestCompletionUnknown: true,
          requiresAuthoritativeReconciliation: true,
        }),
      );
    });

    test('falls back to ingest status text when the error response is malformed JSON', async () => {
      const ingestJson = jest.fn().mockRejectedValue(new SyntaxError('Unexpected token'));
      mockSingleS3HierarchyImport({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: ingestJson,
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { props } = renderUploader({ projectType: 'PT2' });

      await loadSingleS3HierarchyFile();

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 image import complete: 1 loaded and committed, 0 failed out of 1. Part creation failed: Unprocessable Entity.',
      ));
      expect(ingestJson).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ ingestCompletionUnknown: false }),
      );
    });

    test('renders structured FastAPI ingest detail without object coercion noise', async () => {
      const ingestJson = jest.fn().mockResolvedValue({
        detail: [{
          type: 'value_error',
          loc: ['body', 'batches', 0, 'parts'],
          msg: 'At least one part is required',
        }],
      });
      mockSingleS3HierarchyImport({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: ingestJson,
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { props } = renderUploader({ projectType: 'PT2' });

      await loadSingleS3HierarchyFile();

      await waitFor(() => expect(props.setError).toHaveBeenLastCalledWith(
        'S3 image import complete: 1 loaded and committed, 0 failed out of 1. Part creation failed: body.batches.0.parts: At least one part is required.',
      ));
      expect(ingestJson).toHaveBeenCalledTimes(1);
      expect(props.setError.mock.calls.at(-1)[0]).not.toContain('[object Object]');
    });

    test('authoritatively reconciles parts when S3 ingest transport completion is unknown', async () => {
      const filename = 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg';
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            objects: [{ key: `incoming/${filename}`, filename, size: 12 }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ imported: [{ id: 'img-front', filename }], failed: [] }),
        })
        .mockRejectedValueOnce(new TypeError('connection lost after ingest dispatch'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const onUploadComplete = jest.fn().mockResolvedValue({ reconciled: true });
      const { props } = renderUploader({ projectType: 'PT2', onUploadComplete });

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue('_'));
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-front', filename }],
        expect.objectContaining({
          source: 's3_import',
          confirmedSucceeded: 1,
          completionUnknown: 0,
          ingestCompletionUnknown: true,
          partsMayHaveChanged: true,
          requiresAuthoritativeReconciliation: true,
        }),
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(props.setError).toHaveBeenLastCalledWith(
        'S3 image import complete: 1 loaded and committed, 0 failed out of 1. Part creation completion is uncertain: connection lost after ingest dispatch. Project data was authoritatively reconciled.',
      );
      expect(screen.queryByTestId('s3-file-picker')).not.toBeInTheDocument();
    });

    test('imports 2,000 returned S3 objects in bounded chunks with stable partial results', async () => {
      const objects = Array.from({ length: 2000 }, (_, index) => ({
        key: `incoming/D1001_LOT01_SET01_SN${String(index).padStart(4, '0')}_front_visual_false.jpg`,
        filename: `D1001_LOT01_SET01_SN${String(index).padStart(4, '0')}_front_visual_false.jpg`,
        size: 1,
      }));
      const importBodies = [];
      const ingestBodies = [];
      let activeImports = 0;
      let maximumActiveImports = 0;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
        if (String(url).endsWith('/s3/list')) {
          return {
            ok: true,
            json: async () => ({ objects, truncated: true }),
          };
        }
        if (String(url).endsWith('/s3/import')) {
          const body = JSON.parse(options.body);
          importBodies.push(body);
          activeImports += 1;
          maximumActiveImports = Math.max(maximumActiveImports, activeImports);
          await Promise.resolve();
          activeImports -= 1;
          const failedKey = objects[1137].key;
          return {
            ok: true,
            json: async () => ({
              imported: body.keys
                .filter((key) => key !== failedKey)
                .reverse()
                .map((key) => ({
                  id: `id-${key}`,
                  filename: key.split('/').pop(),
                  metadata: { source_s3_key: key },
                })),
              failed: body.keys.includes(failedKey)
                ? [{ key: failedKey, error: 'unreadable object' }]
                : [],
            }),
          };
        }
        if (String(url).endsWith('/ingest')) {
          ingestBodies.push(JSON.parse(options.body));
          return {
            ok: true,
            json: async () => ({ counters: { parts_created: 1999 } }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const hierarchyKeys = ['design_number', 'lot_number', 'set_number', 'serial_number', 'side', 'modality', 'overlay'];
      const { props } = renderUploader({
        projectType: 'PT2',
        projectConfiguration: {
          file_naming_scheme: {
            delimiter: '_',
            metadata_extractor: { mode: 'simple', pattern: '_', keys: hierarchyKeys },
          },
        },
      });

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));

      expect(await screen.findByText(/2000 \/ 2000 selected/)).toBeInTheDocument();
      const picker = screen.getByTestId('s3-file-picker');
      expect(within(picker).getAllByTestId('s3-object-row')).toHaveLength(100);
      expect(within(picker).getAllByRole('checkbox')).toHaveLength(100);
      expect(screen.getByTestId('s3-pagination-status')).toHaveTextContent('Page 1 of 20 · Showing 1-100 of 2000 objects');
      expect(screen.getByText(/listing was truncated/)).toBeInTheDocument();

      const firstKeyCheckbox = within(picker).getAllByRole('checkbox')[0];
      fireEvent.click(firstKeyCheckbox);
      expect(screen.getByText(/1999 \/ 2000 selected/)).toBeInTheDocument();
      fireEvent.click(within(picker).getByRole('button', { name: 'Next' }));
      expect(screen.getByTestId('s3-pagination-status')).toHaveTextContent('Page 2 of 20 · Showing 101-200 of 2000 objects');
      expect(within(picker).getAllByTestId('s3-object-row')).toHaveLength(100);
      expect(within(picker).getAllByRole('checkbox')[0]).toBeChecked();
      fireEvent.click(within(picker).getByRole('button', { name: 'Previous' }));
      expect(screen.getByTestId('s3-pagination-status')).toHaveTextContent('Page 1 of 20 · Showing 1-100 of 2000 objects');
      expect(within(picker).getAllByRole('checkbox')[0]).not.toBeChecked();
      fireEvent.click(within(picker).getAllByRole('checkbox')[0]);
      expect(screen.getByText(/2000 \/ 2000 selected/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      expect(importBodies).toHaveLength(20);
      expect(importBodies.map((body) => body.keys.length)).toEqual(Array(20).fill(100));
      expect(maximumActiveImports).toBe(2);
      expect(props.onUploadComplete.mock.calls[0][0]).toHaveLength(1999);
      expect(props.onUploadComplete.mock.calls[0][0][0].metadata.source_s3_key).toBe(objects[0].key);
      expect(props.onUploadComplete.mock.calls[0][0].at(-1).metadata.source_s3_key).toBe(objects[1999].key);
      expect(ingestBodies).toHaveLength(1);
      expect(ingestBodies[0].unassigned_parts).toHaveLength(1999);
      expect(props.setError).toHaveBeenLastCalledWith(
        'S3 load complete: 1999 succeeded, 1 failed out of 2000. First confirmed failure: unreadable object.',
      );
      expect(screen.getByText(/1 \/ 2000 selected/)).toBeInTheDocument();
      expect(screen.getByTestId('s3-pagination-status')).toHaveTextContent(
        'Page 12 of 20 · Showing 1101-1200 of 2000 objects',
      );
      const retryPageCheckboxes = within(picker).getAllByRole('checkbox');
      const confirmedCheckbox = retryPageCheckboxes[0];
      const failureCheckbox = retryPageCheckboxes[37];
      expect(confirmedCheckbox).toBeDisabled();
      expect(confirmedCheckbox).not.toBeChecked();
      expect(failureCheckbox).not.toBeDisabled();
      expect(failureCheckbox).toBeChecked();

      fireEvent.click(within(picker).getByRole('button', { name: 'Clear Retryable Failures' }));
      expect(screen.getByText(/0 \/ 2000 selected/)).toBeInTheDocument();
      expect(failureCheckbox).not.toBeChecked();
      fireEvent.click(confirmedCheckbox);
      expect(confirmedCheckbox).not.toBeChecked();

      fireEvent.click(within(picker).getByRole('button', { name: 'Select Retryable Failures' }));
      expect(screen.getByText(/1 \/ 2000 selected/)).toBeInTheDocument();
      expect(failureCheckbox).toBeChecked();
      expect(confirmedCheckbox).not.toBeChecked();
      expect(fetchSpy).toHaveBeenCalledTimes(22);
    });

    test('globally selects a partial final S3 page, sends a final one-key chunk, and resets on reload', async () => {
      const firstListing = Array.from({ length: 2001 }, (_, index) => ({
        key: `incoming/object-${index}.png`,
        filename: `object-${index}.png`,
        size: 1,
      }));
      const secondListing = Array.from({ length: 2 }, (_, index) => ({
        key: `replacement/object-${index}.png`,
        filename: `replacement-${index}.png`,
        size: 1,
      }));
      const importBodies = [];
      let listingRequestCount = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
        if (String(url).endsWith('/s3/list')) {
          const objects = listingRequestCount === 0 ? firstListing : secondListing;
          listingRequestCount += 1;
          return { ok: true, json: async () => ({ objects }) };
        }
        if (String(url).endsWith('/s3/import')) {
          const body = JSON.parse(options.body);
          importBodies.push(body);
          return {
            ok: true,
            json: async () => ({
              imported: body.keys.map((key) => ({
                id: `id-${key}`,
                filename: key.split('/').pop(),
                metadata: { source_s3_key: key },
              })),
              failed: [],
            }),
          };
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      const { rerender, props } = renderUploader();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/first' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      const picker = await screen.findByTestId('s3-file-picker');

      for (let page = 1; page < 21; page += 1) {
        fireEvent.click(within(picker).getByRole('button', { name: 'Next' }));
      }
      expect(screen.getByTestId('s3-pagination-status')).toHaveTextContent('Page 21 of 21 · Showing 2001-2001 of 2001 objects');
      expect(within(picker).getAllByTestId('s3-object-row')).toHaveLength(1);
      expect(within(picker).getByRole('button', { name: 'Next' })).toBeDisabled();
      expect(within(picker).getByRole('checkbox')).toBeChecked();

      fireEvent.click(within(picker).getByRole('button', { name: 'Clear Selection' }));
      expect(screen.getByText(/0 \/ 2001 selected/)).toBeInTheDocument();
      expect(within(picker).getByRole('checkbox')).not.toBeChecked();
      fireEvent.click(within(picker).getByRole('button', { name: 'Select All' }));
      expect(screen.getByText(/2001 \/ 2001 selected/)).toBeInTheDocument();
      expect(within(picker).getByRole('checkbox')).toBeChecked();
      fireEvent.click(within(picker).getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      expect(importBodies).toHaveLength(21);
      expect(importBodies.filter((body) => body.keys.length === 100)).toHaveLength(20);
      expect(importBodies.filter((body) => body.keys.length === 1)).toEqual([
        expect.objectContaining({ keys: [firstListing[2000].key] }),
      ]);
      expect(props.onUploadComplete.mock.calls[0][0]).toHaveLength(2001);
      expect(screen.queryByTestId('s3-file-picker')).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/replacement' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      expect(await screen.findByText(/2 \/ 2 selected/)).toBeInTheDocument();
      expect(screen.getByTestId('s3-pagination-status')).toHaveTextContent('Page 1 of 1 · Showing 1-2 of 2 objects');
      expect(within(screen.getByTestId('s3-file-picker')).getAllByTestId('s3-object-row')).toHaveLength(2);

      rerender(<ImageUploader {...props} projectId="proj-2" />);
      expect(screen.queryByTestId('s3-file-picker')).not.toBeInTheDocument();
    });
  });

  describe('Load Test Data', () => {
    test.each([
      ['PT1', false],
      ['PT2', false],
      ['PT3', true],
    ])('shows the NIST CoCr loader only for %s projects', (projectType, expectsNistLoader) => {
      renderUploader({ projectType });

      expect(screen.getByRole('button', { name: 'Load Test Data' })).toBeInTheDocument();
      const nistButton = screen.queryByRole('button', { name: 'Load NIST CoCr Volume' });
      if (expectsNistLoader) {
        expect(nistButton).toBeInTheDocument();
      } else {
        expect(nistButton).not.toBeInTheDocument();
      }
    });

    test.each([
      ['PT1', 16, 0],
      ['PT3', 64, 1],
    ])('loads %s project test data and reports ingest counters', async (projectType, imagesCreated, partsCreated) => {
      const payload = {
        project_type: projectType,
        images_created: imagesCreated,
        ingest: { counters: { parts_created: partsCreated } },
      };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => payload,
      });
      const { props } = renderUploader({ projectType });

      fireEvent.click(screen.getByRole('button', { name: /load test data/i }));
      expect(screen.getByRole('button', { name: /loading test data/i })).toBeDisabled();

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/projects/proj-1/load-test-data',
          expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
        );
      });
      expect(await screen.findByTestId('load-test-data-result')).toHaveTextContent(
        `Loaded ${imagesCreated} new ${projectType} test images`
      );
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ source: 'test_data', confirmedSucceeded: imagesCreated, payload }),
      );
      expect(props.setError).toHaveBeenCalledWith(null);
    });

    test('loads project-type test data through the backend endpoint', async () => {
      const payload = {
        project_type: 'PT3',
        images_created: 64,
        ingest: {
          counters: { parts_created: 1 },
          parts: [
            {
              metadata: {
                volume_shape: { axial: 64, coronal: 96, sagittal: 128 },
                mpr: { axis_labels: ['XY', 'XZ', 'YZ'] },
              },
            },
          ],
        },
      };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => payload,
      });

      const { props } = renderUploader({ projectType: 'PT3' });
      fireEvent.click(screen.getByRole('button', { name: /load test data/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/projects/proj-1/load-test-data',
          expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
        );
      });
      expect(await screen.findByTestId('load-test-data-result')).toHaveTextContent('Loaded 64 new PT3 test images');
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ source: 'test_data', confirmedSucceeded: 64, payload }),
      );
      expect(props.setError).toHaveBeenCalledWith(null);
    });

    test('keeps loading state until test data refresh completes', async () => {
      const payload = {
        project_type: 'PT1',
        images_created: 16,
        ingest: { counters: { parts_created: 0 } },
      };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => payload,
      });
      let resolveRefresh;
      const onUploadComplete = jest.fn(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));

      renderUploader({ projectType: 'PT1', onUploadComplete });
      fireEvent.click(screen.getByRole('button', { name: /load test data/i }));

      await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ source: 'test_data', confirmedSucceeded: 16, payload }),
      ));
      expect(screen.getByRole('button', { name: /loading test data/i })).toBeDisabled();

      resolveRefresh();

      await waitFor(() => expect(screen.getByRole('button', { name: /load test data/i })).not.toBeDisabled());
    });

    test('surfaces backend detail when project-type test data loading fails', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'PT3 test stack not found' }),
      });

      const { props } = renderUploader({ projectType: 'PT3' });
      fireEvent.click(screen.getByRole('button', { name: /load test data/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/projects/proj-1/load-test-data',
          expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
        );
      });
      expect(props.setError).toHaveBeenCalledWith('Failed to load PT3 test data. PT3 test stack not found');
    });

    test('loads the NIST CoCr pair from the exact fixture URL and refreshes project data', async () => {
      const payload = {
        project_type: 'PT3',
        images_created: 2,
        ingest: { counters: { parts_created: 1 } },
      };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => payload,
      });
      const { props } = renderUploader({ projectType: 'PT3' });

      fireEvent.click(screen.getByRole('button', { name: 'Load NIST CoCr Volume' }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/proj-1/load-test-data?fixture=nist-cocr',
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      ));
      expect(await screen.findByTestId('load-nist-cocr-result')).toHaveTextContent(
        'Loaded 2 new NIST CoCr test images; created 1 part.'
      );
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({
          source: 'test_data',
          fixture: 'nist-cocr',
          confirmedSucceeded: 2,
          partsMayHaveChanged: true,
          requiresAuthoritativeReconciliation: true,
          payload,
        }),
      );
      expect(props.setError).toHaveBeenCalledWith(null);
    });

    test('keeps both fixture controls disabled with a NIST-specific label until refresh completes', async () => {
      const payload = {
        project_type: 'PT3',
        images_created: 2,
        ingest: { counters: { parts_created: 1 } },
      };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => payload,
      });
      let resolveRefresh;
      const onUploadComplete = jest.fn(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
      renderUploader({ projectType: 'PT3', onUploadComplete });

      fireEvent.click(screen.getByRole('button', { name: 'Load NIST CoCr Volume' }));

      expect(await screen.findByRole('button', { name: 'Loading NIST CoCr Volume...' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Load Test Data' })).toBeDisabled();
      await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('button', { name: 'Loading NIST CoCr Volume...' })).toBeDisabled();

      resolveRefresh();

      await waitFor(() => expect(
        screen.getByRole('button', { name: 'Load NIST CoCr Volume' })
      ).not.toBeDisabled());
    });

    test('surfaces backend detail when NIST CoCr loading fails', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'NIST CoCr test volumes not found' }),
      });
      const { props } = renderUploader({ projectType: 'PT3' });

      fireEvent.click(screen.getByRole('button', { name: 'Load NIST CoCr Volume' }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/proj-1/load-test-data?fixture=nist-cocr',
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      ));
      expect(props.setError).toHaveBeenCalledWith(
        'Failed to load NIST CoCr volume. NIST CoCr test volumes not found'
      );
      expect(screen.queryByTestId('load-nist-cocr-result')).not.toBeInTheDocument();
    });

    test('guards NIST double-clicks and cross-loader concurrency with one operation token', async () => {
      let resolveFetch;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => new Promise((resolve) => {
        resolveFetch = resolve;
      }));
      renderUploader({ projectType: 'PT3' });
      const nistButton = screen.getByRole('button', { name: 'Load NIST CoCr Volume' });

      fireEvent.click(nistButton);
      fireEvent.click(nistButton);
      fireEvent.click(screen.getByRole('button', { name: 'Load Test Data' }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/projects/proj-1/load-test-data?fixture=nist-cocr',
        expect.objectContaining({ method: 'POST' }),
      );

      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({
            project_type: 'PT3',
            images_created: 2,
            ingest: { counters: { parts_created: 1 } },
          }),
        });
      });
      await waitFor(() => expect(screen.getByTestId('load-nist-cocr-result')).toBeInTheDocument());
    });
  });

  describe('Project-level metadata loading', () => {
    test('loads a selected metadata file without uploading images', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ key: 'saved' }),
      });
      const onProjectMetadataLoaded = jest.fn();
      renderUploader({ onProjectMetadataLoaded });

      const metadataInput = screen.getByLabelText(/metadata file/i);
      const metadataFile = new File([JSON.stringify({ operator: 'qa', lot: 42 })], 'project.json', {
        type: 'application/json',
      });
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/parsed project\.json/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /load metadata/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/proj-1/metadata');
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.key).toMatch(/^associated_upload_metadata:project\.json:/);
      expect(payload.value.metadata).toEqual({ operator: 'qa', lot: 42 });
      expect(await screen.findByText(/Loaded project\.json as project metadata/i)).toBeInTheDocument();
      expect(onProjectMetadataLoaded).toHaveBeenCalledWith(expect.objectContaining({
        filename: 'project.json',
        reference_type: 'project_metadata',
      }));
    });
  });

  describe('Upload with manual metadata only', () => {
    test('sends manual JSON metadata in FormData', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => batchPayload([{ id: 'img-1' }]),
      });

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), {
        target: { value: '{"source": "manual"}' },
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);

      const body = fetchSpy.mock.calls[0][1].body;
      expect((await batchManifest(body))[0].metadata).toEqual({ source: 'manual' });
    });
  });

  describe('Upload with extracted metadata', () => {
    test('sends extracted metadata from filename in FormData', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => batchPayload([{ id: 'img-1' }]),
      });

      const { props } = renderUploader({ projectType: 'PT2' });
      const files = [makeFile('lot1_SN001.png')];
      selectFiles(files);

      fireEvent.change(screen.getByLabelText('Delimiter'), {
        target: { value: '_' },
      });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial' },
      });
      fireEvent.change(screen.getByLabelText('Use as Group Identifier (Optional)'), {
        target: { value: 'serial' },
      });

      // Wait for the config to settle (isValid=true, preview matches).
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);

      const body = fetchSpy.mock.calls[0][1].body;
      expect((await batchManifest(body))[0]).toEqual(expect.objectContaining({
        group_identifier: 'SN001',
        metadata: {
        lot: 'lot1',
        serial: 'SN001',
        },
      }));
    });

    test('keeps PT1 hierarchy uploads unassigned until Images to Parts assignment', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => batchPayload([{ id: 'img-front', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' }]),
      });

      const { props } = renderUploader();
      selectFiles([makeFile('D1001_LOT01_SET01_SN0001_front_visual_false.jpg')]);

      await waitFor(() => {
        expect(screen.getByLabelText('Delimiter')).toHaveValue('_');
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });
      expect(screen.queryByLabelText('Use as Group Identifier (Optional)')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect((await batchManifest(fetchSpy.mock.calls[0][1].body))[0].metadata).toEqual({
        design_number: 'D1001',
        lot_number: 'LOT01',
        set_number: 'SET01',
        serial_number: 'SN0001',
        side: 'front',
        modality: 'visual',
        overlay: false,
      });
      expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/ingest'))).toBe(false);
      expect(props.onUploadComplete).toHaveBeenCalledWith([
        { id: 'img-front', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' },
      ], expect.objectContaining({
        source: 'local_upload',
        confirmedSucceeded: 1,
        partsMayHaveChanged: false,
      }));
    });

    test('auto-creates inspection parts from VISTA hierarchy filenames after upload', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([
            {
              id: 'img-front',
              filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
            },
            {
              id: 'img-back',
              filename: 'D1001_LOT01_SET01_SN0001_back_visual_false.jpg',
            },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            project_id: 'proj-1',
            counters: { parts_created: 1 },
            discrepancies: [],
          }),
        });

      const { props } = renderUploader({ projectType: 'PT2' });
      selectFiles([
        makeFile('D1001_LOT01_SET01_SN0001_front_visual_false.jpg'),
        makeFile('D1001_LOT01_SET01_SN0001_back_visual_false.jpg'),
      ]);

      await waitFor(() => {
        expect(screen.getByLabelText('Delimiter')).toHaveValue('_');
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      const firstUploadMetadata = (await batchManifest(fetchSpy.mock.calls[0][1].body))[0].metadata;
      expect(firstUploadMetadata).toEqual({
        design_number: 'D1001',
        lot_number: 'LOT01',
        set_number: 'SET01',
        serial_number: 'SN0001',
        side: 'front',
        modality: 'visual',
        overlay: false,
      });

      const ingestCall = fetchSpy.mock.calls[1];
      expect(ingestCall[0]).toBe('/api/projects/proj-1/ingest');
      expect(ingestCall[1].method).toBe('POST');
      expect(JSON.parse(ingestCall[1].body)).toEqual({
        batches: [],
        unassigned_parts: [
          expect.objectContaining({
            serial_number: 'SN0001',
            display_name: 'D1001 LOT01 SET01 SN0001',
            metadata: expect.objectContaining({
              design_number: 'D1001',
              lot_number: 'LOT01',
              set_number: 'SET01',
              serial_number: 'SN0001',
              configured_views: ['back', 'front'],
              modalities: ['visual'],
              view_images: {
                back: 'D1001_LOT01_SET01_SN0001_back_visual_false.jpg',
                front: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
              },
            }),
          }),
        ],
      });
      expect(props.onUploadComplete).toHaveBeenCalledWith([
        { id: 'img-front', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' },
        { id: 'img-back', filename: 'D1001_LOT01_SET01_SN0001_back_visual_false.jpg' },
      ], expect.objectContaining({
        source: 'local_upload',
        confirmedSucceeded: 2,
        partsMayHaveChanged: true,
      }));
    });

    test('uses saved filename hierarchy abbreviations to decode uploaded filenames into inspection parts', async () => {
      const projectConfiguration = {
        file_naming_scheme: {
          hierarchy_levels: [
            { id: 'drawing_number', label: 'Drawing', abbreviation: 'DWG' },
            { id: 'lot_number', label: 'Lot', abbreviation: 'LT' },
            { id: 'part_number', label: 'Part', abbreviation: 'PN' },
            { id: 'serial_number', label: 'Serial', abbreviation: 'SN' },
          ],
          image_descriptors: [
            { id: 'view', label: 'View', abbreviation: 'VW' },
            { id: 'modality', label: 'Modality', abbreviation: 'MD' },
          ],
        },
      };
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([
            { id: 'img-left', filename: 'DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png' },
            { id: 'img-right', filename: 'DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png' },
          ]),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 }, discrepancies: [] }) });

      renderUploader({ projectType: 'PT2', projectConfiguration });
      selectFiles([
        makeFile('DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png'),
        makeFile('DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png'),
      ]);

      await waitFor(() => {
        expect(screen.getByLabelText('Delimiter')).toHaveValue('_');
        expect(screen.getByLabelText('Keys (comma-separated)')).toHaveValue('design_number, lot_number, set_number, serial_number, side, modality, overlay');
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect((await batchManifest(fetchSpy.mock.calls[0][1].body))[0].metadata).toEqual(expect.objectContaining({
        design_number: '100',
        lot_number: '22',
        set_number: '7',
        serial_number: '9',
        side: 'left',
        modality: 'visual',
        overlay: false,
      }));
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({
        batches: [],
        unassigned_parts: [
          expect.objectContaining({
            serial_number: '9',
            display_name: '100 22 7 9',
            metadata: expect.objectContaining({
              design_number: '100',
              lot_number: '22',
              set_number: '7',
              serial_number: '9',
              configured_views: ['left', 'right'],
              modalities: ['thermal', 'visual'],
              view_images: {
                left: 'DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png',
                right: 'DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png',
              },
              source_images: expect.arrayContaining([
                expect.objectContaining({ filename: 'DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png', image_id: 'img-left' }),
                expect.objectContaining({ filename: 'DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png', image_id: 'img-right' }),
              ]),
            }),
          }),
        ],
      });
    });

    test('does not infer upload metadata from filename when filename convention is disabled', async () => {
      const projectConfiguration = {
        file_naming_scheme: {
          use_filename_convention: false,
          hierarchy_levels: [
            { id: 'drawing_number', label: 'Drawing', abbreviation: 'D' },
            { id: 'lot_number', label: 'Lot', abbreviation: 'L' },
            { id: 'part_number', label: 'Part', abbreviation: 'P' },
            { id: 'serial_number', label: 'Serial', abbreviation: 'S' },
          ],
          image_descriptors: [
            { id: 'view', label: 'View', abbreviation: 'V' },
            { id: 'modality', label: 'Modality', abbreviation: 'M' },
          ],
        },
      };
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-ignored', filename: 'D200_L03_P55_S888_Vfront_Mvisual_false.jpg' }]),
        });

      renderUploader({ projectType: 'PT2', projectConfiguration });
      selectFiles([makeFile('D200_L03_P55_S888_Vfront_Mvisual_false.jpg')]);

      await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue(''));
      expect(screen.queryByLabelText('Keys (comma-separated)')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect((await batchManifest(fetchSpy.mock.calls[0][1].body))[0].metadata).toEqual({});
    });

    test('supports hyphen-delimited batch naming convention from saved filename hierarchy', async () => {
      const projectConfiguration = {
        file_naming_scheme: {
          hierarchy_levels: [
            { id: 'drawing_number', label: 'Drawing', abbreviation: 'D' },
            { id: 'lot_number', label: 'Lot', abbreviation: 'L' },
            { id: 'batch', label: 'Batch', abbreviation: 'B' },
            { id: 'serial_number', label: 'Serial', abbreviation: 'S' },
          ],
          image_descriptors: [
            { id: 'view', label: 'View', abbreviation: 'V' },
            { id: 'modality', label: 'Modality', abbreviation: 'M' },
          ],
        },
      };
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-front', filename: 'D200-L03-B55-S888-Vfront-Mvisual-false.jpg' }]),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 }, discrepancies: [] }) });

      renderUploader({ projectType: 'PT2', projectConfiguration });
      selectFiles([makeFile('D200-L03-B55-S888-Vfront-Mvisual-false.jpg')]);

      await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue('-'));
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({
        batches: [
          expect.objectContaining({
            name: '200_03_55',
            parts: [
              expect.objectContaining({
                serial_number: '888',
                metadata: expect.objectContaining({
                  batch_number: '55',
                  view_images: { front: 'D200-L03-B55-S888-Vfront-Mvisual-false.jpg' },
                }),
              }),
            ],
          }),
        ],
        unassigned_parts: [],
      });
    });

  });

  describe('buildInspectionPartIngestPayload', () => {
    test('keeps PT1 SET hierarchy metadata unassigned to inspection batches', () => {
      const payload = buildInspectionPartIngestPayload([
        {
          image: { id: 'img-1', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' },
          metadata: {
            design_number: 'D1001',
            lot_number: 'LOT01',
            set_number: 'SET01',
            serial_number: 'SN0001',
            side: 'front',
            modality: 'visual',
            overlay: 'false',
          },
        },
        {
          image: { id: 'img-2', filename: 'D1001_LOT01_SET01_SN0001_front_heatmap_true.jpg' },
          metadata: {
            design_number: 'D1001',
            lot_number: 'LOT01',
            set_number: 'SET01',
            serial_number: 'SN0001',
            side: 'front',
            modality: 'heatmap',
            overlay: 'true',
          },
        },
      ]);

      expect(payload.batches).toHaveLength(0);
      expect(payload.unassigned_parts).toHaveLength(1);
      expect(payload.unassigned_parts[0].metadata).toEqual(expect.objectContaining({
        set_number: 'SET01',
        configured_views: ['front'],
        modalities: ['heatmap', 'visual'],
        view_images: {
          front: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
        },
        overlay_images: {
          front: {
            heatmap: 'D1001_LOT01_SET01_SN0001_front_heatmap_true.jpg',
          },
        },
      }));
    });

    test('groups legacy PT1 batch metadata into inspection batches and parts', () => {
      const payload = buildInspectionPartIngestPayload([
        {
          image: { id: 'img-1', filename: 'D1001_LOT01_BATCH01_SN0001_front_visual_false.jpg' },
          metadata: {
            design_number: 'D1001',
            lot_number: 'LOT01',
            batch_number: 'BATCH01',
            serial_number: 'SN0001',
            side: 'front',
            modality: 'visual',
            overlay: 'false',
          },
        },
        {
          image: { id: 'img-2', filename: 'D1001_LOT01_BATCH01_SN0001_front_heatmap_true.jpg' },
          metadata: {
            design_number: 'D1001',
            lot_number: 'LOT01',
            batch_number: 'BATCH01',
            serial_number: 'SN0001',
            side: 'front',
            modality: 'heatmap',
            overlay: 'true',
          },
        },
      ]);

      expect(payload.batches).toHaveLength(1);
      expect(payload.batches[0].parts).toHaveLength(1);
      expect(payload.unassigned_parts).toHaveLength(0);
      expect(payload.batches[0].parts[0].metadata).toEqual(expect.objectContaining({
        batch_number: 'BATCH01',
        configured_views: ['front'],
        modalities: ['heatmap', 'visual'],
        view_images: {
          front: 'D1001_LOT01_BATCH01_SN0001_front_visual_false.jpg',
        },
        overlay_images: {
          front: {
            heatmap: 'D1001_LOT01_BATCH01_SN0001_front_heatmap_true.jpg',
          },
        },
      }));
    });



    test('preserves arbitrary image version fields and links configured overlay images to base filenames', () => {
      const payload = buildInspectionPartIngestPayload([
        {
          image: { id: 'img-base', filename: 'D100_LOT01_SET01_SN0001_front_visual_v1.png' },
          metadata: {
            design_number: 'D100',
            lot_number: 'LOT01',
            set_number: 'SET01',
            serial_number: 'SN0001',
            side: 'front',
            modality: 'visual',
            version: 'v1',
            overlay: false,
          },
        },
        {
          image: { id: 'img-overlay', filename: 'D100_LOT01_SET01_SN0001_front_visual_v1_overlay.png' },
          metadata: {
            design_number: 'D100',
            lot_number: 'LOT01',
            set_number: 'SET01',
            serial_number: 'SN0001',
            side: 'front',
            modality: 'visual',
            version: 'v1',
            overlay: true,
            overlay_base_filename: 'D100_LOT01_SET01_SN0001_front_visual_v1.png',
          },
        },
      ]);

      expect(payload.unassigned_parts[0].metadata.source_images).toEqual(expect.arrayContaining([
        expect.objectContaining({ filename: 'D100_LOT01_SET01_SN0001_front_visual_v1.png', image_id: 'img-base', version: 'v1' }),
        expect.objectContaining({
          filename: 'D100_LOT01_SET01_SN0001_front_visual_v1_overlay.png',
          image_id: 'img-overlay',
          overlay: true,
          overlay_base_filename: 'D100_LOT01_SET01_SN0001_front_visual_v1.png',
          version: 'v1',
        }),
      ]));
      expect(payload.unassigned_parts[0].metadata.filename_identifiers).toEqual({ version: 'v1' });
      expect(payload.unassigned_parts[0].metadata.overlay_images).toEqual({
        front: { visual: 'D100_LOT01_SET01_SN0001_front_visual_v1_overlay.png' },
      });
    });

    test('groups PT3 Build-It stack metadata and maps all images to the part', () => {
      const payload = buildInspectionPartIngestPayload([
        {
          image: { id: 'img-z0', filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z000.png' },
          metadata: {
            project_type: 'PT3',
            volume_stack_id: 'PT3_SYNTH_MPR_001',
            slice_axis: 'Z',
            slice_index: 0,
          },
        },
        {
          image: { id: 'img-z1', filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z001.png' },
          metadata: {
            project_type: 'PT3',
            volume_stack_id: 'PT3_SYNTH_MPR_001',
            slice_axis: 'Z',
            slice_index: 1,
          },
        },
      ]);

      expect(payload.batches).toHaveLength(1);
      expect(payload.batches[0].name).toBe('PT3_PT3_SYNTH_MPR_001');
      expect(payload.batches[0].parts).toHaveLength(1);
      expect(payload.batches[0].parts[0].serial_number).toBe('PT3_SYNTH_MPR_001');
      expect(payload.batches[0].parts[0].metadata).toEqual(expect.objectContaining({
        project_type: 'PT3',
        volume_stack_id: 'PT3_SYNTH_MPR_001',
      }));
      expect(payload.batches[0].parts[0].metadata.source_images).toEqual([
        expect.objectContaining({ filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z000.png', image_id: 'img-z0', slice_index: 0 }),
        expect.objectContaining({ filename: 'PT3_GEOMETRIC_DUAL_LABEL_Z001.png', image_id: 'img-z1', slice_index: 1 }),
      ]);
    });
  });

  describe('Metadata merge precedence', () => {
    test('manual metadata overrides extracted metadata on key collision', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => batchPayload([{ id: 'img-1' }]),
      });

      const { props } = renderUploader();
      const files = [makeFile('lot1_SN001.png')];
      selectFiles(files);

      // Set up extractor: keys "lot" and "serial".
      fireEvent.change(screen.getByLabelText('Delimiter'), {
        target: { value: '_' },
      });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial' },
      });

      // Manual metadata with an overlapping "lot" key and extra "source" key.
      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), {
        target: { value: '{"lot": "OVERRIDE", "source": "manual"}' },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);

      const body = fetchSpy.mock.calls[0][1].body;
      const metadata = (await batchManifest(body))[0].metadata;
      expect(metadata).toEqual({
        lot: 'OVERRIDE',
        serial: 'SN001',
        source: 'manual',
      });
    });
  });

  describe('Validation errors', () => {
    test('sets error when submitting with no files', () => {
      const { props } = renderUploader();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      expect(props.setError).toHaveBeenCalledWith(
        'Please select at least one file to upload.'
      );
    });

    test('sets error when submitting with invalid manual JSON', () => {
      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), {
        target: { value: 'not valid json' },
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      expect(props.setError).toHaveBeenCalledWith('Invalid JSON format for metadata.');
    });
  });

  describe('Upload failure handling', () => {
    test('treats an item omitted from a successful batch response as completion unknown', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ uploaded: [], failed: [] }),
      });
      const { props } = renderUploader();
      selectFiles([makeFile('omitted.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        'Upload finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          source: 'local_upload',
          completionUnknown: 1,
          confirmedFailed: 0,
          requiresAuthoritativeReconciliation: true,
        }),
      );
      expect(screen.getByText('No files selected')).toBeInTheDocument();
    });

    test('reports a batch network rejection as completion unknown and refreshes once', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(props.setError).toHaveBeenCalledWith(
          'Upload finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.'
        );
      });
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 'local_upload', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('reports a legacy network rejection as completion unknown and refreshes once', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
      const { props } = renderUploader();
      const file = makeFile('large-volume.npy');
      Object.defineProperty(file, 'size', { value: BATCH_UPLOAD_MAX_BYTES + 1 });
      selectFiles([file]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        'Upload finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/proj-1/images');
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 'local_upload', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
    });

    test('reports a legacy HTTP 5xx as completion unknown and refreshes once', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ detail: 'upstream response lost' }),
      });
      const { props } = renderUploader();
      const file = makeFile('large-volume.npy');
      Object.defineProperty(file, 'size', { value: BATCH_UPLOAD_MAX_BYTES + 1 });
      selectFiles([file]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        'Upload finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/proj-1/images');
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 'local_upload', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
    });

    test('reports a batch HTTP 5xx as completion unknown and refreshes once', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(props.setError).toHaveBeenCalledWith(
          'Upload finished with uncertain results: 0 confirmed succeeded, 1 completion unknown, 0 failed out of 1. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.'
        );
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 'local_upload', completionUnknown: 1, requiresAuthoritativeReconciliation: true }),
      );
    });

    test('keeps a batch HTTP 4xx as a definite failure without refresh', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({ detail: 'built-in batch size limit exceeded' }),
      });

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        'Upload complete: 0 succeeded, 1 failed out of 1.',
      ));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).not.toHaveBeenCalled();
      expect(screen.getByText(/1 file selected/)).toBeInTheDocument();
    });

    test('surfaces the built-in manifest limit without sending an oversized request', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const { props } = renderUploader();
      selectFiles([makeFile('metadata-heavy.png')]);
      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), {
        target: { value: JSON.stringify({ payload: 'x'.repeat((8 * 1024 * 1024) + 1) }) },
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        expect.stringContaining('metadata-heavy.png: Upload metadata exceeds the 8388608-byte batch manifest limit'),
      ));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('ingests and reports only successful images from a partial batch', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            uploaded: [{
              client_index: 0,
              image: {
                id: 'img-front',
                filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
              },
            }],
            failed: [{
              client_index: 1,
              filename: 'D1001_LOT01_SET01_SN0001_back_visual_false.jpg',
              code: 'validation_failed',
              detail: 'bad image',
            }],
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ counters: { parts_created: 1 } }) });
      const { props } = renderUploader({ projectType: 'PT2' });
      selectFiles([
        makeFile('D1001_LOT01_SET01_SN0001_front_visual_false.jpg'),
        makeFile('D1001_LOT01_SET01_SN0001_back_visual_false.jpg'),
      ]);

      await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue('_'));
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(fetchSpy.mock.calls[1][0]).toBe('/api/projects/proj-1/ingest');
      const ingestPayload = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(ingestPayload.unassigned_parts[0].metadata.source_images).toEqual([
        expect.objectContaining({ image_id: 'img-front' }),
      ]);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'img-front' }),
      ], expect.objectContaining({
        source: 'local_upload',
        confirmedSucceeded: 1,
        confirmedFailed: 1,
      }));
      expect(props.setError).toHaveBeenLastCalledWith('Upload complete: 1 succeeded, 1 failed out of 2.');
    });

    test('Cancel aborts the active request, reports unknown completion, and refreshes without ingesting', async () => {
      let capturedSignal;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((_url, options) => {
        capturedSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });
      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        'Upload cancelled: 0 confirmed succeeded, 1 completion unknown, 0 not started out of 1. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.'
      ));
      expect(capturedSignal.aborted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledTimes(1);
      expect(props.onUploadComplete).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ source: 'local_upload', cancelled: true, completionUnknown: 1 }),
      );
      expect(screen.getByText('No files selected')).toBeInTheDocument();
    });

    test('recomputes cancellation during part ingest and authoritatively reconciles ambiguous ingest completion', async () => {
      const filename = 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg';
      let ingestSignal;
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-front', filename }]),
        })
        .mockImplementationOnce((_url, options) => {
          ingestSignal = options.signal;
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const { props } = renderUploader({ projectType: 'PT2' });
      selectFiles([makeFile(filename)]);
      await waitFor(() => expect(screen.getByLabelText('Delimiter')).toHaveValue('_'));
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledWith(
        [{ id: 'img-front', filename }],
        expect.objectContaining({
          source: 'local_upload',
          cancelled: true,
          completionUnknown: 0,
          ingestCompletionUnknown: true,
          partsMayHaveChanged: true,
          requiresAuthoritativeReconciliation: true,
        }),
      ));
      expect(ingestSignal.aborted).toBe(true);
      expect(props.setError).toHaveBeenLastCalledWith(
        'Upload cancelled: 1 confirmed succeeded, 0 completion unknown, 0 not started out of 1. Project data was refreshed.',
      );
      expect(screen.getByText('No files selected')).toBeInTheDocument();
    });
  });
  describe('Associated metadata file upload', () => {
    test('keeps the newest metadata selection when an older file read finishes last', async () => {
      let resolveOlderRead;
      const olderRead = new Promise((resolve) => {
        resolveOlderRead = resolve;
      });
      renderUploader();
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      const olderFile = {
        name: 'older.json',
        text: () => olderRead,
      };
      const newerFile = {
        name: 'newer.json',
        text: async () => '{"selection":"newer"}',
      };

      Object.defineProperty(metadataInput, 'files', { value: [olderFile], configurable: true });
      fireEvent.change(metadataInput);
      Object.defineProperty(metadataInput, 'files', { value: [newerFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/parsed newer\.json/i)).toBeInTheDocument();
      await act(async () => {
        resolveOlderRead('{"selection":"older"}');
        await olderRead;
      });

      expect(screen.getByText(/parsed newer\.json/i)).toBeInTheDocument();
      expect(screen.queryByText(/parsed older\.json/i)).not.toBeInTheDocument();
      expect(screen.getByText('newer.json')).toBeInTheDocument();
    });

    test('stores parsed JSON once as project metadata and references it from each uploaded image', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: 'stored-metadata' }),
        })
        .mockResolvedValue({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-1', filename: 'photo.png' }]),
        });

      const onProjectMetadataLoaded = jest.fn();
      const { props } = renderUploader({ onProjectMetadataLoaded });
      selectFiles([makeFile('photo.png')]);
      const metadataFile = new File(['{"camera":"A1","exposure":10}'], 'capture.json', { type: 'application/json' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/Parsed capture\.json as associated_upload_metadata:/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      expect(fetchSpy.mock.calls[0][0]).toBe('/api/projects/proj-1/metadata');
      expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
      const projectMetadataPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(projectMetadataPayload.key).toMatch(/^associated_upload_metadata:capture\.json:/);
      expect(projectMetadataPayload.value).toEqual(expect.objectContaining({
        kind: 'associated_image_upload_metadata',
        filename: 'capture.json',
        file_type: 'json',
        parser: 'json',
        metadata: { camera: 'A1', exposure: 10 },
      }));

      const uploadBody = fetchSpy.mock.calls[1][1].body;
      const imageMetadata = (await batchManifest(uploadBody))[0].metadata;
      expect(imageMetadata.associated_metadata_ref).toBe(projectMetadataPayload.key);
      expect(imageMetadata.associated_metadata).toEqual(expect.objectContaining({
        reference_type: 'project_metadata',
        project_metadata_key: projectMetadataPayload.key,
        filename: 'capture.json',
        file_type: 'json',
        parser: 'json',
      }));
      expect(imageMetadata.associated_metadata.metadata).toBeUndefined();
      expect(props.onProjectMetadataLoaded).toHaveBeenCalledTimes(1);
      expect(props.onProjectMetadataLoaded).toHaveBeenCalledWith(expect.objectContaining({
        project_metadata_key: projectMetadataPayload.key,
        filename: 'capture.json',
      }));
    });

    test('treats a .nsipro selected with image files as associated metadata instead of an upload image', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'stored-nsipro-metadata' }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-1', filename: 'photo.png' }]),
        });

      renderUploader();
      const metadataFile = new File(['[capture]\noperator=alice\nexposure=12'], 'scan.nsipro', { type: 'text/plain' });
      selectFiles([makeFile('photo.png'), metadataFile]);

      expect(await screen.findByText(/Parsed scan\.nsipro as associated_upload_metadata:/i)).toBeInTheDocument();
      expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      const projectMetadataPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(projectMetadataPayload.value).toEqual(expect.objectContaining({
        filename: 'scan.nsipro',
        file_type: 'nsipro',
        metadata: { capture: { operator: 'alice', exposure: 12 } },
      }));
      const uploadBody = fetchSpy.mock.calls[1][1].body;
      expect(uploadBody.getAll('files')[0].name).toBe('photo.png');
      const imageMetadata = (await batchManifest(uploadBody))[0].metadata;
      expect(imageMetadata.associated_metadata_ref).toBe(projectMetadataPayload.key);
      expect(imageMetadata.associated_metadata).toEqual(expect.objectContaining({
        filename: 'scan.nsipro',
        parser: 'nsipro-key-value',
      }));
      expect(imageMetadata.nsipro_metadata).toBeUndefined();
    });


    test('stores a deployment-specific .nsipro once and uses lightweight references for ingest', async () => {
      const deploymentNsiproFixture = [
        '[Deployment]',
        'Deployment ID = DEP-42',
        'Line ID = LINE-7',
        'Build Number = 118',
        '[Custom Fields]',
        'Inspection Lot = LOT-ALPHA',
        'Operator Badge = QA-17',
        'Scan Mode = micro CT',
      ].join('\n');

      expect(parseAssociatedMetadataText(deploymentNsiproFixture, 'deployment-a.nsipro', {
        projectConfiguration: { metadata_parsers: { nsipro: { parser_id: 'deployment_a' } } },
      })).toEqual(expect.objectContaining({
        parser: 'nsipro-key-value',
        parser_id: 'deployment_a',
        parser_hash: 'sha256:d1c01fbbf53558bc44e1fcc73a8f537f0feec684ef38b8c919beefb59c1be6bb',
        metadata: {
          deployment: {
            deployment_id: 'DEP-42',
            line_id: 'LINE-7',
            build_number: 118,
          },
          custom_fields: {
            inspection_lot: 'LOT-ALPHA',
            operator_badge: 'QA-17',
            scan_mode: 'micro CT',
          },
        },
      }));

      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'stored-deployment-metadata' }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-front', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' }]),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 } }) });

      renderUploader({
        projectType: 'PT2',
        projectConfiguration: { metadata_parsers: { nsipro: { parser_id: 'deployment_a' } } },
      });
      selectFiles([makeFile('D1001_LOT01_SET01_SN0001_front_visual_false.jpg')]);
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'design_number, lot_number, set_number, serial_number, side, modality, overlay' },
      });
      const metadataFile = new File([deploymentNsiproFixture], 'deployment-a.nsipro', { type: 'text/plain' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/Parsed deployment-a\.nsipro as associated_upload_metadata:/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      const storedMetadataPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(storedMetadataPayload.value).toEqual(expect.objectContaining({
        filename: 'deployment-a.nsipro',
        file_type: 'nsipro',
        parser_id: 'deployment_a',
        metadata: expect.objectContaining({
          custom_fields: expect.objectContaining({ operator_badge: 'QA-17' }),
        }),
      }));

      const imageMetadata = (await batchManifest(fetchSpy.mock.calls[1][1].body))[0].metadata;
      expect(imageMetadata.nsipro_metadata).toBeUndefined();
      expect(imageMetadata.associated_metadata).toEqual(expect.objectContaining({
        parser_id: 'deployment_a',
        parser_hash: storedMetadataPayload.value.parser_hash,
      }));

      const ingestPayload = JSON.parse(fetchSpy.mock.calls[2][1].body);
      const sourceImage = ingestPayload.unassigned_parts[0].metadata.source_images[0];
      expect(ingestPayload.unassigned_parts[0].metadata.nsipro_metadata).toBeUndefined();
      expect(sourceImage.nsipro_metadata).toBeUndefined();
      expect(sourceImage.associated_metadata_ref).toBe(storedMetadataPayload.key);
    });

    test('keeps decoded .nsipro fields only in project metadata and references them from hierarchy ingest', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'stored-metadata' }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-front', filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg' }]),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 } }) });

      renderUploader({ projectType: 'PT2' });
      selectFiles([makeFile('D1001_LOT01_SET01_SN0001_front_visual_false.jpg')]);
      fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: '_' } });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'design_number, lot_number, set_number, serial_number, side, modality, overlay' },
      });
      const metadataFile = new File([
        '[deployment]\ndeployment_id=DEP-42\noperator=alice\nfixture=F-7\nraw_content=',
        'x'.repeat(3000),
      ], 'deployment.nsipro', { type: 'text/plain' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/Parsed deployment\.nsipro as associated_upload_metadata:/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      const projectMetadataPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(projectMetadataPayload.value.metadata.deployment).toEqual(expect.objectContaining({
        deployment_id: 'DEP-42',
        operator: 'alice',
        fixture: 'F-7',
      }));

      const imageMetadata = (await batchManifest(fetchSpy.mock.calls[1][1].body))[0].metadata;
      expect(imageMetadata.associated_metadata_ref).toBe(projectMetadataPayload.key);
      expect(imageMetadata.associated_metadata).toEqual(expect.objectContaining({
        reference_type: 'project_metadata',
        project_metadata_key: projectMetadataPayload.key,
        filename: 'deployment.nsipro',
        file_type: 'nsipro',
      }));
      expect(imageMetadata.associated_metadata.metadata).toBeUndefined();
      expect(imageMetadata.nsipro_metadata).toBeUndefined();

      expect(fetchSpy.mock.calls[2][0]).toBe('/api/projects/proj-1/ingest');
      const ingestPart = JSON.parse(fetchSpy.mock.calls[2][1].body).unassigned_parts[0];
      expect(ingestPart.metadata.associated_metadata_ref).toBe(projectMetadataPayload.key);
      expect(ingestPart.metadata.associated_metadata.metadata).toBeUndefined();
      expect(ingestPart.metadata.nsipro_metadata).toBeUndefined();
      expect(ingestPart.metadata.source_images[0]).toEqual(expect.objectContaining({
        associated_metadata_ref: projectMetadataPayload.key,
        associated_metadata: expect.objectContaining({
          parser: 'nsipro-key-value',
          content_hash: projectMetadataPayload.value.content_hash,
        }),
      }));
      expect(ingestPart.metadata.source_images[0].nsipro_metadata).toBeUndefined();
    });

    test('uses lightweight .nsipro references in PT3 volume-stack ingest records', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'stored-metadata' }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'slice-1', filename: 'slice-001.png' }]),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 } }) });

      renderUploader({ projectType: 'PT3' });
      selectFiles([makeFile('slice-001.png')]);
      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), {
        target: { value: JSON.stringify({ volume_stack_id: 'stack-7', serial_number: 'VOL-7', slice_axis: 'z', slice_index: 1, modality: 'ct' }) },
      });
      const metadataFile = new File(['[deployment]\ndeployment_id=DEP-PT3\nscanner=CT-9'], 'stack.nsipro', { type: 'text/plain' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/Parsed stack\.nsipro as associated_upload_metadata:/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      expect(fetchSpy.mock.calls[2][0]).toBe('/api/projects/proj-1/ingest');
      const ingestPayload = JSON.parse(fetchSpy.mock.calls[2][1].body);
      const pt3Part = ingestPayload.batches[0].parts[0];
      const projectMetadataKey = JSON.parse(fetchSpy.mock.calls[0][1].body).key;
      expect(pt3Part.metadata).toEqual(expect.objectContaining({
        project_type: 'PT3',
        volume_stack_id: 'stack-7',
        associated_metadata_ref: projectMetadataKey,
      }));
      expect(pt3Part.metadata.source_images[0]).toEqual(expect.objectContaining({
        filename: 'slice-001.png',
        image_id: 'slice-1',
        associated_metadata_ref: projectMetadataKey,
      }));
      expect(pt3Part.metadata.nsipro_metadata).toBeUndefined();
      expect(pt3Part.metadata.source_images[0].nsipro_metadata).toBeUndefined();
    });

    test('parses .nsipro key-value metadata files', async () => {
      expect(parseAssociatedMetadataText('[capture]\noperator=alice\nexposure: 12\nvalid=true', 'scan.nsipro')).toEqual({
        parser: 'nsipro-key-value',
        parser_id: 'default',
        parser_version: '1.0.0',
        parser_hash: 'sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df',
        metadata: {
          capture: {
            operator: 'alice',
            exposure: 12,
            valid: true,
          },
        },
        warnings: [],
        source_filename: 'scan.nsipro',
      });
    });


    test('uses project configuration metadata_parsers.nsipro.parser_id for .nsipro association uploads', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'stored-metadata' }) })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => batchPayload([{ id: 'img-1', filename: 'photo.png' }]),
        });

      renderUploader({
        projectConfiguration: {
          metadata_parsers: { nsipro: { parser_id: 'deployment_a' } },
        },
      });
      selectFiles([makeFile('photo.png')]);
      const metadataFile = new File(['operator=alice'], 'deployment.nsipro', { type: 'text/plain' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/Parsed deployment\.nsipro as associated_upload_metadata:/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      const projectMetadataPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(projectMetadataPayload.value).toEqual(expect.objectContaining({
        filename: 'deployment.nsipro',
        file_type: 'nsipro',
        parser: 'nsipro-key-value',
        parser_id: 'deployment_a',
        metadata: { operator: 'alice' },
      }));
      const imageMetadata = (await batchManifest(fetchSpy.mock.calls[1][1].body))[0].metadata;
      expect(imageMetadata.associated_metadata).toEqual(expect.objectContaining({
        parser: 'nsipro-key-value',
        parser_id: 'deployment_a',
      }));
    });

    test('fails closed with a clear upload error for unknown configured .nsipro parser ids', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });

      renderUploader({
        projectConfiguration: {
          metadata_parsers: { nsipro: { parser_id: 'unknown_deployment' } },
        },
      });
      selectFiles([makeFile('photo.png')]);
      const metadataFile = new File(['operator=alice'], 'deployment.nsipro', { type: 'text/plain' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByRole('alert')).toHaveTextContent('Unknown .nsipro parser configured: unknown_deployment.');
      expect(screen.getByRole('button', { name: /upload images/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('blocks upload when associated metadata has an unsupported type', async () => {
      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);
      const metadataFile = new File(['x'], 'notes.txt', { type: 'text/plain' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported metadata file type');
      expect(screen.getByRole('button', { name: /upload images/i })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      expect(props.setError).not.toHaveBeenCalledWith(null);
    });
  });

  describe('Retry selection characterization', () => {
    test('keeps only definite local failures selected and preserves manual metadata for the retry', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          uploaded: [{ client_index: 0, image: { id: 'img-ok', filename: 'ok.png' } }],
          failed: [{ client_index: 1, filename: 'bad.png', code: 'validation_failed', detail: 'bad image' }],
        }),
      });
      const { props } = renderUploader({ projectType: 'PT2' });
      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), { target: { value: '{"lot":"L1"}' } });
      selectFiles([makeFile('ok.png'), makeFile('bad.png'), makeFile('omitted.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(props.setError).toHaveBeenCalledWith(
        'Upload finished with uncertain results: 1 confirmed succeeded, 1 completion unknown, 1 failed out of 3. Project data was refreshed. Completion-unknown files were removed from the retry selection; audit project data and explicitly reselect them only if retrying is safe.',
      ));
      await waitFor(() => expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled());
      expect(screen.getByText(/^1 file selected/)).toBeInTheDocument();
      expect(screen.getByLabelText('Metadata (Optional JSON)')).toHaveValue('{"lot":"L1"}');

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      const retryBody = fetchSpy.mock.calls[1][1].body;
      expect(retryBody.getAll('files').map((file) => file.name)).toEqual(['bad.png']);
    });

    test('clears the local selection and manual metadata after every file is confirmed', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => batchPayload([{ id: 'img-ok', filename: 'ok.png' }]),
      });
      const { props } = renderUploader();
      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), { target: { value: '{"lot":"L1"}' } });
      selectFiles([makeFile('ok.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitForSuccessfulUpload(props);
      expect(screen.getByText('No files selected')).toBeInTheDocument();
      expect(screen.getByLabelText('Metadata (Optional JSON)')).toHaveValue('');
    });

    test('closes the S3 picker once every selected file is confirmed', async () => {
      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ objects: [{ key: 'incoming/a.png', filename: 'a.png', size: 12 }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ imported: [{ id: 'img-a', filename: 'a.png' }], failed: [] }),
        });
      const { props } = renderUploader();
      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/incoming' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));

      await waitFor(() => expect(props.onUploadComplete).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByTestId('s3-file-picker')).not.toBeInTheDocument());
    });
  });

  describe('Project route changes', () => {
    test('aborts a local upload and ignores its late outcome when projectId changes', async () => {
      let capturedSignal;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((_url, options) => {
        capturedSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });
      const onUploadComplete = jest.fn();
      const setError = jest.fn();
      const { rerender } = render(
        <ImageUploader projectId="project-a" onUploadComplete={onUploadComplete} setError={setError} />,
      );
      selectFiles([makeFile('route-change.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      rerender(<ImageUploader projectId="project-b" onUploadComplete={onUploadComplete} setError={setError} />);

      await waitFor(() => expect(capturedSignal.aborted).toBe(true));
      await waitFor(() => expect(screen.getByText('No files selected')).toBeInTheDocument());
      expect(onUploadComplete).not.toHaveBeenCalled();
      expect(setError).not.toHaveBeenCalled();
    });

    test('aborts an S3 listing and ignores project A results after projectId changes', async () => {
      let capturedSignal;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((_url, options) => {
        capturedSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });
      const setError = jest.fn();
      const { rerender } = render(<ImageUploader projectId="project-a" setError={setError} />);
      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/project-a' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      rerender(<ImageUploader projectId="project-b" setError={setError} />);

      await waitFor(() => expect(capturedSignal.aborted).toBe(true));
      expect(screen.queryByTestId('s3-file-picker')).not.toBeInTheDocument();
      expect(screen.getByLabelText('S3 URL (Optional)')).toHaveValue('');
      expect(setError).not.toHaveBeenCalled();
    });

    test('aborts an S3 import and never reports project A completion after projectId changes', async () => {
      let importSignal;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url, options) => {
        if (String(url).endsWith('/s3/list')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ objects: [{ key: 'project-a/a.png', filename: 'a.png', size: 12 }] }),
          });
        }
        importSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });
      const onUploadComplete = jest.fn();
      const setError = jest.fn();
      const { rerender } = render(
        <ImageUploader projectId="project-a" onUploadComplete={onUploadComplete} setError={setError} />,
      );
      fireEvent.change(screen.getByLabelText('S3 URL (Optional)'), {
        target: { value: 's3://source-bucket/project-a' },
      });
      fireEvent.click(screen.getByRole('button', { name: /load files from s3/i }));
      await screen.findByTestId('s3-file-picker');
      setError.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /load selected s3 files/i }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

      rerender(
        <ImageUploader projectId="project-b" onUploadComplete={onUploadComplete} setError={setError} />,
      );

      await waitFor(() => expect(importSignal.aborted).toBe(true));
      expect(onUploadComplete).not.toHaveBeenCalled();
      expect(screen.queryByTestId('s3-file-picker')).not.toBeInTheDocument();
      expect(setError).not.toHaveBeenCalled();
    });
  });

});
