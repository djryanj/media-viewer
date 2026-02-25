// tests/unit/path-encoding.test.js
/**
 * Unit tests for path encoding in URL construction.
 *
 * The frontend constructs API URLs by splitting file paths on '/' and
 * encoding each segment with encodeURIComponent. These tests verify
 * that this pattern produces correct URLs for gorilla/mux's single
 * URL-decode on the backend.
 */

import { describe, it, expect } from 'vitest';

/**
 * Replicate the inline encoding pattern used throughout the frontend:
 *   path.split('/').map(encodeURIComponent).join('/')
 *
 * This is not a custom utility — it's the standard pattern extracted
 * here solely to avoid repetition in test assertions.
 */
function encodePath(path) {
    if (!path) return '';
    return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Simulate gorilla/mux's single URL-decode of each path segment.
 */
function decodePath(encoded) {
    if (!encoded) return '';
    return encoded.split('/').map(decodeURIComponent).join('/');
}

describe('Path segment encoding with encodeURIComponent', () => {
    describe('Empty and falsy inputs', () => {
        it('should return empty string for empty input', () => {
            expect(encodePath('')).toBe('');
        });

        it('should return empty string for null', () => {
            expect(encodePath(null)).toBe('');
        });

        it('should return empty string for undefined', () => {
            expect(encodePath(undefined)).toBe('');
        });
    });

    describe('Simple paths (no encoding needed)', () => {
        it('should pass through simple filename', () => {
            expect(encodePath('photo.jpg')).toBe('photo.jpg');
        });

        it('should pass through simple nested path', () => {
            expect(encodePath('photos/vacation/beach.jpg')).toBe('photos/vacation/beach.jpg');
        });

        it('should pass through alphanumeric with hyphens and underscores', () => {
            expect(encodePath('my-folder/my_file_01.jpg')).toBe('my-folder/my_file_01.jpg');
        });

        it('should pass through dots in names', () => {
            expect(encodePath('archive.2024/photo.v2.jpg')).toBe('archive.2024/photo.v2.jpg');
        });

        it('should pass through tildes', () => {
            expect(encodePath('~user/file.jpg')).toBe('~user/file.jpg');
        });
    });

    describe('Directory separator preservation', () => {
        it('should preserve single separator', () => {
            expect(encodePath('dir/file.jpg')).toBe('dir/file.jpg');
        });

        it('should preserve deeply nested separators', () => {
            expect(encodePath('a/b/c/d/file.jpg')).toBe('a/b/c/d/file.jpg');
        });

        it('should handle leading slash', () => {
            expect(encodePath('/photos/file.jpg')).toBe('/photos/file.jpg');
        });

        it('should handle trailing slash', () => {
            expect(encodePath('photos/subfolder/')).toBe('photos/subfolder/');
        });

        it('should handle filename only', () => {
            expect(encodePath('file.jpg')).toBe('file.jpg');
        });
    });

    describe('Space encoding', () => {
        it('should encode spaces in filenames', () => {
            expect(encodePath('my file.jpg')).toBe('my%20file.jpg');
        });

        it('should encode spaces in directory names', () => {
            expect(encodePath('my photos/beach day.jpg')).toBe('my%20photos/beach%20day.jpg');
        });

        it('should encode multiple consecutive spaces', () => {
            expect(encodePath('a  b/c  d.jpg')).toBe('a%20%20b/c%20%20d.jpg');
        });

        it('should encode leading and trailing spaces in segments', () => {
            expect(encodePath(' leading/trailing .jpg')).toBe('%20leading/trailing%20.jpg');
        });
    });

    describe('Hash character encoding', () => {
        it('should encode hash in filename', () => {
            expect(encodePath('file#1.jpg')).toBe('file%231.jpg');
        });

        it('should encode hash in directory name', () => {
            expect(encodePath('folder#2/file.jpg')).toBe('folder%232/file.jpg');
        });

        it('should encode multiple hashes', () => {
            expect(encodePath('a#b#c.jpg')).toBe('a%23b%23c.jpg');
        });
    });

    describe('Question mark encoding', () => {
        it('should encode question mark in filename', () => {
            expect(encodePath('what?.jpg')).toBe('what%3F.jpg');
        });

        it('should encode question mark in directory name', () => {
            expect(encodePath('why?/file.jpg')).toBe('why%3F/file.jpg');
        });
    });

    describe('Percent character encoding (literal %XX on disk)', () => {
        it('should double-encode literal percent in filename', () => {
            // File literally named "file%21.jpg" on disk
            // encodeURIComponent('%') → '%25', so '%21' → '%2521'
            // mux decodes '%2521' → '%21' (the literal filename)
            expect(encodePath('file%21.jpg')).toBe('file%2521.jpg');
        });

        it('should double-encode percent in directory name', () => {
            expect(encodePath('dir%20name/file.jpg')).toBe('dir%2520name/file.jpg');
        });

        it('should encode bare percent sign', () => {
            expect(encodePath('100% done.jpg')).toBe('100%25%20done.jpg');
        });

        it('should handle multiple percent sequences', () => {
            expect(encodePath('a%20b%21c.jpg')).toBe('a%2520b%2521c.jpg');
        });
    });

    describe('Ampersand and equals encoding', () => {
        it('should encode ampersand', () => {
            expect(encodePath('Tom & Jerry.jpg')).toBe('Tom%20%26%20Jerry.jpg');
        });

        it('should encode equals sign', () => {
            expect(encodePath('key=value.txt')).toBe('key%3Dvalue.txt');
        });
    });

    describe('Unicode and international characters', () => {
        it('should encode accented characters', () => {
            expect(encodePath('photos/café.jpg')).toBe('photos/caf%C3%A9.jpg');
        });

        it('should encode CJK characters', () => {
            expect(encodePath('写真/花.jpg')).toBe('%E5%86%99%E7%9C%9F/%E8%8A%B1.jpg');
        });

        it('should encode emoji', () => {
            const result = encodePath('photos/🌅sunset.jpg');
            expect(result).toContain('photos/');
            expect(result).toContain('sunset.jpg');
            expect(result).not.toBe('photos/🌅sunset.jpg');
        });

        it('should encode mixed accented characters', () => {
            expect(encodePath('résumé/naïve.jpg')).toBe('r%C3%A9sum%C3%A9/na%C3%AFve.jpg');
        });
    });

    describe('Other special URL characters', () => {
        it('should encode square brackets', () => {
            expect(encodePath('file[1].jpg')).toBe('file%5B1%5D.jpg');
        });

        it('should encode curly braces', () => {
            expect(encodePath('file{1}.jpg')).toBe('file%7B1%7D.jpg');
        });

        it('should encode pipe', () => {
            expect(encodePath('a|b.jpg')).toBe('a%7Cb.jpg');
        });

        it('should encode caret', () => {
            expect(encodePath('a^b.jpg')).toBe('a%5Eb.jpg');
        });

        it('should encode backtick', () => {
            expect(encodePath('file`name.jpg')).toBe('file%60name.jpg');
        });

        it('should encode at sign', () => {
            expect(encodePath('user@host.jpg')).toBe('user%40host.jpg');
        });

        it('should encode colon', () => {
            expect(encodePath('time:12:30.jpg')).toBe('time%3A12%3A30.jpg');
        });

        it('should encode semicolon', () => {
            expect(encodePath('a;b.jpg')).toBe('a%3Bb.jpg');
        });

        it('should encode plus sign', () => {
            expect(encodePath('a+b.jpg')).toBe('a%2Bb.jpg');
        });

        it('should encode comma', () => {
            expect(encodePath('a,b.jpg')).toBe('a%2Cb.jpg');
        });

        it('should encode double quotes', () => {
            expect(encodePath('say "hello".jpg')).toBe('say%20%22hello%22.jpg');
        });

        it('should preserve parentheses (unreserved in encodeURIComponent)', () => {
            expect(encodePath('photo (1).jpg')).toBe('photo%20(1).jpg');
        });

        it('should preserve single quotes (unreserved in encodeURIComponent)', () => {
            expect(encodePath("it's.jpg")).toBe("it's.jpg");
        });
    });

    describe('Complex real-world filenames', () => {
        it('should handle typical camera filename', () => {
            expect(encodePath('DCIM/IMG_20240101_120000.jpg')).toBe('DCIM/IMG_20240101_120000.jpg');
        });

        it('should handle download duplicate naming', () => {
            expect(encodePath('Downloads/document (2).pdf')).toBe('Downloads/document%20(2).pdf');
        });

        it('should handle deeply nested path with mixed special chars', () => {
            expect(encodePath('Photos/2024 Vacation/Day #1/café & beach.jpg')).toBe(
                'Photos/2024%20Vacation/Day%20%231/caf%C3%A9%20%26%20beach.jpg'
            );
        });

        it('should handle filename resembling URL query string', () => {
            expect(encodePath('files/report?final=true.pdf')).toBe(
                'files/report%3Ffinal%3Dtrue.pdf'
            );
        });

        it('should handle filename resembling URL fragment', () => {
            expect(encodePath('docs/readme#section1.md')).toBe('docs/readme%23section1.md');
        });

        it('should handle filename with literal encoded sequence on disk', () => {
            // File on disk is literally named "hello%20world.txt"
            expect(encodePath('hello%20world.txt')).toBe('hello%2520world.txt');
        });
    });

    describe('Round-trip: encode then single decode recovers original', () => {
        const roundTrips = [
            'photos/beach.jpg',
            'my photos/beach day.jpg',
            'photos/file#1.jpg',
            'photos/file%21.jpg',
            '写真/café.jpg',
            'Photos/2024 Vacation/Day #1/café & beach.jpg',
            'docs/why?.txt',
            'a#b?c%d&e=f@g[h].jpg',
            'hello%20world.txt',
            '100% done.jpg',
            'Tom & Jerry.jpg',
            'file (1) [final] {v2}.jpg',
        ];

        roundTrips.forEach((original) => {
            it(`should round-trip: "${original}"`, () => {
                const encoded = encodePath(original);
                const decoded = decodePath(encoded);
                expect(decoded).toBe(original);
            });
        });
    });

    describe('Constructed API URLs are well-formed', () => {
        it('should produce valid /api/file/ URL with no raw special chars', () => {
            const path = 'photos/my file #1.jpg';
            const url = `/api/file/${encodePath(path)}`;

            expect(url).toBe('/api/file/photos/my%20file%20%231.jpg');
            expect(url).not.toContain(' ');
            expect(url).not.toMatch(/[^%]#/);
        });

        it('should produce valid /api/thumbnail/ URL', () => {
            const url = `/api/thumbnail/${encodePath('photos/café.jpg')}`;
            expect(url).toBe('/api/thumbnail/photos/caf%C3%A9.jpg');
        });

        it('should produce valid /api/stream/ URL', () => {
            const url = `/api/stream/${encodePath('videos/my video (1).mp4')}`;
            expect(url).toBe('/api/stream/videos/my%20video%20(1).mp4');
        });

        it('should produce valid download URL with query param intact', () => {
            const url = `/api/file/${encodePath('docs/report & summary.pdf')}?download=true`;

            expect(url).toBe('/api/file/docs/report%20%26%20summary.pdf?download=true');
            // Only one '?' — the download query param, not from the filename
            expect(url.split('?').length).toBe(2);
        });

        it('should not break URL when path has no special chars', () => {
            const url = `/api/file/${encodePath('simple/path/file.jpg')}`;
            expect(url).toBe('/api/file/simple/path/file.jpg');
        });
    });
});
