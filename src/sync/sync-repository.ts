import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_KINDS,
  type DesiredAgentState,
  type ManagedSkill,
  type PortableSnapshot,
  type SkillGroup,
  type SkillId
} from '../shared/domain';

export const SYNC_FORMAT_NAME = 'agent-baton-sync';
export const SYNC_SCHEMA_VERSION = 1;

export interface SkillTombstone {
  entity: 'skill';
  id: SkillId;
  schemaVersion: typeof SYNC_SCHEMA_VERSION;
  deletedAt: string;
}

export interface PortableSkillMetadata {
  id: SkillId;
  schemaVersion: typeof SYNC_SCHEMA_VERSION;
  name: string;
  userDescription?: string;
  tags: string[];
  syncPolicy: 'sync-allowed';
  source: ManagedSkill['source'];
}

export interface SyncRepositorySkill {
  metadata: PortableSkillMetadata;
  /** The content location in the checked-out sync repository. */
  contentDirectory: string;
}

export interface SyncRepositorySnapshot {
  skills: SyncRepositorySkill[];
  groups: SkillGroup[];
  agentStates: DesiredAgentState[];
  tombstones: SkillTombstone[];
}

export interface WriteSyncRepositoryInput {
  snapshot: PortableSnapshot;
  tombstones?: readonly SkillTombstone[];
  copyContent: (skillId: SkillId, targetDirectory: string) => Promise<void>;
}

export class SyncRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncRepositoryError';
  }
}

/**
 * Owns only the portable `agent-baton/` tree inside a user-selected dedicated
 * Git repository. The Git working tree and credentials deliberately stay
 * outside this module, making serialization deterministic and testable.
 */
export class SyncRepository {
  constructor(private readonly repositoryRoot: string) {}

  portableRoot(): string {
    return join(this.repositoryRoot, 'agent-baton');
  }

  rootDirectory(): string {
    return this.repositoryRoot;
  }

  async read(): Promise<SyncRepositorySnapshot | undefined> {
    const root = this.portableRoot();
    if (!(await pathExists(root))) {
      return undefined;
    }

    const format = await readJson(join(root, 'format.json'));
    assertFormat(format);
    const skills = await this.readSkills(root);
    const rawGroups = await this.readJsonDirectory<unknown>(join(root, 'groups'));
    const rawAgentStates = await this.readJsonDirectory<unknown>(join(root, 'agent-states'));
    const tombstones = await this.readJsonDirectory<SkillTombstone>(join(root, 'tombstones'));

    const groups = rawGroups.map(toCoreGroup);
    const agentStates = rawAgentStates.map(toCoreAgentState);
    for (const tombstone of tombstones) assertTombstone(tombstone);
    return {
      skills: skills.sort((left, right) => left.metadata.id.localeCompare(right.metadata.id)),
      groups: groups.sort((left, right) => left.id.localeCompare(right.id)),
      agentStates: agentStates.sort((left, right) => left.agent.localeCompare(right.agent)),
      tombstones: tombstones.sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  /**
   * Replaces the portable tree through a same-volume staging rename. The
   * caller must already have shown its Git/local change preview. A malformed
   * or newer existing tree is never overwritten.
   */
  async write(input: WriteSyncRepositoryInput): Promise<void> {
    assertPortableSnapshot(input.snapshot);
    const existing = await this.read();
    void existing;

    await mkdir(this.repositoryRoot, { recursive: true });
    const staging = join(this.repositoryRoot, `.agent-baton-staging-${randomUUID()}`);
    const target = this.portableRoot();
    const backup = join(this.repositoryRoot, `.agent-baton-backup-${randomUUID()}`);

    try {
      await this.writeStaging(staging, input);
      if (await pathExists(target)) {
        await rename(target, backup);
      }
      try {
        await rename(staging, target);
      } catch (error) {
        if (await pathExists(backup)) {
          await rename(backup, target);
        }
        throw error;
      }
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private async writeStaging(staging: string, input: WriteSyncRepositoryInput): Promise<void> {
    await mkdir(staging, { recursive: true });
    await writeDeterministicJson(join(staging, 'format.json'), {
      format: SYNC_FORMAT_NAME,
      schemaVersion: SYNC_SCHEMA_VERSION
    });

    for (const { skill } of [...input.snapshot.skills].sort((left, right) => left.skill.id.localeCompare(right.skill.id))) {
      const directory = join(staging, 'skills', skill.id);
      await writeDeterministicJson(join(directory, 'metadata.json'), toPortableSkillMetadata(skill));
      await input.copyContent(skill.id, join(directory, 'content'));
    }

    for (const { group } of [...input.snapshot.groups].sort((left, right) => left.group.id.localeCompare(right.group.id))) {
      await writeDeterministicJson(join(staging, 'groups', `${group.id}.json`), {
        ...group,
        schemaVersion: SYNC_SCHEMA_VERSION,
        skillIds: [...new Set(group.skillIds)].sort()
      });
    }

    for (const { state } of [...input.snapshot.agentStates].sort((left, right) => left.state.agent.localeCompare(right.state.agent))) {
      await writeDeterministicJson(join(staging, 'agent-states', `${state.agent}.json`), {
        ...state,
        schemaVersion: SYNC_SCHEMA_VERSION,
        activeGroupIds: [...new Set(state.activeGroupIds)].sort(),
        overrides: Object.fromEntries(Object.entries(state.overrides).sort(([left], [right]) => left.localeCompare(right)))
      });
    }

    for (const tombstone of [...(input.tombstones ?? [])].sort((left, right) => left.id.localeCompare(right.id))) {
      assertTombstone(tombstone);
      await writeDeterministicJson(join(staging, 'tombstones', `${tombstone.id}.json`), tombstone);
    }
  }

  private async readSkills(root: string): Promise<SyncRepositorySkill[]> {
    const skillsRoot = join(root, 'skills');
    if (!(await pathExists(skillsRoot))) return [];
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const skills: SyncRepositorySkill[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) {
        throw new SyncRepositoryError(`同步仓库中存在非法 Skill 条目：${entry.name}`);
      }
      const directory = join(skillsRoot, entry.name);
      const metadata = await readJson(join(directory, 'metadata.json'));
      assertPortableSkillMetadata(metadata);
      if (metadata.id !== entry.name) {
        throw new SyncRepositoryError(`Skill 元数据 ID 与目录不一致：${entry.name}`);
      }
      const contentDirectory = join(directory, 'content');
      if (!(await pathExists(contentDirectory))) {
        throw new SyncRepositoryError(`同步 Skill 缺少 content 目录：${metadata.id}`);
      }
      skills.push({ metadata, contentDirectory });
    }
    return skills;
  }

  private async readJsonDirectory<T>(directory: string): Promise<T[]> {
    if (!(await pathExists(directory))) return [];
    const entries = await readdir(directory, { withFileTypes: true });
    const records: T[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw new SyncRepositoryError(`同步仓库中存在非法 JSON 条目：${entry.name}`);
      }
      records.push(await readJson(join(directory, entry.name)) as T);
    }
    return records;
  }
}

export function toPortableSkillMetadata(skill: ManagedSkill): PortableSkillMetadata {
  if (skill.syncPolicy !== 'sync-allowed') {
    throw new SyncRepositoryError(`Local Only Skill 不能写入同步仓库：${skill.id}`);
  }
  return {
    id: skill.id,
    schemaVersion: SYNC_SCHEMA_VERSION,
    name: skill.name,
    ...(skill.userDescription ? { userDescription: skill.userDescription } : {}),
    tags: [...new Set(skill.tags)].sort(),
    syncPolicy: 'sync-allowed',
    source: skill.source
  };
}

export function deterministicJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

async function writeDeterministicJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, deterministicJson(value), 'utf8');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error.';
    throw new SyncRepositoryError(`无法读取同步文件 ${path}: ${message}`);
  }
}

