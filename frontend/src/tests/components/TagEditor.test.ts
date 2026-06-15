import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TagEditor from '$lib/components/ui/TagEditor.svelte';
import type { Tag } from '$lib/api/types';

vi.mock('$lib/api/client', () => ({
    tags: {
        list: vi.fn().mockResolvedValue([]),
        related: vi.fn().mockResolvedValue([])
    }
}));

function makeTag(name: string, itemCount = 1): Tag {
    return { id: 0, name, itemCount, createdAt: '' };
}

// Pre-seeded known tags used across most tests — avoids async list() load.
const knownTags = [
    makeTag('vacation', 5),
    makeTag('vacation-2024', 3),
    makeTag('vantage', 2),
    makeTag('nature', 8),
    makeTag('portrait', 4)
];

async function focusAndType(input: HTMLInputElement, value: string) {
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value } });
}

describe('TagEditor — chip rendering', () => {
    it('renders existing tags as chips', () => {
        render(TagEditor, { tags: ['nature', 'portrait'], onchange: vi.fn() });
        expect(screen.getByText('nature')).toBeTruthy();
        expect(screen.getByText('portrait')).toBeTruthy();
    });

    it('renders a remove button for each chip', () => {
        render(TagEditor, { tags: ['nature', 'portrait'], onchange: vi.fn() });
        expect(screen.getByRole('button', { name: 'Remove tag nature' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove tag portrait' })).toBeTruthy();
    });

    it('clicking the × button calls onchange without that tag', async () => {
        const onchange = vi.fn();
        render(TagEditor, { tags: ['nature', 'portrait'], onchange });
        await fireEvent.click(screen.getByRole('button', { name: 'Remove tag nature' }));
        expect(onchange).toHaveBeenCalledWith(['portrait']);
    });

    it('renders the placeholder when there are no tags', () => {
        const { container } = render(TagEditor, { tags: [], onchange: vi.fn() });
        const input = container.querySelector('input') as HTMLInputElement;
        expect(input.placeholder).toBe('Add tags…');
    });

    it('placeholder is empty when tags exist', () => {
        const { container } = render(TagEditor, { tags: ['nature'], onchange: vi.fn() });
        const input = container.querySelector('input') as HTMLInputElement;
        expect(input.placeholder).toBe('');
    });
});

describe('TagEditor — keyboard: adding tags', () => {
    beforeEach(() => vi.clearAllMocks());

    it('Enter adds inputValue as a new tag when no suggestion is highlighted', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'newcustom');
        await fireEvent.keyDown(input, { key: 'Enter' });
        expect(onchange).toHaveBeenCalledWith(['newcustom']);
    });

    it('comma adds inputValue as a new tag', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'newcustom');
        await fireEvent.keyDown(input, { key: ',' });
        expect(onchange).toHaveBeenCalledWith(['newcustom']);
    });

    it('does not add an empty tag on Enter', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange });
        const input = container.querySelector('input') as HTMLInputElement;
        await fireEvent.focus(input);
        await fireEvent.keyDown(input, { key: 'Enter' });
        expect(onchange).not.toHaveBeenCalled();
    });

    it('does not add a duplicate tag', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, {
            tags: ['nature'],
            onchange,
            allTags: knownTags
        });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'nature');
        await fireEvent.keyDown(input, { key: 'Enter' });
        expect(onchange).not.toHaveBeenCalled();
    });
});

describe('TagEditor — keyboard: Backspace', () => {
    it('Backspace on empty input removes the last tag', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, {
            tags: ['nature', 'portrait'],
            onchange
        });
        const input = container.querySelector('input') as HTMLInputElement;
        await fireEvent.focus(input);
        await fireEvent.keyDown(input, { key: 'Backspace' });
        expect(onchange).toHaveBeenCalledWith(['nature']);
    });

    it('Backspace does nothing when the input has text', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: ['nature'], onchange });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'nat');
        await fireEvent.keyDown(input, { key: 'Backspace' });
        expect(onchange).not.toHaveBeenCalled();
    });
});

describe('TagEditor — keyboard: Escape', () => {
    it('Escape clears the input value', async () => {
        const { container } = render(TagEditor, {
            tags: [],
            onchange: vi.fn(),
            allTags: knownTags
        });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'vac');
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.value).toBe('');
    });
});

