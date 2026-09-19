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

  it('excludes previously staged private files from the initial portable commit', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'agent-baton-git-private-'));
    temporaryDirectories.push(repository);
    await git(repository, 'init');
    await git(repository, 'config', 'user.name', 'AgentBaton Test');
    await git(repository, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(repository, 'private.txt'), 'private local data');
    await git(repository, 'add', 'private.txt');
    await mkdir(join(repository, 'agent-baton'));
    await writeFile(join(repository, 'agent-baton', 'format.json'), '{"schemaVersion":1}');
    const executor = new SystemGitCommandExecutor();
    const stagedPrivate = await executor.run(['ls-files', '--stage', '--', 'private.txt'], repository);

    await new GitWorktree(repository).commitPortableChanges('sync: initial state');

    expect(await executor.run(['ls-tree', '-r', '--name-only', 'HEAD'], repository)).toBe('agent-baton/format.json');
    expect(await executor.run(['ls-files', '--stage', '--', 'private.txt'], repository)).toBe(stagedPrivate);
    expect(await executor.run(['diff', '--cached', '--name-only'], repository)).toBe('private.txt');
  });

  it.each(['modify', 'delete'] as const)('preserves unrelated staged and unstaged edits when portable files %s', async (change) => {
    const repository = await mkdtemp(join(tmpdir(), 'agent-baton-git-index-'));
    temporaryDirectories.push(repository);
    await git(repository, 'init');
    await git(repository, 'config', 'user.name', 'AgentBaton Test');
    await git(repository, 'config', 'user.email', 'test@example.invalid');
    await mkdir(join(repository, 'agent-baton'));
    const portablePath = join(repository, 'agent-baton', 'format.json');
    await writeFile(portablePath, '{"schemaVersion":1}');
    await writeFile(join(repository, 'private.txt'), 'original');
    await git(repository, 'add', '--all');
    await git(repository, 'commit', '--no-verify', '-m', 'initial');
    await writeFile(join(repository, 'private.txt'), 'staged private edit');
    await git(repository, 'add', 'private.txt');
    await writeFile(join(repository, 'private.txt'), 'unstaged private edit');
    const executor = new SystemGitCommandExecutor();
    const stagedPrivate = await executor.run(['diff', '--cached', '--', 'private.txt'], repository);
    const unstagedPrivate = await executor.run(['diff', '--', 'private.txt'], repository);
    if (change === 'delete') await rm(portablePath);
    else await writeFile(portablePath, '{"schemaVersion":1,"updated":true}');

    await new GitWorktree(repository).commitPortableChanges('sync: update state');

    expect(await executor.run(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], repository)).toBe('agent-baton/format.json');
    expect(await executor.run(['show', 'HEAD:private.txt'], repository)).toBe('original');
    expect(await executor.run(['diff', '--cached', '--', 'private.txt'], repository)).toBe(stagedPrivate);
    expect(await executor.run(['diff', '--', 'private.txt'], repository)).toBe(unstagedPrivate);
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
