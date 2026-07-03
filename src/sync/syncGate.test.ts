import { SyncGate } from './syncGate';

describe('SyncGate', () => {
  it('runs the function and returns its result', async () => {
    const gate = new SyncGate();
    expect(await gate.run(() => Promise.resolve('done'))).toBe('done');
  });

  it('returns null for a run attempted while another is in flight', async () => {
    const gate = new SyncGate();
    let release!: () => void;
    const first = gate.run(() => new Promise<string>(resolve => {
      release = () => resolve('first');
    }));

    const second = await gate.run(() => Promise.resolve('second'));

    expect(second).toBeNull();
    release();
    expect(await first).toBe('first');
  });

  it('allows a new run after the previous one completes', async () => {
    const gate = new SyncGate();
    await gate.run(() => Promise.resolve('first'));
    expect(await gate.run(() => Promise.resolve('second'))).toBe('second');
  });

  it('releases the gate when the function throws', async () => {
    const gate = new SyncGate();
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate.run(() => Promise.resolve('after'))).toBe('after');
  });
});
