/**
 * Step-test metronome: a woodblock-style "tock" every beat, scheduled ahead on the Web Audio
 * clock so the tempo stays steady even when the page is busy. `onBeat` fires on each click for
 * the visual pulse.
 *
 * Browsers keep audio muted until the page gets a click or key press. One shared AudioContext
 * is created and unlocked on the first such gesture anywhere on the page (call `primeAudio()`
 * early), so the clicks can start later from a timer or the facilitator console.
 */
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

	constructor(
		private bpm: number,
		private onBeat?: (beat: number) => void
	) {}

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

	/** Queue every click due in the next 120 ms. */
	private schedule() {
		const ctx = context();
		const period = 60 / this.bpm;
		// Fell behind (tab was in the background, or audio still locked): skip ahead, no burst.
		if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.02;
		while (this.next < ctx.currentTime + 0.12) {
			if (!this.muted) this.click(this.next);
			const beat = this.beat++;
			const delay = Math.max(0, (this.next - ctx.currentTime) * 1000);
			setTimeout(() => this.timer && this.onBeat?.(beat), delay);
			this.next += period;
		}
	}

	/** Woodblock "tock": a pitched body that drops slightly, plus a short filtered-noise attack. */
	private click(at: number) {
		const ctx = context();
		const out = ctx.createGain();
		out.gain.value = 0.9;
		out.connect(ctx.destination);

		const body = ctx.createOscillator();
		const bodyGain = ctx.createGain();
		body.type = 'sine';
		body.frequency.setValueAtTime(1250, at);
		body.frequency.exponentialRampToValueAtTime(900, at + 0.04);
		bodyGain.gain.setValueAtTime(0.0001, at);
		bodyGain.gain.exponentialRampToValueAtTime(1, at + 0.0015);
		bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
		body.connect(bodyGain).connect(out);
		body.start(at);
		body.stop(at + 0.08);

		// Overtone gives it the hollow wooden ring.
		const ring = ctx.createOscillator();
		const ringGain = ctx.createGain();
		ring.type = 'sine';
		ring.frequency.setValueAtTime(2600, at);
		ringGain.gain.setValueAtTime(0.0001, at);
		ringGain.gain.exponentialRampToValueAtTime(0.35, at + 0.001);
		ringGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
		ring.connect(ringGain).connect(out);
		ring.start(at);
		ring.stop(at + 0.04);

		if (!this.noise) {
			const len = Math.floor(ctx.sampleRate * 0.01);
			this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
			const d = this.noise.getChannelData(0);
			for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
		}
		const n = ctx.createBufferSource();
		const bp = ctx.createBiquadFilter();
		const nGain = ctx.createGain();
		n.buffer = this.noise;
		bp.type = 'bandpass';
		bp.frequency.value = 3000;
		bp.Q.value = 1.2;
		nGain.gain.value = 0.5;
		n.connect(bp).connect(nGain).connect(out);
		n.start(at);
	}
}
