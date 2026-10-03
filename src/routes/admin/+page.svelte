<script>
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * `/admin` itself has no screen: collections are the first catalog section.
	 * `replaceState` keeps the redirect out of history, so Back returns to wherever
	 * the administrator came from.
	 */
	$effect(() => {
		void goto(resolve('admin/collections'), { replaceState: true });
	});
</script>

<p role="status">Opening the catalog…</p>
