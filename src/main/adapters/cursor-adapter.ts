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

export class CursorAdapter implements AgentAdapter {
  readonly agent = 'cursor' as const;
  private readonly cursorRoot: string;
  private readonly skillRoots: string[];

  constructor(homeDirectory = homedir()) {
    this.cursorRoot = join(homeDirectory, '.cursor');
    this.skillRoots = [
      join(homeDirectory, '.agents', 'skills'),
      join(homeDirectory, '.cursor', 'skills'),
      join(homeDirectory, '.claude', 'skills'),
      join(homeDirectory, '.codex', 'skills')
    ];
  }

  async detect(): Promise<AgentDetection> {
    return existsSync(this.cursorRoot)
      ? { agent: this.agent, availability: 'detected', detail: `发现 Cursor 配置：${this.cursorRoot}` }
      : { agent: this.agent, availability: 'not-detected', detail: '未发现 Cursor 用户级配置目录。' };
  }

  async discoverUserSkills(): Promise<AgentDiscoveryResult> {
    return discoverUserSkillRoots(this.agent, this.skillRoots);
  }

  async assessSkill(): Promise<CompatibilityAssessment> {
    return {
      status: 'compatible-with-warning',
      detail: 'Cursor 没有公开的外部单 Skill 完全禁用机制；disable-model-invocation 不是禁用。'
    };
  }

  managedSkillRoot(): string {
    return join(this.cursorRoot, 'skills');
  }

  reloadBehavior(): 'unknown' {
    return 'unknown';
  }
}
