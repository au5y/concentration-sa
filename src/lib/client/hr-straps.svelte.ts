/**
 * Heart-rate straps connected from the admin page with Web Bluetooth (Chrome / Edge, HTTPS or
 * localhost). Readings are buffered and sent to /admin/hr every 2 s; unsent ones are also kept
 * in this browser's storage so a reload or a network drop doesn't lose them.
 */
import { HR_MEASUREMENT, HR_SERVICE, parseHrMeasurement, type HrSample } from '$lib/hr';

const FLUSH_MS = 2000;
const HISTORY = 150;
const PENDING_KEY = 'hr-pending';
const ASSIGN_KEY = 'hr-assign';
/** Keep at most this many unsent readings (about 4 h for 3 straps at 1/s). */
const MAX_PENDING = 50_000;

type Status = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

// Minimal Web Bluetooth types (not in TypeScript's DOM lib).
interface BtCharacteristic extends EventTarget {
	value?: DataView;
	startNotifications(): Promise<BtCharacteristic>;
}
interface BtServer {
	connected: boolean;
	connect(): Promise<BtServer>;
	disconnect(): void;
	getPrimaryService(s: string): Promise<{ getCharacteristic(c: string): Promise<BtCharacteristic> }>;
}
interface BtDevice extends EventTarget {
	id: string;
	name?: string;
	gatt?: BtServer;
}
interface Bluetooth {
	requestDevice(o: { filters: { services: string[] }[] }): Promise<BtDevice>;
}

export class Strap {
	status = $state<Status>('connecting');
	bpm = $state<number | null>(null);
	contact = $state<boolean | null>(null);
	lastAt = $state<number | null>(null);
	history = $state<number[]>([]);
	pid = $state<string | null>(null);
	error = $state('');
	/** Set when the facilitator disconnects on purpose: don't reconnect. */
	closing = false;
	constructor(
		public device: BtDevice,
		public name: string
	) {}
	get id() {
		return this.device.id;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function load<T>(key: string, fallback: T): T {
	try {
		const v = localStorage.getItem(key);
		return v ? (JSON.parse(v) as T) : fallback;
	} catch {
		return fallback;
	}
}
function save(key: string, v: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(v));
	} catch {
		// storage full or blocked: the in-memory buffer still sends
	}
}

