import * as simpleGit from 'simple-git';

export class GitService {
    async initRepository(directory: string, remote?: string): Promise<void> {
        const repo = simpleGit.simpleGit(directory);
        try {
            const isRepo = await repo.checkIsRepo();

            if (!isRepo) await repo.init();

            if (remote) {
                const remotes = await repo.getRemotes(true);
                const hasOrigin = remotes.some(r => r.name === 'origin');
                if (!hasOrigin) await repo.addRemote('origin', remote);
            }
        } catch (error) {
            console.error('Git initialization failed:', error);
        }
    }

    async commitAndPush(directory: string, message: string, hasRemote: boolean): Promise<void> {
        const repo = simpleGit.simpleGit(directory);

        try {
            await repo.add('.');
            const statusSummary = await repo.status();
            if (statusSummary.staged.length === 0 && statusSummary.modified.length === 0) return;
            await repo.commit(message);

            if (hasRemote) await repo.push('origin', 'main');
        } catch (error) {
            console.error('Git commit/push failed:', error);
            throw error;
        }
    }
}
