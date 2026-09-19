import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentKind } from '../../shared/domain';
import type { AgentDiscoveryResult, DiscoveryIssue } from './agent-adapter';
import { toDiscoveredInstallation } from './agent-adapter';
import { inspectSkillDirectory, SkillInspectionError } from '../skills/skill-file-inspector';

/** Reads direct child Skill directories from known user roots without writing. */
export async function discoverUserSkillRoots(
  agent: AgentKind,
  roots: readonly string[]
): Promise<AgentDiscoveryResult> {
  const installations: AgentDiscoveryResult['installations'] = [];
  const issues: DiscoveryIssue[] = [];
  const uniqueRoots = [...new Set(roots)].sort();

  for (const root of uniqueRoots) {
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const detail = error instanceof Error ? `无法读取 Skill 根目录：${error.message}` : '无法读取 Skill 根目录。';
        issues.push({ sourcePath: root, detail });
      }
      continue;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const candidatePath = join(root, entry.name);
      try {
        const inspected = await inspectSkillDirectory(candidatePath);
        installations.push(toDiscoveredInstallation(agent, inspected));
      } catch (error) {
        const detail = error instanceof SkillInspectionError ? error.message : '无法读取 Skill 目录。';
        issues.push({ sourcePath: candidatePath, detail });
      }
    }
  }

  return {
    installations: installations.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    issues: issues.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  };
}
