export class AutoSyncScheduler {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private syncFn: () => Promise<void>;
	private registerInterval: (id: number) => void;

	constructor(
		syncFn: () => Promise<void>,
		registerInterval: (id: number) => void,
	) {
		this.syncFn = syncFn;
		this.registerInterval = registerInterval;
	}

	start(intervalMinutes: number): void {
		this.stop();
		if (intervalMinutes <= 0) return;
		const ms = intervalMinutes * 60 * 1000;
		this.intervalId = setInterval(() => {
			this.syncFn().catch((error: unknown) => {
				console.error('Auto-sync failed:', error);
			});
		}, ms);
		this.registerInterval(this.intervalId as unknown as number);
	}

	stop(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	isRunning(): boolean {
		return this.intervalId !== null;
	}
}