describe('TagEditor — Tab completion (the fix)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('Tab completes the first suggestion when nothing is highlighted', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;

        // Type "vac" — matches "vacation" (first) and "vacation-2024"
        await focusAndType(input, 'vac');
        await fireEvent.keyDown(input, { key: 'Tab' });

        // Should complete "vacation" (top match), not add literal "vac"
        expect(onchange).toHaveBeenCalledWith(['vacation']);
    });

    it('Tab with ArrowDown selection completes the highlighted suggestion', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;

        await focusAndType(input, 'vac');
        // Arrow down once to highlight the second suggestion ("vacation-2024")
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        await fireEvent.keyDown(input, { key: 'Tab' });

        expect(onchange).toHaveBeenCalledWith(['vacation-2024']);
    });

    it('Tab does nothing (no prevent-default skip) when no suggestions are showing', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, {
            tags: [],
            onchange,
            allTags: knownTags
        });
        const input = container.querySelector('input') as HTMLInputElement;

        // Type something that matches nothing — no suggestions visible
        await focusAndType(input, 'zzznomatch');
        const tabEvent = new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(tabEvent);

        // onchange should not be called — Tab should pass through normally
        expect(onchange).not.toHaveBeenCalled();
        expect(tabEvent.defaultPrevented).toBe(false);
    });

    it('Tab is blocked (preventDefault) when suggestions are visible', async () => {
        const { container } = render(TagEditor, {
            tags: [],
            onchange: vi.fn(),
            allTags: knownTags
        });
        const input = container.querySelector('input') as HTMLInputElement;

        await focusAndType(input, 'vac');
        const tabEvent = new KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true
        });
        input.dispatchEvent(tabEvent);

        expect(tabEvent.defaultPrevented).toBe(true);
    });

    it('Enter still adds inputValue as-is when no suggestion highlighted (allows new tags)', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;

        // "vac" matches suggestions, but Enter with no highlight adds the literal input
        await focusAndType(input, 'vac');
        await fireEvent.keyDown(input, { key: 'Enter' });

        expect(onchange).toHaveBeenCalledWith(['vac']);
    });

    it('Enter completes the highlighted suggestion when one is selected', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;

        await focusAndType(input, 'vac');
        await fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight first ("vacation")
        await fireEvent.keyDown(input, { key: 'Enter' });

        expect(onchange).toHaveBeenCalledWith(['vacation']);
    });
});

describe('TagEditor — ArrowDown/Up navigation', () => {
    it('ArrowDown highlights the first suggestion', async () => {
        const { container } = render(TagEditor, {
            tags: [],
            onchange: vi.fn(),
            allTags: knownTags
        });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'vac');
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        const active = container.querySelector('.suggestion.active');
        expect(active).toBeTruthy();
    });

    it('ArrowUp from top does not go below -1', async () => {
        const onchange = vi.fn();
        const { container } = render(TagEditor, { tags: [], onchange, allTags: knownTags });
        const input = container.querySelector('input') as HTMLInputElement;
        await focusAndType(input, 'vac');
        await fireEvent.keyDown(input, { key: 'ArrowUp' });
        // Still no highlighted suggestion; Tab should complete first suggestion
        await fireEvent.keyDown(input, { key: 'Tab' });
        expect(onchange).toHaveBeenCalledWith(['vacation']);
    });
});

describe('TagEditor — ontagclick, onpaste, and focus()', () => {
    beforeEach(() => vi.clearAllMocks());

    it('chips get .clickable class when ontagclick is provided', () => {
        const { container } = render(TagEditor, {
            tags: ['nature'],
            onchange: vi.fn(),
            ontagclick: vi.fn()
        });
        expect(container.querySelector('.chip.clickable')).toBeTruthy();
    });

    it('clicking a chip calls ontagclick with the tag name', async () => {
        const ontagclick = vi.fn();
        const { container } = render(TagEditor, {
            tags: ['nature', 'portrait'],
            onchange: vi.fn(),
            ontagclick
        });
        await fireEvent.click(container.querySelector('.chip') as HTMLElement);
        expect(ontagclick).toHaveBeenCalledWith('nature');
    });

    it('onpaste override is called with clipboard content instead of merging', async () => {
        // Populate the module-level clipboard via copy action in a first instance
        const { container: c1 } = render(TagEditor, {
            tags: ['sunset', 'beach'],
            onchange: vi.fn()
        });
        await fireEvent.click(c1.querySelector('[aria-label="Copy tags"]') as HTMLElement);

        // Second instance with onpaste override receives the clipboard
        const onpaste = vi.fn();
        const { container: c2 } = render(TagEditor, {
            tags: [],
            onchange: vi.fn(),
            onpaste
        });
        await fireEvent.click(c2.querySelector('[aria-label="Paste tags"]') as HTMLElement);
        expect(onpaste).toHaveBeenCalledWith(['sunset', 'beach']);
    });

    it('exported focus() focuses the tag input', () => {
        const { component, container } = render(TagEditor, { tags: [], onchange: vi.fn() });
        const input = container.querySelector('input') as HTMLInputElement;
        (component as unknown as { focus: () => void }).focus();
        expect(document.activeElement).toBe(input);
    });
});
