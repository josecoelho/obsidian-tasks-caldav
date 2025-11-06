import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from './src/types';
import { ensureTaskId, extractTaskId, isValidTaskId } from './src/utils/taskIdGenerator';
import { TaskManager } from './src/tasks/taskManager';
import { SyncEngine } from './src/sync/syncEngine';

export default class CalDAVSyncPlugin extends Plugin {
	settings: CalDAVSettings;
	syncEngine: SyncEngine | null = null;

	async onload() {
		await this.loadSettings();

		// Command: Inject task IDs into selected lines
		this.addCommand({
			id: 'inject-task-ids',
			name: 'Inject task IDs into selected tasks',
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const selection = editor.getSelection();

				if (selection) {
					// Process selected text
					const lines = selection.split('\n');
					const processedLines = lines.map(line => {
						// Only process lines that look like tasks
						if (line.trim().match(/^-\s*\[.\]\s+/)) {
							const result = ensureTaskId(line);
							if (result.modified) {
								return result.text;
							}
						}
						return line;
					});

					const newText = processedLines.join('\n');
					editor.replaceSelection(newText);

					const addedCount = processedLines.filter((line, i) => line !== lines[i]).length;
					if (addedCount > 0) {
						new Notice(`Added IDs to ${addedCount} task(s)`);
					} else {
						new Notice('All tasks already have IDs');
					}
				} else {
					// Process current line
					const cursor = editor.getCursor();
					const line = editor.getLine(cursor.line);

					if (line.trim().match(/^-\s*\[.\]\s+/)) {
						const result = ensureTaskId(line);
						if (result.modified) {
							editor.setLine(cursor.line, result.text);
							new Notice('Added task ID');
						} else {
							new Notice('Task already has an ID');
						}
					} else {
						new Notice('Current line is not a task');
					}
				}
			}
		});

