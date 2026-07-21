import { App, Notice } from "obsidian";
import { ObsidianTasksWrapper } from "../tasks/obsidianTasksWrapper";
import { CalDAVClientDirect } from "../caldav/calDAVClientDirect";
import { SyncStorage } from "../storage/syncStorage";
import { CalDAVSettings, CalendarMapping, IdMapping, SyncDirection } from "../types";
import { CalDAVAdapter } from "./caldavAdapter";
import { ObsidianAdapter } from "./obsidianAdapter";
import { diff } from "./diff";
import { applicableChanges } from "./applicableChanges";
import { SyncProgress } from "./progress";
import { CommonTask, Conflict, ConflictStrategy, SyncChange } from "./types";
import { storageIdForCalendar } from "../utils/calendarStorageId";
import { calendarLabel } from "../utils/calendarLabel";

export interface SyncResult {
	calendarName: string;
	success: boolean;
	message: string;
	created: { toObsidian: number; toCalDAV: number };
	updated: { toObsidian: number; toCalDAV: number };
	deleted: { toObsidian: number; toCalDAV: number };
	reconciled: number;
	conflicts: number;
	details: {
		toObsidian: SyncChange[];
		toCalDAV: SyncChange[];
		conflictDetails: Conflict[];
		obsidianTasks?: CommonTask[];
		caldavTasks?: CommonTask[];
		baselineTasks?: CommonTask[];
	};
}

export interface SyncOptions {
	/** Preview changes without writing to either side. */
	dryRun?: boolean;
	/** Sync was triggered automatically (not by an explicit user command). */
	background?: boolean;
	/** Called with updated counts as each change is applied. */
	onProgress?: (progress: SyncProgress) => void;
}

export class SyncEngine {
	private calendar: CalendarMapping;
	private settings: CalDAVSettings;
	private storage: SyncStorage;
	private caldavAdapter: CalDAVAdapter;
	private obsidianAdapter: ObsidianAdapter;

	constructor(app: App, calendar: CalendarMapping, settings: CalDAVSettings) {
		this.calendar = calendar;
		this.settings = settings;
		const wrapper = new ObsidianTasksWrapper(app);
		this.storage = new SyncStorage(app, storageIdForCalendar(calendar));
		this.caldavAdapter = new CalDAVAdapter(
			new CalDAVClientDirect(calendar),
			calendar.caldavCategory,
		);
		this.obsidianAdapter = new ObsidianAdapter(wrapper, {
			syncTag: calendar.obsidianTag,
			newTasksDestination: settings.newTasksDestination,
			newTasksSection: settings.newTasksSection,
			includeObsidianLink: settings.includeObsidianLink,
			getVaultName: () => app.vault.getName(),
		});
	}

	async initialize(): Promise<boolean> {
		if (!this.obsidianAdapter.isReady()) {
			new Notice("Tasks plugin required for sync");
			return false;
		}
		await this.storage.initialize();
		return true;
	}

	async sync({ dryRun = false, background = false, onProgress }: SyncOptions = {}): Promise<SyncResult> {
		try {
			const showProgress = !background || this.settings.showAutoSyncNotifications;
			if (showProgress) {
				new Notice(`${dryRun ? "[DRY RUN] " : ""}Starting sync for ${calendarLabel(this.calendar)}...`);
			}

			const idMapping = this.storage.getIdMapping();

			const caldavTasks = await this.caldavAdapter.fetchTasks(idMapping);
			const obsidianTasks = await this.obsidianAdapter.fetchTasks();
			const baseline = this.getOrSeedBaseline(obsidianTasks, caldavTasks, idMapping);

			const changeset = diff(obsidianTasks, caldavTasks, baseline, this.conflictStrategy());
			const applicable = applicableChanges(changeset, this.direction());

			if (dryRun) return this.buildResult(applicable, obsidianTasks, caldavTasks, baseline, true, showProgress);

			this.completePulledIdentities(applicable, idMapping);
			this.healUnmappedVaultMatches(caldavTasks, obsidianTasks, idMapping);

			const progress: SyncProgress = {
				pullDone: 0,
				pullTotal: applicable.toObsidian.length,
				pushDone: 0,
				pushTotal: applicable.toCalDAV.length,
			};
			onProgress?.({ ...progress });

			const { completionRemappings } = await this.obsidianAdapter.applyChanges(
				applicable.toObsidian,
				() => {
					progress.pullDone++;
					onProgress?.({ ...progress });
				},
			);
			// Stamp IDs before the CalDAV push: if the push fails, the vault
			// keeps the identities, so the retry converges on the same UIDs
			// instead of minting new ones and duplicating tasks.
			await this.obsidianAdapter.writeBackIds(obsidianTasks);
			await this.caldavAdapter.applyChanges(
				applicable.toCalDAV,
				idMapping,
				() => {
					progress.pushDone++;
					onProgress?.({ ...progress });
				},
			);

			this.updateIdMapping(idMapping, completionRemappings, applicable);
			this.persistState(obsidianTasks, caldavTasks, applicable, idMapping);
			await this.storage.save();

			return this.buildResult(applicable, obsidianTasks, caldavTasks, baseline, false, showProgress);
		} catch (error) {
			return this.buildErrorResult(error);
		}
	}

