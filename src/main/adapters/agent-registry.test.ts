import { describe, expect, it } from 'vitest';
import { createBuiltInAgentAdapters } from './agent-registry';

describe('createBuiltInAgentAdapters', () => {
  it('keeps the five V1 Agent identities in a single registry', () => {
    expect(createBuiltInAgentAdapters('/a-test-home').map((adapter) => adapter.agent)).toEqual([
      'codex',
      'claude-code',
      'cursor',
      'trae',
      'opencode'
    ]);
    expect(createBuiltInAgentAdapters('/a-test-home').find((adapter) => adapter.agent === 'trae')?.managedSkillRoot()).toBeUndefined();
  });
});
