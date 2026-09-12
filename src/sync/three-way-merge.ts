import type { DesiredAgentState, SkillGroup } from '../shared/domain';
import { deterministicJson, type PortableSkillMetadata, type SkillTombstone } from './sync-repository';

export interface SyncMergeSkill {
  metadata: PortableSkillMetadata;
  contentHash: string;
}

/** A hash-only portable view used as the persistent merge baseline. */
export interface SyncMergeState {
  skills: SyncMergeSkill[];
  groups: SkillGroup[];
  agentStates: DesiredAgentState[];
  tombstones: SkillTombstone[];
}

export type SyncConflict =
  | {
      kind: 'field';
      entity: 'skill' | 'group' | 'agent-state';
      id: string;
      field: string;
      base: unknown;
      local: unknown;
      remote: unknown;
    }
  | {
      kind: 'content';
      entity: 'skill';
      id: string;
      baseHash?: string;
      localHash?: string;
      remoteHash?: string;
    }
  | {
      kind: 'delete-vs-change';
      entity: 'skill' | 'group' | 'agent-state';
      id: string;
    }
  | {
      kind: 'tombstone';
      entity: 'skill';
      id: string;
      tombstone: SkillTombstone;
    };

export interface ThreeWayMergeResult {
  merged: SyncMergeState;
  conflicts: SyncConflict[];
}

/**
 * Merges only non-overlapping structured changes. It intentionally leaves
 * Skill directory contents opaque: concurrent content changes always require
 * a human choice instead of a text merge.
 */
export function mergeSyncStates(
  base: SyncMergeState,
  local: SyncMergeState,
  remote: SyncMergeState
): ThreeWayMergeResult {
  const conflicts: SyncConflict[] = [];
  const mergedTombstones = mergeTombstones(base, local, remote, conflicts);
  const tombstonesById = new Map(mergedTombstones.map((tombstone) => [tombstone.id, tombstone]));
  const mergedSkills = mergeSkills(base.skills, local.skills, remote.skills, tombstonesById, conflicts);
  const mergedGroups = mergeEntities('group', base.groups, local.groups, remote.groups, (group) => group.id, conflicts);
  const mergedAgentStates = mergeEntities('agent-state', base.agentStates, local.agentStates, remote.agentStates, (state) => state.agent, conflicts);

  return {
    merged: {
      skills: mergedSkills.sort((left, right) => left.metadata.id.localeCompare(right.metadata.id)),
      groups: mergedGroups.sort((left, right) => left.id.localeCompare(right.id)),
      agentStates: mergedAgentStates.sort((left, right) => left.agent.localeCompare(right.agent)),
      tombstones: mergedTombstones.sort((left, right) => left.id.localeCompare(right.id))
    },
    conflicts: conflicts.sort(compareConflict)
  };
}

function mergeSkills(
  baseSkills: readonly SyncMergeSkill[],
  localSkills: readonly SyncMergeSkill[],
  remoteSkills: readonly SyncMergeSkill[],
  tombstonesById: ReadonlyMap<string, SkillTombstone>,
  conflicts: SyncConflict[]
): SyncMergeSkill[] {
  const baseById = indexById(baseSkills, (skill) => skill.metadata.id);
  const localById = indexById(localSkills, (skill) => skill.metadata.id);
  const remoteById = indexById(remoteSkills, (skill) => skill.metadata.id);
  const ids = sortedUnion(baseById.keys(), localById.keys(), remoteById.keys());
  const result: SyncMergeSkill[] = [];

  for (const id of ids) {
    const tombstone = tombstonesById.get(id);
    const base = baseById.get(id);
    const local = localById.get(id);
    const remote = remoteById.get(id);
    if (tombstone && (base || local || remote)) {
      conflicts.push({ kind: 'tombstone', entity: 'skill', id, tombstone });
      continue;
    }

    const mergedMetadata = mergeEntity('skill', id, base?.metadata, local?.metadata, remote?.metadata, conflicts);
    if (!mergedMetadata) continue;
    const contentHash = mergeContentHash(id, base?.contentHash, local?.contentHash, remote?.contentHash, conflicts);
    if (!contentHash) continue;
    result.push({ metadata: mergedMetadata, contentHash });
  }
  return result;
}

