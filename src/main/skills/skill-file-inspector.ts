import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.js', '.mjs', '.ps1', '.py', '.rb', '.sh', '.zsh']);
const SKILL_FILE_NAME = 'SKILL.md';

export type RiskKind = 'binary-file' | 'executable-file' | 'script-file' | 'symlink';

export interface RiskItem {
  kind: RiskKind;
  relativePath: string;
  detail?: string;
}

export interface SkillFileManifestEntry {
  relativePath: string;
  contentHash: string;
  kind: 'file' | 'symlink';
}

export interface InspectedSkillDirectory {
  sourcePath: string;
  canonicalPath: string;
  skillFilePath: string;
  name: string;
  originalDescription: string;
  contentHash: string;
  files: SkillFileManifestEntry[];
  risks: RiskItem[];
}

export class SkillInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillInspectionError';
  }
}

/**
 * Reads a Skill directory without executing any Skill content. Symlinks are
 * recorded as risks and never followed while walking the directory.
 */
export async function inspectSkillDirectory(sourcePath: string): Promise<InspectedSkillDirectory> {
  const absoluteSourcePath = resolve(sourcePath);
  const rootStat = await lstat(absoluteSourcePath);
  if (!rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
    throw new SkillInspectionError('Skill source must be a directory.');
  }

  const canonicalPath = await realpath(absoluteSourcePath);
  const skillFilePath = join(canonicalPath, SKILL_FILE_NAME);
  const skillFileStat = await lstat(skillFilePath).catch(() => undefined);
  if (!skillFileStat?.isFile()) {
    throw new SkillInspectionError(`Skill directory must contain a regular ${SKILL_FILE_NAME} file.`);
  }

  const skillFile = await readFile(skillFilePath, 'utf8');
  const metadata = parseSkillMetadata(skillFile, basename(canonicalPath));
  const risks: RiskItem[] = [];
  const files: SkillFileManifestEntry[] = [];
  const digest = createHash('sha256');
  await hashDirectory(canonicalPath, canonicalPath, digest, risks, files);

  return {
    sourcePath: absoluteSourcePath,
    canonicalPath,
    skillFilePath,
    name: metadata.name,
    originalDescription: metadata.description,
    contentHash: `sha256:${digest.digest('hex')}`,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    risks: risks.sort(compareRiskItems)
  };
}

function compareRiskItems(left: RiskItem, right: RiskItem): number {
  return left.relativePath.localeCompare(right.relativePath) || left.kind.localeCompare(right.kind);
}

async function hashDirectory(
  rootPath: string,
  currentPath: string,
  digest: ReturnType<typeof createHash>,
  risks: RiskItem[],
  files: SkillFileManifestEntry[]
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name);
    const relativePath = safeRelativePath(rootPath, fullPath);
    const stat = await lstat(fullPath);

    if (stat.isSymbolicLink()) {
      const target = await readlink(fullPath);
      digest.update(`link\0${relativePath}\0${target}\0`);
      files.push({ relativePath, contentHash: `sha256:${createHash('sha256').update(target).digest('hex')}`, kind: 'symlink' });
      risks.push({ kind: 'symlink', relativePath, detail: target });
      continue;
    }

    if (stat.isDirectory()) {
      digest.update(`directory\0${relativePath}\0`);
      await hashDirectory(rootPath, fullPath, digest, risks, files);
      continue;
    }

    if (!stat.isFile()) {
      digest.update(`special\0${relativePath}\0`);
      risks.push({ kind: 'binary-file', relativePath, detail: 'Unsupported special file.' });
      continue;
    }

    const content = await readFile(fullPath);
    digest.update(`file\0${relativePath}\0`);
    digest.update(content);
    files.push({ relativePath, contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`, kind: 'file' });

    const extension = extname(entry.name).toLowerCase();
    if (SCRIPT_EXTENSIONS.has(extension)) {
      risks.push({ kind: 'script-file', relativePath });
    }
    if ((stat.mode & 0o111) !== 0) {
      risks.push({ kind: 'executable-file', relativePath });
    }
    if (content.includes(0)) {
      risks.push({ kind: 'binary-file', relativePath });
    }
  }
}

function safeRelativePath(rootPath: string, candidatePath: string): string {
  const path = relative(rootPath, candidatePath);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || resolve(rootPath, path) !== candidatePath) {
    throw new SkillInspectionError('Encountered a path outside the Skill directory.');
  }
  return path.split(sep).join('/');
}

function parseSkillMetadata(
  skillFile: string,
  fallbackName: string
): { name: string; description: string } {
  if (!skillFile.startsWith('---')) {
    return { name: fallbackName, description: '' };
  }

  const frontMatterEnd = skillFile.indexOf('\n---', 3);
  if (frontMatterEnd === -1) {
    return { name: fallbackName, description: '' };
  }

  const frontMatter = skillFile.slice(3, frontMatterEnd).split('\n');
  const fields = new Map<string, string>();
  for (const line of frontMatter) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) {
      continue;
    }
    fields.set(match[1], unquoteYamlScalar(match[2]));
  }

  return {
    name: fields.get('name') || fallbackName,
    description: fields.get('description') || ''
  };
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
