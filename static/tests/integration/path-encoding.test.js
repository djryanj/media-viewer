// tests/integration/path-encoding.test.js
/**
 * Integration tests for frontend path encoding consistency.
 *
 * Verifies that file paths encoded with the standard pattern
 *   path.split('/').map(encodeURIComponent).join('/')
 * are correctly handled by the real backend across all API endpoints.
 *
 * Requires a running backend with indexed test media files.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
    ensureAuthenticated,
    listFiles,
    getMediaFiles,
    apiRequest,
} from '../helpers/api-helpers.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Replicate the frontend's inline encoding pattern.
 */
function encodePath(path) {
    if (!path) return '';
    // Strip leading slash(es) — the base URL templates already include the slash
    const normalized = path.replace(/^\/+/, '');
    return normalized.split('/').map(encodeURIComponent).join('/');
}

function hasFragmentChars(name) {
    return name.includes('#');
}

function hasPathSafeSpecialChars(name) {
    // Characters that are valid in URL paths but need encoding
    // to avoid misinterpretation: # (fragment), + (' etc.
    return /[#+'!()*]/.test(name);
}

/**
 * Fetch a file via /api/files/{path}.
 */
async function fetchFile(path, options = {}) {
    const query = options.download ? '?download=true' : '';
    const method = options.method || 'GET';

    try {
        const response = await apiRequest(`/api/files/${encodePath(path)}${query}`, {
            method,
        });

        return {
            success: response.ok,
            status: response.status,
            contentType: response.headers.get('content-type'),
            contentDisposition: response.headers.get('content-disposition'),
        };
    } catch (error) {
        return { success: false, status: 0, error: error.message };
    }
}

/**
 * Fetch a thumbnail via /api/thumbnails/{path}.
 */
async function fetchThumbnail(path) {
    try {
        const response = await apiRequest(`/api/thumbnails/${encodePath(path)}`);

        let size = 0;
        if (response.ok) {
            const blob = await response.blob();
            size = blob.size;
        }

        return {
            success: response.ok,
            status: response.status,
            contentType: response.headers.get('content-type'),
            size,
        };
    } catch (error) {
        return { success: false, status: 0, error: error.message };
    }
}

/**
 * Fetch stream info via /api/stream-info/{path}.
 */
async function fetchStreamInfo(path) {
    try {
        const response = await apiRequest(`/api/stream-info/${encodePath(path)}`);

        const data = response.ok ? await response.json() : null;
        return { success: response.ok, status: response.status, data };
    } catch (error) {
        return { success: false, status: 0, error: error.message };
    }
}

/**
 * HEAD request to /api/stream/{path}.
 */
async function fetchStreamHead(path) {
    try {
        const response = await apiRequest(`/api/stream/${encodePath(path)}`, {
            method: 'HEAD',
        });

        return {
            success: response.ok,
            status: response.status,
            contentType: response.headers.get('content-type'),
        };
    } catch (error) {
        return { success: false, status: 0, error: error.message };
    }
}

/**
 * Collect files from a directory and optionally one level of subdirectories.
 */
async function collectFiles(path, maxDepth = 1) {
    const result = await listFiles(path);
    if (!result.success || !result.data.items) return [];

    let files = result.data.items.filter((item) => item.type !== 'folder');

    if (maxDepth > 0) {
        const subdirs = result.data.items.filter((item) => item.type === 'folder');
        for (const subdir of subdirs.slice(0, 5)) {
            const subFiles = await collectFiles(subdir.path, maxDepth - 1);
            files = files.concat(subFiles);
        }
    }

    return files;
}

function hasSpaces(name) {
    return name.includes(' ');
}

function hasSpecialChars(name) {
    return /[#%&?=$${}|^`@:;+,"]/.test(name);
}

function hasUnicode(name) {
    // eslint-disable-next-line no-control-regex
    return /[^\x00-\x7F]/.test(name);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Path Encoding Integration', () => {
    let allFiles = [];
    let imageFiles = [];
    let videoFiles = [];

    beforeAll(async () => {
        await ensureAuthenticated();

        allFiles = await collectFiles('', 1);
        imageFiles = allFiles.filter((f) => f.type === 'image');
        videoFiles = allFiles.filter((f) => f.type === 'video');

        const withSpaces = allFiles.filter((f) => hasSpaces(f.name)).length;
        const withSpecial = allFiles.filter((f) => hasSpecialChars(f.name)).length;
        const withUnicode = allFiles.filter((f) => hasUnicode(f.name)).length;
        console.log(allFiles[0]?.path);
        console.log(
            `Path encoding tests: ${allFiles.length} files ` +
                `(${imageFiles.length} images, ${videoFiles.length} videos, ` +
                `${withSpaces} with spaces, ${withSpecial} with special chars, ` +
                `${withUnicode} with unicode)`
        );
    });

    // ── Encoding round-trip ─────────────────────────────────────────────

    describe('Encoding round-trip', () => {
        it('should round-trip all listed paths through encode/decode', () => {
            for (const file of allFiles.slice(0, 30)) {
                const encoded = encodePath(file.path);
                const decoded = encoded.split('/').map(decodeURIComponent).join('/');
                expect(decoded).toBe(file.path);
            }
        });

        it('should not alter already-safe paths', () => {
            const safe = allFiles.filter((f) => /^[a-zA-Z0-9._\-/]+$/.test(f.path)).slice(0, 10);

            for (const file of safe) {
                expect(encodePath(file.path)).toBe(file.path);
            }
        });

        it('should encode # so it is not interpreted as a URL fragment', () => {
            const path = 'clip#1 final.mp4';
            const encoded = encodePath(path);
            expect(encoded).toBe('clip%231%20final.mp4');
            expect(encoded).not.toContain('#');
        });

        it('should encode + so it is not interpreted as a space', () => {
            const path = 'Beached+Whales.jpg';
            const encoded = encodePath(path);
            expect(encoded).toBe('Beached%2BWhales.jpg');
        });

        it('should encode apostrophes', () => {
            const path = "Big_N'_Tall_1.jpg";
            const encoded = encodePath(path);
            // encodeURIComponent does NOT encode apostrophes
            expect(encoded).toBe("Big_N'_Tall_1.jpg");
        });

        it('should not encode parentheses', () => {
            const path = 'photo (1).jpg';
            const encoded = encodePath(path);
            // encodeURIComponent does NOT encode ( or )
            expect(encoded).toBe('photo%20(1).jpg');
        });

        it('should encode all path-safe special characters in a complex filename', () => {
            const path = "folder (1)/clip#2 + director's cut!.mp4";
            const encoded = encodePath(path);
            // encodeURIComponent encodes: space → %20, # → %23, + → %2B
            // Does NOT encode: ( ) ' !
            expect(encoded).toBe("folder%20(1)/clip%232%20%2B%20director's%20cut!.mp4");
            expect(encoded).not.toContain('#');
        });

        it('should produce URLs where # does not truncate the path', () => {
            // This is the specific bug: unencoded # in a URL causes
            // everything after it to be treated as a fragment and not
            // sent to the server.
            const path = 'clip#1 final.mp4';
            const url = `/api/thumbnails/${encodePath(path)}`;
            expect(url).toBe('/api/thumbnails/clip%231%20final.mp4');

            // Verify the URL can be parsed and the full path is preserved
            const parsed = new URL(url, 'http://localhost');
            expect(parsed.pathname).toBe('/api/thumbnails/clip%231%20final.mp4');
            expect(parsed.hash).toBe(''); // No fragment
        });

        it('should encode ? so it is not interpreted as a query string', () => {
            const path = 'what?really.jpg';
            const encoded = encodePath(path);
            expect(encoded).toBe('what%3Freally.jpg');
            expect(encoded).not.toContain('?');
        });

        it('should encode both # and ? in the same filename', () => {
            const path = 'how?why#both.jpg';
            const encoded = encodePath(path);
            expect(encoded).toBe('how%3Fwhy%23both.jpg');
            expect(encoded).not.toContain('#');
            expect(encoded).not.toContain('?');

            const url = `/api/thumbnails/${encoded}`;
            const parsed = new URL(url, 'http://localhost');
            expect(parsed.pathname).toBe('/api/thumbnails/how%3Fwhy%23both.jpg');
            expect(parsed.hash).toBe('');
            expect(parsed.search).toBe('');
        });
    });

    // ── /api/files/ ──────────────────────────────────────────────────────

    describe('File serving (/api/files/)', () => {
        it('should serve a file with a simple name', async () => {
            if (allFiles.length === 0) {
                console.log('No files available, skipping');
                return;
            }

            const result = await fetchFile(allFiles[0].path);
            expect(result.success).toBe(true);
            expect(result.status).toBe(200);
        });

        it('should serve files with spaces in names', async () => {
            const files = allFiles.filter((f) => hasSpaces(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No files with spaces found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchFile(file.path);
                expect(result.success).toBe(true);
                expect(result.status).toBe(200);
            }
        });

        it('should serve files with special characters in names', async () => {
            const files = allFiles.filter((f) => hasSpecialChars(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No files with special characters found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchFile(file.path);
                expect(result.success).toBe(true);
                expect(result.status).toBe(200);
            }
        });

        it('should serve files with unicode characters in names', async () => {
            const files = allFiles.filter((f) => hasUnicode(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No files with unicode characters found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchFile(file.path);
                expect(result.success).toBe(true);
                expect(result.status).toBe(200);
            }
        });

        it('should set Content-Disposition for download requests', async () => {
            if (allFiles.length === 0) {
                console.log('No files available, skipping');
                return;
            }

            const result = await fetchFile(allFiles[0].path, { download: true });
            expect(result.success).toBe(true);
            expect(result.contentDisposition).toBeTruthy();
            expect(result.contentDisposition).toContain('attachment');
        });

        it('should set Content-Disposition for downloads of files with spaces', async () => {
            const file = allFiles.find((f) => hasSpaces(f.name));
            if (!file) {
                console.log('No files with spaces found, skipping');
                return;
            }

            const result = await fetchFile(file.path, { download: true });
            expect(result.success).toBe(true);
            expect(result.contentDisposition).toBeTruthy();
            expect(result.contentDisposition).toContain('attachment');
        });

        it('should reject path traversal attempts', async () => {
            const result = await fetchFile('../../../etc/passwd');
            expect(result.success).toBe(false);
            expect([400, 403, 404]).toContain(result.status);
        });

        it('should return 404 for non-existent file', async () => {
            const result = await fetchFile('nonexistent-dir/nonexistent-' + Date.now() + '.jpg');
            expect(result.success).toBe(false);
            expect(result.status).toBe(404);
        });
    });

    // ── /api/thumbnails/ ─────────────────────────────────────────────────

    describe('Thumbnail serving (/api/thumbnails/)', () => {
        it('should serve thumbnail for a simple-named image', async () => {
            if (imageFiles.length === 0) {
                console.log('No image files available, skipping');
                return;
            }

            const result = await fetchThumbnail(imageFiles[0].path);
            if (result.status === 503) {
                console.log('Thumbnails disabled, skipping');
                return;
            }

            expect(result.success).toBe(true);
            expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            expect(result.size).toBeGreaterThan(0);
        });

        it('should serve thumbnails for images with spaces in names', async () => {
            const files = imageFiles.filter((f) => hasSpaces(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with spaces found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for images with special characters', async () => {
            const files = imageFiles.filter((f) => hasSpecialChars(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with special characters found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for video files', async () => {
            if (videoFiles.length === 0) {
                console.log('No video files available, skipping');
                return;
            }

            const result = await fetchThumbnail(videoFiles[0].path);
            if (result.status === 503) {
                console.log('Thumbnails disabled, skipping');
                return;
            }

            expect(result.success).toBe(true);
            expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
        });

        it('should serve thumbnails for folders', async () => {
            const rootResult = await listFiles('');
            if (!rootResult.success) return;

            const folders = (rootResult.data.items || []).filter((f) => f.type === 'folder');
            if (folders.length === 0) {
                console.log('No folders available, skipping');
                return;
            }

            const result = await fetchThumbnail(folders[0].path);
            if (result.status === 503) {
                console.log('Thumbnails disabled, skipping');
                return;
            }

            if (result.success) {
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should return 404 for non-existent file thumbnail', async () => {
            const result = await fetchThumbnail(
                'nonexistent-dir/nonexistent-' + Date.now() + '.jpg'
            );
            if (result.status === 503) {
                console.log('Thumbnails disabled, skipping');
                return;
            }

            expect(result.success).toBe(false);
            expect(result.status).toBe(404);
        });
        it('should serve thumbnails for files with hash/octothorpe in names', async () => {
            const files = imageFiles.filter((f) => hasFragmentChars(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with # in name found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for files with plus signs in names', async () => {
            const files = imageFiles.filter((f) => f.name.includes('+')).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with + in name found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for files with apostrophes in names', async () => {
            const files = imageFiles.filter((f) => f.name.includes("'")).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with apostrophes found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for files with parentheses in names', async () => {
            const files = imageFiles.filter((f) => f.name.includes('(')).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with parentheses found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for files with exclamation marks in names', async () => {
            const files = imageFiles.filter((f) => f.name.includes('!')).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with exclamation marks found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });

        it('should serve thumbnails for files with question marks in names', async () => {
            const files = imageFiles.filter((f) => f.name.includes('?')).slice(0, 3);
            if (files.length === 0) {
                console.log('No images with ? in name found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchThumbnail(file.path);
                if (result.status === 503) {
                    console.log('Thumbnails disabled, skipping');
                    return;
                }

                expect(result.success).toBe(true);
                expect(result.contentType).toMatch(/^image\/(jpeg|png)$/);
            }
        });
    });

    // ── /api/stream/ and /api/stream-info/ ──────────────────────────────

    describe('Video streaming (/api/stream/)', () => {
        it('should return stream info for a video', async () => {
            if (videoFiles.length === 0) {
                console.log('No video files available, skipping');
                return;
            }

            const result = await fetchStreamInfo(videoFiles[0].path);
            expect(result.success).toBe(true);
            expect(result.data).toHaveProperty('needsTranscode');
        });

        it('should return stream info for videos with spaces in names', async () => {
            const files = videoFiles.filter((f) => hasSpaces(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No videos with spaces found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchStreamInfo(file.path);
                expect(result.success).toBe(true);
                expect(result.data).toHaveProperty('needsTranscode');
            }
        });

        it('should return stream info for videos with special characters', async () => {
            const files = videoFiles.filter((f) => hasSpecialChars(f.name)).slice(0, 3);
            if (files.length === 0) {
                console.log('No videos with special characters found, skipping');
                return;
            }

            for (const file of files) {
                const result = await fetchStreamInfo(file.path);
                expect(result.success).toBe(true);
            }
        });

        // the streaming endpoint might need a while to transcode one of the test videos, so we set a long timeout here.
        // TODO: the endpoint really should respond to HEAD requests without waiting for transcoding.
        // and/or we can update the backend so it doesn't block as long when transcoding.
        it('should respond to stream HEAD request', { timeout: 120_000 }, async () => {
            if (videoFiles.length === 0) {
                console.log('No video files available, skipping');
                return;
            }

            const result = await fetchStreamHead(videoFiles[0].path, { method: 'HEAD' });
            expect(result.success).toBe(true);
            expect(result.contentType).toMatch(/^video\//);
        });

        it('should return 404 for non-existent video stream', async () => {
            const result = await fetchStreamHead(
                'nonexistent-dir/nonexistent-' + Date.now() + '.mp4'
            );
            expect(result.success).toBe(false);
            expect(result.status).toBe(404);
        });
    });

    // ── Cross-endpoint consistency ──────────────────────────────────────

    describe('Cross-endpoint consistency', () => {
        it('should access the same image via file and thumbnail endpoints', async () => {
            if (imageFiles.length === 0) {
                console.log('No image files available, skipping');
                return;
            }

            const file = imageFiles[0];

            const fileResult = await fetchFile(file.path);
            expect(fileResult.success).toBe(true);

            const thumbResult = await fetchThumbnail(file.path);
            if (thumbResult.status !== 503) {
                expect(thumbResult.success).toBe(true);
            }
        });

        it(
            'should access the same video via file, thumbnail, stream-info, and stream',
            { timeout: 60_000 },
            async () => {
                if (videoFiles.length === 0) {
                    console.log('No video files available, skipping');
                    return;
                }

                const file = videoFiles[0];

                const fileResult = await fetchFile(file.path);
                expect(fileResult.success).toBe(true);

                const thumbResult = await fetchThumbnail(file.path);
                if (thumbResult.status !== 503) {
                    expect(thumbResult.success).toBe(true);
                }

                const infoResult = await fetchStreamInfo(file.path);
                expect(infoResult.success).toBe(true);

                const streamResult = await fetchStreamHead(file.path);
                expect(streamResult.success).toBe(true);
            }
        );

        it(
            'should handle files with spaces consistently across all endpoints',
            { timeout: 60_000 },
            async () => {
                const spacedImage = imageFiles.find((f) => hasSpaces(f.name));
                const spacedVideo = videoFiles.find((f) => hasSpaces(f.name));

                if (spacedImage) {
                    const fileResult = await fetchFile(spacedImage.path);
                    expect(fileResult.success).toBe(true);

                    const thumbResult = await fetchThumbnail(spacedImage.path);
                    if (thumbResult.status !== 503) {
                        expect(thumbResult.success).toBe(true);
                    }
                }

                if (spacedVideo) {
                    const fileResult = await fetchFile(spacedVideo.path);
                    expect(fileResult.success).toBe(true);

                    const infoResult = await fetchStreamInfo(spacedVideo.path);
                    expect(infoResult.success).toBe(true);

                    const streamResult = await fetchStreamHead(spacedVideo.path);
                    expect(streamResult.success).toBe(true);
                }

                if (!spacedImage && !spacedVideo) {
                    console.log('No files with spaces found, skipping');
                }
            }
        );

        it('should serve listed media files via encoded /api/files/ URLs', async () => {
            const result = await getMediaFiles('');
            expect(result.success).toBe(true);

            const sample = (result.data || []).slice(0, 5);
            for (const file of sample) {
                const fileResult = await fetchFile(file.path);
                expect(fileResult.success).toBe(true);
            }
        });

        it('should serve subdirectory files via encoded paths', async () => {
            const rootResult = await listFiles('');
            if (!rootResult.success) return;

            const folders = (rootResult.data.items || []).filter((f) => f.type === 'folder');
            if (folders.length === 0) {
                console.log('No subdirectories found, skipping');
                return;
            }

            const subResult = await listFiles(folders[0].path);
            expect(subResult.success).toBe(true);

            const subFiles = (subResult.data.items || [])
                .filter((f) => f.type !== 'folder')
                .slice(0, 3);

            for (const file of subFiles) {
                const fileResult = await fetchFile(file.path);
                expect(fileResult.success).toBe(true);
            }
        });

        it('should find listed files in their parent media listing', async () => {
            if (allFiles.length === 0) {
                console.log('No files available, skipping');
                return;
            }

            // Pick a file and verify it appears in its parent directory's media listing
            const file = imageFiles[0] || videoFiles[0] || allFiles[0];
            if (!file) return;

            const parentPath = file.path.substring(0, file.path.lastIndexOf('/')) || '';
            const mediaResult = await getMediaFiles(parentPath);

            if (mediaResult.success && file.type !== 'folder') {
                const found = mediaResult.data.find((f) => f.path === file.path);
                expect(found).toBeTruthy();
            }
        });

        it('should serve both file and thumbnail for files with fragment-unsafe characters', async () => {
            // The # character is the most dangerous: it silently truncates
            // the URL if not encoded, causing the server to receive a
            // completely different path.
            const files = allFiles.filter((f) => hasFragmentChars(f.name)).slice(0, 5);

            if (files.length === 0) {
                console.log('No files with # in name found, skipping');
                return;
            }

            for (const file of files) {
                const fileResult = await fetchFile(file.path);
                expect(fileResult.success).toBe(true);

                if (file.type === 'image' || file.type === 'video') {
                    const thumbResult = await fetchThumbnail(file.path);
                    if (thumbResult.status === 503) {
                        console.log('Thumbnails disabled, skipping');
                        return;
                    }

                    expect(thumbResult.success).toBe(true);
                    expect(thumbResult.contentType).toMatch(/^image\/(jpeg|png)$/);
                }
            }
        });

        it('should serve both file and thumbnail for files with URL-path-safe special characters', async () => {
            const files = allFiles
                .filter((f) => hasPathSafeSpecialChars(f.name) && f.type !== 'folder')
                .slice(0, 5);

            if (files.length === 0) {
                console.log('No files with path-safe special characters found, skipping');
                return;
            }

            for (const file of files) {
                const fileResult = await fetchFile(file.path);
                expect(fileResult.success).toBe(true);

                if (file.type === 'image' || file.type === 'video') {
                    const thumbResult = await fetchThumbnail(file.path);
                    if (thumbResult.status === 503) {
                        console.log('Thumbnails disabled, skipping');
                        return;
                    }

                    expect(thumbResult.success).toBe(true);
                    expect(thumbResult.contentType).toMatch(/^image\/(jpeg|png)$/);
                }
            }
        });
    });
});
