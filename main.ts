import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from './src/types';
import { extractTaskId, isValidTaskId } from './src/utils/taskIdGenerator';
import { SyncEngine, SyncResult } from './src/sync/syncEngine';
import { dumpCalDAVRequests } from './src/caldav/requestDumper';
import { SyncResultModal } from './src/ui/syncResultModal';
import { AutoSyncScheduler } from './src/sync/autoSync';
import { runMigrations } from './src/migrations/migrationRunner';

export default class CalDAVSyncPlugin extends Plugin {
	settings!: CalDAVSettings;
	private syncEngines: SyncEngine[] = [];
	private autoSync: AutoSyncScheduler | null = null;

	async onload() {
		await this.loadSettings();

		await runMigrations(this.app, this.settings);

		await this.initializeEngines();

		this.addCommand({
			id: 'validate-task-ids',
			name: 'Validate task ids in current document',
			editorCallback: (editor: Editor) => {
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
					new Notice('No task ids found in document');
				}
			}
		});

		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: async () => {
				if (this.syncEngines.length === 0) {
					new Notice('No calendars configured');
					return;
				}
				const results = await this.syncAllEngines(false);
				new SyncResultModal(this.app, results, false).open();
			}
		});

		this.addCommand({
			id: 'sync-dry-run',
			name: 'Preview sync (dry run - no changes)',
			callback: async () => {
				if (this.syncEngines.length === 0) {
					new Notice('No calendars configured');
					return;
				}
				const results = await this.syncAllEngines(true);
				new SyncResultModal(this.app, results, true, () => this.syncAllEngines(false)).open();
			}
		});

		this.addCommand({
			id: 'view-sync-status',
			name: 'View sync status',
			callback: () => {
				if (this.syncEngines.length === 0) {
					new Notice('No calendars configured');
					return;
				}
				const statuses = this.syncEngines.map(e => e.getStatus());
				new Notice(statuses.join('\n---\n'), 8000);
			}
		});

		this.addCommand({
			id: 'dump-caldav-requests',
			name: 'Dump server requests for debugging',
			callback: async () => {
				if (this.settings.calendars.length === 0) {
					new Notice('No calendars configured');
					return;
				}
				new Notice('Dumping server requests...');
				try {
					const result = await dumpCalDAVRequests(this.app, this.settings.calendars[0]);
					new Notice(`${result}\nCheck .caldav-sync/test-caldav-requests/ in your vault.`, 10000);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					new Notice(`Server dump failed: ${msg}`, 8000);
					console.error('[CalDAV] Dump failed:', error);
				}
			}
		});

		this.addSettingTab(new CalDAVSettingTab(this.app, this));

		this.autoSync = new AutoSyncScheduler(
			() => this.syncAll(),
			(id) => this.registerInterval(id),
		);
		this.autoSync.start(this.settings.syncInterval);
	}

	onunload() {
	}

	async loadSettings() {
		const loaded = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		this.settings = Object.assign({}, DEFAULT_CALDAV_SETTINGS, loaded) as CalDAVSettings;

		const legacy = loaded;
		if (legacy.serverUrl && !legacy.calendars) {
			this.settings.calendars = [{
				tag: (legacy.syncTag as string) ?? 'sync',
				calendarName: (legacy.calendarName as string) ?? '',
				serverUrl: (legacy.serverUrl as string) ?? '',
				username: (legacy.username as string) ?? '',
				password: (legacy.password as string) ?? '',
			}];
			await this.saveData(this.settings);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.initializeEngines();
		this.autoSync?.start(this.settings.syncInterval);
	}

	private async initializeEngines(): Promise<void> {
		this.syncEngines = [];
		for (const calendar of this.settings.calendars) {
			const engine = new SyncEngine(this.app, calendar, this.settings);
			const ready = await engine.initialize();
			if (ready) {
				this.syncEngines.push(engine);
			}
		}
		if (this.syncEngines.length === 0 && this.settings.calendars.length > 0) {
			new Notice('Sync failed: tasks plugin not available');
		}
	}

	private async syncAll(): Promise<void> {
		for (const engine of this.syncEngines) {
			await engine.sync({ background: true });
		}
	}

	private async syncAllEngines(dryRun: boolean): Promise<SyncResult[]> {
		const results: SyncResult[] = [];
		for (const engine of this.syncEngines) {
			results.push(await engine.sync({ dryRun }));
		}
		return results;
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

		new Setting(containerEl)
			.setName('Calendars')
			.setHeading();

		for (let i = 0; i < this.plugin.settings.calendars.length; i++) {
			this.renderCalendarMapping(containerEl, i);
		}

		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Add calendar')
				.onClick(async () => {
					this.plugin.settings.calendars.push({
						tag: '',
						calendarName: '',
						serverUrl: '',
						username: '',
						password: '',
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('Behavior')
			.setHeading();

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
			.setDesc('File where new calendar tasks will be added')
			.addText(text => text
				.setPlaceholder('Inbox.md')
				.setValue(this.plugin.settings.newTasksDestination)
				.onChange(async (value) => {
					this.plugin.settings.newTasksDestination = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include Obsidian link in synced tasks')
			.setDesc('Embed a deep link to each synced task so you can open it in Obsidian from your calendar client. The link refreshes only when the task itself changes, so moving the source file will not update already-synced tasks. Existing link lines inside task bodies are stripped on sync-back.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeObsidianLink)
				.onChange(async (value) => {
					this.plugin.settings.includeObsidianLink = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show automatic sync notifications')
			.setDesc('Show progress notices when sync runs automatically in the background. Manual sync and errors always notify.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showAutoSyncNotifications)
				.onChange(async (value) => {
					this.plugin.settings.showAutoSyncNotifications = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Conflict resolution')
			.setHeading();

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

	private renderCalendarMapping(containerEl: HTMLElement, index: number): void {
		const calendar = this.plugin.settings.calendars[index];

		new Setting(containerEl)
			.setName(`Calendar ${index + 1}`)
			.setHeading()
			.addButton(button => button
				.setButtonText('Remove')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.calendars.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('Tag')
			.setDesc('Tag that routes tasks to this calendar (without #)')
			.addText(text => text
				.setPlaceholder('Work')
				.setValue(calendar.tag)
				.onChange(async (value) => {
					calendar.tag = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Calendar name')
			.setDesc('Name of the calendar on the server')
			.addText(text => text
				.setPlaceholder('Work')
				.setValue(calendar.calendarName)
				.onChange(async (value) => {
					calendar.calendarName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('Calendar server URL')
			.addText(text => text
				.setPlaceholder('https://caldav.example.com')
				.setValue(calendar.serverUrl)
				.onChange(async (value) => {
					calendar.serverUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.addText(text => text
				.setPlaceholder('Enter username')
				.setValue(calendar.username)
				.onChange(async (value) => {
					calendar.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Enter password')
					.setValue(calendar.password)
					.onChange(async (value) => {
						calendar.password = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
