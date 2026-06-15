import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration } from '$lib/utils/format';

describe('formatBytes', () => {
    it('formats 0 bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
    });
    it('formats kilobytes', () => {
        expect(formatBytes(1024)).toBe('1 KB');
    });
    it('formats megabytes', () => {
        expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });
    it('formats fractional values', () => {
        expect(formatBytes(1500)).toBe('1.5 KB');
    });
});

describe('formatDuration', () => {
    it('formats seconds only', () => {
        expect(formatDuration(45)).toBe('0:45');
    });
    it('formats minutes and seconds', () => {
        expect(formatDuration(90)).toBe('1:30');
    });
    it('formats hours', () => {
        expect(formatDuration(3661)).toBe('1:01:01');
    });
});
