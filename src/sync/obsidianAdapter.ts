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
		const tasks: CommonTask[] = [];
		this.tasksById = new Map();

		for (const { task, body } of inputs) {
			const taskId = extractId(task) ?? generateTaskId();
			this.tasksById.set(taskId, task);
			const common = this.mapper.toCommonTask(task, taskId, body);

			if (this.settings.includeObsidianLink && this.settings.getVaultName) {
				common.obsidianUrl = this.buildObsidianUrl(
					this.settings.getVaultName(),
					task.taskLocation._tasksFile._path,
				);
			}

			tasks.push(common);
		}

		return tasks;
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

		for (const change of changes) {
			try {
				switch (change.type) {
					case "create": {
						const taskId = generateTaskId();
						const taskWithId: CommonTask = {
							...change.task,
							uid: taskId,
						};
						const markdown = this.mapper.toMarkdown(
							taskWithId,
							this.settings.syncTag,
						);

						await this.wrapper.createTask(
							markdown,
							this.settings.newTasksDestination,
							this.settings.newTasksSection,
						);

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
							existingTask.taskLocation._tasksFile._path,
						);

						await this.wrapper.updateTaskInVault(existingTask, result);

						// If toggle produced two lines, second is new recurring occurrence
						const lines = result.split('\n');
						if (lines.length > 1) {
							const idMatch = lines[1].match(/🆔\s+(\S+)/);
							if (idMatch) {
								completionRemappings.push({
									oldTaskId: change.task.uid,
									newTaskId: idMatch[1],
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
		for (const task of obsidianTasks) {
			const original = this.tasksById.get(task.uid);
			if (!original) continue;
			// Only write back if the original task had no ID
			if (this.wrapper.extractId(original)) continue;

			try {
				const markdown = this.mapper.toMarkdown(
					task,
					this.settings.syncTag,
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
}
