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

export class OpenCodeAdapter implements AgentAdapter {
  readonly agent = 'opencode' as const;
  private readonly configDirectory: string;
  private readonly skillRoots: string[];

  constructor(homeDirectory = homedir(), xdgConfigHome = process.env.XDG_CONFIG_HOME) {
    const configHome = xdgConfigHome || join(homeDirectory, '.config');
    this.configDirectory = join(configHome, 'opencode');
    this.skillRoots = [
      join(this.configDirectory, 'skills'),
      join(homeDirectory, '.claude', 'skills'),
      join(homeDirectory, '.agents', 'skills')
    ];
  }

  async detect(): Promise<AgentDetection> {
    return existsSync(this.configDirectory)
      ? { agent: this.agent, availability: 'detected', detail: `发现 OpenCode 配置：${this.configDirectory}` }
      : { agent: this.agent, availability: 'not-detected', detail: '未发现 OpenCode 用户级配置目录。' };
  }

  async discoverUserSkills(): Promise<AgentDiscoveryResult> {
    return discoverUserSkillRoots(this.agent, this.skillRoots);
  }

  async assessSkill(): Promise<CompatibilityAssessment> {
    return {
      status: 'compatible-with-warning',
      detail: 'OpenCode 权限配置正在演进；必须先识别现有配置 schema，未知版本只读。'
    };
  }

  managedSkillRoot(): string {
    return join(this.configDirectory, 'skills');
  }

  reloadBehavior(): 'unknown' {
    return 'unknown';
  }
}
