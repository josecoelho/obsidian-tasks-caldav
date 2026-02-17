/**
 * Mock implementation of Obsidian API for testing
 */

export class App {
    vault: Vault = new Vault();
    plugins: { plugins: Record<string, unknown> } = { plugins: {} };
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
    constructor(_message: string, _timeout?: number) {
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
    setTitle(_title: string): void {}
}

export class Plugin {
    app: App = new App();
    manifest: Record<string, unknown> = {};

    async loadData(): Promise<unknown> {
        return {};
    }

    async saveData(_data: unknown): Promise<void> {
        // Mock save
    }

    addCommand(_command: CommandDefinition): void {
        // Mock add command
    }

    addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
        return document.createElement('div');
    }

    addSettingTab(_tab: PluginSettingTab): void {
        // Mock add setting tab
    }

    registerInterval(_interval: number): void {
        // Mock register interval
    }

    registerDomEvent(_el: HTMLElement | Window | Document, _event: string, _callback: () => void): void {
        // Mock register event
    }
}

interface CommandDefinition {
    id: string;
    name: string;
    callback?: () => void;
    editorCallback?: (editor: Editor, view: MarkdownView) => void;
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

interface TextComponent {
    setPlaceholder(placeholder: string): TextComponent;
    setValue(value: string): TextComponent;
    onChange(callback: (value: string) => void): TextComponent;
    inputEl: HTMLInputElement;
}

interface ToggleComponent {
    setValue(value: boolean): ToggleComponent;
    onChange(callback: (value: boolean) => void): ToggleComponent;
}

export class Setting {
    containerEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
    }

    setName(_name: string): this {
        return this;
    }

    setDesc(_desc: string): this {
        return this;
    }

    setHeading(): this {
        return this;
    }

    addText(cb: (text: TextComponent) => void): this {
        const text: TextComponent = {
            setPlaceholder: () => text,
            setValue: () => text,
            onChange: () => text,
            inputEl: document.createElement('input'),
        };
        cb(text);
        return this;
    }

    addToggle(cb: (toggle: ToggleComponent) => void): this {
        const toggle: ToggleComponent = {
            setValue: () => toggle,
            onChange: () => toggle,
        };
        cb(toggle);
        return this;
    }
}

export interface MarkdownView {
    // Mock interface - Obsidian's MarkdownView has many properties
    // but we only need the type for callback signatures
    file: TFile | null;
}

export interface Editor {
    getSelection(): string;
    replaceSelection(text: string): void;
    getCursor(): { line: number; ch: number };
    getLine(line: number): string;
    setLine(line: number, text: string): void;
    getValue(): string;
}

export function normalizePath(path: string): string {
    return path;
}

export const requestUrl = jest.fn();
