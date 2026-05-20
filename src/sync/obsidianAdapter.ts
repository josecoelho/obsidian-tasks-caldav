import { CommonTask, SyncChange } from "./types";
import {
	ObsidianTask,
	TaskWithBody,
	ObsidianTasksWrapper,
} from "../tasks/obsidianTasksWrapper";
import { ObsidianMapper } from "../tasks/obsidianMapper";
import { generateTaskId } from "../utils/taskIdGenerator";

export type { TaskWithBody } from "../tasks/obsidianTasksWrapper";

export interface ApplyChangesResult {
	createdMappings: Array<{ taskId: string; caldavUID: string }>;
	completionRemappings: Array<{ oldTaskId: string; newTaskId: string }>;
}

export interface ObsidianSyncSettings {
	syncTag?: string;
	newTasksDestination: string;
	newTasksSection?: string;
	includeObsidianLink?: boolean;
	// Called at normalize time so vault renames are picked up without reconstructing the adapter.
	getVaultName?: () => string;
}

export class ObsidianAdapter {
	private mapper: ObsidianMapper;
	private wrapper: ObsidianTasksWrapper;
	private settings: ObsidianSyncSettings;
	private tasksById = new Map<string, ObsidianTask>();

	constructor(
		wrapper: ObsidianTasksWrapper,
		settings: ObsidianSyncSettings,
		mapper?: ObsidianMapper,
	) {
		this.wrapper = wrapper;
		this.settings = settings;
		this.mapper = mapper ?? new ObsidianMapper();
	}

	isReady(): boolean {
		return this.wrapper.initialize();
	}

	async fetchTasks(syncTag?: string): Promise<CommonTask[]> {
		const allInputs = await this.wrapper.getAllTasksWithBody();
		const filtered = this.wrapper.filterByTag(allInputs, syncTag);
		return this.normalize(
			filtered,
			(task) => this.wrapper.extractId(task),
		);
	}

	/**
	 * Normalize pre-filtered TaskWithBody[] into CommonTask[].
	 * Assigns IDs internally: uses existing ID from extractId, or generates
	 * an in-memory ID via generateTaskId(). Stores the ID→ObsidianTask
	 * mapping internally for use by applyChanges/writeBackIds.
	 */
	normalize(
		inputs: TaskWithBody[],
		extractId: (task: ObsidianTask) => string | null,
	): CommonTask[] {
		this.tasksById = new Map();
		const idByTask = new Map<ObsidianTask, string>();
		const pending: Array<{ common: CommonTask; parentTask: ObsidianTask | null }> = [];

		for (const { task, body, parentTask } of inputs) {
			const taskId = extractId(task) ?? generateTaskId();
			this.tasksById.set(taskId, task);
			idByTask.set(task, taskId);
			const common = this.mapper.toCommonTask(task, taskId, body);

			if (this.settings.includeObsidianLink && this.settings.getVaultName) {
				common.obsidianUrl = this.buildObsidianUrl(
					this.settings.getVaultName(),
					task.taskLocation.path,
				);
			}

			pending.push({ common, parentTask });
		}

		for (const { common, parentTask } of pending) {
			// parentTask is absent from this batch only when filterByTag excluded
			// the parent; null (top-level) is the correct fallback then, since
			// there is no resolvable ancestor sync UID.
			common.parentUid = parentTask ? (idByTask.get(parentTask) ?? null) : null;
		}

		return pending.map(p => p.common);
	}

	private buildObsidianUrl(vaultName: string, filePath: string): string {
		return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
	}

