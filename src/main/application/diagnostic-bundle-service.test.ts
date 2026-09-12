import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../adapters/agent-adapter';
import { LocalStateStore } from '../storage/local-state-store';
import { DiagnosticBundleService } from './diagnostic-bundle-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('DiagnosticBundleService', () => {
  it('previews and writes a local sanitized diagnostic without paths or Skill content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-baton-diagnostic-'));
    temporaryDirectories.push(directory);
    const store = new LocalStateStore(':memory:');
    store.saveSkill({ id: 'skill-a', name: 'private-name', originalDescription: 'secret body', tags: [], syncPolicy: 'local-only', source: { kind: 'local' } });
    store.saveObservedInstallation({ agent: 'codex', path: '/private/device/path', contentHash: 'hash', enabled: true, managed: true });
    const adapter: AgentAdapter = {
      agent: 'codex',
      detect: async () => ({ agent: 'codex', availability: 'detected', detail: '/private/home/.codex' }),
      discoverUserSkills: async () => ({ installations: [], issues: [] }),
      assessSkill: async () => ({ status: 'compatible', detail: 'fixture' }),
      managedSkillRoot: () => '/private/home/.agents/skills'
    };
    const service = new DiagnosticBundleService([adapter], store);
    expect(service.preview()).toEqual(expect.objectContaining({ files: ['diagnostic.json'] }));
    const output = join(directory, 'diagnostic.json');

    await service.generate(output, new Date('2026-08-09T00:00:00.000Z'));

    const body = await readFile(output, 'utf8');
    expect(body).toContain('managedSkillCount');
    expect(body).not.toContain('/private');
    expect(body).not.toContain('secret body');
    expect(body).not.toContain('private-name');
    store.close();
  });
});
