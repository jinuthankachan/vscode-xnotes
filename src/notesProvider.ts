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

    // Track open files to prevent multiple watchers
    private openFiles = new Map<string, {
        tempPath: string;
        disposables: vscode.Disposable[];
    }>();

    constructor(
        private context: vscode.ExtensionContext,
        private configService: ConfigService,
        private encryptionService: EncryptionService,
        private gitService: GitService
    ) {}

    private getDefaultCommitMessage(action: string, fileName: string): string {
        const now = new Date();
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
        
        const month = months[now.getUTCMonth()];
        const day = now.getUTCDate().toString().padStart(2, '0');
        const year = now.getUTCFullYear();
        const hours = now.getUTCHours().toString().padStart(2, '0');
        const minutes = now.getUTCMinutes().toString().padStart(2, '0');
        
        const timestamp = `${month} ${day}, ${year} ${hours}:${minutes} UTC`;
        return `${action} ${fileName} @ ${timestamp}`;
    }

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

            return noteItems.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.label.localeCompare(b.label);
            });
        } catch (error) {
            console.error('Error reading directory:', error);
            return [];
        }
    }

    async setup(): Promise<void> {
        const config = await this.configService.setupConfig();
        if (config) {
            if (config.gitRemote) {
                await this.gitService.initRepository(config.notesDirectory, config.gitRemote);
            }
            vscode.commands.executeCommand('setContext', 'xnotesEnabled', true);
            this.refresh();
            vscode.window.showInformationMessage('XNotes setup completed successfully!');
        }
    }

    async createNewNote(): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config) {
            vscode.window.showErrorMessage('Set up XNotes first.');
            return;
        }

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
        
        // Check if file already exists
        if (await fs.pathExists(encryptedPath)) {
            vscode.window.showErrorMessage('A note with this name already exists.');
            return;
        }

        const initContent = `# ${fileName}\n\nYour new note...`;

        try {
            const encryptedContent = this.encryptionService.encrypt(initContent, config.encryptionPassword);
            await fs.writeFile(encryptedPath, encryptedContent);
            
            // Commit the new note creation
            const defaultMessage = this.getDefaultCommitMessage('Created file', `${fileName}.md`);
            const commitMessage = await vscode.window.showInputBox({
                prompt: 'Enter commit message for creating this note',
                placeHolder: defaultMessage,
                value: defaultMessage
            });

            if (commitMessage && commitMessage.trim().length > 0) {
                try {
                    await this.gitService.commitAndPush(config.notesDirectory, commitMessage.trim(), !!config.gitRemote);
                    vscode.window.showInformationMessage('New note created and committed: ' + commitMessage);
                } catch (error) {
                    vscode.window.showWarningMessage('Note created but git commit failed: ' + (error instanceof Error ? error.message : error));
                }
            }
            
            this.refresh();

            const noteItem = new NoteItem(`${fileName}.md`, vscode.TreeItemCollapsibleState.None, encryptedPath, false);
            await this.openNote(noteItem);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create note: ${error instanceof Error ? error.message : error}`);
        }
    }

    async createNewFolder(): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config) {
            vscode.window.showErrorMessage('Set up XNotes first.');
            return;
        }

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
            
            // Commit the new folder creation
            const defaultMessage = this.getDefaultCommitMessage('Created folder', folderName);
            const commitMessage = await vscode.window.showInputBox({
                prompt: 'Enter commit message for creating this folder',
                placeHolder: defaultMessage,
                value: defaultMessage
            });

            if (commitMessage && commitMessage.trim().length > 0) {
                try {
                    await this.gitService.commitAndPush(config.notesDirectory, commitMessage.trim(), !!config.gitRemote);
                    vscode.window.showInformationMessage('New folder created and committed: ' + commitMessage);
                } catch (error) {
                    vscode.window.showWarningMessage('Folder created but git commit failed: ' + (error instanceof Error ? error.message : error));
                }
            }
            
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create folder: ${error instanceof Error ? error.message : error}`);
        }
    }

    async openNote(item: NoteItem): Promise<void> {
        const config = await this.configService.getConfig();
        if (!config || item.isDirectory) return;

        // Check if file is already open
        if (this.openFiles.has(item.filePath)) {
            const existingFile = this.openFiles.get(item.filePath)!;
            const document = await vscode.workspace.openTextDocument(existingFile.tempPath);
            await vscode.window.showTextDocument(document);
            return;
        }

        try {
            // Verify encrypted file exists
            if (!(await fs.pathExists(item.filePath))) {
                vscode.window.showErrorMessage('Note file not found.');
                this.refresh();
                return;
            }

            const encryptedContent = await fs.readFile(item.filePath, 'utf8');
            const decryptedContent = this.encryptionService.decrypt(encryptedContent, config.encryptionPassword);

            const tempDir = path.join(this.context.globalStorageUri.fsPath, 'temp');
            await fs.ensureDir(tempDir);

            const tempFileName = path.basename(item.filePath, '.enc') + '.md';
            const tempFilePath = path.join(tempDir, tempFileName + '_' + Date.now()); // Unique temp file

            await fs.writeFile(tempFilePath, decryptedContent);

            const document = await vscode.workspace.openTextDocument(tempFilePath);
            await vscode.window.showTextDocument(document);

            // Set up file watchers
            const disposables: vscode.Disposable[] = [];

            // Save on document save
            const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
                if (savedDoc.uri.fsPath === tempFilePath) {
                    await this.saveEncryptedNote(tempFilePath, item.filePath, config.encryptionPassword, item.label);
                    console.log('Note saved and encrypted:', item.filePath);
                }
            });
            disposables.push(onSaveDisposable);

            // Clean up when document is closed
            const onCloseDisposable = vscode.workspace.onDidCloseTextDocument(async (closedDoc) => {
                if (closedDoc.uri.fsPath === tempFilePath) {
                    // Final save before closing (without commit prompt to avoid annoyance)
                    try {
                        const content = await fs.readFile(tempFilePath, 'utf8');
                        const encrypted = this.encryptionService.encrypt(content, config.encryptionPassword);
                        await fs.writeFile(item.filePath, encrypted);
                    } catch (error) {
                        console.error('Failed to save on close:', error);
                    }

                    // Clean up
                    try {
                        await fs.remove(tempFilePath);
                    } catch (error) {
                        console.error('Failed to remove temp file:', error);
                    }

                    // Remove from tracking and dispose watchers
                    this.openFiles.delete(item.filePath);
                    disposables.forEach(d => d.dispose());

                    console.log('Note closed:', item.filePath);
                }
            });
            disposables.push(onCloseDisposable);

            // Track the open file
            this.openFiles.set(item.filePath, {
                tempPath: tempFilePath,
                disposables
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open note: ${error instanceof Error ? error.message : error}`);
        }
    }

    private async saveEncryptedNote(tempPath: string, encryptedPath: string, password: string, fileName: string): Promise<void> {
        try {
            const content = await fs.readFile(tempPath, 'utf8');
            const encrypted = this.encryptionService.encrypt(content, password);
            await fs.writeFile(encryptedPath, encrypted);
            console.log('Successfully encrypted and saved:', encryptedPath);

            // Prompt user for commit message on save with default
            const defaultMessage = this.getDefaultCommitMessage('Updated file', fileName);
            const commitMessage = await vscode.window.showInputBox({
                prompt: 'Enter commit message for this save',
                placeHolder: defaultMessage,
                value: defaultMessage
            });

            if (commitMessage && commitMessage.trim().length > 0) {
                const config = await this.configService.getConfig();
                if (config) {
                    try {
                        await this.gitService.commitAndPush(config.notesDirectory, commitMessage.trim(), !!config.gitRemote);
                        vscode.window.showInformationMessage('Changes committed: ' + commitMessage);
                    } catch (error) {
                        vscode.window.showErrorMessage('Git commit failed: ' + (error instanceof Error ? error.message : error));
                    }
                }
            }
        } catch (error) {
            console.error('Failed to save encrypted note:', error);
            vscode.window.showErrorMessage('Failed to save note. Please try again.');
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
            console.log('Changes committed successfully');
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
                // Close file if it's open
                if (this.openFiles.has(item.filePath)) {
                    const openFile = this.openFiles.get(item.filePath)!;
                    openFile.disposables.forEach(d => d.dispose());
                    await fs.remove(openFile.tempPath);
                    this.openFiles.delete(item.filePath);
                }

                await fs.remove(item.filePath);
                
                // Commit the deletion
                const defaultMessage = this.getDefaultCommitMessage('Deleted', item.label);
                const commitMessage = await vscode.window.showInputBox({
                    prompt: 'Enter commit message for deleting this item',
                    placeHolder: defaultMessage,
                    value: defaultMessage
                });

                if (commitMessage && commitMessage.trim().length > 0) {
                    const config = await this.configService.getConfig();
                    if (config) {
                        try {
                            await this.gitService.commitAndPush(config.notesDirectory, commitMessage.trim(), !!config.gitRemote);
                            vscode.window.showInformationMessage('Item deleted and committed: ' + commitMessage);
                        } catch (error) {
                            vscode.window.showWarningMessage('Item deleted but git commit failed: ' + (error instanceof Error ? error.message : error));
                        }
                    }
                }
                
                this.refresh();
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
            vscode.window.showInformationMessage('Syncing notes to remote repository...');
            
            // Just push any pending commits, don't create a new one
            const defaultMessage = this.getDefaultCommitMessage('Manual sync', 'repository');
            await this.gitService.commitAndPush(
                config.notesDirectory,
                defaultMessage,
                !!config.gitRemote
            );
            
            vscode.window.showInformationMessage('Successfully synced notes to remote repository.');
        } catch (error) {
            console.error('Sync failed:', error);
            vscode.window.showErrorMessage(`Sync failed: ${error instanceof Error ? error.message : error}`);
        }
    }
}
