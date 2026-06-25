/**
 * CLI Resolver — locate the legal-desens console script binary.
 *
 * Resolution order (first hit wins):
 *   1. process.env.LEGAL_DESENS_BIN
 *   2. <repo>/.venv/bin/legal-desens
 *   3. <repo>/.venv/Scripts/legal-desens.exe  (path reserved; not tested on Windows)
 *   4. `legal-desens` on PATH (which legal-desens)
 *
 * No hardcoded user-specific paths. Local overrides go to .env.local (gitignored).
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function resolveFromEnv() {
  const bin = process.env.LEGAL_DESENS_BIN;
  if (bin && existsSync(bin)) return bin;
  return null;
}

function resolveFromVenv() {
  const candidates = [
    path.join(repoRoot, '.venv', 'bin', 'legal-desens'),
    path.join(repoRoot, '.venv', 'Scripts', 'legal-desens.exe'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function resolveFromPath() {
  try {
    const stdout = execFileSync('which', ['legal-desens'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (stdout && existsSync(stdout)) return stdout;
  } catch {
    // not on PATH
  }
  return null;
}

let _cached = undefined;

/**
 * Returns the absolute path to the legal-desens binary, or throws.
 */
export function resolveLegalDesensBin() {
  if (_cached !== undefined) {
    if (_cached === null) throw new Error('legal-desens binary not found');
    return _cached;
  }
  const hit = resolveFromEnv() || resolveFromVenv() || resolveFromPath();
  _cached = hit || null;
  if (!_cached) {
    throw new Error(
      'legal-desens binary not found. Set LEGAL_DESENS_BIN in .env.local, ' +
      'or run: npm run setup'
    );
  }
  return _cached;
}

/**
 * Get the rules.json path via `legal-desens paths --json`.
 * Returns absolute path string.
 */
export function getRulesPath() {
  const bin = resolveLegalDesensBin();
  try {
    const stdout = execFileSync(bin, ['paths', '--json'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const parsed = JSON.parse(stdout);
    if (parsed.rules && existsSync(parsed.rules)) return parsed.rules;
    throw new Error(`rules path from paths --json does not exist: ${parsed.rules}`);
  } catch (err) {
    throw new Error(`Failed to resolve rules path via legal-desens paths --json: ${err.message}`);
  }
}
