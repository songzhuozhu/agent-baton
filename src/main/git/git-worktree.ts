import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const execFile = promisify(execFileCallback);

export type GitCommandEnvironment = Readonly<Record<string, string | undefined>>;

export interface GitCommandExecutor {
  run(args: readonly string[], cwd: string, environment?: GitCommandEnvironment): Promise<string>;
}

export class SystemGitCommandExecutor implements GitCommandExecutor {
  async run(args: readonly string[], cwd: string, environment?: GitCommandEnvironment): Promise<string> {
    try {
      const { stdout } = await execFile('git', [...args], {
        cwd,
        windowsHide: true,
        env: { ...process.env, ...environment },
        maxBuffer: 10 * 1024 * 1024
      });
      return stdout.trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown Git error';
      throw new GitWorktreeError(`Git 命令失败（git ${args.join(' ')}）：${detail}`);
    }
  }
}

export interface GitWorktreeStatus {
  repositoryDirectory: string;
  changedPortablePaths: string[];
  upstream: string | undefined;
}

export type GitRemoteRelation = 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-upstream';

export class GitWorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitWorktreeError';
  }
}

export interface CloneGitWorktreeInput {
  repositoryUrl: string;
  targetDirectory: string;
  environment?: GitCommandEnvironment;
}

export function isGitHubHttpsRepositoryUrl(repositoryUrl: string): boolean {
  try {
    const parsed = new URL(repositoryUrl);
    return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com');
  } catch {
    return false;
  }
}

/**
 * Clones only to an absent, user-selected directory. Credentials, when any,
 * exist solely in the supplied child-process environment.
 */
export async function cloneGitWorktree(
  input: CloneGitWorktreeInput,
  git: GitCommandExecutor = new SystemGitCommandExecutor()
): Promise<void> {
  if (!isGitHubHttpsRepositoryUrl(input.repositoryUrl)) {
    throw new GitWorktreeError('GitHub App 同步只接受 HTTPS github.com 仓库地址。');
  }
  if (!isAbsolute(input.targetDirectory)) {
    throw new GitWorktreeError('同步仓库克隆目录必须是绝对路径。');
  }
  if (existsSync(input.targetDirectory)) {
    throw new GitWorktreeError('所选位置已存在同名目录，不能覆盖现有文件。');
  }
  await mkdir(dirname(input.targetDirectory), { recursive: true });
  try {
    await git.run(['clone', '--', input.repositoryUrl, input.targetDirectory], dirname(input.targetDirectory), input.environment);
  } catch (error) {
    // The target was verified absent before clone; removing a partial clone is
    // therefore a narrow cleanup, not deletion of user-owned data.
    await rm(input.targetDirectory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * A narrow Git boundary. It stages only the portable `agent-baton/` subtree.
 * It does not own or persist credentials; an optional per-process environment
 * is supplied by the dedicated Device Flow credential boundary.
 */
export class GitWorktree {
  constructor(
    private readonly repositoryDirectory: string,
    private readonly git: GitCommandExecutor = new SystemGitCommandExecutor(),
    private readonly environment?: GitCommandEnvironment
  ) {}

  async assertRepository(): Promise<void> {
    if (!existsSync(join(this.repositoryDirectory, '.git'))) {
      throw new GitWorktreeError('请选择已初始化的专用 Git 同步仓库。');
    }
    const isWorkTree = await this.run(['rev-parse', '--is-inside-work-tree']);
    if (isWorkTree !== 'true') throw new GitWorktreeError('所选目录不是有效 Git 工作树。');
  }

  async status(): Promise<GitWorktreeStatus> {
    await this.assertRepository();
    const changedPortablePaths = (await this.run(['status', '--porcelain=v1', '--', 'agent-baton']))
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3))
      .sort();
    const upstream = await this.tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    return { repositoryDirectory: resolve(this.repositoryDirectory), changedPortablePaths, upstream };
  }

  async originUrl(): Promise<string> {
    await this.assertRepository();
    const remote = await this.tryRun(['remote', 'get-url', 'origin']);
    if (!remote) throw new GitWorktreeError('同步仓库尚未配置 origin 远端。');
    return remote;
  }

  /** Read-only against remote data; fetching updates local tracking refs only. */
  async fetch(): Promise<void> {
    await this.assertRepository();
    await this.originUrl();
    await this.run(['fetch', '--prune', 'origin']);
  }

  async remoteRelation(): Promise<GitRemoteRelation> {
    await this.assertRepository();
    const upstream = await this.tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (!upstream) return 'no-upstream';
    const counts = await this.run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
      throw new GitWorktreeError('无法判断本地与远端同步仓库的提交关系。');
    }
    if (ahead === 0 && behind === 0) return 'up-to-date';
    if (ahead > 0 && behind === 0) return 'ahead';
    if (ahead === 0 && behind > 0) return 'behind';
    return 'diverged';
  }

  /** Requires a previous user confirmation in the application layer. */
  async commitPortableChanges(message: string): Promise<string | undefined> {
    await this.assertRepository();
    if (!message.trim()) throw new GitWorktreeError('Git 提交说明不能为空。');
    await this.run(['add', '--all', '--', 'agent-baton']);
    const staged = await this.run(['diff', '--cached', '--name-only', '--', 'agent-baton']);
    if (!staged) return undefined;
    // A path-limited commit uses Git's temporary index and preserves unrelated
    // staged changes, which must never be included in a portable sync push.
    await this.run(['commit', '--only', '--no-verify', '-m', message.trim(), '--', 'agent-baton']);
    return this.run(['rev-parse', 'HEAD']);
  }

  /** Never pushes implicitly; it is intentionally separate from commit. */
  async pushHead(): Promise<void> {
    await this.assertRepository();
    const upstream = await this.tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (!upstream) throw new GitWorktreeError('当前分支没有上游，无法安全推送。');
    await this.run(['push', 'origin', 'HEAD']);
  }

  private async tryRun(args: string[]): Promise<string | undefined> {
    try {
      return await this.run(args);
    } catch {
      return undefined;
    }
  }

  private run(args: readonly string[]): Promise<string> {
    return this.git.run(args, this.repositoryDirectory, this.environment);
  }
}
