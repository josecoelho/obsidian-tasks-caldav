import { App, Notice } from "obsidian";
import { ObsidianTasksWrapper } from "../tasks/obsidianTasksWrapper";
import { CalDAVClientDirect } from "../caldav/calDAVClientDirect";
import { SyncStorage } from "../storage/syncStorage";
import { CalDAVSettings, IdMapping } from "../types";
import { CalDAVAdapter } from "./caldavAdapter";
import { ObsidianAdapter } from "./obsidianAdapter";
import { diff } from "./diff";
import { CommonTask, Conflict, ConflictStrategy, SyncChange } from "./types";

export interface SyncResult {
	success: boolean;
	message: string;
	created: { toObsidian: number; toCalDAV: number };
	updated: { toObsidian: number; toCalDAV: number };
	deleted: { toObsidian: number; toCalDAV: number };
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

export class SyncEngine {
	private app: App;
	private settings: CalDAVSettings;
	private wrapper: ObsidianTasksWrapper;
	private storage: SyncStorage;
	private caldavAdapter: CalDAVAdapter;
	private obsidianAdapter: ObsidianAdapter;

	constructor(app: App, settings: CalDAVSettings) {
		this.app = app;
		this.settings = settings;
		this.wrapper = new ObsidianTasksWrapper(app);
		this.storage = new SyncStorage(app);
		this.caldavAdapter = new CalDAVAdapter(
			new CalDAVClientDirect(settings),
		);
		this.obsidianAdapter = new ObsidianAdapter(this.wrapper, {
			syncTag: settings.syncTag,
			newTasksDestination: settings.newTasksDestination,
			newTasksSection: settings.newTasksSection,
		});
	}

	async initialize(): Promise<boolean> {
		const wrapperReady = this.wrapper.initialize();
		if (!wrapperReady) {
			new Notice("obsidian-tasks plugin required for sync");
			return false;
		}

		await this.storage.initialize();
		return true;
	}