export class StrapManager {
	straps = $state<Strap[]>([]);
	/** Readings not yet confirmed by the server. */
	pending = $state(0);
	lastSent = $state<number | null>(null);
	sendError = $state('');
	private buffer: HrSample[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private sending = false;

	/**
	 * Default: the admin page (straps assigned to participants there, sent to /admin/hr).
	 * `{ pid }`: a remote participant's own computer; every reading is theirs, sent to /api/session/hr.
	 */
	constructor(private own?: { pid: string }) {}

	private get pendingKey() {
		return this.own ? `${PENDING_KEY}:${this.own.pid}` : PENDING_KEY;
	}

	/** Why straps can't be connected here, or '' if they can. */
	static unsupported(): string {
		if (typeof window === 'undefined') return '';
		if (!window.isSecureContext) return 'Bluetooth needs this page on HTTPS (or http://localhost). Open the admin page from its https:// address.';
		if (!('bluetooth' in navigator)) return 'This browser has no Web Bluetooth. Use Chrome or Edge on Windows, macOS or ChromeOS.';
		return '';
	}

	start() {
		this.buffer = load<HrSample[]>(this.pendingKey, []);
		this.pending = this.buffer.length;
		this.timer = setInterval(() => this.flush(), FLUSH_MS);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		for (const s of this.straps) this.disconnect(s);
		save(this.pendingKey, this.buffer);
	}

	get connected() {
		return this.straps.some((s) => s.status !== 'disconnected');
	}

	/** Opens Chrome's device picker (must be called from a click). */
	async add(): Promise<void> {
		const bt = (navigator as unknown as { bluetooth: Bluetooth }).bluetooth;
		const device = await bt.requestDevice({ filters: [{ services: [HR_SERVICE] }] });
		const existing = this.straps.find((s) => s.id === device.id);
		if (existing && existing.status !== 'disconnected') return;
		const strap = existing ?? new Strap(device, device.name || `strap ${this.straps.length + 1}`);
		strap.pid = this.own?.pid ?? load<Record<string, string | null>>(ASSIGN_KEY, {})[device.id] ?? null;
		strap.closing = false;
		if (!existing) {
			this.straps.push(strap);
			device.addEventListener('gattserverdisconnected', () => this.reconnect(strap));
		}
		await this.connect(strap);
	}

	/** Reconnect a strap that was disconnected on purpose (no device picker needed). */
	async resume(strap: Strap) {
		strap.closing = false;
		try {
			await this.connect(strap);
		} catch (e) {
			strap.error = (e as Error).message;
			strap.status = 'disconnected';
		}
	}

	assign(strap: Strap, pid: string | null) {
		strap.pid = pid;
		save(ASSIGN_KEY, { ...load<Record<string, string | null>>(ASSIGN_KEY, {}), [strap.id]: pid });
	}

	disconnect(strap: Strap) {
		strap.closing = true;
		strap.status = 'disconnected';
		try {
			strap.device.gatt?.disconnect();
		} catch {
			// already gone
		}
	}

	remove(strap: Strap) {
		this.disconnect(strap);
		this.straps = this.straps.filter((s) => s !== strap);
	}

	private async connect(strap: Strap) {
		strap.status = strap.lastAt ? 'reconnecting' : 'connecting';
		strap.error = '';
		const server = await strap.device.gatt!.connect();
		const ch = await (await server.getPrimaryService(HR_SERVICE)).getCharacteristic(HR_MEASUREMENT);
		ch.addEventListener('characteristicvaluechanged', () => ch.value && this.onReading(strap, ch.value));
		await ch.startNotifications();
		strap.status = 'live';
	}

	/** Strap dropped (out of range, battery, taken off): keep trying until it's back or removed. */
	private async reconnect(strap: Strap) {
		if (strap.closing) return;
		strap.status = 'reconnecting';
		for (let i = 0; !strap.closing && this.straps.includes(strap); i++) {
			try {
				await this.connect(strap);
				return;
			} catch (e) {
				strap.error = (e as Error).message;
				await sleep(Math.min(10_000, 1000 * 2 ** i));
			}
		}
	}

	private onReading(strap: Strap, v: DataView) {
		const r = parseHrMeasurement(v);
		const ts = Date.now();
		strap.bpm = r.bpm;
		strap.contact = r.contact;
		strap.lastAt = ts;
		strap.history = [...strap.history.slice(-(HISTORY - 1)), r.bpm];
		this.buffer.push({ strap: strap.id, strap_name: strap.name, pid: strap.pid, ts, bpm: r.bpm, rr: r.rr, contact: r.contact });
		if (this.buffer.length > MAX_PENDING) this.buffer.splice(0, this.buffer.length - MAX_PENDING);
		this.pending = this.buffer.length;
	}

	/** Send buffered readings; on failure they stay buffered (and in storage) for the next try. */
	async flush() {
		if (this.sending || !this.buffer.length) return;
		this.sending = true;
		const batch = this.buffer.slice(0, 2000);
		try {
			const res = await fetch(this.own ? '/api/session/hr' : '/admin/hr', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ samples: batch, client_now: Date.now(), ...(this.own ? { pid: this.own.pid } : {}) })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
			this.buffer.splice(0, batch.length);
			this.lastSent = Date.now();
			this.sendError = '';
		} catch (e) {
			this.sendError = (e as Error).message || 'network error';
		} finally {
			this.pending = this.buffer.length;
			save(this.pendingKey, this.buffer);
			this.sending = false;
		}
	}
}
