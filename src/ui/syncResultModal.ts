import { App, Modal } from 'obsidian';
import { SyncResult } from '../sync/syncEngine';
import { CommonTask, Conflict, SyncChange } from '../sync/types';

export class SyncResultModal extends Modal {
  private results: SyncResult[];
  private isDryRun: boolean;
  private onApply?: () => Promise<SyncResult[]>;

  constructor(app: App, results: SyncResult[], isDryRun: boolean, onApply?: () => Promise<SyncResult[]>) {
    super(app);
    this.results = results;
    this.isDryRun = isDryRun;
    this.onApply = onApply;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('sync-modal');

    this.setTitle(this.isDryRun ? 'Sync preview (dry run)' : 'Sync results');

    for (const result of this.results) {
      this.renderCalendarSection(contentEl, result);
    }

    this.renderActions(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderCalendarSection(container: HTMLElement, result: SyncResult): void {
    const section = container.createDiv({ cls: 'sync-calendar-section' });
    section.createEl('h3', { text: result.calendarName, cls: 'sync-calendar-heading' });

    this.renderSummary(section, result);

    const details = result.details;

    if (details.obsidianTasks || details.caldavTasks || details.baselineTasks) {
      this.renderSection(section, 'Inputs', (el) => {
        if (details.obsidianTasks) {
          el.createEl('h4', { text: `Obsidian tasks (${details.obsidianTasks.length})` });
          this.renderTaskTable(el, details.obsidianTasks);
        }
        if (details.caldavTasks) {
          el.createEl('h4', { text: `CalDAV tasks (${details.caldavTasks.length})` });
          this.renderTaskTable(el, details.caldavTasks);
        }
        if (details.baselineTasks) {
          el.createEl('h4', { text: `Baseline tasks (${details.baselineTasks.length})` });
          this.renderTaskTable(el, details.baselineTasks);
        }
      }, true);
    }

    const hasChanges = details.toObsidian.length > 0 || details.toCalDAV.length > 0;
    if (hasChanges) {
      this.renderSection(section, 'Changes', (el) => {
        if (details.toObsidian.length > 0) {
          el.createEl('h4', { text: `→ Obsidian (${details.toObsidian.length})` });
          this.renderChanges(el, details.toObsidian);
        }
        if (details.toCalDAV.length > 0) {
          el.createEl('h4', { text: `→ CalDAV (${details.toCalDAV.length})` });
          this.renderChanges(el, details.toCalDAV);
        }
      }, false);
    }

    if (details.conflictDetails.length > 0) {
      this.renderSection(section, `Conflicts (${details.conflictDetails.length})`, (el) => {
        this.renderConflicts(el, details.conflictDetails);
      }, false);
    }

    if (!hasChanges && details.conflictDetails.length === 0) {
      section.createEl('p', {
        text: 'Everything is in sync. No changes needed.',
        cls: 'sync-no-changes',
      });
    }
  }

  private renderSummary(container: HTMLElement, result: SyncResult): void {
    const summary = container.createDiv({ cls: 'sync-summary' });

    const parts: string[] = [];

    const toObs = result.created.toObsidian + result.updated.toObsidian + result.deleted.toObsidian;
    if (toObs > 0) {
      const segments: string[] = [];
      if (result.created.toObsidian) segments.push(`${result.created.toObsidian} created`);
      if (result.updated.toObsidian) segments.push(`${result.updated.toObsidian} updated`);
      if (result.deleted.toObsidian) segments.push(`${result.deleted.toObsidian} deleted`);
      parts.push(`→ Obsidian: ${segments.join(', ')}`);
    }

    const toCal = result.created.toCalDAV + result.updated.toCalDAV + result.deleted.toCalDAV;
    if (toCal > 0) {
      const segments: string[] = [];
      if (result.created.toCalDAV) segments.push(`${result.created.toCalDAV} created`);
      if (result.updated.toCalDAV) segments.push(`${result.updated.toCalDAV} updated`);
      if (result.deleted.toCalDAV) segments.push(`${result.deleted.toCalDAV} deleted`);
      parts.push(`→ CalDAV: ${segments.join(', ')}`);
    }

    if (result.conflicts > 0) {
      parts.push(`${result.conflicts} conflict${result.conflicts > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
      parts.push('No changes');
    }

    for (const part of parts) {
      const badge = summary.createSpan({ cls: 'sync-summary-item' });
      badge.textContent = part;
    }

    if (!result.success) {
      const errorBadge = summary.createSpan({ cls: 'sync-summary-item sync-summary-error' });
      errorBadge.textContent = `Error: ${result.message}`;
    }
  }

  private renderSection(
    container: HTMLElement,
    title: string,
    buildContent: (el: HTMLElement) => void,
    collapsed: boolean,
  ): void {
    const details = container.createEl('details', { cls: 'sync-section' });
    if (!collapsed) {
      details.setAttribute('open', '');
    }
    details.createEl('summary', { text: title, cls: 'sync-section-title' });
    const content = details.createDiv({ cls: 'sync-section-content' });
    buildContent(content);
  }

  private renderTaskTable(container: HTMLElement, tasks: CommonTask[]): void {
    if (tasks.length === 0) {
      container.createEl('p', { text: 'No tasks', cls: 'sync-empty' });
      return;
    }

    const table = container.createEl('table', { cls: 'sync-task-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    for (const header of ['UID', 'Title', 'Status', 'Due', 'Priority']) {
      headerRow.createEl('th', { text: header });
    }

    const tbody = table.createEl('tbody');
    for (const task of tasks) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: this.truncateUid(task.uid), cls: 'sync-uid', attr: { title: task.uid } });
      row.createEl('td', { text: task.title });
      row.createEl('td', { text: task.status });
      row.createEl('td', { text: task.dueDate ?? '—' });
      row.createEl('td', { text: task.priority === 'none' ? '—' : task.priority });
    }
  }

  private renderChanges(container: HTMLElement, changes: SyncChange[]): void {
    const list = container.createDiv({ cls: 'sync-changes' });

    for (const change of changes) {
      const item = list.createDiv({ cls: 'sync-change-item' });

      const badge = item.createSpan({ cls: `sync-badge sync-badge-${change.type}` });
      badge.textContent = change.type;

      const desc = item.createSpan({ cls: 'sync-change-desc' });
      desc.textContent = change.task.title;

      const uid = item.createSpan({ cls: 'sync-change-uid' });
      uid.textContent = this.truncateUid(change.task.uid);
      uid.setAttribute('title', change.task.uid);

      if (change.type === 'update' && change.previousVersion) {
        const diff = this.describeChanges(change.previousVersion, change.task);
        if (diff) {
          const diffEl = item.createDiv({ cls: 'sync-change-diff' });
          diffEl.textContent = diff;
        }
      }
    }
  }

  private renderConflicts(container: HTMLElement, conflicts: Conflict[]): void {
    for (const conflict of conflicts) {
      const conflictEl = container.createDiv({ cls: 'sync-conflict' });

      conflictEl.createEl('h5', { text: `Task: ${conflict.uid}` });

      const grid = conflictEl.createDiv({ cls: 'sync-conflict-grid' });

      const obsCol = grid.createDiv({ cls: 'sync-conflict-col' });
      obsCol.createEl('h6', { text: 'Obsidian' });
      this.renderTaskDetail(obsCol, conflict.obsidianVersion);

      const calCol = grid.createDiv({ cls: 'sync-conflict-col' });
      calCol.createEl('h6', { text: 'CalDAV' });
      this.renderTaskDetail(calCol, conflict.caldavVersion);

      const baseCol = grid.createDiv({ cls: 'sync-conflict-col' });
      baseCol.createEl('h6', { text: 'Baseline' });
      this.renderTaskDetail(baseCol, conflict.baselineVersion);
    }
  }

  private renderTaskDetail(container: HTMLElement, task: CommonTask): void {
    const dl = container.createEl('dl', { cls: 'sync-task-detail' });
    const fields: [string, string][] = [
      ['Title', task.title],
      ['Status', task.status],
      ['Due', task.dueDate ?? '—'],
      ['Priority', task.priority === 'none' ? '—' : task.priority],
      ['Tags', task.tags.length > 0 ? task.tags.join(', ') : '—'],
    ];

    for (const [label, value] of fields) {
      dl.createEl('dt', { text: label });
      dl.createEl('dd', { text: value });
    }
  }

  private renderActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: 'sync-actions' });

    if (this.isDryRun && this.onApply) {
      const applyBtn = actions.createEl('button', {
        text: 'Apply changes',
        cls: 'mod-cta',
      });
      applyBtn.addEventListener('click', () => {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';
        this.onApply!()
          .then((results) => {
            this.close();
            new SyncResultModal(this.app, results, false).open();
          })
          .catch(() => {
            applyBtn.textContent = 'Apply changes';
            applyBtn.disabled = false;
          });
      });
    }

    const closeBtn = actions.createEl('button', { text: 'Close' });
    closeBtn.addEventListener('click', () => this.close());
  }

  private truncateUid(uid: string): string {
    if (uid.length <= 12) return uid;
    return uid.substring(0, 8) + '…';
  }

  private describeChanges(prev: CommonTask, curr: CommonTask): string {
    const diffs: string[] = [];
    if (prev.title !== curr.title) diffs.push('title');
    if (prev.status !== curr.status) diffs.push(`status: ${prev.status} → ${curr.status}`);
    if (prev.dueDate !== curr.dueDate) diffs.push(`due: ${prev.dueDate ?? '—'} → ${curr.dueDate ?? '—'}`);
    if (prev.priority !== curr.priority) diffs.push(`priority: ${prev.priority} → ${curr.priority}`);
    return diffs.join(', ');
  }
}
