import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTransaction, FileTransactionError, hashFileOrMissing } from './file-transaction';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agent-baton-transaction-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('FileTransaction', () => {
  it('writes only when the planned hash still matches and preserves a backup', async () => {
    const workspace = await createWorkspace();
    const configDirectory = join(workspace, 'config');
    const configPath = join(configDirectory, 'settings.json');
    await mkdir(configDirectory);
    await writeFile(configPath, '{"before":true}\n');
    const transaction = new FileTransaction(join(workspace, 'backups'), [configDirectory]);

    const result = await transaction.execute([
      { path: configPath, content: '{"after":true}\n', expectedHash: await hashFileOrMissing(configPath) }
    ]);

    await expect(readFile(configPath, 'utf8')).resolves.toBe('{"after":true}\n');
    await expect(readFile(join(result.backupDirectory, '0.backup'), 'utf8')).resolves.toBe('{"before":true}\n');
  });

  it('refuses to write when an external modification invalidates the plan', async () => {
    const workspace = await createWorkspace();
    const configDirectory = join(workspace, 'config');
    const configPath = join(configDirectory, 'settings.json');
    await mkdir(configDirectory);
    await writeFile(configPath, 'original');
    const plannedHash = await hashFileOrMissing(configPath);
    await writeFile(configPath, 'external-change');
    const transaction = new FileTransaction(join(workspace, 'backups'), [configDirectory]);

    await expect(
      transaction.execute([{ path: configPath, content: 'agent-baton-change', expectedHash: plannedHash }])
    ).rejects.toBeInstanceOf(FileTransactionError);
    await expect(readFile(configPath, 'utf8')).resolves.toBe('external-change');
  });

  it('rolls back earlier writes when a later write cannot be applied', async () => {
    const workspace = await createWorkspace();
    const configDirectory = join(workspace, 'config');
    const firstPath = join(configDirectory, 'first.json');
    const blockingPath = join(configDirectory, 'not-a-directory');
    const secondPath = join(blockingPath, 'second.json');
    await mkdir(configDirectory);
    await writeFile(firstPath, 'first-before');
    await writeFile(blockingPath, 'block');
    const transaction = new FileTransaction(join(workspace, 'backups'), [configDirectory]);

    await expect(
      transaction.execute([
        { path: firstPath, content: 'first-after', expectedHash: await hashFileOrMissing(firstPath) },
        { path: secondPath, content: 'second', expectedHash: null }
      ])
    ).rejects.toThrow('Transaction rolled back');
    await expect(readFile(firstPath, 'utf8')).resolves.toBe('first-before');
  });
});
