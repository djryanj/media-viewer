<script lang="ts">
    import { auth, tags as tagsApi, system, version as versionApi } from '$lib/api/client';
    import type { Tag, SystemStatus, BuildInfo } from '$lib/api/types';
    import {
        isWebAuthnSupported,
        prepareCreateOptions,
        serializeCreateCredential
    } from '$lib/utils/webauthn';
    import { toastStore } from '$lib/stores/toast.svelte';
    import { settingsStore } from '$lib/stores/settings.svelte';
    import { galleryStore } from '$lib/stores/gallery.svelte';

    function close() {
        settingsStore.hide();
    }

    function handleBackdrop(e: MouseEvent) {
        if (e.target === e.currentTarget) close();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') close();
    }

    // ── Tabs ─────────────────────────────────────────────────────────────────
    type Tab = 'security' | 'passkeys' | 'library' | 'tags' | 'system' | 'about';
    let activeTab = $state<Tab>('security');
    const webauthnSupported = isWebAuthnSupported();

    // Reset state when reopened
    $effect(() => {
        if (settingsStore.open) {
            activeTab = 'security';
            prefSortField = (loadPrefs().sortField as string) ?? 'name';
            prefSortOrder = (loadPrefs().sortOrder as string) ?? 'asc';
            prefVideoAutoplay = (loadPrefs().videoAutoplay as boolean) ?? true;
            prefMediaLoop = (loadPrefs().mediaLoop as boolean) ?? true;
            prefClockEnabled = (loadPrefs().clockEnabled as boolean) ?? true;
            prefClockFormat = (loadPrefs().clockFormat as string) === '24' ? '24' : '12';
            prefClockAlwaysVisible = (loadPrefs().clockAlwaysVisible as boolean) ?? false;
            // Reset passkey state so the list reloads on next visit to that tab
            passkeys = [];
            passkeysHaveBeenLoaded = false;
            newPasskeyName = derivePasskeyName();
        }
    });

    // ── Password change ──────────────────────────────────────────────────────
    let currentPassword = $state('');
    let newPassword = $state('');
    let confirmPassword = $state('');
    let pwLoading = $state(false);

    async function handlePasswordChange(e: SubmitEvent) {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toastStore.error('New passwords do not match');
            return;
        }
        if (newPassword.length < 6) {
            toastStore.error('New password must be at least 6 characters');
            return;
        }
        pwLoading = true;
        try {
            await auth.changePassword(currentPassword, newPassword);
            toastStore.success('Password updated');
            currentPassword = '';
            newPassword = '';
            confirmPassword = '';
        } catch (err) {
            toastStore.error(err instanceof Error ? err.message : 'Failed to change password');
        } finally {
            pwLoading = false;
        }
    }

    // ── Library preferences (localStorage) ──────────────────────────────────
    const PREFS_KEY = 'mediaViewerPreferences';

    function loadPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw) return JSON.parse(raw) as Record<string, unknown>;
        } catch {
            /* ignore */
        }
        return {};
    }

    function savePrefs(patch: Record<string, unknown>) {
        const prefs = { ...loadPrefs(), ...patch };
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    }

    let prefSortField = $state((loadPrefs().sortField as string) ?? 'name');
    let prefSortOrder = $state((loadPrefs().sortOrder as string) ?? 'asc');
    let prefVideoAutoplay = $state((loadPrefs().videoAutoplay as boolean) ?? true);
    let prefMediaLoop = $state((loadPrefs().mediaLoop as boolean) ?? true);
    let prefClockEnabled = $state((loadPrefs().clockEnabled as boolean) ?? true);
    let prefClockFormat = $state<'12' | '24'>(
        (loadPrefs().clockFormat as string) === '24' ? '24' : '12'
    );
    let prefClockAlwaysVisible = $state((loadPrefs().clockAlwaysVisible as boolean) ?? false);

    function saveLibraryPrefs() {
        savePrefs({
            sortField: prefSortField,
            sortOrder: prefSortOrder,
            videoAutoplay: prefVideoAutoplay,
            mediaLoop: prefMediaLoop,
            clockEnabled: prefClockEnabled,
            clockFormat: prefClockFormat,
            clockAlwaysVisible: prefClockAlwaysVisible
        });
        // Sync the live gallery store so the change takes effect immediately.
        galleryStore.setSort(
            prefSortField as 'name' | 'size' | 'date',
            prefSortOrder as 'asc' | 'desc'
        );
        window.dispatchEvent(new Event('clockPreferenceChanged'));
        toastStore.success('Preferences saved');
    }

    // ── Tags manager ─────────────────────────────────────────────────────────
    let allTags: Tag[] = $state([]);
    let tagsLoading = $state(false);
    let tagSearch = $state('');
    let renamingTag = $state<string | null>(null);
    let renameValue = $state('');

    const filteredTags = $derived(
        tagSearch.trim()
            ? allTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
            : allTags
    );

    async function loadTags() {
        tagsLoading = true;
        try {
            allTags = await tagsApi.list();
        } catch {
            toastStore.error('Failed to load tags');
        } finally {
            tagsLoading = false;
        }
    }

    function startRename(tag: Tag) {
        renamingTag = tag.name;
        renameValue = tag.name;
    }

    async function commitRename(oldName: string) {
        const newName = renameValue.trim();
        if (!newName || newName === oldName) {
            renamingTag = null;
            return;
        }
        try {
            await tagsApi.rename(oldName, newName);
            toastStore.success(`Tag renamed to "${newName}"`);
            await loadTags();
        } catch (err) {
            toastStore.error(err instanceof Error ? err.message : 'Rename failed');
        } finally {
            renamingTag = null;
        }
    }

    async function deleteTag(name: string) {
        if (!confirm(`Delete tag "${name}" from all files? This cannot be undone.`)) return;
        try {
            await tagsApi.delete(name);
            toastStore.success(`Tag "${name}" deleted`);
            allTags = allTags.filter((t) => t.name !== name);
        } catch (err) {
            toastStore.error(err instanceof Error ? err.message : 'Delete failed');
        }
    }

    // ── Passkeys ─────────────────────────────────────────────────────────────
    interface Passkey {
        id: number;
        name: string;
        createdAt: string;
        lastUsedAt?: string;
    }
    let passkeys: Passkey[] = $state([]);
    let passkeysLoading = $state(false);
    let passkeyRegLoading = $state(false);
    // Tracks whether we've completed at least one load attempt this modal session.
    // Without this, the auto-load $effect loops forever when the passkey list is
    // empty: loadPasskeys() returns [] → length===0 still true → fires again.
    let passkeysHaveBeenLoaded = $state(false);

    function derivePasskeyName(): string {
        if (typeof navigator === 'undefined') return 'My Passkey';
        const ua = navigator.userAgent;
        if (/iPhone/i.test(ua)) return 'iPhone';
        if (/iPad/i.test(ua)) return 'iPad';
        if (/Android/i.test(ua)) return /Mobile/.test(ua) ? 'Android Phone' : 'Android Tablet';
        const platform = navigator.platform ?? '';
        if (/Mac/.test(platform)) return 'Mac';
        if (/Win/.test(platform)) return 'Windows PC';
        if (/Linux/.test(platform)) return 'Linux';
        return 'My Passkey';
    }

    let newPasskeyName = $state(derivePasskeyName());

    async function loadPasskeys() {
        passkeysLoading = true;
        try {
            passkeys = await auth.listPasskeys();
        } catch {
            toastStore.error('Failed to load passkeys');
        } finally {
            passkeysLoading = false;
            passkeysHaveBeenLoaded = true;
        }
    }

    async function registerPasskey() {
        if (passkeyRegLoading || !webauthnSupported) return;
        const name = newPasskeyName.trim();
        if (!name) {
            toastStore.error('Please enter a name for this passkey');
            return;
        }
        passkeyRegLoading = true;
        try {
            const { options, sessionId } = await auth.webauthnRegisterBegin();
            const publicKey = prepareCreateOptions(options.publicKey);
            const cred = (await navigator.credentials.create({
                publicKey
            })) as PublicKeyCredential | null;
            if (!cred) return;
            // Call finish with the credential serialized; name is passed via JSON body
            await fetch('/api/auth/webauthn/register/finish', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    name,
                    credential: serializeCreateCredential(cred)
                })
            }).then((r) => {
                if (!r.ok) throw new Error('Registration failed');
            });
            toastStore.success('Passkey registered');
            newPasskeyName = derivePasskeyName();
            await loadPasskeys();
        } catch (err) {
            if ((err as Error)?.name === 'NotAllowedError') {
                toastStore.error('Registration cancelled');
            } else if ((err as Error)?.name === 'InvalidStateError') {
                toastStore.error('This authenticator is already registered');
            } else {
                toastStore.error((err as Error)?.message || 'Passkey registration failed');
            }
        } finally {
            passkeyRegLoading = false;
        }
    }

    async function deletePasskey(id: number) {
        if (!confirm('Remove this passkey? You will no longer be able to use it to sign in.'))
            return;
        try {
            await auth.deletePasskey(id);
            toastStore.success('Passkey removed');
            passkeys = passkeys.filter((p) => p.id !== id);
        } catch {
            toastStore.error('Failed to remove passkey');
        }
    }

    // Load passkeys lazily when the tab becomes active for the first time this
    // modal session. passkeysHaveBeenLoaded prevents re-triggering when the
    // list is empty (otherwise returning [] keeps the condition true and loops).
    $effect(() => {
        if (
            webauthnSupported &&
            activeTab === 'passkeys' &&
            settingsStore.open &&
            !passkeysHaveBeenLoaded &&
            !passkeysLoading
        ) {
            loadPasskeys();
        }
    });

    // ── System actions ───────────────────────────────────────────────────────
    let systemLoading = $state<string | null>(null);

    async function runSystemAction(key: string, fn: () => Promise<unknown>, successMsg: string) {
        systemLoading = key;
        try {
            await fn();
            toastStore.success(successMsg);
        } catch (err) {
            toastStore.error(err instanceof Error ? err.message : 'Action failed');
        } finally {
            systemLoading = null;
        }
    }

    // ── System live status polling ────────────────────────────────────────────
    let systemStatus = $state<SystemStatus | null>(null);
    let statusPollTimer: ReturnType<typeof setInterval> | null = null;

    function startStatusPolling() {
        if (statusPollTimer) return;
        async function poll() {
            try {
                systemStatus = await system.status();
            } catch {
                /* ignore */
            }
        }
        poll();
        statusPollTimer = setInterval(poll, 3000);
    }

    function stopStatusPolling() {
        if (statusPollTimer) {
            clearInterval(statusPollTimer);
            statusPollTimer = null;
        }
    }

    $effect(() => {
        if ((activeTab === 'system' || activeTab === 'about') && settingsStore.open) {
            startStatusPolling();
        } else {
            stopStatusPolling();
        }
        return () => stopStatusPolling();
    });

    // ── About tab ─────────────────────────────────────────────────────────────
    let buildInfo = $state<BuildInfo | null>(null);
    let buildInfoLoading = $state(false);

    $effect(() => {
        if (activeTab === 'about' && settingsStore.open && !buildInfo && !buildInfoLoading) {
            buildInfoLoading = true;
            versionApi
                .get()
                .then((b) => {
                    buildInfo = b;
                })
                .catch(() => {})
                .finally(() => {
                    buildInfoLoading = false;
                });
        }
    });

    // ── Helpers ───────────────────────────────────────────────────────────────
    function fmtBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function fmtETA(secs: number | undefined): string {
        if (!secs || secs <= 0) return '';
        if (secs < 60) return `~${Math.round(secs)}s`;
        return `~${Math.round(secs / 60)}m`;
    }

    function workerState(w: SystemStatus['indexer'] | undefined): 'running' | 'idle' | 'disabled' {
        if (!w || !w.summary.enabled) return 'disabled';
        return w.summary.running ? 'running' : 'idle';
    }

    // Load tags lazily when that tab becomes active (and modal is open)
    $effect(() => {
        if (activeTab === 'tags' && settingsStore.open && allTags.length === 0 && !tagsLoading) {
            loadTags();
        }
    });
