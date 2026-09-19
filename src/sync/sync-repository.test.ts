import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PortableSnapshot } from '../shared/domain';
import {
  SyncRepository,
  SyncRepositoryError,
  deterministicJson
} from './sync-repository';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-baton-sync-'));
  temporaryDirectories.push(directory);
  return directory;
}

const portableSnapshot: PortableSnapshot = {
  skills: [{ skill: {
    id: 'skill-a',
    name: 'Design',
    originalDescription: 'must stay in SKILL.md only',
    userDescription: '个人的设计工作流',
    tags: ['personal', 'design'],
    syncPolicy: 'sync-allowed',
    source: { kind: 'local' }
  } }],
  groups: [{ group: {
    id: 'group-a',
    name: '个人全栈',
    participatesInSync: true,
    skillIds: ['skill-a']
  } }],
  agentStates: [{ state: {
    agent: 'codex',
    activeGroupIds: ['group-a'],
    overrides: { 'skill-a': 'force-enable' }
  } }]
};

describe('SyncRepository', () => {
  it('writes a deterministic portable tree without original descriptions or local paths', async () => {
    const repositoryRoot = await temporaryDirectory();
    const source = join(repositoryRoot, 'source');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'SKILL.md'), '---\nname: Design\n---\n');
    const repository = new SyncRepository(repositoryRoot);

    await repository.write({
      snapshot: portableSnapshot,
      tombstones: [{ entity: 'skill', id: 'removed', schemaVersion: 1, deletedAt: '2026-08-09T00:00:00.000Z' }],
      copyContent: async (_id, target) => cp(source, target, { recursive: true })
    });

    const metadata = await readFile(join(repositoryRoot, 'agent-baton', 'skills', 'skill-a', 'metadata.json'), 'utf8');
    expect(metadata).toContain('"schemaVersion": 1');
    expect(metadata).not.toContain('must stay in SKILL.md only');
    expect(metadata).not.toContain(repositoryRoot);
    expect(await readFile(join(repositoryRoot, 'agent-baton', 'skills', 'skill-a', 'content', 'SKILL.md'), 'utf8')).toContain('name: Design');
    await expect(repository.read()).resolves.toMatchObject({
      skills: [{ metadata: { id: 'skill-a', syncPolicy: 'sync-allowed' } }],
      groups: [{ id: 'group-a', skillIds: ['skill-a'] }],
      agentStates: [{ agent: 'codex', activeGroupIds: ['group-a'] }],
      tombstones: [{ id: 'removed' }]
    });
  });

  it('refuses to create a portable repository that contains Local Only content', async () => {
    const repository = new SyncRepository(await temporaryDirectory());
    const localOnly: PortableSnapshot = {
      ...portableSnapshot,
      skills: [{ skill: { ...portableSnapshot.skills[0].skill, syncPolicy: 'local-only' } }]
    };

    await expect(repository.write({ snapshot: localOnly, copyContent: async () => undefined }))
      .rejects.toThrow('Local Only Skill');
  });

  it('refuses to overwrite a sync tree with a newer unknown schema', async () => {
    const repositoryRoot = await temporaryDirectory();
    const formatDirectory = join(repositoryRoot, 'agent-baton');
    await mkdir(formatDirectory, { recursive: true });
    await writeFile(join(formatDirectory, 'format.json'), '{"format":"agent-baton-sync","schemaVersion":2}');
    const repository = new SyncRepository(repositoryRoot);

    await expect(repository.write({ snapshot: portableSnapshot, copyContent: async () => undefined }))
      .rejects.toBeInstanceOf(SyncRepositoryError);
  });

  it('uses sorted keys and a final newline for reviewable JSON', () => {
    expect(deterministicJson({ z: ['b'], a: { y: 1, b: true } })).toBe(
      '{\n  "a": {\n    "b": true,\n    "y": 1\n  },\n  "z": [\n    "b"\n  ]\n}\n'
    );
  });

  it.each(['skill', 'group', 'tombstone'] as const)('rejects a traversing %s ID before copying or writing anything', async (entity) => {
    const repositoryRoot = await temporaryDirectory();
    const sentinel = join(repositoryRoot, 'escaped.json');
    await writeFile(sentinel, 'must stay unchanged');
    const snapshot = structuredClone(portableSnapshot);
    const tombstones = [{ entity: 'skill' as const, id: 'removed', schemaVersion: 1 as const, deletedAt: '2026-08-09T00:00:00.000Z' }];
    if (entity === 'skill') snapshot.skills[0].skill.id = '../../escaped';
    if (entity === 'group') snapshot.groups[0].group.id = '../../escaped';
    if (entity === 'tombstone') tombstones[0].id = '../../escaped';
    let copied = false;

    await expect(new SyncRepository(repositoryRoot).write({
      snapshot,
      tombstones,
      copyContent: async () => { copied = true; }
    })).rejects.toBeInstanceOf(SyncRepositoryError);

    expect(copied).toBe(false);
    expect(await readFile(sentinel, 'utf8')).toBe('must stay unchanged');
    expect(await readdir(repositoryRoot)).toEqual(['escaped.json']);
  });

  it.each(['..', '../escape', '..\\escape', '/absolute', 'C:\\absolute', ''])('rejects the unsafe ID %j when reading a group', async (id) => {
    const repositoryRoot = await temporaryDirectory();
    const portableRoot = join(repositoryRoot, 'agent-baton');
    await mkdir(join(portableRoot, 'groups'), { recursive: true });
    await writeFile(join(portableRoot, 'format.json'), deterministicJson({ format: 'agent-baton-sync', schemaVersion: 1 }));
    await writeFile(join(portableRoot, 'groups', 'group-a.json'), deterministicJson({ ...portableSnapshot.groups[0].group, id, schemaVersion: 1 }));

    await expect(new SyncRepository(repositoryRoot).read()).rejects.toBeInstanceOf(SyncRepositoryError);
  });

  it.each([
    { directory: 'groups', record: { ...portableSnapshot.groups[0].group, schemaVersion: 1 } },
    { directory: 'agent-states', record: { ...portableSnapshot.agentStates[0].state, schemaVersion: 1 } },
    { directory: 'tombstones', record: { entity: 'skill', id: 'removed', schemaVersion: 1, deletedAt: '2026-08-09T00:00:00.000Z' } }
  ])('rejects mismatched record filenames in $directory', async ({ directory, record }) => {
    const repositoryRoot = await temporaryDirectory();
    const portableRoot = join(repositoryRoot, 'agent-baton');
    await mkdir(join(portableRoot, directory), { recursive: true });
    await writeFile(join(portableRoot, 'format.json'), deterministicJson({ format: 'agent-baton-sync', schemaVersion: 1 }));
    await writeFile(join(portableRoot, directory, 'different.json'), deterministicJson(record));

    await expect(new SyncRepository(repositoryRoot).read()).rejects.toThrow('ID 与文件名不一致');
  });

  it.each([
    { source: { kind: 'unknown' } },
    { source: { kind: 'upstream' } },
    { source: { kind: 'upstream', repositoryUrl: 'https://github.com/example/skills', relativePath: '../escape', baselineCommit: 'commit', contentHash: 'hash' } },
    { userDescription: { invalid: true } }
  ])('rejects malformed skill metadata on read and write: %j', async (invalidFields) => {
    const repositoryRoot = await temporaryDirectory();
    const repository = new SyncRepository(repositoryRoot);
    const skill = { ...portableSnapshot.skills[0].skill, ...invalidFields };
    const snapshot = { ...portableSnapshot, skills: [{ skill }] } as unknown as PortableSnapshot;
    await expect(repository.write({ snapshot, copyContent: async () => undefined })).rejects.toBeInstanceOf(SyncRepositoryError);
    expect(await readdir(repositoryRoot)).toEqual([]);

    const portableRoot = repository.portableRoot();
    const skillRoot = join(portableRoot, 'skills', 'skill-a');
    await mkdir(join(skillRoot, 'content'), { recursive: true });
    await writeFile(join(portableRoot, 'format.json'), deterministicJson({ format: 'agent-baton-sync', schemaVersion: 1 }));
    await writeFile(join(skillRoot, 'metadata.json'), deterministicJson({ ...skill, schemaVersion: 1 }));
    await expect(repository.read()).rejects.toBeInstanceOf(SyncRepositoryError);
  });
});
