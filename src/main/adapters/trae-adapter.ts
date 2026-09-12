import type {
  AgentAdapter,
  AgentDetection,
  AgentDiscoveryResult,
  CompatibilityAssessment
} from './agent-adapter';

export class TraeAdapter implements AgentAdapter {
  readonly agent = 'trae' as const;

  async detect(): Promise<AgentDetection> {
    if (process.platform === 'linux') {
      return {
        agent: this.agent,
        availability: 'unsupported-platform',
        detail: 'TRAE 没有 Linux 客户端的官方支持证据，V1 不提供集成写入。'
      };
    }

    return {
      agent: this.agent,
      availability: 'read-only',
      detail: 'TRAE 的用户级路径和自动化配置格式尚无官方依据，等待真实版本验证。'
    };
  }

  async discoverUserSkills(): Promise<AgentDiscoveryResult> {
    return { installations: [], issues: [] };
  }

  async assessSkill(): Promise<CompatibilityAssessment> {
    return {
      status: 'unknown',
      detail: '缺少 TRAE 用户级路径和配置格式的官方证据，无法安全自动部署。'
    };
  }

  managedSkillRoot(): undefined {
    return undefined;
  }

  reloadBehavior(): 'unknown' {
    return 'unknown';
  }
}
