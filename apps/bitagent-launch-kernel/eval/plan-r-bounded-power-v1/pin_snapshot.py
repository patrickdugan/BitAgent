"""Bind an existing offline HF model snapshot to exact local file SHA-256s.

This is an integrity ledger for local bytes. The caller must separately verify
that their snapshot came from the stated Hugging Face revision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

MANIFEST = json.loads((Path(__file__).parent / 'scenarios.json').read_text(encoding='utf-8'))
REPO_ID = MANIFEST['model_pilot']['repo_id']
REVISION = MANIFEST['model_pilot']['revision']
IGNORE_DIRS = frozenset(('.cache', '.git', '__pycache__'))
UNSAFE_SUFFIXES = frozenset(('.bin', '.pkl', '.pickle', '.pt', '.pth', '.ckpt', '.py'))


def digest_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def canonical_hash(payload: object) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def scan(snapshot_dir: Path) -> dict[str, str]:
    root = snapshot_dir.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('snapshot directory is required')
    files = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if any(part in IGNORE_DIRS for part in relative.parts):
            continue
        if path.is_dir():
            continue
        if not path.is_file() or path.suffix.lower() in UNSAFE_SUFFIXES:
            raise ValueError(f'unsupported artifact file: {relative}')
        if len(files) >= 128:
            raise ValueError('snapshot exceeds the file-count cap')
        if path.stat().st_size > 8 * 1024**3:
            raise ValueError('snapshot contains an oversized file')
        files[relative.as_posix()] = digest_file(path)
    if 'config.json' not in files or 'tokenizer_config.json' not in files:
        raise ValueError('model config and tokenizer_config.json required')
    if not any(name.endswith('.safetensors') for name in files):
        raise ValueError('safetensors checkpoint required')
    if 'tokenizer.json' not in files and 'tokenizer.model' not in files:
        raise ValueError('tokenizer.json or tokenizer.model required')
    return files


def prepare_lock(snapshot_dir: Path) -> dict:
    files = scan(snapshot_dir)
    core = {'schema': 'bitagent.plan_r_local_model_lock.v1',
            'repo_id': REPO_ID, 'revision': REVISION,
            'source_claim': 'caller_attests_snapshot_origin',
            'local_files_only': True, 'trust_remote_code': False,
            'use_safetensors': True, 'files_sha256': files}
    return {**core, 'lock_sha256': canonical_hash(core)}


def verify_lock(snapshot_dir: Path, lock_path: Path) -> dict:
    saved = json.loads(lock_path.read_text(encoding='utf-8'))
    if not isinstance(saved, dict):
        raise ValueError('malformed model lock')
    expected = prepare_lock(snapshot_dir)
    if saved != expected:
        raise ValueError('local model snapshot lock mismatch')
    return saved


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot-dir', required=True, type=Path)
    p.add_argument('--lock', required=True, type=Path)
    p.add_argument('--create', action='store_true', help='Create lock for caller-verified pinned snapshot')
    args = p.parse_args()
    if args.lock.resolve() == args.snapshot_dir.resolve() or args.snapshot_dir.resolve() in args.lock.resolve().parents:
        p.error('put the lock file outside the snapshot directory')
    if args.create:
        if args.lock.exists():
            p.error('lock exists; creation will not overwrite it')
        lock = prepare_lock(args.snapshot_dir)
        args.lock.parent.mkdir(parents=True, exist_ok=True)
        args.lock.write_text(json.dumps(lock, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    else:
        lock = verify_lock(args.snapshot_dir, args.lock)
    print(json.dumps({'lock_sha256': lock['lock_sha256'], 'repo_id': lock['repo_id'],
                      'revision': lock['revision'], 'file_count': len(lock['files_sha256'])}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