	getStatus(): string {
		const state = this.storage.getState();
		const idMapping = this.storage.getIdMapping();
		const baseline = this.storage.getBaseline();

		const lastSync = state.lastSyncTime
			? new Date(state.lastSyncTime).toLocaleString()
			: "Never";

		return (
			`Last sync: ${lastSync}\n` +
			`Mapped tasks: ${Object.keys(idMapping.taskIdToCaldavUid).length}\n` +
			`Baseline tasks: ${baseline.length}\n` +
			`Conflicts: ${state.conflicts.length}`
		);
	}

	// --- Private helpers ---

	private direction(): SyncDirection {
		return this.calendar.syncDirection ?? "bidirectional";
	}

	private conflictStrategy(): ConflictStrategy {
		const direction = this.direction();
		if (direction === "pull") return "caldav-wins";
		if (direction === "push") return "obsidian-wins";
		return this.settings.autoResolveObsidianWins
			? "obsidian-wins"
			: "caldav-wins";
	}

	private getOrSeedBaseline(
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		idMapping: IdMapping,
	): CommonTask[] {
		const baseline = this.storage.getBaseline();
		if (baseline.length > 0) return baseline;
		if (Object.keys(idMapping.taskIdToCaldavUid).length === 0) return baseline;

		return this.seedBaselineFromIdMapping(obsidianTasks, caldavTasks, idMapping);
	}

	private seedBaselineFromIdMapping(
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		idMapping: IdMapping,
	): CommonTask[] {
		const obsidianByUid = new Map(obsidianTasks.map((t) => [t.uid, t]));
		const caldavByUid = new Map(caldavTasks.map((t) => [t.uid, t]));
		const baseline: CommonTask[] = [];

		for (const taskId of Object.keys(idMapping.taskIdToCaldavUid)) {
			const task = obsidianByUid.get(taskId) ?? caldavByUid.get(taskId);
			if (task) baseline.push(task);
		}

		return baseline;
	}

	/**
	 * Fill in the stable Obsidian `uid` on every CalDAV-sourced task that still
	 * lacks one, before the new baseline is computed. A first-time-pulled task
	 * arrives with `uid === ''` (only its `caldavId` is set); leaving it empty
	 * would key the baseline by an empty or raw-CalDAV string and read as a
	 * spurious delete on the next sync.
	 *
	 * The identity has two sources:
	 *  - a genuine server create (`toObsidian` create): mint a fresh vault ID and
	 *    register both mapping directions against the task's `caldavId`.
	 *  - a reconcile (server task matched by content to an existing vault task):
	 *    reuse the matched task's ID, carried on the change's `counterpartUid`.
	 *
	 * Each change's `task` is the same object as the fetched `caldavTasks` entry,
	 * so stamping it here propagates straight into `computeNewBaseline` with no
	 * re-keying. The server UID is always read from `caldavId`, never from `uid`.
	 */
	private completePulledIdentities(
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
		idMapping: IdMapping,
	): void {
		for (const change of changeset.toObsidian) {
			if (change.type === "create") {
				change.task.uid = this.mintTaskIdForCaldav(change.task, idMapping);
			}
		}
		for (const change of changeset.toCalDAV) {
			if (change.type === "reconcile" && change.counterpartUid) {
				change.task.uid = change.counterpartUid;
			}
		}
	}

