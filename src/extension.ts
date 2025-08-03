import * as vscode from 'vscode';
import { NotesProvider } from './notesProvider';
import { EncryptionService } from './encryptionService';
import { GitService } from './gitService';
import { ConfigService } from './configService';

let notesProvider: NotesProvider;

export async function activate(context: vscode.ExtensionContext) {
    const configService = new ConfigService(context);
    const encryptionService = new EncryptionService();
    const gitService = new GitService();

    notesProvider = new NotesProvider(
        context,
        configService,
        encryptionService,
        gitService
    );

    vscode.window.createTreeView('xnotesView', {
        treeDataProvider: notesProvider,
        showCollapseAll: true
    });

    const commands = [
        vscode.commands.registerCommand('xnotes.setup', () => notesProvider.setup()),
        vscode.commands.registerCommand('xnotes.newNote', () => notesProvider.createNewNote()),
        vscode.commands.registerCommand('xnotes.newFolder', () => notesProvider.createNewFolder()),
        vscode.commands.registerCommand('xnotes.deleteItem', (item) => notesProvider.deleteItem(item)),
        vscode.commands.registerCommand('xnotes.sync', () => notesProvider.syncToRemote()),
        vscode.commands.registerCommand('xnotes.openNote', (item) => notesProvider.openNote(item))
    ];

    context.subscriptions.push(...commands);

    if (await configService.isConfigured()) {
        vscode.commands.executeCommand('setContext', 'xnotesEnabled', true);
        notesProvider.refresh();
    }
}

export function deactivate() {}
