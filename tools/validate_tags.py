#!/usr/bin/env python3
"""
validate_tags.py — 标签系统完整性校验

Usage:
  Before publishing:  python tools/validate_tags.py
  Dry-run:            python tools/validate_tags.py --dry-run

验证 tags.json 的以下规则（参考 Tag-Spec.md）:
  1. 无重复 id
  2. 每个 tag 有 cn / en
  3. id 全小写，无空格，无 #
  4. 无保留 tag id 冲突
  5. migration.map 目标均指向有效 id
  6. 中英文一致性检查

用法: python tools/validate_tags.py
"""

import json
import sys
from pathlib import Path

RESERVED_IDS = {"featured", "draft", "internal", "all"}


def load_tags(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate(tags_path: Path) -> tuple[int, int]:
    """返回 (errors, warnings)"""
    try:
        data = load_tags(tags_path)
    except Exception as e:
        print(f"[FATAL] 无法读取 tags.json: {e}")
        return 1, 0

    errors = 0
    warnings = 0

    tags = data.get("tags", [])
    migration = data.get("migration", {})
    migration_map = migration.get("map", {})
    manual_review = migration.get("_manual_review", [])

    # ── 构建 id 集合 ──
    id_set = set()
    id_list = []

    for i, tag in enumerate(tags):
        tid = tag.get("id")
        if not tid:
            print(f"[ERROR] tags[{i}] 缺少 id")
            errors += 1
            continue

        id_list.append(tid)

        # 1. 重复 id
        if tid in id_set:
            print(f"[ERROR] 重复 id: {tid}")
            errors += 1
        id_set.add(tid)

        # 2. 命名规则
        if tid.lower() != tid:
            print(f"[ERROR] id 包含大写: {tid}")
            errors += 1
        if " " in tid:
            print(f"[ERROR] id 包含空格: {tid}")
            errors += 1
        if "#" in tid:
            print(f"[ERROR] id 包含 #: {tid}")
            errors += 1

        # 3. 保留标签
        if tid in RESERVED_IDS:
            print(f"[ERROR] id 与保留标签冲突: {tid}")
            errors += 1

        # 4. 中英文
        cn = tag.get("cn")
        en = tag.get("en")
        if not cn:
            print(f"[WARN]  {tid}: 缺少 cn Display Name")
            warnings += 1
        if not en:
            print(f"[WARN]  {tid}: 缺少 en Display Name")
            warnings += 1

    # ── Migration map 检查 ──
    for old, new_id in migration_map.items():
        if new_id not in id_set:
            print(f"[ERROR] migration.map['{old}'] → '{new_id}': 目标 id 不存在")
            errors += 1

    # ── 手动审核清单 ──
    if manual_review:
        print(f"\n  [REVIEW] 需人工确认: {len(manual_review)} 个标签")
        for item in manual_review:
            print(f"    - {item}")

    # ── 统计 ──
    print(f"\n  -- 校验完成 --")
    print(f"  Tags 数量:   {len(tags)}")
    print(f"  Migration:   {len(migration_map)} 条映射")
    print(f"  Errors:      {errors}")
    print(f"  Warnings:    {warnings}")

    if errors == 0 and warnings == 0:
        print(f"  [OK] 全部通过")
    elif errors == 0:
        print(f"  [WARN] 有 warning，可忽视但建议检查")
    else:
        print(f"  [FAIL] 有 error，需要修复")

    return errors, warnings


def main():
    script_dir = Path(__file__).parent
    project_root = script_dir.parent if script_dir.name == "tools" else script_dir
    tags_path = project_root / "journal" / "data" / "tags.json"

    if not tags_path.exists():
        print(f"[FATAL] 找不到 tags.json: {tags_path}")
        sys.exit(2)

    print(f"  校验: {tags_path}\n")
    errors, warnings = validate(tags_path)
    sys.exit(0 if errors == 0 else 1)


if __name__ == "__main__":
    main()
