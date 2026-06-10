import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import SearchBar from '$lib/components/ui/SearchBar.svelte';
import type { SearchSuggestion } from '$lib/api/types';

const mockSuggest = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('$app/navigation', () => ({
    goto: vi.fn(),
}));

vi.mock('$lib/api/client', () => ({
    media: {
        suggest: mockSuggest,
    },
}));

import { goto } from '$app/navigation';

function makeSuggestion(name: string, type = 'image'): SearchSuggestion {
    return { path: `/${name}.jpg`, name, type, highlight: name };
}

describe('SearchBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a search input with the correct placeholder', () => {
        render(SearchBar);
        const input = screen.getByRole('combobox');
        expect(input).toBeTruthy();
        expect((input as HTMLInputElement).placeholder).toBe('Search files and tags…');
    });

    it('wraps the input in a search landmark', () => {
        render(SearchBar);
        const region = screen.getByRole('search');
        expect(region).toBeTruthy();
    });

    it('does not show the clear button when the query is empty', () => {
        render(SearchBar);
        const clearBtn = screen.queryByRole('button', { name: /clear search/i });
        expect(clearBtn).toBeNull();
    });

    it('shows the clear button once the user types', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox');
        await fireEvent.input(input, { target: { value: 'vacation' } });
        expect(screen.getByRole('button', { name: /clear search/i })).toBeTruthy();
    });

    it('clear button resets the input to empty', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'vacation' } });
        const clearBtn = screen.getByRole('button', { name: /clear search/i });
        await fireEvent.click(clearBtn);
        expect(input.value).toBe('');
        expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull();
    });

    it('submitting a non-empty query navigates to /search', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox');
        await fireEvent.input(input, { target: { value: 'nature' } });
        const form = input.closest('form')!;
        await fireEvent.submit(form);
        expect(goto).toHaveBeenCalledWith('/search?q=nature');
    });

    it('submitting an empty query does not navigate', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox');
        const form = input.closest('form')!;
        await fireEvent.submit(form);
        expect(goto).not.toHaveBeenCalled();
    });

    it('encodes special characters in the search query', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox');
        await fireEvent.input(input, { target: { value: 'beach & sun' } });
        const form = input.closest('form')!;
        await fireEvent.submit(form);
        expect(goto).toHaveBeenCalledWith('/search?q=beach%20%26%20sun');
    });

    it('pressing Escape clears the query', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'test' } });
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(input.value).toBe('');
    });

    it('fires the onclose callback when the query is submitted', async () => {
        const onclose = vi.fn();
        render(SearchBar, { props: { onclose } });
        const input = screen.getByRole('combobox');
        await fireEvent.input(input, { target: { value: 'query' } });
        const form = input.closest('form')!;
        await fireEvent.submit(form);
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('fires the onclose callback when Escape is pressed', async () => {
        const onclose = vi.fn();
        render(SearchBar, { props: { onclose } });
        const input = screen.getByRole('combobox');
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(onclose).toHaveBeenCalledOnce();
    });
});

describe('SearchBar — keyboard navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSuggest.mockResolvedValue([
            makeSuggestion('alpha'),
            makeSuggestion('beta'),
            makeSuggestion('gamma')
        ]);
    });

    it('ArrowDown highlights the first suggestion', async () => {
        const { container } = render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'a' } });
        await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input.getAttribute('aria-activedescendant')).toBe('sug-0');
        expect(container.querySelector('.suggestion-item.active')).toBeTruthy();
    });

    it('ArrowDown wraps from last to first', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'a' } });
        await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
        // Press down 3× to reach last, then one more to wrap
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input.getAttribute('aria-activedescendant')).toBe('sug-0');
    });

    it('ArrowUp from top wraps to last suggestion', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'a' } });
        await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
        await fireEvent.keyDown(input, { key: 'ArrowUp' });
        expect(input.getAttribute('aria-activedescendant')).toBe('sug-2');
    });

    it('Enter on highlighted suggestion navigates', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'a' } });
        await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        await fireEvent.keyDown(input, { key: 'Enter' });
        expect(goto).toHaveBeenCalledWith(expect.stringContaining('alpha'));
    });

    it('Escape first dismisses suggestions, second press calls onclose', async () => {
        const onclose = vi.fn();
        render(SearchBar, { props: { onclose } });
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'a' } });
        await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
        // First Escape: dismiss suggestions
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByText('alpha')).toBeNull();
        expect(onclose).not.toHaveBeenCalled();
        // Second Escape: clear + close
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(onclose).toHaveBeenCalledOnce();
    });

    it('typing resets the active suggestion index', async () => {
        render(SearchBar);
        const input = screen.getByRole('combobox') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: 'a' } });
        await waitFor(() => expect(screen.getByText('alpha')).toBeTruthy());
        await fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input.getAttribute('aria-activedescendant')).toBe('sug-0');
        // Typing should reset
        mockSuggest.mockResolvedValue([makeSuggestion('new')]);
        await fireEvent.input(input, { target: { value: 'ab' } });
        expect(input.getAttribute('aria-activedescendant')).toBeNull();
    });
});
