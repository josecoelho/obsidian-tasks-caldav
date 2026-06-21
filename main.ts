import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { CalDAVSettings, CalendarMapping, DEFAULT_CALDAV_SETTINGS, SyncDirection } from './src/types';
import { describeIncompleteCalendar } from './src/utils/calendarConfig';
import { extractTaskId, isValidTaskId } from './src/utils/taskIdGenerator';
import { SyncEngine, SyncResult } from './src/sync/syncEngine';
import { dumpCalDAVRequests } from './src/caldav/requestDumper';
import { SyncResultModal } from './src/ui/syncResultModal';
import { BrowseCalendarsModal } from './src/ui/browseCalendarsModal';
import { AutoSyncScheduler } from './src/sync/autoSync';
import { runMigrations } from './src/migrations/migrationRunner';

export default class CalDAVSyncPlugin extends Plugin {
	settings!: CalDAVSettings;
	private syncEngines: SyncEngine[] = [];
	private autoSync: AutoSyncScheduler | null = null;

	async onload() {
		await this.loadSettings();

		if (await runMigrations(this.app, this.settings)) {
			await this.saveData(this.settings);
		}

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

		// Pre-calendars-array installs stored a single flat calendar at the top
		// level. Lift it into the new array with the legacy `tag` field intact;
		// migration 003 owns the tag→obsidianTag/caldavCategory split, and
		// `runMigrations` in onload will persist both changes in one write.
		const legacy = loaded;
		if (legacy.serverUrl && !legacy.calendars) {
			this.settings.calendars = [{
				tag: (legacy.syncTag as string) ?? 'sync',
				calendarName: (legacy.calendarName as string) ?? '',
				serverUrl: (legacy.serverUrl as string) ?? '',
				username: (legacy.username as string) ?? '',
				password: (legacy.password as string) ?? '',
			} as unknown as CalDAVSettings['calendars'][number]];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.initializeEngines();
		this.autoSync?.start(this.settings.syncInterval);
	}

	private async initializeEngines(): Promise<void> {
		this.syncEngines = [];
		const skipped: string[] = [];
		let configuredCount = 0;
		for (let index = 0; index < this.settings.calendars.length; index++) {
			const calendar = this.settings.calendars[index];
			const incomplete = describeIncompleteCalendar(calendar, index);
			if (incomplete) {
				skipped.push(incomplete);
				continue;
			}
			configuredCount++;
			const engine = new SyncEngine(this.app, calendar, this.settings);
			const ready = await engine.initialize();
			if (ready) {
				this.syncEngines.push(engine);
			}
		}
		this.notifySkippedCalendars(skipped);
		if (this.syncEngines.length === 0 && configuredCount > 0) {
			new Notice('Sync failed: tasks plugin not available');
		}
	}

	private notifySkippedCalendars(skipped: string[]): void {
		if (skipped.length === 0) {
			return;
		}
		const noun = skipped.length === 1 ? 'calendar' : 'calendars';
		new Notice(`Skipped ${skipped.length} incomplete ${noun}: ${skipped.join('; ')}. Configure in settings.`, 8000);
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
						obsidianTag: '',
						caldavCategory: '',
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
		const direction = calendar.syncDirection ?? 'bidirectional';

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
			.setName('Sync direction')
			.setDesc(this.syncDirectionDesc(direction))
			.addDropdown(dropdown => dropdown
				.addOption('bidirectional', 'Bidirectional')
				.addOption('pull', 'Pull from server only')
				.addOption('push', 'Push to server only')
				.setValue(direction)
				.onChange(async (value) => {
					calendar.syncDirection = value as SyncDirection;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('Obsidian tag')
			.setDesc('Only Obsidian tasks with this tag are pushed to the server. Leave empty to push every task.')
			.addText(text => text
				.setPlaceholder('Sync')
				.setValue(calendar.obsidianTag)
				.onChange(async (value) => {
					calendar.obsidianTag = value;
					await this.plugin.saveSettings();
					updateHint();
				}));

		new Setting(containerEl)
			.setName('Server category')
			.setDesc("Only server tasks with this category are pulled into Obsidian. Leave empty to pull every task (useful when some clients — such as the iOS reminders app — can't set categories).")
			.addText(text => text
				.setPlaceholder('Sync')
				.setValue(calendar.caldavCategory)
				.onChange(async (value) => {
					calendar.caldavCategory = value;
					await this.plugin.saveSettings();
					updateHint();
				}));

		let hintEl: HTMLElement | null = null;
		const updateHint = () => {
			hintEl?.remove();
			hintEl = null;
			if (calendar.obsidianTag || calendar.caldavCategory) return;
			const text = direction === 'pull'
				? 'No filter set — every server task is pulled into this vault (nothing is written back to the server).'
				: direction === 'push'
					? 'No filter set — every task in this vault is pushed to the server (nothing is pulled back).'
					: 'No filter set — every task in this calendar will sync both ways.';
			hintEl = containerEl.createDiv({ cls: 'setting-item-description', text });
		};
		updateHint();

		const calendarUrlSetting = new Setting(containerEl)
			.setName('Calendar URL')
			.addText(text => text
				.setPlaceholder('https://caldav.example.com/dav/calendars/user/personal/')
				.setValue(calendar.calendarUrl ?? '')
				.onChange(async (value) => {
					calendar.calendarUrl = value.trim() || undefined;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Browse calendars')
				.onClick(() => this.openBrowseCalendars(calendar)));
		calendarUrlSetting.settingEl.addClass('sync-calendar-url');

		if (!calendar.calendarUrl && calendar.calendarName.trim()) {
			calendarUrlSetting.setDesc(`Currently matched by name "${calendar.calendarName}" — paste a URL or browse to pin the exact calendar.`);
		} else {
			calendarUrlSetting.setDesc("Paste your calendar's URL, or browse to find it.");
		}

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

	private syncDirectionDesc(direction: SyncDirection): string {
		if (direction === 'pull') {
			return 'Server changes are brought into Obsidian. Nothing is ever written to the server.';
		}
		if (direction === 'push') {
			return 'Obsidian changes are sent to the server. Server changes are never pulled back, though a sync ID is still written into each task that is pushed.';
		}
		return 'Obsidian and the server are kept in sync, both ways.';
	}

	private openBrowseCalendars(calendar: CalendarMapping): void {
		if (!calendar.username.trim() || !calendar.password.trim()) {
			new Notice('Enter username and password first.');
			return;
		}
		new BrowseCalendarsModal(this.app, calendar, async () => {
			await this.plugin.saveSettings();
			this.display();
		}).open();
	}

}
