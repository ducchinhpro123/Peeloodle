<script>
	/**
	 * @type {{
	 *   title: import('svelte').Snippet,
	 *   children: import('svelte').Snippet,
	 *   action?: import('svelte').Snippet,
	 *   art?: import('svelte').Snippet,
	 *   kicker?: import('svelte').Snippet,
	 *   points?: import('svelte').Snippet,
	 *   class?: string,
	 * }}
	 */
	let {
		title,
		children,
		action = undefined,
		art = undefined,
		kicker = undefined,
		points = undefined,
		class: className = undefined
	} = $props();
</script>

<section class={className ? `hero ${className}` : 'hero'}>
	<div class="hero-copy">
		{#if kicker}{@render kicker()}{/if}
		<h1>{@render title()}</h1>
		<p class="hero-lead">{@render children()}</p>
		{#if action}{@render action()}{/if}
		{#if points}{@render points()}{/if}
	</div>
	{#if art}{@render art()}{/if}
</section>
