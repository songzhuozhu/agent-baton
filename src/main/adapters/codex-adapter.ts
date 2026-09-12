import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentAdapter,
  AgentDetection,
  AgentDiscoveryResult,
  CompatibilityAssessment
} from './agent-adapter';
import { discoverUserSkillRoots } from './directory-skill-discovery';

export class CodexAdapter implements AgentAdapter {
  readonly agent = 'codex' as const;
  private readonly skillRoot: string;
  private readonly configPath: string;

  constructor(homeDirectory = homedir()) {
    this.skillRoot = join(homeDirectory, '.agents', 'skills');
    this.configPath = join(homeDirectory, '.codex', 'config.toml');
  }

  async detect(): Promise<AgentDetection> {
    if (existsSync(this.skillRoot) || existsSync(this.configPath)) {
      return {
        agent: this.agent,
        availability: 'detected',
        detail: `发现 Codex 用户配置或 Skill 目录：${this.skillRoot}`
      };
    }

    return {
      agent: this.agent,
      availability: 'not-detected',
      detail: '未发现 Codex 用户级配置或 Skill 目录。'
    };
  }

  async discoverUserSkills(): Promise<AgentDiscoveryResult> {
    return discoverUserSkillRoots(this.agent, [this.skillRoot]);
  }

  async assessSkill(): Promise<CompatibilityAssessment> {
    return {
      status: 'compatible-with-warning',
      detail:
        'Codex 支持用户级 Skill 发现。应用前仍需按目标 Codex 版本验证 skills.config.path 使用目录还是 SKILL.md 路径。'
    };
  }

  managedSkillRoot(): string {
    return this.skillRoot;
  }

  reloadBehavior(): 'requires-restart' {
    return 'requires-restart';
  }
}
