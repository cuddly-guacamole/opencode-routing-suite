#!/usr/bin/env node
// verify-upstream-snapshot.mjs — mechanical enforcement of the snapshot contract
//
// Enforces scripts/upstream/README.md §快照规则（契约 3.4）:
//
//   只读        — nobody may edit any file in scripts/upstream/
//   唯一事实源  — plugin injection text must be derived from this snapshot
//   更新走流程  — a new upstream version goes through 「如何更新」, never an
//                 in-place edit
//
// The third rule was prose and was enforced by nothing: this repository has no
// CI. This script is the executable form of it. Zero dependencies — Node
// builtins only (node:crypto, node:fs, node:path), so it needs no install step.
//
// ---------------------------------------------------------------------------
// EXIT CODES
//   0  OK          every enforced file matches its recorded sha256, the recorded
//                  set and the on-disk set are the same set, and the machine
//                  record agrees with the prose table.
//   1  DRIFT       a snapshot file's bytes no longer match the record; or a file
//                  was added to scripts/upstream/ with no provenance entry; or a
//                  recorded entry names a file that is no longer there.
//   2  CONFIG      the provenance record itself is missing, unreadable, or
//                  malformed; or it disagrees with the prose table in
//                  scripts/upstream/README.md. (A disagreement is a
//                  configuration fault, not byte drift in the snapshot — the two
//                  homes for the same fact were edited unevenly.)
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_CONFIG = 2;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_DIR = join(ROOT, 'scripts', 'upstream');
const PROVENANCE = join(SNAPSHOT_DIR, 'provenance.json');
const PROSE = join(SNAPSHOT_DIR, 'README.md');
const PROSE_HEADING = /快照清单/;

function die(code, msg) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function sha256(file) {
  // Buffer, never utf8 string: a text read would hide a CRLF/LF difference
  // behind Node's decoder, which is exactly the drift this must catch.
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// --- load the machine-readable record ---------------------------------------
let prov;
try {
  prov = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
} catch (e) {
  die(EXIT_CONFIG, `CONFIG: cannot read provenance record ${PROVENANCE}: ${e.message}`);
}
if (!prov || !Array.isArray(prov.enforced) || !Array.isArray(prov.declared_unenforced)) {
  die(EXIT_CONFIG, `CONFIG: ${PROVENANCE} must have "enforced" and "declared_unenforced" arrays`);
}

// --- cross-check the machine record against the prose table -----------------
// The snapshot's provenance is documented in a Markdown table, which no tool can
// read safely. So the table stays the human source of truth and this file is the
// machine mirror — and this check is what stops the two from drifting apart
// silently. Removing the table rows does not weaken the check: it turns into a
// CONFIG failure, not a pass.
let proseTable;
try {
  const lines = readFileSync(PROSE, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => PROSE_HEADING.test(l));
  if (start === -1) die(EXIT_CONFIG, `CONFIG: no 快照清单 section found in ${PROSE}`);
  let end = start + 1;
  while (end < lines.length && !/^#/.test(lines[end])) end++;
  proseTable = lines.slice(start, end);
} catch (e) {
  die(EXIT_CONFIG, `CONFIG: cannot read ${PROSE}: ${e.message}`);
}

const proseErrors = [];
for (const entry of prov.enforced) {
  const rows = proseTable.filter((l) => l.includes(entry.file));
  if (rows.length === 0) {
    proseErrors.push(`${entry.file}: no row in the 快照清单 table of ${PROSE}`);
    continue;
  }
  const hit = rows.find((l) => l.includes(entry.sha256));
  if (!hit) {
    proseErrors.push(
      `${entry.file}: recorded sha256 ${entry.sha256} does not appear in the 快照清单 table ` +
        `(prose row: ${rows[0].trim().slice(0, 120)})`,
    );
    continue;
  }
  if (entry.commit && !hit.includes(entry.commit)) {
    proseErrors.push(
      `${entry.file}: recorded commit ${entry.commit} not present on the prose row ` +
        `(${hit.trim().slice(0, 120)})`,
    );
  }
}
if (proseErrors.length) {
  die(
    EXIT_CONFIG,
    `CONFIG: provenance.json and ${PROSE} disagree. The two homes for the snapshot's ` +
      `provenance must be updated together:\n  - ` +
      proseErrors.join('\n  - '),
  );
}

// --- byte verification -------------------------------------------------------
let drift = 0;
const summary = [];

for (const entry of prov.enforced) {
  const file = join(SNAPSHOT_DIR, entry.file);
  let present;
  try {
    present = statSync(file).isFile();
  } catch {
    present = false;
  }
  if (!present) {
    process.stderr.write(
      `MISSING ${entry.file} expected-by-provenance (recorded sha256 ${entry.sha256})\n`,
    );
    drift++;
    continue;
  }
  const actual = sha256(file);
  const bytes = statSync(file).size;
  if (actual !== entry.sha256) {
    process.stderr.write(
      `MISMATCH ${entry.file} expected=${entry.sha256} actual=${actual}\n`,
    );
    drift++;
    continue;
  }
  if (typeof entry.bytes === 'number' && bytes !== entry.bytes) {
    process.stderr.write(
      `MISMATCH ${entry.file} expected-bytes=${entry.bytes} actual-bytes=${bytes} ` +
        `(sha256 matched — provenance.json "bytes" field is stale)\n`,
    );
    drift++;
    continue;
  }
  summary.push(`  OK  ${entry.file.padEnd(22)} ${actual}  ${bytes} B  @${entry.commit}`);
}

// --- the recorded set must be exactly the set on disk -----------------------
// An unrecorded addition is the drift this is here to catch: someone drops a new
// file into the read-only snapshot and it is invisible to every other check.
const known = new Set([...prov.enforced.map((e) => e.file), ...prov.declared_unenforced.map((e) => e.file)]);
const present = [];
(function walk(dir, prefix = '') {
  let items;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    const rel = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.isDirectory()) walk(join(dir, it.name), rel);
    else if (it.isFile()) present.push(rel);
  }
})(SNAPSHOT_DIR);

for (const rel of present.sort()) {
  if (rel === 'provenance.json') continue; // the record itself, not snapshot content
  if (!known.has(rel)) {
    process.stderr.write(
      `UNRECORDED ${rel} is in scripts/upstream/ with no provenance entry. ` +
        `The snapshot is 只读 — a new file here must arrive through 「如何更新」 ` +
        `and be registered in provenance.json.\n`,
    );
    drift++;
  }
}
for (const file of prov.enforced) {
  if (!present.includes(file.file)) continue; // already reported as MISSING above
}

// --- report ------------------------------------------------------------------
console.log(`upstream snapshot: ${prov.snapshot_source.repo} @ ${prov.snapshot_source.commit} (${prov.snapshot_source.tag_description})`);
console.log(`enforced files: ${prov.enforced.length}`);
for (const line of summary) console.log(line);
console.log(`declared but not byte-enforced: ${prov.declared_unenforced.map((e) => e.file).join(', ') || '(none)'}`);
console.log(`prose cross-check: ${prov.enforced.length} record(s) agree with ${PROSE.replace(ROOT + '\\', '')} §快照清单`);

if (drift > 0) {
  process.stderr.write(`\nFAIL: ${drift} provenance violation(s). The snapshot is 只读 and 更新走流程 — see scripts/upstream/README.md §如何更新.\n`);
  process.exit(EXIT_DRIFT);
}
console.log('\nOK: snapshot matches its recorded provenance byte for byte.');
process.exit(EXIT_OK);
