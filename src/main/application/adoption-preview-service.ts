import { randomUUID } from 'node:crypto';
import type { ManagedSkill, SkillSource, SyncPolicy } from '../../shared/domain';
import type { RiskItem } from '../skills/skill-file-inspector';
import { inspectSkillDirectory } from '../skills/skill-file-inspector';
import { SkillControlService } from './skill-control-service';
import type { StagedUpstreamCandidate, UpstreamFetcher } from '../upstream/upstream-update-service';

const ADOPTION_PREVIEW_TTL_MS = 15 * 60 * 1000;

export class AdoptionPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdoptionPreviewError';
  }
}

export interface AdoptionPreview {
  id: string;
  sourceDirectory: string;
  name: string;
  originalDescription: string;
  contentHash: string;
  risks: RiskItem[];
  possibleDuplicates: Array<{ skillId: string; name: string; reason: 'same-content' | 'same-name' }>;
  sourceKind: 'local' | 'upstream';
  upstream?: { repositoryUrl: string; relativePath: string; baselineCommit: string };
  expiresAt: string;
}

interface PendingAdoption extends AdoptionPreview {
  source?: SkillSource;
  cleanup?: () => Promise<void>;
}

export interface ConfirmAdoptionInput {
  tags?: string[];
  userDescription?: string;
  syncPolicy?: SyncPolicy;
  source?: SkillSource;
}

/** Requires explicit, short-lived confirmation before a source is copied. */
export class AdoptionPreviewService {
  private readonly pending = new Map<string, PendingAdoption>();

  constructor(
    private readonly skillControl: SkillControlService,
    private readonly upstreamFetcher?: UpstreamFetcher
  ) {}

  async preview(sourceDirectory: string, now = new Date()): Promise<AdoptionPreview> {
    const inspection = await inspectSkillDirectory(sourceDirectory);
    return this.createPreview(inspection, undefined, now);
  }

  /**
   * Reads a Git source into a disposable staging directory. The candidate is
   * not copied into the managed library until the same explicit confirmation
   * required for local adoption.
   */
  async previewUpstream(
    repositoryUrl: string,
    relativePath: string,
    now = new Date()
  ): Promise<AdoptionPreview> {
    if (!this.upstreamFetcher) throw new AdoptionPreviewError('当前应用未配置 Git 上游纳管能力。');
    const candidate = await this.upstreamFetcher.stage({
      kind: 'upstream',
      repositoryUrl,
      relativePath,
      baselineCommit: '',
      contentHash: ''
    });
    try {
      const inspection = await inspectSkillDirectory(candidate.skillDirectory);
      return await this.createPreview(inspection, {
        kind: 'upstream',
        repositoryUrl,
        relativePath,
        baselineCommit: candidate.commit,
        contentHash: inspection.contentHash
      }, now, candidate);
    } catch (error) {
      await candidate.cleanup();
      throw error;
    }
  }

  private async createPreview(
    inspection: Awaited<ReturnType<typeof inspectSkillDirectory>>,
    source: SkillSource | undefined,
    now: Date,
    candidate?: StagedUpstreamCandidate
  ): Promise<AdoptionPreview> {
    const possibleDuplicates = await this.skillControl.findPossibleDuplicates({
      name: inspection.name,
      contentHash: inspection.contentHash
    });
    const id = randomUUID();
    const preview: PendingAdoption = {
      id,
      sourceDirectory: inspection.sourcePath,
      name: inspection.name,
      originalDescription: inspection.originalDescription,
      contentHash: inspection.contentHash,
      risks: inspection.risks,
      possibleDuplicates,
      sourceKind: source?.kind ?? 'local',
      ...(source?.kind === 'upstream' ? { upstream: { repositoryUrl: source.repositoryUrl, relativePath: source.relativePath, baselineCommit: source.baselineCommit } } : {}),
      expiresAt: new Date(now.getTime() + ADOPTION_PREVIEW_TTL_MS).toISOString()
    };
    this.pending.set(id, { ...preview, source, ...(candidate ? { cleanup: candidate.cleanup } : {}) });
    await this.removeExpired(now);
    return preview;
  }

  async confirm(
    previewId: string,
    input: ConfirmAdoptionInput,
    now = new Date()
  ): Promise<ManagedSkill> {
    const preview = this.pending.get(previewId);
    if (!preview) {
      throw new AdoptionPreviewError('纳管预览不存在或已被使用，请重新选择 Skill。');
    }
    if (new Date(preview.expiresAt).getTime() <= now.getTime()) {
      this.pending.delete(previewId);
      throw new AdoptionPreviewError('纳管预览已过期，请重新选择 Skill。');
    }

    this.pending.delete(previewId);
    try {
      const current = await inspectSkillDirectory(preview.sourceDirectory);
      if (current.contentHash !== preview.contentHash) {
        throw new AdoptionPreviewError('Skill 内容已变化，请重新预览并确认纳管。');
      }
      return await this.skillControl.adoptSkill({
        sourceDirectory: preview.sourceDirectory,
        tags: input.tags,
        userDescription: input.userDescription,
        syncPolicy: input.syncPolicy,
        source: preview.source ?? input.source
      });
    } finally {
      await preview.cleanup?.();
    }
  }

  private async removeExpired(now: Date): Promise<void> {
    for (const [id, preview] of this.pending) {
      if (new Date(preview.expiresAt).getTime() <= now.getTime()) {
        this.pending.delete(id);
        await preview.cleanup?.();
      }
    }
  }
}
