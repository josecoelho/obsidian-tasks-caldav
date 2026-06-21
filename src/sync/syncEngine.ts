import { App, Notice } from "obsidian";
import { ObsidianTasksWrapper } from "../tasks/obsidianTasksWrapper";
import { CalDAVClientDirect } from "../caldav/calDAVClientDirect";
import { SyncStorage } from "../storage/syncStorage";
import { CalDAVSettings, CalendarMapping, IdMapping } from "../types";
import { CalDAVAdapter } from "./caldavAdapter";
import { ObsidianAdapter } from "./obsidianAdapter";
import { diff } from "./diff";
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

	async sync({ dryRun = false, background = false }: SyncOptions = {}): Promise<SyncResult> {
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

			if (dryRun) return this.buildResult(changeset, obsidianTasks, caldavTasks, baseline, true, showProgress);

			const { createdMappings, completionRemappings } = await this.obsidianAdapter.applyChanges(changeset.toObsidian);
			await this.caldavAdapter.applyChanges(changeset.toCalDAV, idMapping);
			await this.obsidianAdapter.writeBackIds(obsidianTasks);

			this.updateIdMapping(idMapping, createdMappings, completionRemappings, changeset);
			this.persistState(obsidianTasks, caldavTasks, changeset, idMapping);
			await this.storage.save();

			return this.buildResult(changeset, obsidianTasks, caldavTasks, baseline, false, showProgress);
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

	private conflictStrategy(): ConflictStrategy {
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

	private updateIdMapping(
		idMapping: IdMapping,
		createdMappings: Array<{ taskId: string; caldavUID: string }>,
		completionRemappings: Array<{ oldTaskId: string; newTaskId: string }>,
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
	): void {
		for (const { taskId, caldavUID } of createdMappings) {
			idMapping.taskIdToCaldavUid[taskId] = caldavUID;
			idMapping.caldavUidToTaskId[caldavUID] = taskId;
		}

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

		return Array.from(baselineMap.values());
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