function mergeContentHash(
  id: string,
  base: string | undefined,
  local: string | undefined,
  remote: string | undefined,
  conflicts: SyncConflict[]
): string | undefined {
  if (local === remote) return local;
  if (local === base) return remote;
  if (remote === base) return local;
  if (base === undefined && (local === undefined || remote === undefined)) return local ?? remote;
  if (local === undefined || remote === undefined) {
    conflicts.push({ kind: 'delete-vs-change', entity: 'skill', id });
    return undefined;
  }
  conflicts.push({ kind: 'content', entity: 'skill', id, baseHash: base, localHash: local, remoteHash: remote });
  return undefined;
}

function mergeEntities<T extends object>(
  entity: 'group' | 'agent-state',
  base: readonly T[],
  local: readonly T[],
  remote: readonly T[],
  id: (value: T) => string,
  conflicts: SyncConflict[]
): T[] {
  const baseById = indexById(base, id);
  const localById = indexById(local, id);
  const remoteById = indexById(remote, id);
  const result: T[] = [];
  for (const key of sortedUnion(baseById.keys(), localById.keys(), remoteById.keys())) {
    const merged = mergeEntity(entity, key, baseById.get(key), localById.get(key), remoteById.get(key), conflicts);
    if (merged) result.push(merged);
  }
  return result;
}

function mergeEntity<T extends object>(
  entity: 'skill' | 'group' | 'agent-state',
  id: string,
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  conflicts: SyncConflict[]
): T | undefined {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;

  if (!base && local && remote) {
    return mergeFields(
      entity,
      id,
      {},
      local as Record<string, unknown>,
      remote as Record<string, unknown>,
      conflicts
    ) as T;
  }
  if (base && (!local || !remote)) {
    conflicts.push({ kind: 'delete-vs-change', entity, id });
    return undefined;
  }
  if (!local || !remote) return local ?? remote;
  return mergeFields(
    entity,
    id,
    (base ?? {}) as Record<string, unknown>,
    local as Record<string, unknown>,
    remote as Record<string, unknown>,
    conflicts
  ) as T;
}

function mergeFields(
  entity: 'skill' | 'group' | 'agent-state',
  id: string,
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  conflicts: SyncConflict[]
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const fields = sortedUnion(Object.keys(base), Object.keys(local), Object.keys(remote));
  for (const field of fields) {
    const baseValue = base[field];
    const localValue = local[field];
    const remoteValue = remote[field];
    if (sameValue(localValue, remoteValue)) {
      if (localValue !== undefined) output[field] = localValue;
      continue;
    }
    if (sameValue(localValue, baseValue)) {
      if (remoteValue !== undefined) output[field] = remoteValue;
      continue;
    }
    if (sameValue(remoteValue, baseValue)) {
      if (localValue !== undefined) output[field] = localValue;
      continue;
    }
    conflicts.push({ kind: 'field', entity, id, field, base: baseValue, local: localValue, remote: remoteValue });
  }
  return output;
}

function mergeTombstones(
  base: SyncMergeState,
  local: SyncMergeState,
  remote: SyncMergeState,
  conflicts: SyncConflict[]
): SkillTombstone[] {
  const baseById = indexById(base.tombstones, (tombstone) => tombstone.id);
  const localById = indexById(local.tombstones, (tombstone) => tombstone.id);
  const remoteById = indexById(remote.tombstones, (tombstone) => tombstone.id);
  const result: SkillTombstone[] = [];
  for (const id of sortedUnion(baseById.keys(), localById.keys(), remoteById.keys())) {
    const merged = mergeEntity('skill', id, baseById.get(id), localById.get(id), remoteById.get(id), conflicts);
    if (merged) result.push(merged as SkillTombstone);
  }
  return result;
}

function indexById<T>(values: readonly T[], id: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) result.set(id(value), value);
  return result;
}

function sortedUnion(...sources: Iterable<string>[]): string[] {
  return [...new Set(sources.flatMap((source) => [...source]))].sort();
}

function same(left: unknown, right: unknown): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function sameValue(left: unknown, right: unknown): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function compareConflict(left: SyncConflict, right: SyncConflict): number {
  return `${left.entity}:${left.id}:${left.kind}:${'field' in left ? left.field : ''}`
    .localeCompare(`${right.entity}:${right.id}:${right.kind}:${'field' in right ? right.field : ''}`);
}
