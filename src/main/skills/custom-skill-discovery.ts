import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { CustomScanRoot } from '../storage/local-state-store';
import { inspectSkillDirectory, SkillInspectionError, type RiskItem } from './skill-file-inspector';

export interface CustomDiscoveredSkill {
  scope: 'custom' | 'project';
  sourcePath: string;
  canonicalPath: string;
  skillName: string;
  originalDescription: string;
  contentHash: string;
  risks: RiskItem[];
}

export interface CustomDiscoveryResult {
  installations: CustomDiscoveredSkill[];
  issues: Array<{ sourcePath: string; detail: string }>;
}

/**
 * Scans only user-added roots and a fixed, shallow set of project Skill
 * locations. It never expands into a disk-wide crawl and never writes.
 */
export async function discoverCustomSkills(roots: readonly CustomScanRoot[]): Promise<CustomDiscoveryResult> {
  const candidates = new Map<string, 'custom' | 'project'>();
  for (const root of roots) {
    const absolute = resolve(root.path);
    if (!isAbsolute(absolute) || !existsSync(absolute)) continue;
    if (root.kind === 'project') {
      for (const relativePath of PROJECT_SKILL_ROOTS) candidates.set(join(absolute, relativePath), 'project');
    } else {
      candidates.set(absolute, 'custom');
    }
  }

  const installations: CustomDiscoveredSkill[] = [];
  const issues: CustomDiscoveryResult['issues'] = [];
  for (const [root, scope] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!existsSync(root)) continue;
    await inspectCandidate(root, scope, installations, issues);
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      await inspectCandidate(join(root, entry.name), scope, installations, issues);
    }
  }

  const unique = new Map<string, CustomDiscoveredSkill>();
  for (const installation of installations) unique.set(installation.canonicalPath, installation);
  return {
    installations: [...unique.values()].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    issues: issues.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  };
}

const PROJECT_SKILL_ROOTS = [
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
  '.opencode/skills'
] as const;

async function inspectCandidate(
  path: string,
  scope: 'custom' | 'project',
  installations: CustomDiscoveredSkill[],
  issues: CustomDiscoveryResult['issues']
): Promise<void> {
  try {
    const skill = await inspectSkillDirectory(path);
    installations.push({
      scope,
      sourcePath: skill.sourcePath,
      canonicalPath: skill.canonicalPath,
      skillName: skill.name,
      originalDescription: skill.originalDescription,
      contentHash: skill.contentHash,
      risks: skill.risks
    });
  } catch (error) {
    if (error instanceof SkillInspectionError && !error.message.includes('SKILL.md')) {
      issues.push({ sourcePath: path, detail: error.message });
    }
  }
}
