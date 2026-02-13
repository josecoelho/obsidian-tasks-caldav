import { AutoSyncScheduler } from './autoSync';

describe('AutoSyncScheduler', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('sets up interval and calls registerInterval when started with interval > 0', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

		scheduler.start(5);

		expect(registerInterval).toHaveBeenCalledTimes(1);
		expect(registerInterval).toHaveBeenCalled();
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
	});

	it('does not set up interval when started with interval <= 0', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

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
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

		scheduler.start(5);
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	it('stops previous interval before starting new one', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);
		const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

		scheduler.start(5);
		const firstId = registerInterval.mock.calls[0][0];

		scheduler.start(10);
		expect(clearIntervalSpy).toHaveBeenCalledWith(firstId);
		expect(registerInterval).toHaveBeenCalledTimes(2);

		scheduler.stop();
		clearIntervalSpy.mockRestore();
	});

	it('returns correct isRunning state', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

		expect(scheduler.isRunning()).toBe(false);

		scheduler.start(5);
		expect(scheduler.isRunning()).toBe(true);

		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});

	it('calls syncFn when interval fires', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

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
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

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

	it('stop is a no-op when not running', () => {
		const syncFn = jest.fn().mockResolvedValue(undefined);
		const registerInterval = jest.fn();
		const scheduler = new AutoSyncScheduler(syncFn, registerInterval);

		// Should not throw
		scheduler.stop();
		expect(scheduler.isRunning()).toBe(false);
	});
});
