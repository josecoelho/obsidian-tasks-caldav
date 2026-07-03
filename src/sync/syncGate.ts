/**
 * Allows one sync run at a time. A run attempted while another is in flight
 * gets null back instead of a second, racing run — overlapping syncs can
 * each see the same unsynced task and double-create it.
 */
export class SyncGate {
  private running = false;

  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }
}
