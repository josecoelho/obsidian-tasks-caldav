import { App, Modal } from 'obsidian';
import { SyncResult } from '../sync/syncEngine';
import { CommonTask, Conflict, SyncChange } from '../sync/types';

export class SyncResultModal extends Modal {
  private result: SyncResult;
  private isDryRun: boolean;
  private onApply?: () => Promise<SyncResult>;

  constructor(app: App, result: SyncResult, isDryRun: boolean, onApply?: () => Promise<SyncResult>) {
    super(app);
    this.result = result;
    this.isDryRun = isDryRun;
    this.onApply = onApply;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('sync-modal');

    this.setTitle(this.isDryRun ? 'Sync Preview (Dry Run)' : 'Sync Results');

    this.renderSummary(contentEl);

    const details = this.result.details;

    // Inputs section (collapsed)
    if (details.obsidianTasks || details.caldavTasks || details.baselineTasks) {
      this.renderSection(contentEl, 'Inputs', (container) => {
        if (details.obsidianTasks) {
          container.createEl('h4', { text: `Obsidian Tasks (${details.obsidianTasks.length})` });
          this.renderTaskTable(container, details.obsidianTasks);
        }
        if (details.caldavTasks) {
          container.createEl('h4', { text: `CalDAV Tasks (${details.caldavTasks.length})` });
          this.renderTaskTable(container, details.caldavTasks);
        }
        if (details.baselineTasks) {
          container.createEl('h4', { text: `Baseline Tasks (${details.baselineTasks.length})` });
          this.renderTaskTable(container, details.baselineTasks);
        }
      }, true);
    }

    // Changes section (expanded)
    const hasChanges = details.toObsidian.length > 0 || details.toCalDAV.length > 0;
    if (hasChanges) {
      this.renderSection(contentEl, 'Changes', (container) => {
        if (details.toObsidian.length > 0) {
          container.createEl('h4', { text: `→ Obsidian (${details.toObsidian.length})` });
          this.renderChanges(container, details.toObsidian);
        }
        if (details.toCalDAV.length > 0) {
          container.createEl('h4', { text: `→ CalDAV (${details.toCalDAV.length})` });
          this.renderChanges(container, details.toCalDAV);
        }
      }, false);
    }

    // Conflicts section (expanded if any)
    if (details.conflictDetails.length > 0) {
      this.renderSection(contentEl, `Conflicts (${details.conflictDetails.length})`, (container) => {
        this.renderConflicts(container, details.conflictDetails);
      }, false);
    }

    // No changes message
    if (!hasChanges && details.conflictDetails.length === 0) {
      contentEl.createEl('p', {
        text: 'Everything is in sync. No changes needed.',
        cls: 'sync-no-changes',
      });
    }

    // Action buttons
    this.renderActions(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderSummary(container: HTMLElement): void {
    const summary = container.createDiv({ cls: 'sync-summary' });
    const r = this.result;

    const parts: string[] = [];

    const toObs = r.created.toObsidian + r.updated.toObsidian + r.deleted.toObsidian;
    if (toObs > 0) {
      const segments: string[] = [];
      if (r.created.toObsidian) segments.push(`${r.created.toObsidian} created`);
      if (r.updated.toObsidian) segments.push(`${r.updated.toObsidian} updated`);
      if (r.deleted.toObsidian) segments.push(`${r.deleted.toObsidian} deleted`);
      parts.push(`→ Obsidian: ${segments.join(', ')}`);
    }

    const toCal = r.created.toCalDAV + r.updated.toCalDAV + r.deleted.toCalDAV;
    if (toCal > 0) {
      const segments: string[] = [];
      if (r.created.toCalDAV) segments.push(`${r.created.toCalDAV} created`);
      if (r.updated.toCalDAV) segments.push(`${r.updated.toCalDAV} updated`);
      if (r.deleted.toCalDAV) segments.push(`${r.deleted.toCalDAV} deleted`);
      parts.push(`→ CalDAV: ${segments.join(', ')}`);
    }

    if (r.conflicts > 0) {
      parts.push(`${r.conflicts} conflict${r.conflicts > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
      parts.push('No changes');
    }

    // Render as badge items
    for (const part of parts) {
      const badge = summary.createSpan({ cls: 'sync-summary-item' });
      badge.textContent = part;
    }

    if (!this.result.success) {
      const errorBadge = summary.createSpan({ cls: 'sync-summary-item sync-summary-error' });
      errorBadge.textContent = `Error: ${this.result.message}`;
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
    for (const header of ['UID', 'Description', 'Status', 'Due', 'Priority']) {
      headerRow.createEl('th', { text: header });
    }

    const tbody = table.createEl('tbody');
    for (const task of tasks) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: this.truncateUid(task.uid), cls: 'sync-uid', attr: { title: task.uid } });
      row.createEl('td', { text: task.description });
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
      desc.textContent = change.task.description;

      const uid = item.createSpan({ cls: 'sync-change-uid' });
      uid.textContent = this.truncateUid(change.task.uid);
      uid.setAttribute('title', change.task.uid);

      // Show what changed for updates
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

      // Obsidian version
      const obsCol = grid.createDiv({ cls: 'sync-conflict-col' });
      obsCol.createEl('h6', { text: 'Obsidian' });
      this.renderTaskDetail(obsCol, conflict.obsidianVersion);

      // CalDAV version
      const calCol = grid.createDiv({ cls: 'sync-conflict-col' });
      calCol.createEl('h6', { text: 'CalDAV' });
      this.renderTaskDetail(calCol, conflict.caldavVersion);

      // Baseline version
      const baseCol = grid.createDiv({ cls: 'sync-conflict-col' });
      baseCol.createEl('h6', { text: 'Baseline' });
      this.renderTaskDetail(baseCol, conflict.baselineVersion);
    }
  }

  private renderTaskDetail(container: HTMLElement, task: CommonTask): void {
    const dl = container.createEl('dl', { cls: 'sync-task-detail' });
    const fields: [string, string][] = [
      ['Description', task.description],
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
        text: 'Apply Changes',
        cls: 'mod-cta',
      });
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';
        try {
          const result = await this.onApply!();
          this.close();
          new SyncResultModal(this.app, result, false).open();
        } catch (error) {
          applyBtn.textContent = 'Apply Changes';
          applyBtn.disabled = false;
        }
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
    if (prev.description !== curr.description) diffs.push('description');
    if (prev.status !== curr.status) diffs.push(`status: ${prev.status} → ${curr.status}`);
    if (prev.dueDate !== curr.dueDate) diffs.push(`due: ${prev.dueDate ?? '—'} → ${curr.dueDate ?? '—'}`);
    if (prev.priority !== curr.priority) diffs.push(`priority: ${prev.priority} → ${curr.priority}`);
    return diffs.join(', ');
  }
}