</script>

{#if settingsStore.open}
    <div
        class="overlay"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="Settings"
        onclick={handleBackdrop}
        onkeydown={handleKeydown}
    >
        <div class="modal">
            <!-- Modal header -->
            <div class="modal-header">
                <h2 class="modal-title">Settings</h2>
                <button class="close-btn" onclick={close} aria-label="Close settings">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Tab bar -->
            <div class="tabs" role="tablist">
                {#each [['security', 'Security'], ['passkeys', 'Passkeys'], ['library', 'Library'], ['tags', 'Tags'], ['system', 'System'], ['about', 'About']] as [Tab, string][] as [id, label]}
                    <button
                        class="tab"
                        class:active={activeTab === id}
                        role="tab"
                        aria-selected={activeTab === id}
                        onclick={() => (activeTab = id)}>{label}</button
                    >
                {/each}
            </div>

            <!-- Scrollable content -->
            <div class="modal-body">
                <!-- Security -->
                {#if activeTab === 'security'}
                    <section class="settings-section">
                        <h3 class="section-title">Change password</h3>
                        <form class="form" onsubmit={handlePasswordChange}>
                            <div class="field">
                                <label for="current-pw">Current password</label>
                                <input
                                    id="current-pw"
                                    type="password"
                                    bind:value={currentPassword}
                                    autocomplete="current-password"
                                    required
                                />
                            </div>
                            <div class="field">
                                <label for="new-pw">New password</label>
                                <input
                                    id="new-pw"
                                    type="password"
                                    bind:value={newPassword}
                                    autocomplete="new-password"
                                    minlength="6"
                                    required
                                />
                            </div>
                            <div class="field">
                                <label for="confirm-pw">Confirm new password</label>
                                <input
                                    id="confirm-pw"
                                    type="password"
                                    bind:value={confirmPassword}
                                    autocomplete="new-password"
                                    minlength="6"
                                    required
                                />
                            </div>
                            <button class="btn-primary" type="submit" disabled={pwLoading}>
                                {pwLoading ? 'Saving…' : 'Change password'}
                            </button>
                        </form>
                    </section>

                    <!-- Passkeys -->
                {:else if activeTab === 'passkeys'}
                    {#if !webauthnSupported}
                        <section class="settings-section">
                            <h3 class="section-title">Passkeys not available</h3>
                            <p class="section-desc">
                                Passkeys require a secure context (HTTPS or localhost). Access this
                                app via HTTPS to enable passkey authentication.
                            </p>
                        </section>
                    {:else}
                        <section class="settings-section">
                            <h3 class="section-title">Registered passkeys</h3>
                            <p class="section-desc">
                                Passkeys let you sign in using your device's biometrics or PIN
                                instead of a password.
                            </p>

                            {#if passkeysLoading}
                                <p class="muted">Loading passkeys…</p>
                            {:else if passkeys.length === 0}
                                <p class="muted">No passkeys registered yet.</p>
                            {:else}
                                <ul class="passkey-list">
                                    {#each passkeys as pk (pk.id)}
                                        <li class="passkey-item">
                                            <div class="passkey-info">
                                                <svg
                                                    class="passkey-ico"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    aria-hidden="true"
                                                >
                                                    <circle cx="8" cy="15" r="4" />
                                                    <path d="m12 15 5-5" />
                                                    <path d="m17 10 2-2" />
                                                    <path d="m15 12 2 2" />
                                                </svg>
                                                <div>
                                                    <span class="passkey-name">{pk.name}</span>
                                                    <span class="passkey-date"
                                                        >Added {new Date(
                                                            pk.createdAt
                                                        ).toLocaleDateString()}</span
                                                    >
                                                </div>
                                            </div>
                                            <button
                                                class="action-btn danger"
                                                onclick={() => deletePasskey(pk.id)}>Remove</button
                                            >
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        </section>

                        <section class="settings-section">
                            <h3 class="section-title">Add a passkey</h3>
                            <div class="form">
                                <div class="field">
                                    <label for="passkey-name">Passkey name</label>
                                    <input
                                        id="passkey-name"
                                        type="text"
                                        bind:value={newPasskeyName}
                                        placeholder="e.g. MacBook Touch ID"
                                        maxlength="50"
                                        required
                                    />
                                </div>
                                <button
                                    class="btn-primary"
                                    onclick={registerPasskey}
                                    disabled={passkeyRegLoading}
                                >
                                    {passkeyRegLoading ? 'Registering…' : 'Add passkey'}
                                </button>
                            </div>
                        </section>
                    {/if}

                    <!-- Library -->
                {:else if activeTab === 'library'}
                    <section class="settings-section">
                        <h3 class="section-title">Default sort order</h3>
                        <p class="section-desc">
                            Applied when opening a folder for the first time.
                        </p>
                        <div class="form">
                            <div class="field">
                                <label for="sort-field">Sort by</label>
                                <select id="sort-field" bind:value={prefSortField}>
                                    <option value="name">Name</option>
                                    <option value="date">Date modified</option>
                                    <option value="size">File size</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="sort-order">Direction</label>
                                <select id="sort-order" bind:value={prefSortOrder}>
                                    <option value="asc">Ascending</option>
                                    <option value="desc">Descending</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    <section class="settings-section">
                        <h3 class="section-title">Playback</h3>
                        <div class="toggle-row">
                            <div>
                                <span class="toggle-label">Autoplay videos</span>
                                <span class="toggle-desc"
                                    >Automatically play videos when opened in the lightbox</span
                                >
                            </div>
                            <label class="switch" aria-label="Autoplay videos">
                                <input type="checkbox" bind:checked={prefVideoAutoplay} />
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="toggle-row">
                            <div>
                                <span class="toggle-label">Loop media</span>
                                <span class="toggle-desc"
                                    >Repeat videos and images when reaching the end</span
                                >
                            </div>
                            <label class="switch" aria-label="Loop media">
                                <input type="checkbox" bind:checked={prefMediaLoop} />
                                <span class="slider"></span>
                            </label>
                        </div>
                    </section>

                    <section class="settings-section">
                        <h3 class="section-title">Clock</h3>
                        <div class="toggle-row">
                            <div>
                                <span class="toggle-label">Show clock in lightbox</span>
                                <span class="toggle-desc"
                                    >Display the current time in the top bar while viewing media</span
                                >
                            </div>
                            <label class="switch" aria-label="Show clock in lightbox">
                                <input type="checkbox" bind:checked={prefClockEnabled} />
                                <span class="slider"></span>
                            </label>
                        </div>
                        {#if prefClockEnabled}
                            <div class="form" style="margin-top: var(--spacing-3)">
                                <div class="field">
                                    <label for="clock-format">Format</label>
                                    <select id="clock-format" bind:value={prefClockFormat}>
                                        <option value="12">12-hour (e.g. 3:45 PM)</option>
                                        <option value="24">24-hour (e.g. 15:45)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="toggle-row" style="margin-top: var(--spacing-3)">
                                <div>
                                    <span class="toggle-label">Always keep clock visible</span>
                                    <span class="toggle-desc"
                                        >Keep clock visible even when other controls fade out</span
                                    >
                                </div>
                                <label class="switch" aria-label="Always keep clock visible">
                                    <input type="checkbox" bind:checked={prefClockAlwaysVisible} />
                                    <span class="slider"></span>
                                </label>
                            </div>
                        {/if}
                        <button class="btn-primary" onclick={saveLibraryPrefs}
                            >Save preferences</button
                        >
                    </section>

                    <!-- Tags -->
                {:else if activeTab === 'tags'}
                    <section class="settings-section">
                        <h3 class="section-title">Tag manager</h3>
                        <div class="tag-toolbar">
                            <input
                                class="search-input"
                                type="search"
                                placeholder="Filter tags…"
                                bind:value={tagSearch}
                                aria-label="Filter tags"
                            />
                            <button class="btn-ghost" onclick={loadTags} disabled={tagsLoading}>
                                {tagsLoading ? 'Loading…' : 'Refresh'}
                            </button>
                        </div>

                        {#if tagsLoading}
                            <p class="muted">Loading tags…</p>
                        {:else if filteredTags.length === 0}
                            <p class="muted">
                                {tagSearch ? 'No tags match your search.' : 'No tags yet.'}
                            </p>
                        {:else}
                            <table class="tag-table">
                                <thead>
                                    <tr>
                                        <th>Tag</th>
                                        <th class="num">Files</th>
                                        <th class="actions-col"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each filteredTags as tag (tag.name)}
                                        <tr>
                                            <td>
                                                {#if renamingTag === tag.name}
                                                    <input
                                                        class="rename-input"
                                                        type="text"
                                                        bind:value={renameValue}
                                                        onkeydown={(e) => {
                                                            if (e.key === 'Enter')
                                                                commitRename(tag.name);
                                                            if (e.key === 'Escape')
                                                                renamingTag = null;
                                                        }}
                                                    />
                                                {:else}
                                                    <span class="tag-chip">{tag.name}</span>
                                                {/if}
                                            </td>
                                            <td class="num">{tag.itemCount}</td>
                                            <td class="actions-col">
                                                {#if renamingTag === tag.name}
                                                    <button
                                                        class="action-btn save"
                                                        onclick={() => commitRename(tag.name)}
                                                        >Save</button
                                                    >
                                                    <button
                                                        class="action-btn cancel"
                                                        onclick={() => (renamingTag = null)}
                                                        >Cancel</button
                                                    >
                                                {:else}
                                                    <button
                                                        class="action-btn"
                                                        onclick={() => startRename(tag)}
                                                        >Rename</button
                                                    >
                                                    <button
                                                        class="action-btn danger"
                                                        onclick={() => deleteTag(tag.name)}
                                                        >Delete</button
                                                    >
                                                {/if}
                                            </td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        {/if}
                    </section>

                    <!-- System -->
                {:else if activeTab === 'system'}
                    <section class="settings-section">
                        <h3 class="section-title">Worker status</h3>
                        <div class="worker-list">
                            {#each [['Indexer', systemStatus?.indexer], ['Thumbnails', systemStatus?.thumbnails], ['Auto-tagger', systemStatus?.autotagger]] as [string, SystemStatus['indexer'] | undefined][] as [label, w]}
                                {@const state = workerState(w)}
                                {@const pct = w?.metrics.progressPercent}
                                {@const eta = w?.metrics.estimatedSecondsRemaining}
                                <div class="worker-row">
                                    <span class="worker-name">{label}</span>
                                    <span class="worker-badge worker-badge--{state}">
                                        {state === 'running'
                                            ? 'Running'
                                            : state === 'idle'
                                              ? 'Idle'
                                              : 'Disabled'}
                                    </span>
                                    {#if state === 'running' && pct != null}
                                        <span class="worker-progress">
                                            {Math.round(pct)}%{eta ? ' · ' + fmtETA(eta) : ''}
                                        </span>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </section>

                    <section class="settings-section">
                        <h3 class="section-title">Cache</h3>
                        {#if systemStatus}
                            <div class="stat-list">
                                <div class="stat-row">
                                    <span class="stat-label">Thumbnails</span>
                                    <span class="stat-value"
                                        >{systemStatus.library.thumbnailCacheFiles.toLocaleString()} files
                                        · {fmtBytes(systemStatus.library.thumbnailCacheBytes)}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Transcode</span>
                                    <span class="stat-value"
                                        >{systemStatus.library.transcodeCacheFiles.toLocaleString()} files
                                        · {fmtBytes(systemStatus.library.transcodeCacheBytes)}</span
                                    >
                                </div>
                            </div>
                        {:else}
                            <p class="muted">Loading…</p>
                        {/if}
                    </section>

                    <section class="settings-section">
                        <h3 class="section-title">Library maintenance</h3>
                        <div class="action-list">
                            <div class="action-row">
                                <div>
                                    <span class="action-label">Reindex library</span>
                                    <span class="action-desc">Scan for new and changed files</span>
                                </div>
                                <button
                                    class="btn-ghost"
                                    disabled={systemLoading === 'reindex'}
                                    onclick={() =>
                                        runSystemAction(
                                            'reindex',
                                            system.reindex,
                                            'Reindex started'
                                        )}
                                    >{systemLoading === 'reindex' ? 'Starting…' : 'Run now'}</button
                                >
                            </div>
                            <div class="action-row">
                                <div>
                                    <span class="action-label">Rebuild thumbnails</span>
                                    <span class="action-desc">Regenerate all thumbnail images</span>
                                </div>
                                <button
                                    class="btn-ghost"
                                    disabled={systemLoading === 'thumbs'}
                                    onclick={() =>
                                        runSystemAction(
                                            'thumbs',
                                            system.rebuildThumbnails,
                                            'Thumbnail rebuild started'
                                        )}
                                    >{systemLoading === 'thumbs' ? 'Starting…' : 'Rebuild'}</button
                                >
                            </div>
                            <div class="action-row">
                                <div>
                                    <span class="action-label">Clear transcode cache</span>
                                    <span class="action-desc">Delete cached HLS video segments</span
                                    >
                                </div>
                                <button
                                    class="btn-danger"
                                    disabled={systemLoading === 'transcode'}
                                    onclick={() =>
                                        runSystemAction(
                                            'transcode',
                                            system.clearTranscodeCache,
                                            'Transcode cache cleared'
                                        )}
                                    >{systemLoading === 'transcode'
                                        ? 'Clearing…'
                                        : 'Clear cache'}</button
                                >
                            </div>
                            <div class="action-row">
                                <div>
                                    <span class="action-label">Run auto-tagger</span>
                                    <span class="action-desc"
                                        >Extract EXIF metadata tags from files</span
                                    >
                                </div>
                                <button
                                    class="btn-ghost"
                                    disabled={systemLoading === 'autotag'}
                                    onclick={() =>
                                        runSystemAction(
                                            'autotag',
                                            system.runAutoTagger,
                                            'Auto-tagger started'
                                        )}
                                    >{systemLoading === 'autotag' ? 'Starting…' : 'Run now'}</button
                                >
                            </div>
                        </div>
                    </section>

                    <!-- About -->
                {:else if activeTab === 'about'}
                    <section class="settings-section">
                        <h3 class="section-title">Version</h3>
                        {#if buildInfoLoading}
                            <p class="muted">Loading…</p>
                        {:else if buildInfo}
                            <div class="stat-list">
                                <div class="stat-row">
                                    <span class="stat-label">Version</span>
                                    <span class="stat-value">{buildInfo.version}</span>
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Commit</span>
                                    <span class="stat-value about-mono"
                                        >{buildInfo.commit.slice(0, 7)}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Runtime</span>
                                    <span class="stat-value"
                                        >{buildInfo.goVersion} · {buildInfo.os}/{buildInfo.arch}</span
                                    >
                                </div>
                            </div>
                        {/if}
                    </section>

                    <section class="settings-section">
                        <h3 class="section-title">Library</h3>
                        {#if systemStatus}
                            {@const lib = systemStatus.library}
                            <div class="stat-list">
                                <div class="stat-row">
                                    <span class="stat-label">Total files</span>
                                    <span class="stat-value">{lib.totalFiles.toLocaleString()}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Images</span>
                                    <span class="stat-value"
                                        >{lib.totalImages.toLocaleString()}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Videos</span>
                                    <span class="stat-value"
                                        >{lib.totalVideos.toLocaleString()}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Folders</span>
                                    <span class="stat-value"
                                        >{lib.totalFolders.toLocaleString()}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Playlists</span>
                                    <span class="stat-value"
                                        >{lib.totalPlaylists.toLocaleString()}</span
                                    >
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Tags</span>
                                    <span class="stat-value">{lib.totalTags.toLocaleString()}</span>
                                </div>
                                <div class="stat-row">
                                    <span class="stat-label">Favorites</span>
                                    <span class="stat-value"
                                        >{lib.totalFavorites.toLocaleString()}</span
                                    >
                                </div>
                                {#if lib.lastIndexed}
                                    <div class="stat-row">
                                        <span class="stat-label">Last indexed</span>
                                        <span class="stat-value"
                                            >{new Date(lib.lastIndexed).toLocaleString()}</span
                                        >
                                    </div>
                                {/if}
                            </div>
                        {:else}
                            <p class="muted">Loading…</p>
                        {/if}
                    </section>
                {/if}
            </div>
            <!-- /.modal-body -->
        </div>
        <!-- /.modal -->
    </div>
    <!-- /.overlay -->
{/if}

<style>
    /* ── Overlay / backdrop ─────────────────────────────────────────────── */
    .overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-4);
    }

    /* ── Modal panel ────────────────────────────────────────────────────── */
    .modal {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        width: 100%;
        max-width: 560px;
        max-height: calc(100dvh - var(--spacing-8));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    /* ── Header row ─────────────────────────────────────────────────────── */
    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-4) var(--spacing-5);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .modal-title {
        font-size: var(--text-lg);
        font-weight: 600;
        color: var(--color-text);
        margin: 0;
    }

    .close-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: var(--radius-md);
        color: var(--color-text-muted);
        cursor: pointer;
        transition:
            background var(--transition-fast),
            color var(--transition-fast);
    }

    .close-btn:hover {
        background: var(--color-surface-2);
        color: var(--color-text);
    }

    .close-btn svg {
        width: 18px;
        height: 18px;
    }

    /* ── Tabs ───────────────────────────────────────────────────────────── */
    .tabs {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid var(--color-border);
        padding: 0 var(--spacing-5);
        flex-shrink: 0;
        overflow-x: auto;
        scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
        display: none;
    }

    .tab {
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        padding: var(--spacing-2) var(--spacing-3);
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--color-text-muted);
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition:
            color var(--transition-fast),
            border-color var(--transition-fast);
    }

    .tab:hover {
        color: var(--color-text);
    }

    .tab.active {
        color: var(--color-primary);
        border-bottom-color: var(--color-primary);
    }

    /* ── Scrollable body ────────────────────────────────────────────────── */
    .modal-body {
        overflow-y: auto;
        padding: var(--spacing-5);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-4);
    }

    /* ── Section cards ──────────────────────────────────────────────────── */
    .settings-section {
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--spacing-4) var(--spacing-5);
    }

    .section-title {
        font-size: var(--text-sm);
        font-weight: 600;
        color: var(--color-text);
        margin: 0 0 var(--spacing-1);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .section-desc {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        margin: 0 0 var(--spacing-4);
    }

    .muted {
        font-size: var(--text-sm);
        color: var(--color-text-muted);
        padding: var(--spacing-3) 0;
        margin: 0;
    }

    /* ── Form ───────────────────────────────────────────────────────────── */
    .form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-3);
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
    }

    label {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    input[type='password'],
    select {
        width: 100%;
        padding: var(--spacing-2) var(--spacing-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-sm);
        transition: border-color var(--transition-fast);
        outline: none;
    }

    input[type='password']:focus,
    select:focus {
        border-color: var(--color-primary);
    }

    /* ── Buttons ────────────────────────────────────────────────────────── */
    .btn-primary {
        padding: var(--spacing-2) var(--spacing-5);
        background: var(--color-primary);
        color: #000;
        border: none;
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
        font-weight: 600;
        cursor: pointer;
        transition: background var(--transition-fast);
        align-self: flex-start;
        margin-top: var(--spacing-2);
    }

    .btn-primary:hover:not(:disabled) {
        background: var(--color-primary-hover);
    }
    .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn-ghost {
        padding: var(--spacing-1) var(--spacing-4);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-sm);
        cursor: pointer;
        transition: background var(--transition-fast);
        white-space: nowrap;
    }

    .btn-ghost:hover:not(:disabled) {
        background: var(--color-surface-3);
    }
    .btn-ghost:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn-danger {
        padding: var(--spacing-1) var(--spacing-4);
        background: transparent;
        border: 1px solid var(--color-danger);
        border-radius: var(--radius-md);
        color: var(--color-danger);
        font-size: var(--text-sm);
        cursor: pointer;
        transition: background var(--transition-fast);
        white-space: nowrap;
    }

    .btn-danger:hover:not(:disabled) {
        background: rgba(239, 83, 80, 0.1);
    }
    .btn-danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ── Toggle switch ──────────────────────────────────────────────────── */
    .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-4);
        padding: var(--spacing-3) 0;
        border-bottom: 1px solid var(--color-border);
    }

    .toggle-row:last-of-type {
        border-bottom: none;
        margin-bottom: var(--spacing-3);
    }

    .toggle-label {
        display: block;
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--color-text);
    }

    .toggle-desc {
        display: block;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        margin-top: 2px;
    }

    .switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        flex-shrink: 0;
        cursor: pointer;
    }

    .switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .slider {
        position: absolute;
        inset: 0;
        background: var(--color-surface-3);
        border-radius: var(--radius-full);
        transition: background var(--transition-fast);
    }

    .slider::before {
        content: '';
        position: absolute;
        width: 18px;
        height: 18px;
        left: 3px;
        top: 3px;
        background: white;
        border-radius: 50%;
        transition: transform var(--transition-fast);
    }

    .switch input:checked + .slider {
        background: var(--color-primary);
    }
    .switch input:checked + .slider::before {
        transform: translateX(20px);
    }

    /* ── Tag table ──────────────────────────────────────────────────────── */
    .tag-toolbar {
        display: flex;
        gap: var(--spacing-3);
        margin-bottom: var(--spacing-3);
    }

    .search-input {
        flex: 1;
        padding: var(--spacing-2) var(--spacing-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-sm);
        outline: none;
    }

    .search-input:focus {
        border-color: var(--color-primary);
    }

    .tag-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--text-sm);
    }

    .tag-table th {
        text-align: left;
        padding: var(--spacing-2) var(--spacing-2);
        color: var(--color-text-muted);
        border-bottom: 1px solid var(--color-border);
        font-weight: 500;
        font-size: var(--text-xs);
    }

    .tag-table td {
        padding: var(--spacing-2) var(--spacing-2);
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text);
    }

    .tag-table tr:last-child td {
        border-bottom: none;
    }

    .num {
        text-align: right;
        width: 56px;
        color: var(--color-text-muted);
    }

    .actions-col {
        text-align: right;
        width: 140px;
    }

    .tag-chip {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-full);
        padding: 2px var(--spacing-2);
        font-size: var(--text-xs);
    }

    .rename-input {
        width: 100%;
        padding: 2px var(--spacing-2);
        background: var(--color-surface);
        border: 1px solid var(--color-primary);
        border-radius: var(--radius-sm);
        color: var(--color-text);
        font-size: var(--text-sm);
        outline: none;
    }

    .action-btn {
        background: none;
        border: none;
        color: var(--color-text-muted);
        font-size: var(--text-xs);
        cursor: pointer;
        padding: 2px var(--spacing-2);
        border-radius: var(--radius-sm);
        transition:
            color var(--transition-fast),
            background var(--transition-fast);
    }

    .action-btn:hover {
        color: var(--color-text);
        background: var(--color-surface);
    }
    .action-btn.danger:hover {
        color: var(--color-danger);
        background: rgba(239, 83, 80, 0.1);
    }
    .action-btn.save {
        color: var(--color-primary);
    }
    .action-btn.cancel {
        color: var(--color-text-muted);
    }

    /* ── System action rows ─────────────────────────────────────────────── */
    .action-list {
        display: flex;
        flex-direction: column;
    }

    .action-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-4);
        padding: var(--spacing-3) 0;
        border-bottom: 1px solid var(--color-border);
    }

    .action-row:last-child {
        border-bottom: none;
    }

    .action-label {
        display: block;
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--color-text);
    }

    .action-desc {
        display: block;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        margin-top: 2px;
    }

    /* ── Worker status ──────────────────────────────────────────────────── */
    .worker-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
    }

    .worker-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        padding: var(--spacing-1) 0;
    }

    .worker-name {
        font-size: var(--text-sm);
        color: var(--color-text);
        width: 96px;
        flex-shrink: 0;
    }

    .worker-badge {
        font-size: var(--text-xs);
        font-weight: 500;
        padding: 2px var(--spacing-2);
        border-radius: var(--radius-full);
        flex-shrink: 0;
    }

    .worker-badge--running {
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
    }
    .worker-badge--idle {
        background: var(--color-surface-3);
        color: var(--color-text-muted);
    }
    .worker-badge--disabled {
        background: var(--color-surface-3);
        color: var(--color-text-subtle, var(--color-text-muted));
        opacity: 0.6;
    }

    .worker-progress {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
    }

    /* ── Stat rows (cache + about) ──────────────────────────────────────── */
    .stat-list {
        display: flex;
        flex-direction: column;
    }

    .stat-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--spacing-4);
        padding: var(--spacing-2) 0;
        border-bottom: 1px solid var(--color-border);
        font-size: var(--text-sm);
    }

    .stat-row:last-child {
        border-bottom: none;
    }

    .stat-label {
        color: var(--color-text-muted);
        flex-shrink: 0;
    }
    .stat-value {
        color: var(--color-text);
        text-align: right;
    }
    .about-mono {
        font-family: monospace;
        font-size: var(--text-xs);
    }

    /* Passkeys */
    .passkey-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .passkey-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-3) 0;
        border-bottom: 1px solid var(--color-border);
    }

    .passkey-item:last-child {
        border-bottom: none;
    }

    .passkey-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
    }

    .passkey-ico {
        width: 20px;
        height: 20px;
        color: var(--color-text-muted);
        flex-shrink: 0;
    }

    .passkey-name {
        display: block;
        font-size: var(--text-sm);
        font-weight: 500;
        color: var(--color-text);
    }

    .passkey-date {
        display: block;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
        margin-top: 1px;
    }

    input[type='text'] {
        width: 100%;
        padding: var(--spacing-2) var(--spacing-3);
        background: var(--color-surface-2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-text);
        font-size: var(--text-base);
        transition: border-color var(--transition-fast);
        outline: none;
    }

    input[type='text']:focus {
        border-color: var(--color-primary);
    }
</style>
