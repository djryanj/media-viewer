import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Breadcrumb from '$lib/components/gallery/Breadcrumb.svelte';
import type { PathPart } from '$lib/api/types';

vi.mock('$app/navigation', () => ({
    goto: vi.fn()
}));

import { goto } from '$app/navigation';

describe('Breadcrumb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders a home button with aria-label "Library root"', () => {
        render(Breadcrumb, { parts: [] });
        const home = screen.getByRole('button', { name: 'Library root' });
        expect(home).toBeTruthy();
    });

    it('renders no separators for empty parts', () => {
        const { container } = render(Breadcrumb, { parts: [] });
        const seps = container.querySelectorAll('.sep');
        expect(seps).toHaveLength(0);
    });

    it('renders part names as text', () => {
        const parts: PathPart[] = [
            { name: 'Photos', path: '/Photos' },
            { name: '2024', path: '/Photos/2024' }
        ];
        render(Breadcrumb, { parts });
        expect(screen.getByText('Photos')).toBeTruthy();
        expect(screen.getByText('2024')).toBeTruthy();
    });

    it('last part has aria-current="page" and is not a button', () => {
        const parts: PathPart[] = [
            { name: 'Photos', path: '/Photos' },
            { name: '2024', path: '/Photos/2024' }
        ];
        render(Breadcrumb, { parts });
        const current = screen.getByText('2024');
        expect(current.tagName.toLowerCase()).toBe('span');
        expect(current.getAttribute('aria-current')).toBe('page');
    });

    it('intermediate parts render as buttons', () => {
        const parts: PathPart[] = [
            { name: 'Photos', path: '/Photos' },
            { name: '2024', path: '/Photos/2024' }
        ];
        render(Breadcrumb, { parts });
        const photosEl = screen.getByText('Photos');
        expect(photosEl.tagName.toLowerCase()).toBe('button');
    });

    it('clicking home calls goto("/")', async () => {
        render(Breadcrumb, { parts: [] });
        const home = screen.getByRole('button', { name: 'Library root' });
        await fireEvent.click(home);
        expect(goto).toHaveBeenCalledWith('/');
    });

    it('clicking an intermediate part calls goto with the encoded path', async () => {
        const parts: PathPart[] = [
            { name: 'My Photos', path: '/My Photos' },
            { name: '2024', path: '/My Photos/2024' }
        ];
        render(Breadcrumb, { parts });
        const myPhotos = screen.getByText('My Photos');
        await fireEvent.click(myPhotos);
        expect(goto).toHaveBeenCalledWith(`/?path=${encodeURIComponent('/My Photos')}`);
    });

    it('renders a separator for each part', () => {
        const parts: PathPart[] = [
            { name: 'A', path: '/A' },
            { name: 'B', path: '/A/B' }
        ];
        const { container } = render(Breadcrumb, { parts });
        const seps = container.querySelectorAll('.sep');
        expect(seps).toHaveLength(2);
    });
});
