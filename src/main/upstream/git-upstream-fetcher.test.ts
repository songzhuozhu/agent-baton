import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemGitCommandExecutor } from '../git/git-worktree';
import { GitUpstreamFetcher } from './git-upstream-fetcher';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return new SystemGitCommandExecutor().run(args, cwd);
}

describe('GitUpstreamFetcher', () => {
  it('reads HEAD and stages only the declared relative Skill directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-upstream-git-'));
    temporaryDirectories.push(workspace);
    const repository = join(workspace, 'repository');
    await mkdir(join(repository, 'skills', 'design'), { recursive: true });
    await writeFile(join(repository, 'skills', 'design', 'SKILL.md'), '---\nname: design\n---\n');
    await git(repository, 'init');
    await git(repository, 'config', 'user.name', 'AgentBaton Test');
    await git(repository, 'config', 'user.email', 'test@example.invalid');
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-m', 'initial');
    const fetcher = new GitUpstreamFetcher(join(workspace, 'staging'));

    const head = await fetcher.resolveHead(repository);
    const staged = await fetcher.stage({ kind: 'upstream', repositoryUrl: repository, relativePath: 'skills/design', baselineCommit: 'ignored', contentHash: 'sha256:ignored' });

    expect(head).toBe(staged.commit);
    await expect(writeFile(join(staged.skillDirectory, 'extra.md'), 'staged only')).resolves.toBeUndefined();
    await staged.cleanup();
  });

  it('rejects an upstream path that escapes the cloned repository', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-baton-upstream-git-'));
    temporaryDirectories.push(workspace);
    const repository = join(workspace, 'repository');
    await mkdir(repository, { recursive: true });
    await writeFile(join(repository, 'SKILL.md'), '---\nname: root\n---\n');
    await git(repository, 'init');
    await git(repository, 'config', 'user.name', 'AgentBaton Test');
    await git(repository, 'config', 'user.email', 'test@example.invalid');
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-m', 'initial');

    await expect(new GitUpstreamFetcher(join(workspace, 'staging')).stage({ kind: 'upstream', repositoryUrl: repository, relativePath: '../outside', baselineCommit: 'ignored', contentHash: 'sha256:ignored' })).rejects.toThrow('不能逃离');
  });
});
