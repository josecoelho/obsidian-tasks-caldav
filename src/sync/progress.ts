/** Counts of applied vs pending changes for one sync run, per direction. */
export interface SyncProgress {
  pullDone: number;
  pullTotal: number;
  pushDone: number;
  pushTotal: number;
}
