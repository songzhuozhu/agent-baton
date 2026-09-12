import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentAdapter } from '../adapters/agent-adapter';
import { LocalStateStore } from '../storage/local-state-store';

export interface DiagnosticBundlePreview {
  files: string[];
  exclusions: string[];
}

/**
 * Generates a deliberately small local diagnostic bundle. It has no Skill
 * body, credentials, absolute paths, or automatic upload channel.
 */
export class DiagnosticBundleService {
  constructor(
    private readonly adapters: readonly AgentAdapter[],
    private readonly stateStore: LocalStateStore
  ) {}

  preview(): DiagnosticBundlePreview {
    return {
      files: ['diagnostic.json'],
      exclusions: ['Skill 正文', 'GitHub 凭据', '绝对路径', '扫描目录', '备份和日志正文']
    };
  }

  async generate(outputPath: string, now = new Date()): Promise<void> {
    const agents = await Promise.all(this.adapters.map(async (adapter) => {
      const [detection, compatibility] = await Promise.all([adapter.detect(), adapter.assessSkill()]);
      return {
        agent: adapter.agent,
        availability: detection.availability,
        compatibility: compatibility.status,
        restartRequired: this.stateStore.isAgentRestartRequired(adapter.agent)
      };
    }));
    const payload = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      platform: process.platform,
      agents,
      managedSkillCount: this.stateStore.listSkills().length,
      groupCount: this.stateStore.listGroups().length,
      desiredStateCount: this.stateStore.listDesiredAgentStates().length,
      managedInstallationCount: this.stateStore.listObservedInstallations().filter((installation) => installation.managed).length,
      syncAllowedSkillCount: this.stateStore.listSkills().filter((skill) => skill.syncPolicy === 'sync-allowed').length
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}
