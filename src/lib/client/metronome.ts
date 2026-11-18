/**
 * Step-test metronome: a short click every beat, scheduled ahead on the Web Audio clock so the
 * tempo stays steady even when the page is busy. `onBeat` fires (roughly) on each click for a
 * visual pulse. Browsers only let audio start after the page has had a click or key press;
 * `start()` resumes the context, so call it from (or after) one.
 */
export class Metronome {
	private ctx: AudioContext | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private next = 0;
	private beat = 0;

	constructor(
		private bpm: number,
		private onBeat?: (beat: number) => void
	) {}

	get running() {
		return this.timer !== null;
	}

	start() {
		if (this.timer) return;
		this.ctx ??= new AudioContext();
		void this.ctx.resume();
		this.next = this.ctx.currentTime + 0.1;
		this.beat = 0;
		this.timer = setInterval(() => this.schedule(), 25);
		this.schedule();
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	close() {
		this.stop();
		void this.ctx?.close();
		this.ctx = null;
	}

	/** Queue every click due in the next 100 ms. */
	private schedule() {
		const ctx = this.ctx!;
		const period = 60 / this.bpm;
		// Fell behind (tab was in the background): skip ahead instead of a burst of clicks.
		if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
		while (this.next < ctx.currentTime + 0.1) {
			this.click(this.next);
			const beat = this.beat++;
			const delay = Math.max(0, (this.next - ctx.currentTime) * 1000);
			setTimeout(() => this.timer && this.onBeat?.(beat), delay);
			this.next += period;
		}
	}

	private click(at: number) {
		const ctx = this.ctx!;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'square';
		osc.frequency.value = 1000;
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.exponentialRampToValueAtTime(0.6, at + 0.002);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
		osc.connect(gain).connect(ctx.destination);
		osc.start(at);
		osc.stop(at + 0.06);
	}
}
