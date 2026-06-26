import fs from 'fs';
import path from 'path';
import { NSIPRO_PARSERS, getConfiguredNsiproParserId, parseGenericNsiproKeyValueText, parseNsiproText, parseNsiproXmlText } from '../nsiproParsers';

describe('nsiproParsers', () => {
  test('exports a registry with deployment parser identifiers', () => {
    expect(Object.keys(NSIPRO_PARSERS)).toEqual(expect.arrayContaining(['default', 'deployment_a', 'deployment_b']));
  });

  test('parses generic key-value .nsipro text with the stable result shape', () => {
    expect(parseGenericNsiproKeyValueText('[capture]\noperator=alice\nexposure: 12\nvalid=true', 'scan.nsipro')).toEqual({
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

  test('parseNsiproText uses JSON first for the default parser', () => {
    expect(parseNsiproText('{"camera":"A1"}', 'scan.nsipro')).toEqual({
      parser: 'nsipro-json',
      parser_id: 'default',
      parser_version: '1.0.0',
      parser_hash: 'sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df',
      metadata: { camera: 'A1' },
      warnings: [],
      source_filename: 'scan.nsipro',
    });
  });

  test('parseNsiproText decodes arbitrary XML .nsipro fields, attributes, text, and repeated elements', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<NSIProMetadata schema="pt3" version="2">',
      '  <Acquisition operator="alice" valid="true">',
      '    <Exposure unit="ms">12.5</Exposure>',
      '    <Mode>brightfield</Mode>',
      '  </Acquisition>',
      '  <Channel index="1"><Name>Brightfield</Name><Wavelength>550</Wavelength></Channel>',
      '  <Channel index="2"><Name>DAPI</Name><Wavelength>405</Wavelength></Channel>',
      '  <Notes><![CDATA[ready for review]]></Notes>',
      '</NSIProMetadata>',
    ].join('\n');

    expect(parseNsiproXmlText(xml, 'scan.nsipro')).toEqual({
      parser: 'nsipro-xml',
      parser_id: 'default',
      parser_version: '1.0.0',
      parser_hash: 'sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df',
      source_filename: 'scan.nsipro',
      warnings: [],
      metadata: {
        NSIProMetadata: {
          '@attributes': { schema: 'pt3', version: 2 },
          Acquisition: {
            '@attributes': { operator: 'alice', valid: true },
            Exposure: { '@attributes': { unit: 'ms' }, '#text': 12.5 },
            Mode: 'brightfield',
          },
          Channel: [
            { '@attributes': { index: 1 }, Name: 'Brightfield', Wavelength: 550 },
            { '@attributes': { index: 2 }, Name: 'DAPI', Wavelength: 405 },
          ],
          Notes: 'ready for review',
        },
      },
    });
    expect(parseNsiproText(xml, 'scan.nsipro')).toEqual(expect.objectContaining({ parser: 'nsipro-xml' }));
  });

  test('parseNsiproText accepts NSI XML-like fields without scalar end tags', () => {
    const xmlLike = [
      '<NSI Reconstruction Project>',
      '  <version>2.0',
      '  <Project Name>Plastic Part 6-5-2024',
      '  <Object Radiograph>',
      '    <file>Radiographs-Plastic Part 6-5-2024\\Plastic Part 6-5-2024-radio*.tif',
      '    <number>1200',
      '  </Object Radiograph>',
      '  <CT Project Configuration>',
      '    <Technique Configuration>',
      '      <System Info>',
      '        <Company Name>North Star Imaging, Inc.',
      '      </System Info>',
      '      <Setup>',
      '        <units>[mm]',
      '        <fixturing>',
      '        <phys filter>0.040&quot; Cu',
      '        <inline scalar>closed value</inline scalar>',
      '      </Setup>',
      '      <Ug>',
      '        <Formula>',
      '          <idx>0',
      '          <Description>IQI Hole (mm)',
      '          <Value>0.51',
      '        </Formula>',
      '        <Formula>',
      '          <idx>1',
      '          <Description>X Srb-Pixels (Hole)',
      '          <Value>3',
      '        </Formula>',
      '      </Ug>',
      '    </Technique Configuration>',
      '  </CT Project Configuration>',
      '</NSI Reconstruction Project>',
    ].join('\n');

    const result = parseNsiproText(xmlLike, 'Plastic Part 6-5-2024.nsipro');

    expect(result).toEqual(expect.objectContaining({
      parser: 'nsipro-xml',
      parser_id: 'default',
      source_filename: 'Plastic Part 6-5-2024.nsipro',
    }));
    const metadata = result.metadata['NSI Reconstruction Project'];
    expect(metadata.version).toBe(2.0);
    expect(metadata['Project Name']).toBe('Plastic Part 6-5-2024');
    expect(metadata['Object Radiograph'].number).toBe(1200);
    const technique = metadata['CT Project Configuration']['Technique Configuration'];
    expect(technique['System Info']['Company Name']).toBe('North Star Imaging, Inc.');
    expect(technique.Setup.fixturing).toEqual({});
    expect(technique.Setup['phys filter']).toBe('0.040" Cu');
    expect(technique.Setup['inline scalar']).toBe('closed value');
    expect(technique.Ug.Formula).toEqual([
      { idx: 0, Description: 'IQI Hole (mm)', Value: 0.51 },
      { idx: 1, Description: 'X Srb-Pixels (Hole)', Value: 3 },
    ]);
  });

  test('parseNsiproText reads the ReadTheDocs Plastic Part example fixture', () => {
    const fixturePath = path.resolve(__dirname, '../../../../test/data/nsipro/Plastic Part 6-5-2024.nsipro');
    const result = parseNsiproText(fs.readFileSync(fixturePath, 'utf8'), 'Plastic Part 6-5-2024.nsipro');

    expect(result).toEqual(expect.objectContaining({
      parser: 'nsipro-xml',
      parser_id: 'default',
      source_filename: 'Plastic Part 6-5-2024.nsipro',
    }));
    const metadata = result.metadata['NSI Reconstruction Project'];
    expect(metadata['Project Name']).toBe('Plastic Part 6-5-2024');
    expect(metadata['Object Radiograph'].number).toBe(1200);
    expect(metadata.Volume.resolution).toBe('605 1189 572');
    const technique = metadata['CT Project Configuration']['Technique Configuration'];
    expect(technique['System Info']['Company Name']).toBe('North Star Imaging, Inc.');
    expect(technique.Detector['integration time ms']).toBe(35.6608);
    expect(technique.Ug.Formula[4].Description).toBe('Im Unsharpness');
  });

  test('parseNsiproXmlText rejects unsafe XML entity declarations', () => {
    const xml = '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>';
    expect(() => parseNsiproXmlText(xml, 'unsafe.nsipro'))
      .toThrow('XML .nsipro metadata with DOCTYPE or entity declarations is not supported.');
  });

  test('parseNsiproText extracts fields from the PT3 sample .nsipro fixture', () => {
    const fixturePath = path.resolve(__dirname, '../../../../test/data/3D/geometric/PT3_GEOMETRIC_DUAL_LABEL.nsipro');
    const result = parseNsiproText(fs.readFileSync(fixturePath, 'utf8'), 'PT3_GEOMETRIC_DUAL_LABEL.nsipro');

    expect(result).toEqual(expect.objectContaining({
      parser: 'nsipro-key-value',
      parser_id: 'default',
      source_filename: 'PT3_GEOMETRIC_DUAL_LABEL.nsipro',
    }));
    expect(result.metadata.Application.application_info).toBe('NIS-Elements AR 5.30.00 (Build 1688)');
    expect(result.metadata.Acquisition.acquisition_datetime).toBe('2026-02-17T14:22:31Z');
    expect(result.metadata.Microscope.objective_magnification).toBe(20);
    expect(result.metadata.Camera.exposure_ms).toBe(12.5);
    expect(result.metadata.Calibration.voxel_size_um).toEqual([2.5, 2.5, 5.0]);
    expect(result.metadata.Volume.slices).toBe(64);
    expect(result.metadata.Stage.stage_x_um).toBe(1024.25);
    expect(result.metadata.Channels.channel_1_name).toBe('Brightfield');
  });

  test('parseNsiproText uses parserId from options and falls back on unknown parser', () => {
    const result = parseNsiproText('operator=alice', 'scan.nsipro', { parserId: 'unknown_parser' });
    expect(result).toEqual(expect.objectContaining({
      parser: 'nsipro-key-value',
      parser_id: 'default',
      requested_parser_id: 'unknown_parser',
      metadata: { operator: 'alice' },
      source_filename: 'scan.nsipro',
    }));
    expect(result.warnings).toContain('Unknown .nsipro parser "unknown_parser"; used default parser instead.');
  });

  test('parseNsiproText can fail closed for unknown parser configuration', () => {
    expect(() => parseNsiproText('operator=alice', 'scan.nsipro', { parserId: 'unknown_parser', failClosed: true }))
      .toThrow('Unknown .nsipro parser configured: unknown_parser.');
  });

  test('parseNsiproText reads parser id from project configuration', () => {
    expect(getConfiguredNsiproParserId({
      metadata_parsers: { nsipro: { parser_id: 'deployment_a' } },
    })).toBe('deployment_a');
    expect(parseNsiproText('operator=alice', 'scan.nsipro', {
      projectConfiguration: { metadata_parsers: { nsipro: { parser_id: 'deployment_a' } } },
    })).toEqual(expect.objectContaining({
      parser: 'nsipro-key-value',
      parser_id: 'deployment_a',
      metadata: { operator: 'alice' },
    }));
  });

  test('deployment_a normalizes deployment-specific custom fields', () => {
    const fixture = [
      '[Deployment]',
      'Deployment ID = DEP-42',
      'Line ID = LINE-7',
      'Build Number = 118',
      '[Custom Fields]',
      'Inspection Lot = LOT-ALPHA',
      'Operator Badge = QA-17',
    ].join('\n');

    expect(parseNsiproText(fixture, 'deployment-a.nsipro', { parserId: 'deployment_a' })).toEqual(expect.objectContaining({
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
        },
      },
    }));
  });

});