	async sync(dryRun: boolean = false): Promise<SyncResult> {
		try {
			const mode = dryRun ? "[DRY RUN] " : "";
			new Notice(`${mode}Starting sync...`);

			const syncTag = this.settings.syncTag;
			const idMapping = this.storage.getIdMapping();

			// Fetch tasks from both sides (adapters own connect + fetch + normalize + filter)
			const caldavTasks = await this.caldavAdapter.fetchTasks(
				syncTag,
				idMapping,
			);
			const obsidianTasks =
				await this.obsidianAdapter.fetchTasks(syncTag);

			// Load baseline — if empty, seed from IdMapping so the
			// first sync with this engine doesn't duplicate everything.
			let baseline = this.storage.getBaseline();
			if (
				baseline.length === 0 &&
				Object.keys(idMapping.taskIdToCaldavUid).length > 0
			) {
				baseline = this.seedBaselineFromIdMapping(
					obsidianTasks,
					caldavTasks,
					idMapping,
				);
			}

			// Diff
			const strategy: ConflictStrategy = this.settings
				.autoResolveObsidianWins
				? "obsidian-wins"
				: "caldav-wins";
			const changeset = diff(
				obsidianTasks,
				caldavTasks,
				baseline,
				strategy,
			);

			const result: SyncResult = {
				success: true,
				message: "",
				created: { toObsidian: 0, toCalDAV: 0 },
				updated: { toObsidian: 0, toCalDAV: 0 },
				deleted: { toObsidian: 0, toCalDAV: 0 },
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

			// Count changes by type
			for (const change of changeset.toObsidian) {
				result[
					change.type === "create"
						? "created"
						: change.type === "update"
							? "updated"
							: "deleted"
				].toObsidian++;
			}
			for (const change of changeset.toCalDAV) {
				result[
					change.type === "create"
						? "created"
						: change.type === "update"
							? "updated"
							: "deleted"
				].toCalDAV++;
			}

			if (dryRun) {
				result.message =
					`Dry run complete! Would sync:\n` +
					`From CalDAV: ${result.created.toObsidian} created, ${result.updated.toObsidian} updated, ${result.deleted.toObsidian} deleted\n` +
					`To CalDAV: ${result.created.toCalDAV} created, ${result.updated.toCalDAV} updated, ${result.deleted.toCalDAV} deleted\n` +
					`Conflicts: ${result.conflicts}\n\nNo changes were made.`;
				new Notice(result.message, 10000);
				return result;
			}

			// Apply changes (adapters own their I/O — no wrapper/client params)
			const createdMappings = await this.obsidianAdapter.applyChanges(
				changeset.toObsidian,
			);
			await this.caldavAdapter.applyChanges(
				changeset.toCalDAV,
				idMapping,
			);
			await this.obsidianAdapter.writeBackIds(obsidianTasks);

			// Update IdMapping with new and deleted tasks
			this.updateIdMapping(idMapping, createdMappings, changeset);
			this.storage.setIdMapping(idMapping);

			// Save new baseline (union of current state after applying changes)
			const newBaseline = this.computeNewBaseline(
				obsidianTasks,
				caldavTasks,
				changeset,
			);
			this.storage.setBaseline(newBaseline);

			// Save state
			this.storage.updateLastSyncTime();
			await this.storage.save();

			result.message =
				`Sync complete! ` +
				`From CalDAV: ${result.created.toObsidian}+${result.updated.toObsidian}+${result.deleted.toObsidian} | ` +
				`To CalDAV: ${result.created.toCalDAV}+${result.updated.toCalDAV}+${result.deleted.toCalDAV}`;
			new Notice(result.message, 5000);

			return result;
		} catch (error) {
			const errorMsg =
				error instanceof Error ? error.message : "Unknown error";
			const message = `Sync failed: ${errorMsg}`;
			new Notice(message, 8000);
			console.error("Sync error:", error);
			return {
				success: false,
				message,
				created: { toObsidian: 0, toCalDAV: 0 },
				updated: { toObsidian: 0, toCalDAV: 0 },
				deleted: { toObsidian: 0, toCalDAV: 0 },
				conflicts: 0,
				details: { toObsidian: [], toCalDAV: [], conflictDetails: [] },
			};
		}
	}

	getStatus(): string {
		const state = this.storage.getState();
		const idMapping = this.storage.getIdMapping();
		const baseline = this.storage.getBaseline();

		const lastSync = state.lastSyncTime
			? new Date(state.lastSyncTime).toLocaleString()
			: "Never";
		const mappedTasks = Object.keys(idMapping.taskIdToCaldavUid).length;
		const baselineTasks = baseline.length;
		const conflicts = state.conflicts.length;

		return `Last sync: ${lastSync}\nMapped tasks: ${mappedTasks}\nBaseline tasks: ${baselineTasks}\nConflicts: ${conflicts}`;
	}

	/**
	 * Seed baseline from IdMapping.
	 * Used on first sync with the new engine to avoid duplicating
	 * tasks that were already synced by the old engine.
	 * For each mapped task, use whichever side has it — preferring
	 * Obsidian (since it's the source of truth for content).
	 */
	private seedBaselineFromIdMapping(
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		idMapping: IdMapping,
	): CommonTask[] {
		const obsidianByUid = new Map(obsidianTasks.map((t) => [t.uid, t]));
		const caldavByUid = new Map(caldavTasks.map((t) => [t.uid, t]));
		const baseline: CommonTask[] = [];

		for (const taskId of Object.keys(idMapping.taskIdToCaldavUid)) {
			const obs = obsidianByUid.get(taskId);
			const cal = caldavByUid.get(taskId);
			if (obs) {
				baseline.push(obs);
			} else if (cal) {
				baseline.push(cal);
			}
		}

		return baseline;
	}

	/**
	 * Update IdMapping after sync to track newly created and deleted tasks.
	 */
	private updateIdMapping(
		idMapping: IdMapping,
		createdMappings: Array<{ taskId: string; caldavUID: string }>,
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
	): void {
		// Tasks created in Obsidian from CalDAV
		for (const { taskId, caldavUID } of createdMappings) {
			idMapping.taskIdToCaldavUid[taskId] = caldavUID;
			idMapping.caldavUidToTaskId[caldavUID] = taskId;
		}

		// Tasks created on CalDAV from Obsidian
		for (const change of changeset.toCalDAV) {
			if (change.type === "create") {
				const caldavUID = `obsidian-${change.task.uid}`;
				idMapping.taskIdToCaldavUid[change.task.uid] = caldavUID;
				idMapping.caldavUidToTaskId[caldavUID] = change.task.uid;
			}
			if (change.type === "delete") {
				const caldavUID =
					idMapping.taskIdToCaldavUid[change.task.uid];
				if (caldavUID) {
					delete idMapping.caldavUidToTaskId[caldavUID];
				}
				delete idMapping.taskIdToCaldavUid[change.task.uid];
			}
		}

		// Tasks deleted from Obsidian
		for (const change of changeset.toObsidian) {
			if (change.type === "delete") {
				const caldavUID =
					idMapping.taskIdToCaldavUid[change.task.uid];
				if (caldavUID) {
					delete idMapping.caldavUidToTaskId[caldavUID];
				}
				delete idMapping.taskIdToCaldavUid[change.task.uid];
			}
		}
	}

	/**
	 * Compute the new baseline after applying changes.
	 * The baseline should reflect the "agreed upon" state of both sides.
	 */
	private computeNewBaseline(
		obsidianTasks: CommonTask[],
		caldavTasks: CommonTask[],
		changeset: { toObsidian: SyncChange[]; toCalDAV: SyncChange[] },
	): CommonTask[] {
		const baselineMap = new Map<string, CommonTask>();

		// Start with current obsidian state (this is what Obsidian has now, pre-apply)
		for (const task of obsidianTasks) {
			baselineMap.set(task.uid, task);
		}

		// Merge in CalDAV tasks (covers tasks only on CalDAV)
		for (const task of caldavTasks) {
			if (!baselineMap.has(task.uid)) {
				baselineMap.set(task.uid, task);
			}
		}

		// Apply the changeset to get the "after sync" state
		for (const change of changeset.toObsidian) {
			if (change.type === "create" || change.type === "update") {
				baselineMap.set(change.task.uid, change.task);
			} else if (change.type === "delete") {
				baselineMap.delete(change.task.uid);
			}
		}

		for (const change of changeset.toCalDAV) {
			if (change.type === "create" || change.type === "update") {
				baselineMap.set(change.task.uid, change.task);
			} else if (change.type === "delete") {
				baselineMap.delete(change.task.uid);
			}
		}

		return Array.from(baselineMap.values());
	}
}
