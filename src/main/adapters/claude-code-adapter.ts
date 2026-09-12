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

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly agent = 'claude-code' as const;
  private readonly configDirectory: string;
  private readonly skillRoot: string;

  constructor(homeDirectory = homedir(), claudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR) {
    this.configDirectory = claudeConfigDirectory || join(homeDirectory, '.claude');
    this.skillRoot = join(this.configDirectory, 'skills');
  }

  async detect(): Promise<AgentDetection> {
    return existsSync(this.configDirectory)
      ? { agent: this.agent, availability: 'detected', detail: `发现 Claude Code 配置：${this.configDirectory}` }
      : { agent: this.agent, availability: 'not-detected', detail: '未发现 Claude Code 用户级配置目录。' };
  }

  async discoverUserSkills(): Promise<AgentDiscoveryResult> {
    return discoverUserSkillRoots(this.agent, [this.skillRoot]);
  }

  async assessSkill(): Promise<CompatibilityAssessment> {
    return {
      status: 'compatible-with-warning',
      detail: 'Claude Code 的 skillOverrides 以名称而非路径为键；同名候选和插件 Skill 必须阻止自动覆盖。'
    };
  }

  managedSkillRoot(): string {
    return this.skillRoot;
  }

  reloadBehavior(): 'hot-reload' {
    return 'hot-reload';
  }
}
