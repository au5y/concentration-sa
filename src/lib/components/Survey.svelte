<script lang="ts">
	/**
	 * Questions at the start of the session, filled in by the facilitator: they ask each question out
	 * loud and tap the participant's answer. RPE is recorded after each bout, not here.
	 */
	let { onSubmit }: { onSubmit: (v: Record<string, unknown>) => Promise<void> } = $props();

	const FITNESS = [
		{ n: 1, label: 'Very low', desc: 'No regular exercise; winded after one flight of stairs' },
		{ n: 2, label: 'Low', desc: 'Occasional light activity (e.g. walking); rarely exercises' },
		{ n: 3, label: 'Moderate', desc: 'Regular moderate activity (e.g. jogging, cycling); can climb several flights without stopping' },
		{ n: 4, label: 'High', desc: 'Regular vigorous training; comfortable with sustained hard effort' },
		{ n: 5, label: 'Very high', desc: 'Structured training for a sport or competition' }
	];
	const HOURS = [4, 5, 6, 7, 8, 9, 10];

	let age = $state<number | null>(null);
	let days = $state<number | null>(null);
	let fitness = $state<number | null>(null);
	let hours = $state<number | null>(null);
	let busy = $state(false);
	let err = $state('');
	const valid = $derived(
		age !== null && age >= 16 && age <= 99 && days !== null && fitness !== null &&
			hours !== null && hours >= 0 && hours <= 24
	);

	async function submit() {
		busy = true;
		err = '';
		try {
			await onSubmit({ age, exercise_days: days, fitness, hours_slept: hours });
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
			busy = false;
		}
	}
</script>

<div class="survey">
	<p class="banner">Facilitator: ask each question out loud and tap the answer.</p>

	<div class="pair">
		<section>
			<h2>1. Age</h2>
			<input
				type="number"
				min="16"
				max="99"
				inputmode="numeric"
				placeholder="years"
				oninput={(e) => {
					const v = e.currentTarget.valueAsNumber;
					age = Number.isFinite(v) ? Math.round(v) : null;
				}}
			/>
		</section>
		<section>
			<h2>2. How many days per week do you exercise?</h2>
			<div class="choices">
				{#each [0, 1, 2, 3, 4, 5, 6, 7] as d (d)}
					<button class="num" class:sel={days === d} onclick={() => (days = d)}>{d}</button>
				{/each}
			</div>
		</section>
	</div>

	<section>
		<h2>3. Fitness level <small>(read the descriptions)</small></h2>
		<div class="fitness">
			{#each FITNESS as f (f.n)}
				<button class:sel={fitness === f.n} onclick={() => (fitness = f.n)}>
					<b>{f.n} · {f.label}</b>
					<span>{f.desc}</span>
				</button>
			{/each}
		</div>
	</section>

	<section>
		<h2>4. Hours slept last night</h2>
		<div class="choices">
			{#each HOURS as h (h)}
				<button class:sel={hours === h} onclick={() => (hours = h)}>{h === 4 ? '≤4' : h === 10 ? '10+' : h}</button>
			{/each}
			<input
				type="number"
				min="0"
				max="24"
				step="0.5"
				placeholder="other"
				inputmode="decimal"
				value={hours !== null && !HOURS.includes(hours) ? hours : ''}
				oninput={(e) => {
					const v = e.currentTarget.valueAsNumber;
					hours = Number.isFinite(v) ? v : null;
				}}
			/>
		</div>
	</section>

	{#if err}<p class="err">{err}</p>{/if}
	<button class="go" disabled={!valid || busy} onclick={submit}>Save &amp; continue</button>
</div>

<style>
	.survey {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem 1.5rem;
	}
	.banner {
		background: #fff4cc;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-weight: 600;
		margin: 0 0 0.5rem;
	}
	section {
		margin-bottom: 0.8rem;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0.6rem 0 0.4rem;
	}
	h2 small {
		font-weight: 400;
		color: #666;
	}
	.fitness {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.4rem;
	}
	.fitness button {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		text-align: left;
		padding: 0.5rem;
		font-size: 1rem;
		background: white;
		border: 2px solid #ccc;
		border-radius: 6px;
		cursor: pointer;
	}
	.fitness span {
		font-size: 0.8rem;
		color: #555;
	}
	.num {
		min-width: 3rem;
	}
	.pair {
		display: flex;
		gap: 3rem;
		flex-wrap: wrap;
	}
	.choices {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.choices button {
		font-size: 1.2rem;
		padding: 0.5rem 1.2rem;
		border: 2px solid #ccc;
		border-radius: 8px;
		background: white;
		cursor: pointer;
	}
	button.sel {
		border-color: #1f63d6 !important;
		background: #eef4ff !important;
	}
	input {
		font-size: 1.1rem;
		padding: 0.4rem;
		width: 6rem;
	}
	.go {
		margin-top: 1rem;
		font-size: 1.3rem;
		padding: 0.6rem 2.2rem;
		border-radius: 10px;
		border: none;
		background: #1f63d6;
		color: white;
		cursor: pointer;
	}
	.go:disabled {
		background: #9ab;
	}
	.err {
		color: #b00;
	}
</style>
