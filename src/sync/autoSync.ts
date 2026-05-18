interface SchedulerTimers {
	setInterval: typeof activeWindow.setInterval;
	clearInterval: typeof activeWindow.clearInterval;
}

export class AutoSyncScheduler {
	private intervalId: number | null = null;
	private syncFn: () => Promise<void>;
	private registerInterval: (id: number) => void;
	private timers: SchedulerTimers;

	constructor(
		syncFn: () => Promise<void>,
		registerInterval: (id: number) => void,
		timers: SchedulerTimers = {
			setInterval: activeWindow.setInterval.bind(activeWindow),
			clearInterval: activeWindow.clearInterval.bind(activeWindow),
		},
	) {
		this.syncFn = syncFn;
		this.registerInterval = registerInterval;
		this.timers = timers;
	}

	start(intervalMinutes: number): void {
		this.stop();
		if (intervalMinutes <= 0) return;
		const ms = intervalMinutes * 60 * 1000;
		this.intervalId = this.timers.setInterval(() => {
			this.syncFn().catch((error: unknown) => {
				console.error('Auto-sync failed:', error);
			});
		}, ms);
		this.registerInterval(this.intervalId);
	}

	stop(): void {
		if (this.intervalId !== null) {
			this.timers.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	isRunning(): boolean {
		return this.intervalId !== null;
	}
}