		// Command: Validate task IDs in document
		this.addCommand({
			id: 'validate-task-ids',
			name: 'Validate task IDs in current document',
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				const content = editor.getValue();
				const lines = content.split('\n');

				let validCount = 0;
				let invalidCount = 0;
				const invalidLines: number[] = [];

				lines.forEach((line, index) => {
					if (line.trim().match(/^-\s*\[.\]\s+/)) {
						const id = extractTaskId(line);
						if (id) {
							if (isValidTaskId(id)) {
								validCount++;
							} else {
								invalidCount++;
								invalidLines.push(index + 1);
							}
						}
					}
				});

				if (invalidCount > 0) {
					new Notice(`Found ${validCount} valid IDs and ${invalidCount} invalid IDs at lines: ${invalidLines.join(', ')}`);
				} else if (validCount > 0) {
					new Notice(`All ${validCount} task IDs are valid`);
				} else {
					new Notice('No task IDs found in document');
				}
			}
		});

		// TEST Command: Access obsidian-tasks getTasks()
		this.addCommand({
			id: 'test-obsidian-tasks-access',
			name: '[TEST] Access obsidian-tasks cache',
			callback: () => {
				console.log('=== Testing obsidian-tasks access ===');

				// Try to access obsidian-tasks plugin
				const tasksPlugin = (this.app as any).plugins.plugins['obsidian-tasks-plugin'];

				if (!tasksPlugin) {
					new Notice('❌ obsidian-tasks plugin not found');
					console.error('obsidian-tasks plugin not available');
					return;
				}

				console.log('✅ obsidian-tasks plugin found:', tasksPlugin);

				// Check if getTasks method exists
				if (typeof tasksPlugin.getTasks !== 'function') {
					new Notice('❌ getTasks() method not found on plugin');
					console.error('getTasks method not available. Available methods:', Object.keys(tasksPlugin));
					return;
				}

				console.log('✅ getTasks() method exists');

				// Try to get tasks
				try {
					const allTasks = tasksPlugin.getTasks();
					console.log('✅ getTasks() returned:', allTasks);
					console.log('Total tasks found:', allTasks.length);

					if (allTasks.length === 0) {
						new Notice('✅ getTasks() works but no tasks found');
						return;
					}

					// Log first task details
					const firstTask = allTasks[0];
					console.log('First task sample:', {
						description: firstTask.description,
						status: firstTask.status,
						isDone: firstTask.isDone,
						priority: firstTask.priority,
						tags: firstTask.tags,
						path: firstTask.taskLocation?.path,
						lineNumber: firstTask.taskLocation?.lineNumber,
						originalMarkdown: firstTask.originalMarkdown,
						dueDate: firstTask.dueDate,
						scheduledDate: firstTask.scheduledDate,
						availableProperties: Object.keys(firstTask)
					});

					new Notice(`✅ Found ${allTasks.length} tasks! Check console for details.`);

				} catch (error) {
					new Notice('❌ Error calling getTasks()');
					console.error('Error accessing getTasks():', error);
				}
			}
		});

		// TEST Command: Test TaskManager
		this.addCommand({
			id: 'test-task-manager',
			name: '[TEST] Test TaskManager functionality',
			callback: async () => {
				console.log('=== Testing TaskManager ===');

				const taskManager = new TaskManager(this.app);

				// Initialize
				const initialized = await taskManager.initialize();

				if (!initialized) {
					new Notice('❌ TaskManager failed to initialize - obsidian-tasks plugin required');
					console.error('TaskManager initialization failed');
					return;
				}

				new Notice('✅ TaskManager initialized');
				console.log('✅ TaskManager initialized');

				// Get all tasks
				const allTasks = taskManager.getAllTasks();
				console.log(`Found ${allTasks.length} total tasks`);

				// Test filtering
				const notDoneTasks = taskManager.getTasksToSync('not done');
				const doneTasks = taskManager.getTasksToSync('done');

				console.log(`Not done tasks: ${notDoneTasks.length}`);
				console.log(`Done tasks: ${doneTasks.length}`);

				// Get stats
				const stats = taskManager.getTaskStats(allTasks);
				console.log('Task statistics:', stats);

				// Check for tasks without IDs
				const tasksWithoutIds = allTasks.filter(t => !taskManager.taskHasId(t));
				console.log(`Tasks without IDs: ${tasksWithoutIds.length}`);

				if (tasksWithoutIds.length > 0) {
					console.log('Sample task without ID:', tasksWithoutIds[0]);
				}

				new Notice(`✅ TaskManager test complete! ${allTasks.length} tasks found. Check console for details.`);
			}
		});

		// Command: Sync Now - Manual sync with CalDAV
		this.addCommand({
			id: 'sync-now',
			name: 'Sync with CalDAV now',
			callback: async () => {
				// Initialize sync engine if not already done
				if (!this.syncEngine) {
					this.syncEngine = new SyncEngine(this.app, this.settings);
					const initialized = await this.syncEngine.initialize();

					if (!initialized) {
						new Notice('❌ Failed to initialize sync engine');
						return;
					}
				}

				// Perform sync
				await this.syncEngine.sync();
			}
		});

		// Command: View Sync Status
		this.addCommand({
			id: 'view-sync-status',
			name: 'View sync status',
			callback: async () => {
				if (!this.syncEngine) {
					this.syncEngine = new SyncEngine(this.app, this.settings);
					await this.syncEngine.initialize();
				}

				const status = await this.syncEngine.getStatus();
				new Notice(status, 8000);
				console.log('Sync Status:', status);
			}
		});

		// Command: Add sync tag to all mapped tasks
		this.addCommand({
			id: 'add-sync-tag-to-mapped-tasks',
			name: 'Add sync tag to all mapped CalDAV tasks',
			callback: async () => {
				const taskManager = new TaskManager(this.app);
				await taskManager.initialize();

				// Load mapping
				const { SyncStorage } = require('./src/storage/syncStorage');
				const storage = new SyncStorage(this.app);
				await storage.initialize();
				const mapping = await storage.loadMapping();

				let updated = 0;
				const allTasks = taskManager.getAllTasks();

				for (const task of allTasks) {
					const taskId = taskManager.getTaskId(task);
					if (!taskId) continue;

					// Check if this task is mapped to CalDAV
					const caldavUID = mapping.tasks[taskId]?.caldavUID;
					if (!caldavUID) continue;

					// Check if task already has the sync tag
					const syncTag = this.settings.syncTag.toLowerCase().replace(/^#/, '');
					const hasSyncTag = task.tags?.some((t: string) =>
						t.toLowerCase().replace(/^#/, '') === syncTag
					);

					if (!hasSyncTag) {
						// Add the sync tag
						const tag = this.settings.syncTag.startsWith('#') ? this.settings.syncTag : `#${this.settings.syncTag}`;
						const newLine = task.originalMarkdown + ` ${tag}`;
						await taskManager.updateTaskInVault(task, newLine);
						updated++;
					}
				}

				new Notice(`Added #${this.settings.syncTag} tag to ${updated} tasks`);
			}
		});

		// Add settings tab
		this.addSettingTab(new CalDAVSettingTab(this.app, this));

		console.log('CalDAV Sync Plugin loaded');
	}

	onunload() {
		console.log('CalDAV Sync Plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_CALDAV_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CalDAVSettingTab extends PluginSettingTab {
	plugin: CalDAVSyncPlugin;

	constructor(app: App, plugin: CalDAVSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'CalDAV Sync Settings' });

		containerEl.createEl('p', {
			text: 'Configure CalDAV server connection and sync behavior.',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('CalDAV server URL (e.g., https://caldav.example.com)')
			.addText(text => text
				.setPlaceholder('https://caldav.example.com')
				.setValue(this.plugin.settings.serverUrl)
				.onChange(async (value) => {
					this.plugin.settings.serverUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('CalDAV username')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.setDesc('CalDAV password')
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('password')
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Calendar name')
			.setDesc('Name of the calendar to sync with')
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.calendarName)
				.onChange(async (value) => {
					this.plugin.settings.calendarName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync tag')
			.setDesc('Tag to filter tasks for sync (e.g., "sync" for #sync). Leave empty to sync all tasks.')
			.addText(text => text
				.setPlaceholder('sync')
				.setValue(this.plugin.settings.syncTag)
				.onChange(async (value) => {
					this.plugin.settings.syncTag = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync interval')
			.setDesc('How often to sync (in minutes)')
			.addText(text => text
				.setPlaceholder('5')
				.setValue(String(this.plugin.settings.syncInterval))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.syncInterval = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('New tasks destination')
			.setDesc('File where new CalDAV tasks will be added')
			.addText(text => text
				.setPlaceholder('Inbox.md')
				.setValue(this.plugin.settings.newTasksDestination)
				.onChange(async (value) => {
					this.plugin.settings.newTasksDestination = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Conflict Resolution' });

		new Setting(containerEl)
			.setName('Require manual conflict resolution')
			.setDesc('When conflicts occur, require manual review before syncing')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.requireManualConflictResolution)
				.onChange(async (value) => {
					this.plugin.settings.requireManualConflictResolution = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-resolve with Obsidian version')
			.setDesc('When conflicts occur, automatically choose Obsidian version')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoResolveObsidianWins)
				.onChange(async (value) => {
					this.plugin.settings.autoResolveObsidianWins = value;
					await this.plugin.saveSettings();
				}));
	}
}
