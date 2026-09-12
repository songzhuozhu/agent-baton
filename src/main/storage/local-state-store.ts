import Database from 'better-sqlite3';
import type {
  DesiredAgentState,
  ManagedSkill,
  ObservedInstallation,
  SkillGroup
} from '../../shared/domain';
import type { SyncMergeState } from '../../sync/three-way-merge';

export interface LocalSkillTombstone {
  id: string;
  deletedAt: string;
  /** True only when the deleted Skill was Sync Allowed before deletion. */
  syncAllowed: boolean;
}

export interface SkillDeletionRecovery {
  skill: ManagedSkill;
  groupIds: string[];
  overrides: Array<{ agent: DesiredAgentState['agent']; override: NonNullable<DesiredAgentState['overrides'][string]> }>;
  trashDirectory: string;
  expiresAt: string;
}

export interface CustomScanRoot {
  path: string;
  kind: 'custom' | 'project';
}

export interface SyncConnection {
  repositoryDirectory: string;
  repositoryUrl: string;
}

export interface LocalErrorLog {
  id: string;
  createdAt: string;
  message: string;
}

interface StoredJsonRow {
  key: string;
  payload: string;
}

export interface ApplyRecord {
  id: string;
  agent: DesiredAgentState['agent'];
  createdAt: string;
  summary: string;
  result: 'succeeded' | 'partially-succeeded' | 'failed' | 'rolled-back';
  backupReference?: string;
  changes: AppliedInstallationChange[];
  undoneAt?: string;
}

export type AppliedInstallationChange =
  | {
      kind: 'deploy';
      targetDirectory: string;
      expectedCurrentHash: string;
      backupDirectory?: string;
      previousInstallation?: ObservedInstallation;
      resultingInstallation: ObservedInstallation;
    }
  | {
      kind: 'remove';
      targetDirectory: string;
      backupDirectory: string;
      previousInstallation?: ObservedInstallation;
    };

/**
 * Device-only state. Its schema deliberately stores portable entities separate
 * from Installations so a Git snapshot is never mistaken for local reality.
 */
