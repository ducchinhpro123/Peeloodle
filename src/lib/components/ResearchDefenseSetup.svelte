<script>
	import { buttonPrimary } from '#lib/ui/styles.js';
	import {
		buildResearchDefenseDeck,
		cleanDefenseField,
		DEFENSE_FIELD_LIMITS,
		DEFENSE_LENGTHS,
		DEFENSE_LOOKS
	} from '#lib/presentations/templates/researchDefense.js';

	/** @type {{ repository: import('#lib/presentations/persistence/repository.js').PresentationRepository, onopen: (id: string) => void | Promise<void> }} */
	let { repository, onopen } = $props();
	let length = $state(
		/** @type {import('#lib/presentations/templates/researchDefense.js').DefenseLength} */ (
			'standard'
		)
	);
	let look = $state(
		/** @type {import('#lib/presentations/templates/researchDefense.js').DefenseLook} */ (
			'midnight'
		)
	);
	let title = $state('');
	let presenter = $state('');
	let institution = $state('');
	let advisor = $state('');
	let date = $state('');
	let question = $state('');
	let building = $state(false);
	let titleError = $state('');
	let saveError = $state('');

	/** @param {SubmitEvent} event */
	async function build(event) {
		event.preventDefault();
		if (building) return;
		const cleanedTitle = cleanDefenseField(title, DEFENSE_FIELD_LIMITS.title);
		if (!cleanedTitle) {
			titleError = 'Add your thesis or project title.';
			document.getElementById('defense-title')?.focus();
			return;
		}
		titleError = '';
		saveError = '';
		building = true;
		try {
			const deck = buildResearchDefenseDeck({
				length,
				look,
				title: cleanedTitle,
				presenter,
				institution,
				advisor,
				date,
				question
			});
			await repository.savePresentation(deck);
			await onopen(deck.id);
		} catch {
			saveError = "Couldn't create your defense deck. Nothing was saved. Please try again.";
		} finally {
			building = false;
		}
	}
</script>

