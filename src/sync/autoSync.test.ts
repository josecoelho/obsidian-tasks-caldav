import { AutoSyncScheduler } from './autoSync';

describe('AutoSyncScheduler', () => {
	const realTimers = {
		setInterval: ((handler: () => void, timeout?: number) =>
			globalThis.setInterval(handler, timeout)) as unknown as typeof setInterval,
		clearInterval: ((id?: number) =>
			globalThis.clearInterval(id)) as unknown as typeof clearInterval,
	};

	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('sets up interval and calls registerInterval when started with interval > 0', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		scheduler.start(5);

		expect(registerInterval).toHaveBeenCalledTimes(1);
		expect(registerInterval).toHaveBeenCalled();
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
	});

	it('does not set up interval when started with interval <= 0', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		scheduler.start(0);
		expect(registerInterval).not.toHaveBeenCalled();
		expect(scheduler.isRunning()).toBe(false);

		scheduler.start(-1);
		expect(registerInterval).not.toHaveBeenCalled();
		expect(scheduler.isRunning()).toBe(false);
	});

	it('clears interval on stop', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		scheduler.start(5);
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	it('stops previous interval before starting new one', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);
		const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

		scheduler.start(5);
		const firstId = (registerInterval.mock.calls[0] as [number])[0];

		scheduler.start(10);
		expect(clearIntervalSpy).toHaveBeenCalledWith(firstId);
		expect(registerInterval).toHaveBeenCalledTimes(2);

		scheduler.stop();
		clearIntervalSpy.mockRestore();
	});

	it('returns correct isRunning state', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		expect(scheduler.isRunning()).toBe(false);

		scheduler.start(5);
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	it('calls syncFn when interval fires', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		scheduler.start(1); // 1 minute

		expect(syncFn).not.toHaveBeenCalled();

		jest.advanceTimersByTime(60_000);
		expect(syncFn).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(60_000);
		expect(syncFn).toHaveBeenCalledTimes(2);

		scheduler.stop();
	});

	it('catches and logs errors from syncFn without crashing the interval', async () => {
		const error = new Error('sync failed');
		const syncFn = jest.fn()
			.mockRejectedValueOnce(error)
			.mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		scheduler.start(1);

		// First tick: error
		jest.advanceTimersByTime(60_000);
		await Promise.resolve(); // flush microtasks
		expect(consoleErrorSpy).toHaveBeenCalledWith('Auto-sync failed:', error);

		// Second tick: succeeds (interval still running)
		jest.advanceTimersByTime(60_000);
		await Promise.resolve();
		expect(syncFn).toHaveBeenCalledTimes(2);

		scheduler.stop();
		consoleErrorSpy.mockRestore();
	});

	it('uses injected timer functions instead of global setInterval/clearInterval', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const setIntervalFn = jest.fn().mockReturnValue(42);
		const clearIntervalFn = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, {
			setInterval: setIntervalFn as unknown as typeof setInterval,
			clearInterval: clearIntervalFn as unknown as typeof clearInterval,
		});

		scheduler.start(5);
		expect(setIntervalFn).toHaveBeenCalledTimes(1);
		expect(registerInterval).toHaveBeenCalledWith(42);

		scheduler.stop();
		expect(clearIntervalFn).toHaveBeenCalledWith(42);
	});

	it('defaults to activeWindow timers when none are injected', () => {
		const setIntervalFn = jest.fn().mockReturnValue(7);
		const clearIntervalFn = jest.fn();
		const globalScope = globalThis as unknown as { activeWindow?: unknown };
		globalScope.activeWindow = { setInterval: setIntervalFn, clearInterval: clearIntervalFn };
		try {
			const scheduler = new AutoSyncScheduler(
				jest.fn().mockResolvedValue(undefined),
				jest.fn(),
			);

			scheduler.start(5);
			expect(setIntervalFn).toHaveBeenCalledTimes(1);

			scheduler.stop();
			expect(clearIntervalFn).toHaveBeenCalledWith(7);
		} finally {
			delete globalScope.activeWindow;
		}
	});

	it('stop is a no-op when not running', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval, realTimers);

		// Should not throw
		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});
});
