/**
 * Mock implementation of Obsidian API for testing
 */

export class App {
    vault: Vault = new Vault();
    plugins: { plugins: Record<string, any> } = { plugins: {} };
}

export class Vault {
    getAbstractFileByPath = jest.fn();
    read = jest.fn();
    modify = jest.fn();
    create = jest.fn();
    getMarkdownFiles = jest.fn();
}

export class TFile {
    path: string = '';
    name: string = '';
    extension: string = 'md';
}

export class Notice {
    constructor(message: string, timeout?: number) {
        // Mock notice - does nothing in tests
    }
}

export class Modal {
    app: App;
    contentEl: HTMLElement;
    constructor(app: App) {
        this.app = app;
        this.contentEl = document.createElement('div');
    }
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
    setTitle(title: string): void {}
}

export class Plugin {
    app: App = new App();
    manifest: any = {};

    async loadData(): Promise<any> {
        return {};
    }

    async saveData(data: any): Promise<void> {
        // Mock save
    }

    addCommand(command: any): void {
        // Mock add command
    }

    addRibbonIcon(icon: string, title: string, callback: Function): any {
        return {};
    }

    addSettingTab(tab: any): void {
        // Mock add setting tab
    }

    registerInterval(interval: number): void {
        // Mock register interval
    }

    registerDomEvent(el: any, event: string, callback: Function): void {
        // Mock register event
    }
}

export class PluginSettingTab {
    app: App;
    plugin: Plugin;

    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
    }

    display(): void {
        // Mock display
    }

    hide(): void {
        // Mock hide
    }
}

export class Setting {
    constructor(containerEl: HTMLElement) {
        // Mock constructor
    }

    setName(name: string): this {
        return this;
    }

    setDesc(desc: string): this {
        return this;
    }

    addText(cb: (text: any) => any): this {
        cb({
            setPlaceholder: () => ({}),
            setValue: () => ({}),
            onChange: () => ({})
        });
        return this;
    }

    addToggle(cb: (toggle: any) => any): this {
        cb({
            setValue: () => ({}),
            onChange: () => ({})
        });
        return this;
    }
}

export interface MarkdownView {
    // Mock interface
}

export interface Editor {
    getSelection(): string;
    replaceSelection(text: string): void;
    getCursor(): any;
    getLine(line: number): string;
    setLine(line: number, text: string): void;
    getValue(): string;
}

export function normalizePath(path: string): string {
    return path;
}

export const requestUrl = jest.fn();