function assertFormat(value: unknown): asserts value is { format: string; schemaVersion: number } {
  if (!isRecord(value) || value.format !== SYNC_FORMAT_NAME || typeof value.schemaVersion !== 'number') {
    throw new SyncRepositoryError('同步仓库 format.json 无效。');
  }
  if (value.schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new SyncRepositoryError(`同步格式版本 ${value.schemaVersion} 高于当前应用支持的版本。`);
  }
  if (value.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncRepositoryError(`不支持的同步格式版本：${value.schemaVersion}`);
  }
}

function assertPortableSnapshot(snapshot: PortableSnapshot): void {
  for (const { skill } of snapshot.skills) toPortableSkillMetadata(skill);
}

function assertPortableSkillMetadata(value: unknown): asserts value is PortableSkillMetadata {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || value.schemaVersion !== SYNC_SCHEMA_VERSION || value.syncPolicy !== 'sync-allowed' || !Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === 'string') || !isRecord(value.source)) {
    throw new SyncRepositoryError('同步 Skill metadata 无效。');
  }
}

function toCoreGroup(value: unknown): SkillGroup {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.participatesInSync !== 'boolean' || !Array.isArray(value.skillIds) || !value.skillIds.every((id) => typeof id === 'string') || value.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncRepositoryError('同步 Group 无效。');
  }
  return {
    id: value.id,
    name: value.name,
    participatesInSync: value.participatesInSync,
    skillIds: [...value.skillIds]
  };
}

function toCoreAgentState(value: unknown): DesiredAgentState {
  if (!isRecord(value) || !AGENT_KINDS.includes(value.agent as DesiredAgentState['agent']) || !Array.isArray(value.activeGroupIds) || !value.activeGroupIds.every((id) => typeof id === 'string') || !isRecord(value.overrides) || !Object.values(value.overrides).every((override) => override === 'force-enable' || override === 'force-disable') || value.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncRepositoryError('同步 Agent State 无效。');
  }
  return {
    agent: value.agent as DesiredAgentState['agent'],
    activeGroupIds: [...value.activeGroupIds],
    overrides: Object.fromEntries(Object.entries(value.overrides)) as DesiredAgentState['overrides']
  };
}

function assertTombstone(value: unknown): asserts value is SkillTombstone {
  if (!isRecord(value) || value.entity !== 'skill' || typeof value.id !== 'string' || typeof value.deletedAt !== 'string' || value.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncRepositoryError('同步删除墓碑无效。');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch(() => false);
}
