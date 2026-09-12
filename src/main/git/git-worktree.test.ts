import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloneGitWorktree, GitWorktree, GitWorktreeError, isGitHubHttpsRepositoryUrl, SystemGitCommandExecutor } from './git-worktree';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function git(repository: string, ...args: string[]): Promise<void> {
  await new SystemGitCommandExecutor().run(args, repository);
}

describe('GitWorktree', () => {
  it('only previews and commits the portable subtree', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'agent-baton-git-'));
    temporaryDirectories.push(repository);
    await git(repository, 'init');
    await git(repository, 'config', 'user.name', 'AgentBaton Test');
    await git(repository, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(repository, 'business-code.txt'), 'must not stage');
    await mkdir(join(repository, 'agent-baton'), { recursive: true });
    await writeFile(join(repository, 'agent-baton', 'format.json'), '{"schemaVersion":1}');
    const worktree = new GitWorktree(repository);

    await expect(worktree.status()).resolves.toMatchObject({ changedPortablePaths: ['agent-baton/'] });
    await expect(worktree.remoteRelation()).resolves.toBe('no-upstream');
    const commit = await worktree.commitPortableChanges('sync: update AgentBaton state');

    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await new SystemGitCommandExecutor().run(['status', '--porcelain=v1'], repository)).toBe('?? business-code.txt');
  });

  it('refuses a directory that was not explicitly initialized as a Git repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-baton-no-git-'));
    temporaryDirectories.push(directory);

    await expect(new GitWorktree(directory).status()).rejects.toBeInstanceOf(GitWorktreeError);
  });

  it('refuses to clone over an existing directory before calling Git', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'agent-baton-clone-'));
    temporaryDirectories.push(parent);
    const target = join(parent, 'existing');
    await mkdir(target);
    let called = false;

    await expect(cloneGitWorktree({ repositoryUrl: 'https://github.com/example/skills.git', targetDirectory: target }, {
      run: async () => { called = true; return ''; }
    })).rejects.toThrow('不能覆盖');
    expect(called).toBe(false);
  });

  it('recognizes only HTTPS GitHub repository URLs for App credentials', () => {
    expect(isGitHubHttpsRepositoryUrl('https://github.com/owner/skills.git')).toBe(true);
    expect(isGitHubHttpsRepositoryUrl('https://github.com.evil.example/owner/skills.git')).toBe(false);
    expect(isGitHubHttpsRepositoryUrl('git@github.com:owner/skills.git')).toBe(false);
  });
});
