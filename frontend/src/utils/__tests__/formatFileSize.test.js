import { formatFileSize, formatFileSizeFixed } from '../formatFileSize';

describe('formatFileSize', () => {
  it('formats zero as Bytes', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });

  it('trims trailing zeros and scales by 1024', () => {
    expect(formatFileSize(512)).toBe('512 Bytes');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 * 2.256)).toBe('2.26 MB');
    expect(formatFileSize(1024 ** 4)).toBe('1 TB');
  });
});

describe('formatFileSizeFixed', () => {
  it('uses fixed precision per unit', () => {
    expect(formatFileSizeFixed(512)).toBe('512 B');
    expect(formatFileSizeFixed(1024)).toBe('1.0 KB');
    expect(formatFileSizeFixed(1024 * 1024)).toBe('1.00 MB');
    expect(formatFileSizeFixed(1024 ** 3 * 2.5)).toBe('2.50 GB');
    expect(formatFileSizeFixed(1024 ** 4)).toBe('1024.00 GB');
  });

  it('treats non-numeric input as zero', () => {
    expect(formatFileSizeFixed(undefined)).toBe('0 B');
    expect(formatFileSizeFixed('abc')).toBe('0 B');
    expect(formatFileSizeFixed('2048')).toBe('2.0 KB');
  });
});
