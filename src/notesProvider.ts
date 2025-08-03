import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigService, NotesConfig } from './configService';
import { EncryptionService } from './encryptionService';
import { GitService } from './gitService';

export class NoteItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly filePath: string,
        public readonly isDirectory: boolean
    ) {
        super(label, collapsibleState);

        if (!isDirectory) {
            this.command = { command: 'xnotes.openNote', title: 'Open Note', arguments: [this] };
            this.contextValue = 'note';
            this.iconPath = new vscode.ThemeIcon('note');
        } else {
            this.contextValue = 'folder';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

export class NotesProvider implements vscode.TreeDataProvider<NoteItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NoteItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(
        private context: vscode.ExtensionContext,
        private configService: ConfigService,
        private encryptionService: EncryptionService,
        private gitService: GitService
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NoteItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: NoteItem): Promise<NoteItem[]> {
        const config = await this.configService.getConfig();
        if (!config) return [];

        const directory = element ? element.filePath : config.notesDirectory;

        try {
            const items = await fs.readdir(directory);
            const noteItems: NoteItem[] = [];

            for (const item of items) {
                const fullPath = path.join(directory, item);
                const stat = await fs.stat(fullPath);

                if (stat.isDirectory()) {
                    noteItems.push(new NoteItem(item, vscode.TreeItemCollapsibleState.Collapsed, fullPath, true));
                } else if (item.endsWith('.enc')) {
                    const displayName = item.replace(/\.enc$/, '.md');
                    noteItems.push(new NoteItem(displayName, vscode.TreeItemCollapsibleState.None, fullPath, false));
                }
            }

            return noteItems;
        } catch (error) {
            console.error(error);
            return [];
        }
    }

    async setup(): Promise<void> {
        const config = await this.configService.setupConfig();
        if (config) {
            if (config.gitRemote) await this.gitService.initRepository(config.notesDirectory, config.gitRemote);
            vscode.commands.executeCommand('setContext', 'xnotesEnabled', true);
            this.refresh();
        }
    }

    async createNewNote(): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config) { vscode.window.showErrorMessage('Set up XNotes first.'); return; }

        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter new note name (without extension)',
            validateInput: (value) =>
                !value || value.trim().length === 0
                    ? 'Note name cannot be empty'
                    : value.includes('.') || /[\\/:*?"<>|]/.test(value)
                    ? 'Invalid characters in file name'
                    : null
        });

        if (!fileName) return;

        const encryptedPath = path.join(config.notesDirectory, `${fileName}.enc`);
        const initContent = `# ${fileName}\n\nYour new note...`;

        try {
            const encryptedContent = this.encryptionService.encrypt(initContent, config.encryptionPassword);
            await fs.writeFile(encryptedPath, encryptedContent);
            this.refresh();

            const noteItem = new NoteItem(`${fileName}.md`, vscode.TreeItemCollapsibleState.None, encryptedPath, false);
            await this.openNote(noteItem);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create note: ${error instanceof Error ? error.message : error}`);
        }
    }

    async createNewFolder(): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config) { vscode.window.showErrorMessage('Set up XNotes first.'); return; }

        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter new folder name',
            validateInput: (value) =>
                !value || value.trim().length === 0
                    ? 'Folder name cannot be empty'
                    : /[\\/:*?"<>|]/.test(value)
                    ? 'Invalid characters in folder name'
                    : null
        });

        if (!folderName) return;

        const folderPath = path.join(config.notesDirectory, folderName);

        try {
            await fs.ensureDir(folderPath);
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create folder: ${error instanceof Error ? error.message : error}`);
        }
    }

    async openNote(item: NoteItem): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config || item.isDirectory) return;

        try {
            const encryptedContent = await fs.readFile(item.filePath, 'utf8');
            const decryptedContent = this.encryptionService.decrypt(encryptedContent, config.encryptionPassword);

            const tempDir = path.join(this.context.globalStorageUri.fsPath, 'temp');
            await fs.ensureDir(tempDir);

            const tempFileName = path.basename(item.filePath, '.enc') + '.md';
            const tempFilePath = path.join(tempDir, tempFileName);

            await fs.writeFile(tempFilePath, decryptedContent);

            const document = await vscode.workspace.openTextDocument(tempFilePath);
            await vscode.window.showTextDocument(document);

            const watcher = vscode.workspace.createFileSystemWatcher(tempFilePath);
            const onChangeDisposable = watcher.onDidChange(async () => {
                await this.saveEncryptedNote(tempFilePath, item.filePath, config.encryptionPassword);
            });

            const onCloseDisposable = vscode.workspace.onDidCloseTextDocument(async closedDoc => {
                if (closedDoc.uri.fsPath === tempFilePath) {
                    await this.saveEncryptedNote(tempFilePath, item.filePath, config.encryptionPassword);
                    await this.commitChanges(config);
                    await fs.remove(tempFilePath);
                    onChangeDisposable.dispose();
                    onCloseDisposable.dispose();
                    watcher.dispose();
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open note: ${error instanceof Error ? error.message : error}`);
        }
    }

    private async saveEncryptedNote(tempPath: string, encryptedPath: string, password: string) {
        try {
            const content = await fs.readFile(tempPath, 'utf8');
            const encrypted = this.encryptionService.encrypt(content, password);
            await fs.writeFile(encryptedPath, encrypted);
        } catch (error) {
            console.error('Failed to save encrypted note:', error);
        }
    }

    private async commitChanges(config: NotesConfig): Promise<void> {
        try {
            const timestamp = new Date().toISOString();
            await this.gitService.commitAndPush(
                config.notesDirectory,
                `Auto-commit: ${timestamp}`,
                !!config.gitRemote
            );
        } catch (error) {
            console.error('Git operations failed:', error);
        }
    }

    async deleteItem(item: NoteItem): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${item.label}"?`,
            { modal: true },
            'Yes'
        );

        if (choice === 'Yes') {
            try {
                await fs.remove(item.filePath);
                this.refresh();

                const config = await this.configService.getConfig();
                if (config) await this.commitChanges(config);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete item: ${error instanceof Error ? error.message : error}`);
            }
        }
    }

    async syncToRemote(): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config?.gitRemote) {
            vscode.window.showWarningMessage('No Git remote repository configured.');
            return;
        }

        try {
            await this.commitChanges(config);
            vscode.window.showInformationMessage('Synced notes to remote repository.');
        } catch (error) {
            vscode.window.showErrorMessage(`Sync failed: ${error instanceof Error ? error.message : error}`);
        }
    }
}
