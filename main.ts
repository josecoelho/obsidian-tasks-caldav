import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { CalDAVSettings, DEFAULT_CALDAV_SETTINGS } from './src/types';
import { ensureTaskId, extractTaskId, isValidTaskId } from './src/utils/taskIdGenerator';

export default class CalDAVSyncPlugin extends Plugin {
	settings: CalDAVSettings;

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
			.setName('Sync query')
			.setDesc('obsidian-tasks query string (e.g., "not done" or "tags include #sync")')
			.addText(text => text
				.setPlaceholder('not done')
				.setValue(this.plugin.settings.syncQuery)
				.onChange(async (value) => {
					this.plugin.settings.syncQuery = value;
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