	/**
	 * Apply sync changes to the Obsidian vault (creates, updates, deletes).
	 */
	async applyChanges(
		changes: SyncChange[],
	): Promise<ApplyChangesResult> {
		const createdMappings: Array<{
			taskId: string;
			caldavUID: string;
		}> = [];
		const completionRemappings: Array<{
			oldTaskId: string;
			newTaskId: string;
		}> = [];

		const orderedChanges = this.orderCreatesParentFirst(changes);
		const createdIdByUid = new Map<string, { taskId: string; created: ObsidianTask | null }>();
		// used by the create and update cases; the complete case delegates serialisation to obsidian-tasks
		const format = await this.wrapper.getConfiguredFormat();

		for (const change of orderedChanges) {
			try {
				switch (change.type) {
					case "create": {
						const taskId = generateTaskId();
						// parentUid is zeroed for the markdown payload because
						// nesting on the Obsidian side is expressed by where
						// insertSubtask places the line, NOT by line content.
						// toMarkdown does not (and must not) read parentUid.
						const taskWithId: CommonTask = { ...change.task, uid: taskId, parentUid: null };
						const markdown = this.mapper.toMarkdown(
							taskWithId,
							this.settings.syncTag,
							format,
						);

						// findTaskById reads the live obsidian-tasks cache, which is
						// NOT refreshed mid-sync. A parent created earlier in this
						// same batch usually won't be found here, so insertSubtask
						// falls back to flat createTask placement. The parent/child
						// link is still carried by parentUid -> CalDAV RELATED-TO and
						// re-nests on a later sync once the cache is warm. This applies
						// transitively: grandchildren also land flat until the cache
						// catches up.
						const parentEntry = change.task.parentUid
							? createdIdByUid.get(change.task.parentUid)
							: undefined;
						const existingParent = change.task.parentUid
							? this.wrapper.findTaskById(
								createdIdByUid.get(change.task.parentUid)?.taskId
								?? change.task.parentUid)
							: null;
						const parentTask = parentEntry?.created ?? existingParent;

						if (parentTask) {
							await this.wrapper.insertSubtask(parentTask, markdown);
						} else {
							await this.wrapper.createTask(
								markdown,
								this.settings.newTasksDestination,
								this.settings.newTasksSection,
							);
						}

						const created = this.wrapper.findTaskById(taskId);
						createdIdByUid.set(change.task.uid, { taskId, created });
						createdMappings.push({
							taskId,
							caldavUID: change.task.uid,
						});
						break;
					}

					case "update": {
						const existingTask =
							this.tasksById.get(change.task.uid) ??
							this.wrapper.findTaskById(change.task.uid);
						if (!existingTask) continue;

						const markdown = this.mapper.toMarkdown(
							change.task,
							this.settings.syncTag,
							format,
						);
						await this.wrapper.updateTaskInVault(
							existingTask,
							markdown,
						);
						break;
					}

					case "complete": {
						const existingTask =
							this.tasksById.get(change.task.uid) ??
							this.wrapper.findTaskById(change.task.uid);
						if (!existingTask) continue;

						const toggleFn = this.wrapper.getToggleCommand();
						if (!toggleFn) {
							throw new Error('obsidian-tasks API not available for task completion');
						}

						const result = toggleFn(
							existingTask.originalMarkdown,
							existingTask.taskLocation.path,
						);

						await this.wrapper.updateTaskInVault(existingTask, result);

						// If toggle produced two lines, second is new recurring occurrence
						const lines = result.split('\n');
						if (lines.length > 1) {
							const idMatch =
							lines[1].match(/\[id::\s*([^\]]+)\]/) ??
							lines[1].match(/🆔\s+(\S+)/);
						if (idMatch) {
								completionRemappings.push({
									oldTaskId: change.task.uid,
									newTaskId: idMatch[1].trim(),
								});
							}
						}
						break;
					}

					case "delete": {
						// Return mapping removal info — SyncEngine handles storage
						break;
					}
					case "reconcile":
						break;
				}
			} catch (error) {
				if (change.type === "complete") throw error;
				console.error(
					`Failed to apply ${change.type} for task ${change.task.uid}:`,
					error,
				);
			}
		}

		return { createdMappings, completionRemappings };
	}

	/**
	 * Write IDs back to vault for tasks that had in-memory IDs generated during normalize.
	 * Only called after sync succeeds, so IDs are only persisted when sync completes.
	 */
	async writeBackIds(obsidianTasks: CommonTask[]): Promise<void> {
		const format = await this.wrapper.getConfiguredFormat();
		for (const task of obsidianTasks) {
			const original = this.tasksById.get(task.uid);
			if (!original) continue;
			// Only write back if the original task had no ID
			if (this.wrapper.extractId(original)) continue;

			try {
				const markdown = this.mapper.toMarkdown(
					task,
					this.settings.syncTag,
					format,
				);
				await this.wrapper.updateTaskInVault(original, markdown);
			} catch (error) {
				console.error(
					`[ObsidianAdapter] Failed to write back ID for task ${task.uid}:`,
					error,
				);
			}
		}
	}

	/**
	 * Look up the original ObsidianTask by its assigned ID.
	 * Used by SyncEngine for mapping resolution after sync.
	 */
	findOriginalTask(uid: string): ObsidianTask | undefined {
		return this.tasksById.get(uid);
	}

	/**
	 * Stable-order changes so that a create whose parent is also being created
	 * appears after its parent. Non-create changes keep their relative order.
	 */
	private orderCreatesParentFirst(changes: SyncChange[]): SyncChange[] {
		const creates = changes.filter(c => c.type === "create");
		const others = changes.filter(c => c.type !== "create");
		const byUid = new Map(creates.map(c => [c.task.uid, c]));
		const ordered: SyncChange[] = [];
		const visited = new Set<string>();
		const visit = (c: SyncChange) => {
			if (visited.has(c.task.uid)) return;
			visited.add(c.task.uid);
			const parentUid = c.task.parentUid;
			if (parentUid && byUid.has(parentUid)) visit(byUid.get(parentUid)!);
			ordered.push(c);
		};
		for (const c of creates) visit(c);
		return [...ordered, ...others];
	}
}
