<script lang="ts">
    import { goto } from '$app/navigation';
    import { settingsStore } from '$lib/stores/settings.svelte';

    // Redirect to home and open the settings modal
    settingsStore.show();
    goto('/');
</script>
