import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TagEditor from '$lib/components/ui/TagEditor.svelte';
import type { Tag } from '$lib/api/types';

vi.mock('$lib/api/client', () => ({
    tags: {
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([])
    }
}));

function makeTag(name: string): Tag {
    return { id: 0, name, itemCount: 1, createdAt: '' };
}

const knownTags = ['vacation', 'nature', 'portrait', 'city', 'travel'].map(makeTag);

describe('TagEditor — recent tags localStorage persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('saves a tag to localStorage when added', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;
        await fireEvent.focus(input);
        await fireEvent.input(input, { target: { value: 'vacation' } });
        await fireEvent.keyDown(input, { key: 'Tab' });

        const stored = JSON.parse(
            localStorage.getItem('mediaViewerRecentTags') ?? '[]'
        ) as string[];
        expect(stored).toContain('vacation');
    });

    it('persists the most-recently-used tag first', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;

        // Add 'nature' then 'vacation'
        await fireEvent.focus(input);
        await fireEvent.input(input, { target: { value: 'nature' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        await fireEvent.input(input, { target: { value: 'vacation' } });
        await fireEvent.keyDown(input, { key: 'Tab' });

        const stored = JSON.parse(
            localStorage.getItem('mediaViewerRecentTags') ?? '[]'
        ) as string[];
        expect(stored[0]).toBe('vacation');
        expect(stored[1]).toBe('nature');
    });

    it('loads persisted recent tags from localStorage on mount', async () => {
        // Pre-seed localStorage
        localStorage.setItem('mediaViewerRecentTags', JSON.stringify(['travel', 'city']));

        const { container } = render(TagEditor, {
            tags: [],
            onchange: vi.fn(),
            allTags: knownTags
        });
        const input = container.querySelector('input') as HTMLInputElement;

        // Focus without typing — should show recents in suggestions
        await fireEvent.focus(input);
        // The suggestions dropdown should include the seeded recent tag
        const suggestions = container.querySelectorAll('.suggestion');
        const names = [...suggestions].map((s) => s.textContent?.trim() ?? '');
        expect(names.some((n) => n.includes('travel') || n.includes('city'))).toBe(true);
    });

    it('limits stored recents to 10 entries', async () => {
        const manyTags = Array.from({ length: 12 }, (_, i) => makeTag(`tag${i}`));
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: manyTags });
        const input = container.querySelector('input') as HTMLInputElement;

        // Add 12 tags one by one
        for (let i = 0; i < 12; i++) {
            await fireEvent.focus(input);
            await fireEvent.input(input, { target: { value: `tag${i}` } });
            await fireEvent.keyDown(input, { key: 'Enter' });
        }

        const stored = JSON.parse(
            localStorage.getItem('mediaViewerRecentTags') ?? '[]'
        ) as string[];
        expect(stored.length).toBeLessThanOrEqual(10);
    });

    it('deduplicates: re-adding a recent tag moves it to the front', async () => {
        localStorage.setItem('mediaViewerRecentTags', JSON.stringify(['nature', 'vacation']));
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;

        // Re-add 'nature'
        await fireEvent.focus(input);
        await fireEvent.input(input, { target: { value: 'nature' } });
        await fireEvent.keyDown(input, { key: 'Enter' });

        const stored = JSON.parse(
            localStorage.getItem('mediaViewerRecentTags') ?? '[]'
        ) as string[];
        expect(stored[0]).toBe('nature');
        // 'vacation' still present but not duplicated
        expect(stored.filter((t) => t === 'nature').length).toBe(1);
    });
});
