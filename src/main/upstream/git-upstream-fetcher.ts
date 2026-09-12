import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UpstreamSkillSource } from '../../shared/domain';
import { SystemGitCommandExecutor, type GitCommandExecutor } from '../git/git-worktree';
import type { StagedUpstreamCandidate, UpstreamFetcher } from './upstream-update-service';

/**
 * Git-only upstream transport. It clones candidates into a disposable local
 * staging root and never writes the managed library or an Agent directory.
 */
export class GitUpstreamFetcher implements UpstreamFetcher {
  constructor(
    private readonly stagingRoot: string,
    private readonly git: GitCommandExecutor = new SystemGitCommandExecutor()
  ) {}

  async resolveHead(repositoryUrl: string): Promise<string> {
    await mkdir(this.stagingRoot, { recursive: true });
    const output = await this.git.run(['ls-remote', repositoryUrl, 'HEAD'], this.stagingRoot);
    const commit = output.split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('上游仓库未返回可识别的 HEAD Commit。');
    return commit;
  }

  async stage(source: UpstreamSkillSource): Promise<StagedUpstreamCandidate> {
    const checkout = join(this.stagingRoot, `candidate-${randomUUID()}`);
    await mkdir(this.stagingRoot, { recursive: true });
    try {
      await this.git.run(['clone', '--depth', '1', source.repositoryUrl, checkout], this.stagingRoot);
      const commit = await this.git.run(['rev-parse', 'HEAD'], checkout);
      const skillDirectory = resolveSkillPath(checkout, source.relativePath);
      return {
        commit,
        skillDirectory,
        cleanup: () => rm(checkout, { recursive: true, force: true })
      };
    } catch (error) {
      await rm(checkout, { recursive: true, force: true });
      throw error;
    }
  }
}

function resolveSkillPath(checkout: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('上游 Skill 相对路径不能是绝对路径。');
  const candidate = resolve(checkout, relativePath || '.');
  const rel = relative(checkout, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('上游 Skill 相对路径不能逃离仓库。');
  }
  return candidate;
}
