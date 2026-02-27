import { CommonTask, SyncChange } from "./types";
import {
	ObsidianTask,
	TaskWithBody,
	ObsidianTasksWrapper,
} from "../tasks/obsidianTasksWrapper";
import { ObsidianMapper } from "../tasks/obsidianMapper";
import { generateTaskId } from "../utils/taskIdGenerator";

export type { TaskWithBody } from "../tasks/obsidianTasksWrapper";

export interface ObsidianSyncSettings {
	syncTag?: string;
	newTasksDestination: string;
	newTasksSection?: string;
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
			tasks.push(this.mapper.toCommonTask(task, taskId, body));
		}

		return tasks;
	}

	/**
	 * Apply sync changes to the Obsidian vault (creates, updates, deletes).
	 */
	async applyChanges(
		changes: SyncChange[],
	): Promise<Array<{ taskId: string; caldavUID: string }>> {
		const createdMappings: Array<{
			taskId: string;
			caldavUID: string;
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

					case "delete": {
						// Return mapping removal info — SyncEngine handles storage
						break;
					}
				}
			} catch (error) {
				console.error(
					`Failed to apply ${change.type} for task ${change.task.uid}:`,
					error,
				);
			}
		}

		return createdMappings;
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
