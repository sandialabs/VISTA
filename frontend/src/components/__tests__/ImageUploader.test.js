import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ImageUploader, { buildDuplicateFilenameMap, buildInspectionPartIngestPayload, formatUploadSize, tagDuplicateFilename } from '../ImageUploader';

const makeFile = (name) => new File(['data'], name, { type: 'image/png' });

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

beforeEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('ImageUploader', () => {

  describe('Duplicate filename tagging', () => {
    test('tags selected duplicate filenames before extension', () => {
      const first = makeFile('overlay.png');
      const second = makeFile('overlay.png');
      const third = makeFile('overlay.png');
      const filenameMap = buildDuplicateFilenameMap([first, second, third]);

      expect(tagDuplicateFilename('part.tif', 1)).toBe('part (duplicate).tif');
      expect(formatUploadSize(1024 ** 2)).toBe('1.00 MB');
      expect(formatUploadSize(1024 ** 3)).toBe('1.00 GB');
      expect(filenameMap.get(first)).toBe('overlay.png');
      expect(filenameMap.get(second)).toBe('overlay (duplicate).png');
      expect(filenameMap.get(third)).toBe('overlay (duplicate 2).png');
    });

    test('uploads duplicate selections with duplicate tags and original filename metadata', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('/ingest')) return { ok: true, json: async () => ({}) };
        return { ok: true, json: async () => ({ id: `img-${fetchSpy.mock.calls.length}` }) };
      });

      renderUploader();
      selectFiles([makeFile('overlay.png'), makeFile('overlay.png')]);
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      const firstBody = fetchSpy.mock.calls[0][1].body;
      const secondBody = fetchSpy.mock.calls[1][1].body;
      expect(firstBody.get('file').name).toBe('overlay.png');
      expect(firstBody.get('metadata')).toBeNull();
      expect(secondBody.get('file').name).toBe('overlay (duplicate).png');
      expect(JSON.parse(secondBody.get('metadata'))).toMatchObject({
        original_filename: 'overlay.png',
        duplicate_filename_tagged: true,
      });
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
      selectFiles([
        new File(['a'.repeat(1024)], 'small.png', { type: 'image/png' }),
        new File(['b'.repeat(2048)], 'large.png', { type: 'image/png' }),
      ]);

      expect(screen.getByText('2 files selected (3.00 KB)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));
      expect(screen.getByText('0 B / 3.00 KB uploaded')).toBeInTheDocument();

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
      await act(async () => {
        firstUpload.resolve({ ok: true, json: async () => ({ id: 'img-small', filename: 'small.png' }) });
        await Promise.resolve();
      });
      expect(screen.getByText('0 B / 3.00 KB uploaded')).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(screen.getByText('1.00 KB / 3.00 KB uploaded')).toBeInTheDocument();

      await act(async () => {
        secondUpload.resolve({ ok: true, json: async () => ({ id: 'img-large', filename: 'large.png' }) });
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
        json: async () => ({ id: 'img-1' }),
      });

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/projects/proj-1/images');
      expect(options.method).toBe('POST');

      const body = options.body;
      expect(body.get('file')).toBeTruthy();
      expect(body.get('metadata')).toBeNull();
      expect(props.onUploadComplete).toHaveBeenCalledWith([{ id: 'img-1' }]);
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
      expect(props.onUploadComplete).toHaveBeenCalledWith([{ id: 'img-a', filename: 'a.png' }]);
      expect(props.setError).toHaveBeenCalledWith(null);
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

      renderUploader();
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
  });

  describe('Load Test Data', () => {
    test.each([
      ['PT1', 16, 4],
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
        expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/load-test-data', { method: 'POST' });
      });
      expect(await screen.findByTestId('load-test-data-result')).toHaveTextContent(
        `Loaded ${imagesCreated} new ${projectType} test images`
      );
      expect(props.onUploadComplete).toHaveBeenCalledWith(payload);
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
        expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/load-test-data', { method: 'POST' });
      });
      expect(await screen.findByTestId('load-test-data-result')).toHaveTextContent('Loaded 64 new PT3 test images');
      expect(props.onUploadComplete).toHaveBeenCalledWith(payload);
      expect(props.setError).toHaveBeenCalledWith(null);
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
        expect(fetchSpy).toHaveBeenCalledWith('/api/projects/proj-1/load-test-data', { method: 'POST' });
      });
      expect(props.setError).toHaveBeenCalledWith('Failed to load PT3 test data. PT3 test stack not found');
    });
  });

  describe('Upload with manual metadata only', () => {
    test('sends manual JSON metadata in FormData', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'img-1' }),
      });

      renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.change(screen.getByLabelText('Metadata (Optional JSON)'), {
        target: { value: '{"source": "manual"}' },
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      const body = fetchSpy.mock.calls[0][1].body;
      expect(JSON.parse(body.get('metadata'))).toEqual({ source: 'manual' });
    });
  });

  describe('Upload with extracted metadata', () => {
    test('sends extracted metadata from filename in FormData', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'img-1' }),
      });

      renderUploader();
      const files = [makeFile('lot1_SN001.png')];
      selectFiles(files);

      fireEvent.change(screen.getByLabelText('Delimiter'), {
        target: { value: '_' },
      });
      fireEvent.change(screen.getByLabelText('Keys (comma-separated)'), {
        target: { value: 'lot, serial' },
      });

      // Wait for the config to settle (isValid=true, preview matches).
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload images/i })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      const body = fetchSpy.mock.calls[0][1].body;
      expect(JSON.parse(body.get('metadata'))).toEqual({
        lot: 'lot1',
        serial: 'SN001',
      });
    });

    test('auto-creates inspection parts from VISTA hierarchy filenames after upload', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-front',
            filename: 'D1001_LOT01_SET01_SN0001_front_visual_false.jpg',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'img-back',
            filename: 'D1001_LOT01_SET01_SN0001_back_visual_false.jpg',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            project_id: 'proj-1',
            counters: { parts_created: 1 },
            discrepancies: [],
          }),
        });

      const { props } = renderUploader();
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
        expect(fetchSpy).toHaveBeenCalledTimes(3);
      });

      const firstUploadMetadata = JSON.parse(fetchSpy.mock.calls[0][1].body.get('metadata'));
      expect(firstUploadMetadata).toEqual({
        design_number: 'D1001',
        lot_number: 'LOT01',
        set_number: 'SET01',
        serial_number: 'SN0001',
        side: 'front',
        modality: 'visual',
        overlay: false,
      });

      const ingestCall = fetchSpy.mock.calls[2];
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
      ]);
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
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'img-left', filename: 'DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'img-right', filename: 'DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 }, discrepancies: [] }) });

      renderUploader({ projectConfiguration });
      selectFiles([
        makeFile('DWG100_LT22_PN7_SN9_VWleft_MDvisual_false.png'),
        makeFile('DWG100_LT22_PN7_SN9_VWright_MDthermal_false.png'),
      ]);

      await waitFor(() => {
        expect(screen.getByLabelText('Delimiter')).toHaveValue('_');
        expect(screen.getByLabelText('Keys (comma-separated)')).toHaveValue('design_number, lot_number, set_number, serial_number, side, modality, overlay');
      });

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body.get('metadata'))).toEqual(expect.objectContaining({
        design_number: '100',
        lot_number: '22',
        set_number: '7',
        serial_number: '9',
        side: 'left',
        modality: 'visual',
        overlay: false,
      }));
      expect(JSON.parse(fetchSpy.mock.calls[2][1].body)).toEqual({
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
        .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'img-front', filename: 'D200-L03-B55-S888-Vfront-Mvisual-false.jpg' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ project_id: 'proj-1', counters: { parts_created: 1 }, discrepancies: [] }) });

      renderUploader({ projectConfiguration });
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
        json: async () => ({ id: 'img-1' }),
      });

      renderUploader();
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

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      const body = fetchSpy.mock.calls[0][1].body;
      const metadata = JSON.parse(body.get('metadata'));
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
    test('sets error on fetch failure', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(props.setError).toHaveBeenCalledWith(
          'Upload complete: 0 succeeded, 1 failed out of 1.'
        );
      });
    });

    test('sets error on non-ok response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const { props } = renderUploader();
      selectFiles([makeFile('photo.png')]);

      fireEvent.click(screen.getByRole('button', { name: /upload images/i }));

      await waitFor(() => {
        expect(props.setError).toHaveBeenCalledWith(
          'Upload complete: 0 succeeded, 1 failed out of 1.'
        );
      });
    });
  });
  describe('Associated metadata file upload', () => {
    test('stores parsed JSON once as project metadata and references it from each uploaded image', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: 'stored-metadata' }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ id: 'img-1', filename: 'photo.png' }),
        });

      renderUploader();
      selectFiles([makeFile('photo.png')]);
      const metadataFile = new File(['{"camera":"A1","exposure":10}'], 'capture.json', { type: 'application/json' });
      const metadataInput = screen.getByLabelText('Metadata File (Optional)');
      Object.defineProperty(metadataInput, 'files', { value: [metadataFile], configurable: true });
      fireEvent.change(metadataInput);

      expect(await screen.findByText(/Associated capture\.json as associated_upload_metadata:/i)).toBeInTheDocument();
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
      const imageMetadata = JSON.parse(uploadBody.get('metadata'));
      expect(imageMetadata.associated_metadata_ref).toBe(projectMetadataPayload.key);
      expect(imageMetadata.associated_metadata).toEqual(expect.objectContaining({
        reference_type: 'project_metadata',
        project_metadata_key: projectMetadataPayload.key,
        filename: 'capture.json',
        file_type: 'json',
        parser: 'json',
      }));
      expect(imageMetadata.associated_metadata.metadata).toBeUndefined();
    });

    test('parses .nsipro key-value metadata files', async () => {
      const { parseAssociatedMetadataText } = await import('../ImageUploader');
      expect(parseAssociatedMetadataText('[capture]\noperator=alice\nexposure: 12\nvalid=true', 'scan.nsipro')).toEqual({
        parser: 'nsipro-key-value',
        metadata: {
          capture: {
            operator: 'alice',
            exposure: 12,
            valid: true,
          },
        },
      });
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

});