	/**
	 * Heal a vault-originated task whose id-mapping was lost. `normalize()` leaves
	 * it with `uid: ""` (unmapped), but its CalDAV `caldavId` equals the vault
	 * task's own id, so `diff()` still matches the pair in the main loop via the
	 * `uid || caldavId` join — as an unchanged no-op that no changeset touches.
	 * Left alone, that CalDAV CommonTask keeps `uid: ""` and lands in the baseline
	 * as an empty-uid phantom (and drags its derived `caldavId` onto disk). Stamp
	 * the stable identity back on and restore the mapping so the pair self-heals
	 * rather than duplicating on the next sync.
	 */
	private healUnmappedVaultMatches(
		caldavTasks: CommonTask[],
		obsidianTasks: CommonTask[],
		idMapping: IdMapping,
	): void {
		const obsidianUids = new Set(obsidianTasks.map((t) => t.uid));
		for (const task of caldavTasks) {
			if (task.uid !== "") continue;
			const caldavUid = task.caldavId ?? "";
			if (!caldavUid || !obsidianUids.has(caldavUid)) continue;
			task.uid = caldavUid;
			idMapping.taskIdToCaldavUid[caldavUid] = caldavUid;
			idMapping.caldavUidToTaskId[caldavUid] = caldavUid;
		}
	}

	private mintTaskIdForCaldav(task: CommonTask, idMapping: IdMapping): string {
		const caldavUid = task.caldavId ?? "";
		const taskId = this.obsidianAdapter.reserveTaskId();
		idMapping.taskIdToCaldavUid[taskId] = caldavUid;
		idMapping.caldavUidToTaskId[caldavUid] = taskId;
		return taskId;
	}

	private updateIdMapping(
		idMapping: IdMapping,
		completionRemappings: Array<{ oldTaskId: string; newTaskId: string }>,
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
	): void {
		for (const { oldTaskId, newTaskId } of completionRemappings) {
			const caldavUID = idMapping.taskIdToCaldavUid[oldTaskId];
			if (caldavUID) {
				delete idMapping.taskIdToCaldavUid[oldTaskId];
				delete idMapping.caldavUidToTaskId[caldavUID];
				idMapping.taskIdToCaldavUid[newTaskId] = caldavUID;
				idMapping.caldavUidToTaskId[caldavUID] = newTaskId;
			}
		}

		for (const change of changeset.toCalDAV) {
			if (change.type === "create") {
				const caldavUID = change.task.uid;
				idMapping.taskIdToCaldavUid[change.task.uid] = caldavUID;
				idMapping.caldavUidToTaskId[caldavUID] = change.task.uid;
			}
			if (change.type === "delete") {
				this.removeFromIdMapping(idMapping, change.task.uid);
			}
		}

		for (const change of changeset.toObsidian) {
			if (change.type === "reconcile" && change.counterpartUid) {
				const obsidianUid = change.task.uid;
				const caldavUid = change.counterpartUid;
				idMapping.taskIdToCaldavUid[obsidianUid] = caldavUid;
				idMapping.caldavUidToTaskId[caldavUid] = obsidianUid;
			}
			if (change.type === "delete") {
				this.removeFromIdMapping(idMapping, change.task.uid);
			}
		}
	}

	private removeFromIdMapping(idMapping: IdMapping, taskId: string): void {
		const caldavUID = idMapping.taskIdToCaldavUid[taskId];
		if (caldavUID) delete idMapping.caldavUidToTaskId[caldavUID];
		delete idMapping.taskIdToCaldavUid[taskId];
	}

	private persistState(
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
		idMapping: IdMapping,
	): void {
		this.storage.setIdMapping(idMapping);
		this.storage.setBaseline(
			this.computeNewBaseline(obsidianTasks, caldavTasks, changeset),
		);
		this.storage.updateLastSyncTime();
	}

	private computeNewBaseline(
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
	): CommonTask[] {
		const baselineMap = new Map<string, CommonTask>();

		for (const task of obsidianTasks) {
			baselineMap.set(task.uid, task);
		}
		for (const task of caldavTasks) {
			// An unmapped CalDAV task has no stable Obsidian identity to persist;
			// keying the baseline by "" would write a phantom duplicate. Matched
			// tasks were already stamped by healUnmappedVaultMatches; anything
			// still empty here (e.g. a mapping-less delete) must not be persisted.
			if (task.uid === "") continue;
			if (!baselineMap.has(task.uid)) {
				baselineMap.set(task.uid, task);
			}
		}

		for (const change of changeset.toObsidian) {
			if (change.type === "create" || change.type === "update" || change.type === "complete" || change.type === "reconcile") {
				baselineMap.set(change.task.uid, change.task);
			} else if (change.type === "delete") {
				baselineMap.delete(change.task.uid);
			}
		}
		for (const change of changeset.toCalDAV) {
			if (change.type === "create" || change.type === "update" || change.type === "complete") {
				baselineMap.set(change.task.uid, change.task);
			} else if (change.type === "delete") {
				baselineMap.delete(change.task.uid);
			}
		}

		return Array.from(baselineMap.values()).map((task) => this.forBaseline(task));
	}

