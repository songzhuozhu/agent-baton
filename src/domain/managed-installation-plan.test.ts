import { describe, expect, it } from 'vitest';
import type { ManagedSkill, ObservedInstallation } from '../shared/domain';
import { buildManagedInstallationPlan, managedInstallationTarget } from './managed-installation-plan';

const design: ManagedSkill = {
  id: 'abcdef12-0000-0000-0000-000000000000',
  name: 'Frontend Design',
  originalDescription: '',
  tags: [],
  syncPolicy: 'sync-allowed',
  source: { kind: 'local' }
};

const video: ManagedSkill = {
  id: 'abcdef34-0000-0000-0000-000000000000',
  name: 'Video',
  originalDescription: '',
  tags: [],
  syncPolicy: 'local-only',
  source: { kind: 'local' }
};

describe('buildManagedInstallationPlan', () => {
  it('installs desired managed Skills, refreshes drifted copies, and removes only managed surplus', () => {
    const observed: ObservedInstallation[] = [
      {
        agent: 'codex',
        skillId: design.id,
        path: '/skills/frontend-design-abcdef12',
        contentHash: 'sha256:old-copy',
        enabled: true,
        managed: true
      },
      {
        agent: 'codex',
        skillId: video.id,
        path: '/skills/video-abcdef34',
        contentHash: 'sha256:video',
        enabled: true,
        managed: true
      },
      {
        agent: 'codex',
        path: '/external/company',
        contentHash: 'sha256:company',
        enabled: false,
        managed: false
      }
    ];

    const plan = buildManagedInstallationPlan({
      agent: 'codex',
      effectiveSkillIds: [design.id],
      managedSkills: [
        { skill: design, contentDirectory: '/library/design', contentHash: 'sha256:new-canonical' },
        { skill: video, contentDirectory: '/library/video', contentHash: 'sha256:video' }
      ],
      observedInstallations: observed,
      targetRoot: '/skills'
    });

    expect(plan).toEqual({
      agent: 'codex',
      operations: [
        {
          kind: 'deploy',
          skillId: design.id,
          sourceDirectory: '/library/design',
          targetDirectory: '/skills/frontend-design-abcdef12',
          expectedTargetHash: 'sha256:old-copy'
        },
        {
          kind: 'remove',
          skillId: video.id,
          targetDirectory: '/skills/video-abcdef34',
          expectedTargetHash: 'sha256:video'
        }
      ],
      blockedExternalInstallationPaths: ['/external/company']
    });
  });

  it('uses a stable deployment target that does not depend on a mutable folder name', () => {
    expect(managedInstallationTarget('/skills', design)).toBe('/skills/frontend-design-abcdef12');
  });
});