<section id="defense-setup" class="defense-setup" aria-labelledby="defense-setup-heading">
	<header>
		<h2 id="defense-setup-heading">Build your defense deck</h2>
		<p>
			Answer what you know now. Everything stays editable, and empty fields keep the sample text.
		</p>
	</header>
	<form onsubmit={build} novalidate aria-busy={building}>
		<fieldset>
			<legend>How long is your talk?</legend>
			<div class="choices">
				{#each Object.entries(DEFENSE_LENGTHS) as [key, option] (key)}
					<label class="choice"
						><input
							type="radio"
							name="defense-length"
							value={key}
							bind:group={length}
							required
						/><span>{option.label}</span></label
					>
				{/each}
			</div>
		</fieldset>
		<fieldset>
			<legend>Look</legend>
			<div class="choices">
				{#each Object.entries(DEFENSE_LOOKS) as [key, option] (key)}
					<label class="choice"
						><input type="radio" name="defense-look" value={key} bind:group={look} required /><span
							class="look-swatch"
							aria-hidden="true"
							style:background={option.dark}><span style:background={option.accent}></span></span
						><span>{option.label}</span></label
					>
				{/each}
			</div>
		</fieldset>
		<div class="fields">
			<div class="field field-wide">
				<label for="defense-title">Thesis or project title</label>
				<input
					id="defense-title"
					name="title"
					type="text"
					bind:value={title}
					required
					maxlength={DEFENSE_FIELD_LIMITS.title}
					aria-invalid={!!titleError}
					aria-describedby={titleError ? 'defense-title-error' : undefined}
					oninput={() => (titleError = '')}
				/>
				{#if titleError}<p id="defense-title-error" class="form-error" role="alert">
						{titleError}
					</p>{/if}
			</div>
			<div class="field">
				<label for="defense-presenter">Your name</label><input
					id="defense-presenter"
					name="presenter"
					autocomplete="name"
					bind:value={presenter}
					maxlength={DEFENSE_FIELD_LIMITS.presenter}
				/>
			</div>
			<div class="field">
				<label for="defense-institution">School or program</label><input
					id="defense-institution"
					name="institution"
					autocomplete="organization"
					bind:value={institution}
					maxlength={DEFENSE_FIELD_LIMITS.institution}
				/>
			</div>
			<div class="field">
				<label for="defense-advisor">Advisor</label><input
					id="defense-advisor"
					name="advisor"
					bind:value={advisor}
					maxlength={DEFENSE_FIELD_LIMITS.advisor}
				/>
			</div>
			<div class="field">
				<label for="defense-date">Defense date</label><input
					id="defense-date"
					name="date"
					type="date"
					bind:value={date}
				/>
			</div>
			<div class="field field-wide">
				<label for="defense-question">Research question</label>
				<p id="defense-question-hint" class="field-hint">One sentence. It goes on its own slide.</p>
				<textarea
					id="defense-question"
					name="question"
					rows="3"
					bind:value={question}
					maxlength={DEFENSE_FIELD_LIMITS.question}
					aria-describedby="defense-question-hint"></textarea>
			</div>
		</div>
		{#if saveError}<p class="form-error" role="alert">{saveError}</p>{/if}
		<button type="submit" class={buttonPrimary} disabled={building}
			>{building ? 'Building your deck…' : 'Build my defense deck'}</button
		>
	</form>
</section>

<style>
	.defense-setup {
		padding: 28px;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		scroll-margin-block-start: calc(var(--header-height) + 16px);
	}
	header {
		margin-block-end: 28px;
	}
	h2 {
		margin: 0;
		font-size: clamp(23px, 2.5vw, 32px);
		letter-spacing: -0.04em;
	}
	header p {
		margin: 8px 0 0;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted);
		max-inline-size: 65ch;
	}
	form {
		display: grid;
		gap: 24px;
		min-inline-size: 0;
	}
	fieldset {
		padding: 0;
		margin: 0;
		min-inline-size: 0;
		border: 0;
	}
	legend {
		padding: 0;
		margin-block-end: 10px;
		font-size: 14px;
		font-weight: 700;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1 1 170px;
		min-inline-size: 0;
		padding: 12px;
		border: 1px solid var(--control-line);
		border-radius: var(--radius-sm);
		font-size: 13px;
		line-height: 1.5;
		cursor: pointer;
	}
	.choice:has(input:checked) {
		border-color: var(--primary);
		background: var(--pale);
	}
	.choice:has(input:focus-visible) {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}
	.choice input {
		flex: none;
		inline-size: 16px;
		block-size: 16px;
		margin: 0;
		accent-color: var(--primary);
	}
	.choice > span:last-child {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}
	.look-swatch {
		display: flex;
		flex: none;
		align-items: end;
		inline-size: 32px;
		block-size: 24px;
		padding: 4px;
		border-radius: 5px;
	}
	.look-swatch span {
		display: block;
		inline-size: 18px;
		block-size: 5px;
		border-radius: 2px;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
	}
	.field {
		display: grid;
		align-content: start;
		min-inline-size: 0;
		gap: 8px;
	}
	.field-wide {
		grid-column: 1 / -1;
	}
	.field label {
		display: block;
		font-size: 13px;
		line-height: 1.5;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.field input,
	textarea {
		box-sizing: border-box;
		inline-size: 100%;
		min-inline-size: 0;
		padding: 12px;
		border: 1px solid var(--control-line);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: 14px;
	}
	.field input {
		min-block-size: 44px;
	}
	textarea {
		resize: vertical;
		line-height: 1.5;
	}
	.field input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.field input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.field-hint {
		margin: -4px 0 0;
		color: var(--muted);
		font-size: 12px;
		line-height: 1.5;
	}
	.form-error {
		margin: 0;
		color: var(--danger);
		font-size: 13px;
		line-height: 1.5;
	}
	button {
		justify-self: start;
	}
	@media (max-width: 600px) {
		.defense-setup {
			padding: 20px;
		}
		.fields {
			grid-template-columns: minmax(0, 1fr);
		}
		button {
			inline-size: 100%;
		}
	}
</style>