export class LocalStateStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  saveSkill(skill: ManagedSkill): void {
    this.saveJson('managed_skills', skill.id, skill);
  }

  listSkills(): ManagedSkill[] {
    return this.listJson<ManagedSkill>('managed_skills');
  }

  saveGroup(group: SkillGroup): void {
    this.saveJson('skill_groups', group.id, group);
  }

  listGroups(): SkillGroup[] {
    return this.listJson<SkillGroup>('skill_groups');
  }

  saveDesiredAgentState(state: DesiredAgentState): void {
    this.saveJson('desired_agent_states', state.agent, state);
  }

  saveDesiredAgentStates(states: readonly DesiredAgentState[]): void {
    const transaction = this.database.transaction(() => {
      for (const state of states) this.saveDesiredAgentState(state);
    });
    transaction();
  }

  listDesiredAgentStates(): DesiredAgentState[] {
    return this.listJson<DesiredAgentState>('desired_agent_states');
  }

  saveObservedInstallation(installation: ObservedInstallation): void {
    const key = `${installation.agent}:${installation.path}`;
    this.saveJson('observed_installations', key, installation);
  }

  listObservedInstallations(): ObservedInstallation[] {
    return this.listJson<ObservedInstallation>('observed_installations');
  }

  deleteObservedInstallation(agent: ObservedInstallation['agent'], path: string): void {
    this.database
      .prepare('DELETE FROM observed_installations WHERE key = ?')
      .run(`${agent}:${path}`);
  }

  saveApplyRecord(record: ApplyRecord): void {
    this.saveJson('apply_records', record.id, record);
  }

  listApplyRecords(): ApplyRecord[] {
    return this.listJson<ApplyRecord>('apply_records');
  }

  getLatestUndoableApply(agent: DesiredAgentState['agent']): ApplyRecord | undefined {
    return this.listApplyRecords()
      .filter((record) => record.agent === agent && record.result === 'succeeded' && !record.undoneAt && record.changes?.length > 0)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  saveSkillTombstone(tombstone: LocalSkillTombstone): void {
    this.saveJson('skill_tombstones', tombstone.id, tombstone);
  }

  listSkillTombstones(): LocalSkillTombstone[] {
    return this.listJson<LocalSkillTombstone>('skill_tombstones');
  }

  deleteSkillTombstone(skillId: string): void {
    this.database.prepare('DELETE FROM skill_tombstones WHERE key = ?').run(skillId);
  }

  deleteManagedSkillAndReferences(
    skillId: string,
    tombstone: LocalSkillTombstone,
    recovery: SkillDeletionRecovery
  ): void {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM managed_skills WHERE key = ?').run(skillId);
      for (const group of this.listGroups()) {
        if (!group.skillIds.includes(skillId)) continue;
        this.saveGroup({ ...group, skillIds: group.skillIds.filter((id) => id !== skillId) });
      }
      for (const state of this.listDesiredAgentStates()) {
        if (!(skillId in state.overrides)) continue;
        const overrides = { ...state.overrides };
        delete overrides[skillId];
        this.saveDesiredAgentState({ ...state, overrides });
      }
      this.saveSkillTombstone(tombstone);
      this.saveJson('skill_deletion_recovery', skillId, recovery);
    });
    transaction();
  }

  getSkillDeletionRecovery(skillId: string): SkillDeletionRecovery | undefined {
    return this.getJson<SkillDeletionRecovery>('skill_deletion_recovery', skillId);
  }

  restoreDeletedManagedSkill(skillId: string): SkillDeletionRecovery {
    const recovery = this.getSkillDeletionRecovery(skillId);
    if (!recovery) throw new Error(`没有可恢复的已删除 Skill：${skillId}`);
    const transaction = this.database.transaction(() => {
      this.saveSkill(recovery.skill);
      for (const groupId of recovery.groupIds) {
        const group = this.listGroups().find((candidate) => candidate.id === groupId);
        if (!group) continue;
        this.saveGroup({ ...group, skillIds: [...new Set([...group.skillIds, skillId])].sort() });
      }
      for (const { agent, override } of recovery.overrides) {
        const state = this.listDesiredAgentStates().find((candidate) => candidate.agent === agent) ?? {
          agent,
          activeGroupIds: [],
          overrides: {}
        };
        this.saveDesiredAgentState({ ...state, overrides: { ...state.overrides, [skillId]: override } });
      }
      this.deleteSkillTombstone(skillId);
      this.database.prepare('DELETE FROM skill_deletion_recovery WHERE key = ?').run(skillId);
    });
    transaction();
    return recovery;
  }

  saveSyncBaseline(connectionId: string, baseline: SyncMergeState): void {
    this.saveJson('sync_baselines', connectionId, baseline);
  }

  getSyncBaseline(connectionId: string): SyncMergeState | undefined {
    return this.getJson<SyncMergeState>('sync_baselines', connectionId);
  }

  saveLocalSetting(key: string, value: string): void {
    this.database
      .prepare('INSERT INTO local_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  getLocalSetting(key: string): string | undefined {
    const row = this.database.prepare('SELECT value FROM local_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setAgentRestartRequired(agent: DesiredAgentState['agent'], required: boolean): void {
    if (required) {
      this.saveJson('agent_restart_state', agent, { agent, required: true });
    } else {
      this.database.prepare('DELETE FROM agent_restart_state WHERE key = ?').run(agent);
    }
  }

  isAgentRestartRequired(agent: DesiredAgentState['agent']): boolean {
    return Boolean(this.getJson<{ agent: string; required: boolean }>('agent_restart_state', agent)?.required);
  }

  saveCustomScanRoot(root: CustomScanRoot): void {
    this.saveJson('custom_scan_roots', root.path, root);
  }

  listCustomScanRoots(): CustomScanRoot[] {
    return this.listJson<CustomScanRoot>('custom_scan_roots');
  }

  deleteCustomScanRoot(path: string): void {
    this.database.prepare('DELETE FROM custom_scan_roots WHERE key = ?').run(path);
  }

  deleteGroupAndReferences(groupId: string): void {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM skill_groups WHERE key = ?').run(groupId);
      for (const state of this.listDesiredAgentStates()) {
        if (!state.activeGroupIds.includes(groupId)) continue;
        this.saveDesiredAgentState({ ...state, activeGroupIds: state.activeGroupIds.filter((id) => id !== groupId) });
      }
    });
    transaction();
  }

  deleteLocalSetting(key: string): void {
    this.database.prepare('DELETE FROM local_settings WHERE key = ?').run(key);
  }

  saveSyncConnection(connection: SyncConnection): void {
    const transaction = this.database.transaction(() => {
      this.saveLocalSetting('sync:repository-directory', connection.repositoryDirectory);
      this.saveLocalSetting('sync:repository-url', connection.repositoryUrl);
    });
    transaction();
  }

  getSyncConnection(): SyncConnection | undefined {
    const repositoryDirectory = this.getLocalSetting('sync:repository-directory');
    const repositoryUrl = this.getLocalSetting('sync:repository-url');
    return repositoryDirectory && repositoryUrl ? { repositoryDirectory, repositoryUrl } : undefined;
  }

  clearSyncConnection(): void {
    const transaction = this.database.transaction(() => {
      this.deleteLocalSetting('sync:repository-directory');
      this.deleteLocalSetting('sync:repository-url');
    });
    transaction();
  }

  appendLocalError(message: string, now = new Date()): LocalErrorLog {
    const entry: LocalErrorLog = {
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: now.toISOString(),
      message: sanitizeLocalError(message)
    };
    const transaction = this.database.transaction(() => {
      this.saveJson('local_error_logs', entry.id, entry);
      const stale = this.listJson<LocalErrorLog>('local_error_logs')
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(100);
      for (const item of stale) this.database.prepare('DELETE FROM local_error_logs WHERE key = ?').run(item.id);
    });
    transaction();
    return entry;
  }

  listLocalErrors(): LocalErrorLog[] {
    return this.listJson<LocalErrorLog>('local_error_logs')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  clearLocalErrors(): void {
    this.database.prepare('DELETE FROM local_error_logs').run();
  }

  commitAgentApply(
    agent: ObservedInstallation['agent'],
    installationsToSave: readonly ObservedInstallation[],
    installationPathsToDelete: readonly string[],
    record: ApplyRecord
  ): void {
    const transaction = this.database.transaction(() => {
      for (const path of installationPathsToDelete) {
        this.database
          .prepare('DELETE FROM observed_installations WHERE key = ?')
          .run(`${agent}:${path}`);
      }
      for (const installation of installationsToSave) {
        this.saveJson('observed_installations', `${installation.agent}:${installation.path}`, installation);
      }
      this.saveJson('apply_records', record.id, record);
    });
    transaction();
  }

  commitAgentUndo(
    recordId: string,
    agent: ObservedInstallation['agent'],
    installationPathsToDelete: readonly string[],
    installationsToSave: readonly ObservedInstallation[],
    undoneAt: string
  ): void {
    const record = this.getJson<ApplyRecord>('apply_records', recordId);
    if (!record || record.agent !== agent || record.undoneAt) {
      throw new Error('最近应用记录不存在或已撤销。');
    }
    const transaction = this.database.transaction(() => {
      for (const path of installationPathsToDelete) {
        this.database.prepare('DELETE FROM observed_installations WHERE key = ?').run(`${agent}:${path}`);
      }
      for (const installation of installationsToSave) {
        this.saveJson('observed_installations', `${installation.agent}:${installation.path}`, installation);
      }
      this.saveJson('apply_records', recordId, { ...record, undoneAt });
    });
    transaction();
  }

  private migrate(): void {
    const migration = this.database.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS managed_skills (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_groups (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS desired_agent_states (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS observed_installations (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS apply_records (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_tombstones (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_baselines (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_deletion_recovery (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_restart_state (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS custom_scan_roots (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS local_error_logs (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );
      `);

      const existing = this.database
        .prepare('SELECT version FROM schema_migrations WHERE version = ?')
        .get(1) as { version: number } | undefined;
      if (!existing) {
        this.database
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(1, new Date().toISOString());
      }
    });

    migration();
  }

  private saveJson(table: JsonTable, key: string, payload: unknown): void {
    this.database
      .prepare(`INSERT INTO ${table} (key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`)
      .run(key, JSON.stringify(payload));
  }

  private listJson<T>(table: JsonTable): T[] {
    const rows = this.database
      .prepare(`SELECT key, payload FROM ${table} ORDER BY key ASC`)
      .all() as StoredJsonRow[];
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  private getJson<T>(table: JsonTable, key: string): T | undefined {
    const row = this.database.prepare(`SELECT key, payload FROM ${table} WHERE key = ?`).get(key) as StoredJsonRow | undefined;
    return row ? JSON.parse(row.payload) as T : undefined;
  }
}

type JsonTable =
  | 'managed_skills'
  | 'skill_groups'
  | 'desired_agent_states'
  | 'observed_installations'
  | 'apply_records'
  | 'skill_tombstones'
  | 'sync_baselines'
  | 'skill_deletion_recovery'
  | 'agent_restart_state'
  | 'custom_scan_roots'
  | 'local_error_logs';

function sanitizeLocalError(message: string): string {
  return message
    .replace(/(authorization:\s*(?:basic|bearer)\s+)[^\s]+/gi, '$1[已脱敏]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, '[已脱敏 GitHub Token]')
    .replace(/\b(access[_-]?token|client[_-]?secret|password)=([^\s&]+)/gi, '$1=[已脱敏]')
    .slice(0, 4_000);
}
