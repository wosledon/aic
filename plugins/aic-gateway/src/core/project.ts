import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadBootstrapCache, loadConfig } from './store.js';
import type { ResolvedProject } from './types.js';

export interface NormalizedRepo {
  normalized_url: string;
  display: string;
  hash: string;
}

/** Mirrors AIControl.Infrastructure.Utils.RepoUrlNormalizer. */
export function normalizeRepoUrl(remoteUrl: string): NormalizedRepo {
  const raw = remoteUrl.trim();
  let host = 'unknown';
  let repoPath = raw;

  const scp = /^git@([^:]+):(.+)$/i.exec(raw);
  const url = /^(https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(raw);
  if (scp) {
    host = scp[1];
    repoPath = scp[2];
  } else if (url) {
    host = url[2];
    repoPath = url[3];
  }

  host = host.toLowerCase();
  repoPath = repoPath.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (repoPath.endsWith('.git')) repoPath = repoPath.slice(0, -4);

  const normalized = `https://${host}/${repoPath}`;
  const display = `${host}/${repoPath}`;
  const hash = 'sha256:' + crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return { normalized_url: normalized, display, hash };
}

export function readGitRemote(cwd: string): string | null {
  try {
    const output = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function readProjectConfig(cwd: string): string | null {
  const candidates = [path.join(cwd, '.pi', 'aic.json'), path.join(cwd, '.aic.json')];
  for (const file of candidates) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { projectKey?: string };
      if (value.projectKey && typeof value.projectKey === 'string') return value.projectKey;
    } catch {
      // try next
    }
  }
  return null;
}

export function resolveProject(cwd = process.cwd()): ResolvedProject {
  const config = loadConfig();
  const repo = readGitRemote(cwd);
  const normalized = repo ? normalizeRepoUrl(repo) : null;

  const explicit = process.env.AIC_PROJECT?.trim() || config.default_project?.trim() || null;
  if (explicit) {
    return {
      key: explicit,
      source: process.env.AIC_PROJECT ? 'explicit' : 'explicit',
      repo_hash: normalized?.hash,
      repo_display: normalized?.display,
      cwd_basename: path.basename(cwd),
    };
  }

  const projectConfig = readProjectConfig(cwd);
  if (projectConfig) {
    return {
      key: projectConfig,
      source: 'project_config',
      repo_hash: normalized?.hash,
      repo_display: normalized?.display,
      cwd_basename: path.basename(cwd),
    };
  }

  if (normalized) {
    const cached = loadBootstrapCache()?.bootstrap;
    const mapping = cached?.repo_mappings.find((item) => item.repo_hash === normalized.hash);
    if (mapping) {
      return {
        key: mapping.project_key,
        source: 'repo_mapping',
        repo_hash: normalized.hash,
        repo_display: normalized.display,
        cwd_basename: path.basename(cwd),
      };
    }
  }

  return {
    key: null,
    source: 'unattributed',
    repo_hash: normalized?.hash,
    repo_display: normalized?.display,
    cwd_basename: path.basename(cwd),
  };
}