	/**
	 * Strip fields that are derived per fetch and must never reach `baseline.json`.
	 * `caldavId` is re-derived by caldavAdapter.normalize() on every sync, so a
	 * persisted copy is both dead weight and a leak of server identity.
	 */
	private forBaseline(task: CommonTask): CommonTask {
		if (task.caldavId === undefined) return task;
		const copy = { ...task };
		delete copy.caldavId;
		return copy;
	}

	private buildResult(
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[]; conflicts: Conflict[] },
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		baseline: CommonTask[],
		dryRun: boolean,
		showProgress: boolean,
	): SyncResult {
		const counts = this.countChanges(changeset);

		const name = calendarLabel(this.calendar);
		const reconciledSuffix = counts.reconciled > 0 ? ` | Reconciled: ${counts.reconciled}` : "";
		const message = dryRun
			? `[${name}] Dry run complete! Would sync:\n` +
				`From calendar: ${counts.created.toObsidian} created, ${counts.updated.toObsidian} updated, ${counts.deleted.toObsidian} deleted\n` +
				`To calendar: ${counts.created.toCalDAV} created, ${counts.updated.toCalDAV} updated, ${counts.deleted.toCalDAV} deleted\n` +
				`Conflicts: ${changeset.conflicts.length}` +
				(counts.reconciled > 0 ? `\nReconciled: ${counts.reconciled}` : "") +
				`\n\nNo changes were made.`
			: `[${name}] Sync complete! ` +
				`From calendar: ${counts.created.toObsidian}+${counts.updated.toObsidian}+${counts.deleted.toObsidian} | ` +
				`To calendar: ${counts.created.toCalDAV}+${counts.updated.toCalDAV}+${counts.deleted.toCalDAV}` +
				reconciledSuffix;

		if (showProgress) {
			new Notice(message, dryRun ? 10000 : 5000);
		}

		return {
			calendarName: calendarLabel(this.calendar),
			success: true,
			message,
			...counts,
			conflicts: changeset.conflicts.length,
			details: {
				toObsidian: changeset.toObsidian,
				toCalDAV: changeset.toCalDAV,
				conflictDetails: changeset.conflicts,
				obsidianTasks,
				caldavTasks,
				baselineTasks: baseline,
			},
		};
	}

	private countChanges(changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] }): {
		created: { toObsidian: number; toCalDAV: number };
		updated: { toObsidian: number; toCalDAV: number };
		deleted: { toObsidian: number; toCalDAV: number };
		reconciled: number;
	} {
		const count = (changes: SyncChange[], type: string) =>
			changes.filter((c) => c.type === type).length;

		return {
			created: { toObsidian: count(changeset.toObsidian, "create"), toCalDAV: count(changeset.toCalDAV, "create") },
			updated: {
				toObsidian: count(changeset.toObsidian, "update") + count(changeset.toObsidian, "complete"),
				toCalDAV: count(changeset.toCalDAV, "update") + count(changeset.toCalDAV, "complete"),
			},
			deleted: { toObsidian: count(changeset.toObsidian, "delete"), toCalDAV: count(changeset.toCalDAV, "delete") },
			reconciled: count(changeset.toObsidian, "reconcile"),
		};
	}

	private buildErrorResult(error: unknown): SyncResult {
		const errorMsg = error instanceof Error ? error.message : "Unknown error";
		const message = `[${calendarLabel(this.calendar)}] Sync failed: ${errorMsg}`;
		new Notice(message, 8000);
		console.error("Sync error:", error);
		return {
			calendarName: calendarLabel(this.calendar),
			success: false,
			message,
			created: { toObsidian: 0, toCalDAV: 0 },
			updated: { toObsidian: 0, toCalDAV: 0 },
			deleted: { toObsidian: 0, toCalDAV: 0 },
			reconciled: 0,
			conflicts: 0,
			details: { toObsidian: [], toCalDAV: [], conflictDetails: [] },
		};
	}
}
