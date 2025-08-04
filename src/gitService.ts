import * as simpleGit from 'simple-git';
import * as vscode from 'vscode';

export class GitService {
    async initRepository(directory: string, remote?: string): Promise<void> {
        const repo = simpleGit.simpleGit(directory);
        
        try {
            const isRepo = await repo.checkIsRepo();

            if (!isRepo) {
                await repo.init();
                console.log('Initialized git repository');
            }

            if (remote) {
                try {
                    const remotes = await repo.getRemotes(true);
                    const hasOrigin = remotes.some(r => r.name === 'origin');
                    
                    if (!hasOrigin) {
                        await repo.addRemote('origin', remote);
                        console.log('Added remote origin:', remote);
                    } else {
                        // Update existing remote
                        await repo.removeRemote('origin');
                        await repo.addRemote('origin', remote);
                        console.log('Updated remote origin:', remote);
                    }
                } catch (remoteError) {
                    console.error('Failed to set up remote:', remoteError);
                }
            }

            // Set up initial config if needed
            try {
                const config = await repo.listConfig();
                if (!config.all['user.name']) {
                    await repo.addConfig('user.name', 'XNotes User');
                    await repo.addConfig('user.email', 'xnotes@local.dev');
                }
            } catch (configError) {
                console.log('Could not set git config, may already be set globally');
            }

        } catch (error) {
            console.error('Git initialization failed:', error);
            vscode.window.showErrorMessage('Failed to initialize git repository. Check if git is installed.');
        }
    }

    async commitAndPush(directory: string, message: string, hasRemote: boolean): Promise<void> {
        const repo = simpleGit.simpleGit(directory);

        try {
            // Check git status first
            const status = await repo.status();
            
            // Add all changes
            await repo.add('.');
            
            // Check if there's anything to commit after adding
            const statusAfterAdd = await repo.status();
            if (statusAfterAdd.staged.length === 0 && statusAfterAdd.modified.length === 0 && statusAfterAdd.not_added.length === 0) {
                console.log('No changes to commit');
                return;
            }

            // Commit changes
            await repo.commit(message);
            console.log('Committed changes:', message);

            if (hasRemote) {
                try {
                    // Check current branch
                    const branchSummary = await repo.branch();
                    const currentBranch = branchSummary.current;
                    
                    console.log('Current branch:', currentBranch);

                    // Try to push to current branch first
                    try {
                        await repo.push('origin', currentBranch);
                        console.log(`Pushed to origin/${currentBranch}`);
                    } catch (pushError: any) {
                        console.log('Failed to push to current branch, trying main/master');
                        
                        // If current branch push fails, try main/master
                        if (currentBranch !== 'main' && currentBranch !== 'master') {
                            try {
                                // Create and switch to main branch if it doesn't exist
                                if (currentBranch === 'master') {
                                    // Switch to main if we're on master
                                    await repo.checkout(['-b', 'main']);
                                } else if (currentBranch !== 'main') {
                                    // Switch to main branch
                                    await repo.checkout(['-b', 'main']);
                                }
                                
                                await repo.push('origin', 'main');
                                console.log('Pushed to origin/main');
                            } catch (mainPushError) {
                                // Try master as fallback
                                try {
                                    await repo.checkout(['-b', 'master']);
                                    await repo.push('origin', 'master');
                                    console.log('Pushed to origin/master');
                                } catch (masterPushError) {
                                    throw pushError; // Re-throw original error
                                }
                            }
                        } else {
                            // If we're already on main/master and it failed, check if we need to set upstream
                            try {
                                await repo.push('origin', currentBranch, ['--set-upstream']);
                                console.log(`Set upstream and pushed to origin/${currentBranch}`);
                            } catch (upstreamError) {
                                console.error('Push failed even with upstream:', upstreamError);
                                throw pushError;
                            }
                        }
                    }
                } catch (pushError: any) {
                    console.error('Push failed:', pushError);
                    
                    // Provide user-friendly error messages
                    if (pushError.message.includes('authentication')) {
                        throw new Error('Git authentication failed. Please check your credentials or use SSH keys.');
                    } else if (pushError.message.includes('remote')) {
                        throw new Error('Remote repository not accessible. Check your internet connection and repository URL.');
                    } else if (pushError.message.includes('rejected')) {
                        throw new Error('Push rejected. The remote repository may have newer commits. Try pulling first.');
                    } else {
                        throw new Error(`Push failed: ${pushError.message || 'Unknown error'}`);
                    }
                }
            }
        } catch (error: any) {
            console.error('Git commit/push operation failed:', error);
            throw error;
        }
    }

    async pullLatest(directory: string): Promise<void> {
        const repo = simpleGit.simpleGit(directory);
        
        try {
            await repo.pull();
            console.log('Pulled latest changes from remote');
        } catch (error) {
            console.error('Pull failed:', error);
            throw new Error('Failed to pull latest changes from remote repository.');
        }
    }
}
