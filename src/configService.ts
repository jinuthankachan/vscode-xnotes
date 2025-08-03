import * as vscode from 'vscode';

export interface NotesConfig {
    notesDirectory: string;
    gitRemote?: string;
    encryptionPassword: string;
}

export class ConfigService {
    private config: NotesConfig | null = null;

    constructor(private context: vscode.ExtensionContext) {}

    async setupConfig(): Promise<NotesConfig | null> {
        const directoryUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Notes Directory'
        });

        if (!directoryUri || directoryUri.length === 0) {
            return null;
        }

        const notesDirectory = directoryUri[0].fsPath;

        const password = await vscode.window.showInputBox({
            prompt: 'Enter encryption password',
            password: true,
            validateInput: (value) => (!value || value.length < 6 ? 'Password must be at least 6 characters long' : null)
        });

        if (!password) {
            return null;
        }

        const gitRemote = await vscode.window.showInputBox({
            prompt: 'Enter git remote URL (optional)',
            placeHolder: 'https://github.com/username/repo.git'
        });

        this.config = {
            notesDirectory,
            encryptionPassword: password,
            gitRemote: gitRemote || undefined
        };

        await this.saveConfig();
        return this.config;
    }

    async getConfig(): Promise<NotesConfig | null> {
        if (this.config) return this.config;
        return this.loadConfig();
    }

    async isConfigured(): Promise<boolean> {
        const stored = await this.loadConfig();
        return stored !== null;
    }

    private async loadConfig(): Promise<NotesConfig | null> {
        const stored = this.context.globalState.get<Omit<NotesConfig, 'encryptionPassword'>>('notesConfig');
        if (stored) {
            const password = await vscode.window.showInputBox({
                prompt: 'Enter encryption password',
                password: true
            });
            if (password) {
                this.config = {
                    ...stored,
                    encryptionPassword: password
                };
                return this.config;
            }
        }
        return null;
    }

    private async saveConfig() {
        if (this.config) {
            await this.context.globalState.update('notesConfig', {
                notesDirectory: this.config.notesDirectory,
                gitRemote: this.config.gitRemote
            });
        }
    }
}
