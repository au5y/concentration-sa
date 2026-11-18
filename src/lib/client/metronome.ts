/**
 * Step-test metronome: a click every beat, scheduled ahead on the Web Audio clock so the tempo
 * stays steady even when the page is busy. Every 4th beat (the first "Up" of up-up-down-down) is
 * accented with a higher, louder version of the sound. `onBeat` fires on each click for the
 * visual pulse. Tempo, sound and mute can change while it runs.
 *
 * Browsers keep audio muted until the page gets a click or key press. One shared AudioContext
 * is created and unlocked on the first such gesture anywhere on the page (call `primeAudio()`
 * early), so the clicks can start later from a timer or the facilitator console.
 */
export const SOUNDS = [
	{ id: 'woodblock', label: 'Woodblock' },
	{ id: 'beep', label: 'Beep' },
	{ id: 'tick', label: 'Tick' }
] as const;
export type SoundId = (typeof SOUNDS)[number]['id'];
export const BEATS_PER_CYCLE = 4;

let shared: AudioContext | null = null;
let primed = false;

function context(): AudioContext {
	shared ??= new AudioContext({ latencyHint: 'interactive' });
	return shared;
}

/** True once the browser lets the page play sound. */
export function audioReady(): boolean {
	return !!shared && shared.state === 'running';
}

/** Try to unlock audio now (call from a click / key handler). */
export async function unlockAudio(): Promise<boolean> {
	const ctx = context();
	try {
		await ctx.resume();
		// A silent blip: some browsers only count audio as started once something plays.
		const b = ctx.createBuffer(1, 1, ctx.sampleRate);
		const src = ctx.createBufferSource();
		src.buffer = b;
		src.connect(ctx.destination);
		src.start();
	} catch {
		// still locked
	}
	return ctx.state === 'running';
}

/** Unlock audio on the first click / tap / key press on the page. Safe to call repeatedly. */
export function primeAudio() {
	if (primed || typeof window === 'undefined') return;
	primed = true;
	const go = () => {
		void unlockAudio().then((ok) => {
			if (ok) for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(ev, go, true);
		});
	};
	for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, go, true);
}

export class Metronome {
	private timer: ReturnType<typeof setInterval> | null = null;
	private next = 0;
	private beat = 0;
	private noise: AudioBuffer | null = null;
	/** Silent but still pulsing. */
	muted = false;
	sound: SoundId = 'woodblock';
	bpm: number;

	constructor(
		bpm: number,
		private onBeat?: (beat: number) => void
	) {
		this.bpm = bpm;
	}

	start() {
		if (this.timer) return;
		const ctx = context();
		void ctx.resume();
		this.next = ctx.currentTime + 0.05;
		this.beat = 0;
		this.timer = setInterval(() => this.schedule(), 25);
		this.schedule();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** Play one click now (to preview a sound). */
	preview(sound: SoundId, accent = false) {
		const ctx = context();
		void ctx.resume();
		this.play(sound, ctx.currentTime + 0.02, accent);
	}

	/** Queue every click due in the next 120 ms. */
	private schedule() {
		const ctx = context();
		// Fell behind (tab was in the background, or audio still locked): skip ahead, no burst.
		if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.02;
		while (this.next < ctx.currentTime + 0.12) {
			const beat = this.beat++;
			if (!this.muted) this.play(this.sound, this.next, beat % BEATS_PER_CYCLE === 0);
			const delay = Math.max(0, (this.next - ctx.currentTime) * 1000);
			setTimeout(() => this.timer && this.onBeat?.(beat), delay);
			// Read every beat, so a tempo change applies from the next click.
			this.next += 60 / Math.min(300, Math.max(20, this.bpm));
		}
	}

	private play(sound: SoundId, at: number, accent: boolean) {
		const ctx = context();
		const out = ctx.createGain();
		out.gain.value = accent ? 1 : 0.75;
		out.connect(ctx.destination);
		if (sound === 'beep') this.beep(ctx, out, at, accent);
		else if (sound === 'tick') this.tick(ctx, out, at, accent);
		else this.woodblock(ctx, out, at, accent);
	}

	private tone(ctx: AudioContext, out: AudioNode, at: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number) {
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(f0, at);
		if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + decay * 0.6);
		g.gain.setValueAtTime(0.0001, at);
		g.gain.exponentialRampToValueAtTime(peak, at + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
		osc.connect(g).connect(out);
		osc.start(at);
		osc.stop(at + decay + 0.01);
	}

	private burst(ctx: AudioContext, out: AudioNode, at: number, freq: number, q: number, level: number) {
		if (!this.noise) {
			const len = Math.floor(ctx.sampleRate * 0.012);
			this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
			const d = this.noise.getChannelData(0);
			for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
		}
		const n = ctx.createBufferSource();
		const bp = ctx.createBiquadFilter();
		const g = ctx.createGain();
		n.buffer = this.noise;
		bp.type = 'bandpass';
		bp.frequency.value = freq;
		bp.Q.value = q;
		g.gain.value = level;
		n.connect(bp).connect(g).connect(out);
		n.start(at);
	}

	/** Hollow wooden "tock". Accent: higher block. */
	private woodblock(ctx: AudioContext, out: AudioNode, at: number, accent: boolean) {
		const f = accent ? 1700 : 1250;
		this.tone(ctx, out, at, 'sine', f, f * 0.72, 1, 0.0015, 0.07);
		this.tone(ctx, out, at, 'sine', f * 2.1, f * 2.1, 0.3, 0.001, 0.03);
		this.burst(ctx, out, at, 3000, 1.2, 0.45);
	}

	/** Soft electronic beep. Accent: a fifth higher. */
	private beep(ctx: AudioContext, out: AudioNode, at: number, accent: boolean) {
		const f = accent ? 1320 : 880;
		this.tone(ctx, out, at, 'sine', f, f, 0.8, 0.004, 0.09);
		this.tone(ctx, out, at, 'triangle', f * 2, f * 2, 0.12, 0.004, 0.05);
	}

	/** Short dry mechanical tick. Accent: brighter and louder. */
	private tick(ctx: AudioContext, out: AudioNode, at: number, accent: boolean) {
		this.burst(ctx, out, at, accent ? 6000 : 4200, 3, accent ? 1.6 : 1.2);
		this.tone(ctx, out, at, 'triangle', accent ? 3400 : 2600, accent ? 3400 : 2600, 0.35, 0.0005, 0.018);
	}
}
