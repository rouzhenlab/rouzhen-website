#!/usr/bin/env python3
"""
Metadata Migration — Phase 3A: entries.json Tag Migration

将 entries.json 中的历史标签字符串（AI, #AI, Content OS, ...）
通过 tags.json 的 migration.map 统一转换为 Tag ID。

设计原则：
  ① 先备份，再修改（entries.before-migration.json）
  ② 幂等：已转换为 ID 的标签不会被重复映射
  ③ 只修改，不删除：手动确认项保留原文，标注为 REVIEW
  ④ 去重：多个旧标签映射到同一 ID 时自动合并
  ⑤ 输出完整迁移报告

Usage:
  python tools/migrate_tags.py
  python tools/migrate_tags.py --dry-run   (仅预览，不写入)
"""

import json
import os
import sys
import shutil
from datetime import datetime
from collections import OrderedDict

# ── Paths ──────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES_PATH = os.path.join(ROOT, "journal", "data", "entries.json")
TAGS_PATH = os.path.join(ROOT, "journal", "data", "tags.json")
BACKUP_PATH = os.path.join(ROOT, "journal", "data", "entries.before-migration.json")

DRY_RUN = "--dry-run" in sys.argv


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=OrderedDict)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ── 加载数据 ───────────────────────────────────────────────────────
entries_data = load_json(ENTRIES_PATH)
tags_data = load_json(TAGS_PATH)

tag_dict = {t["id"]: t for t in tags_data.get("tags", [])}
migration_map = tags_data.get("migration", {}).get("map", {})
manual_review = tags_data.get("migration", {}).get("_manual_review", [])

# ── 辅助函数 ───────────────────────────────────────────────────────
def is_valid_id(s):
    """检查字符串是否已经是有效的 Tag ID"""
    return s in tag_dict


def migrate_tag(raw):
    """
    对单个标签字符串执行迁移。
    返回 (new_value, action, detail)
    action: "keep" | "migrate" | "duplicate" | "manual_review" | "unknown"
    """
    if not raw or not raw.strip():
        return raw, "keep", "empty"

    trimmed = raw.strip()

    # 1. 已经是有效 ID → 保持
    if is_valid_id(trimmed):
        return trimmed, "keep", "already valid ID"

    # 2. 在 migration map 中 → 转换
    if trimmed in migration_map:
        target = migration_map[trimmed]
        if is_valid_id(target):
            return target, "migrate", "{} -> {}".format(trimmed, target)
        else:
            # migration map 指向不存在的 ID（数据错误）
            return trimmed, "unknown", "migration target '{}' not in tag dict".format(target)

    # 3. 在 manual_review 列表中 → 人工确认
    if trimmed in manual_review:
        return trimmed, "manual_review", "needs manual review"

    # 4. 未知标签 → 保持原样
    return trimmed, "unknown", "no mapping found"


def migrate_list(tag_list, entry_title=""):
    """
    迁移整个标签列表，自动去重。
    返回 (new_list, changes) where changes is list of dicts
    """
    if not tag_list:
        return [], []

    seen = set()
    new_list = []
    changes = []

    for raw in tag_list:
        new_val, action, detail = migrate_tag(raw)

        if action == "duplicate":
            # 重复 ID，记录但不重复添加
            changes.append({
                "old": raw,
                "new": "(duplicate of {})".format(new_val),
                "action": "dedup",
                "detail": detail
            })
            continue

        if new_val in seen:
            changes.append({
                "old": raw,
                "new": "(duplicate of {})".format(new_val),
                "action": "dedup",
                "detail": "merged with existing " + new_val
            })
            continue

        seen.add(new_val)
        new_list.append(new_val)
        changes.append({
            "old": raw,
            "new": new_val,
            "action": action,
            "detail": detail
        })

    return new_list, changes


# ── 创建备份 ────────────────────────────────────────────────────────
if not DRY_RUN:
    shutil.copy2(ENTRIES_PATH, BACKUP_PATH)
    print("[BACKUP] {} -> {}".format(
        os.path.basename(ENTRIES_PATH),
        os.path.basename(BACKUP_PATH)
    ))
else:
    print("[DRY RUN] No files will be modified.\n")


# ── 迁移执行 ────────────────────────────────────────────────────────
report = {
    "migrated_at": datetime.now().isoformat(),
    "entries_scanned": 0,
    "tags_total_before": 0,
    "tags_migrated": 0,
    "tags_kept": 0,
    "tags_deduped": 0,
    "tags_manual_review": 0,
    "tags_unknown": 0,
    "per_entry": []
}

entries = entries_data.get("entries", [])
report["entries_scanned"] = len(entries)

for entry in entries:
    entry_report = {
        "id": entry.get("id", "?"),
        "title": entry.get("title", "?"),
        "tags_before": list(entry.get("tags", [])),
        "changes": []
    }

    # 迁移 tags
    new_tags, tag_changes = migrate_list(entry.get("tags", []), entry.get("title", ""))
    entry["tags"] = new_tags
    entry_report["tags_after"] = list(new_tags)
    entry_report["changes"].extend(tag_changes)
    report["tags_total_before"] += len(entry_report["tags_before"])

    for ch in tag_changes:
        if ch["action"] == "migrate":
            report["tags_migrated"] += 1
        elif ch["action"] in ("keep",):
            report["tags_kept"] += 1
        elif ch["action"] == "dedup":
            report["tags_deduped"] += 1
        elif ch["action"] == "manual_review":
            report["tags_manual_review"] += 1
        elif ch["action"] == "unknown":
            report["tags_unknown"] += 1

    # 迁移 tagsEn（如果存在）
    if "tagsEn" in entry and entry["tagsEn"]:
        new_tags_en, en_changes = migrate_list(entry["tagsEn"], entry.get("titleEn", ""))
        entry["tagsEn"] = new_tags_en
        # tagsEn 的变更合并到同一 entry_report（标记为 EN）
        for ch in en_changes:
            ch["lang"] = "en"
        entry_report["changes"].extend(en_changes)
        # 不重复计数（tagsEn 和 tags 语义上映射到同一组 ID）

    report["per_entry"].append(entry_report)


# ── 更新 meta ───────────────────────────────────────────────────────
entries_data["meta"]["schema_version"] = 2
entries_data["meta"]["lastUpdated"] = datetime.now().strftime("%Y-%m-%d")
entries_data["meta"]["note"] = (
    "Tag values migrated from legacy strings to canonical IDs. "
    "See docs/Tag-Audit-Report.md and tools/migrate_tags.py for details."
)


# ── 写入 ────────────────────────────────────────────────────────────
if not DRY_RUN:
    save_json(ENTRIES_PATH, entries_data)
    print("[WRITE] entries.json migrated successfully.\n")
else:
    print("[DRY RUN] entries.json NOT modified.\n")


# ── 输出报告 ────────────────────────────────────────────────────────
divider = "=" * 60
print(divider)
print("  MIGRATION REPORT")
print(divider)

# 汇总表
print()
print("  {:.<30} {:>6}".format("Entries scanned", report["entries_scanned"]))
print("  {:.<30} {:>6}".format("Total tag references (before)", report["tags_total_before"]))
print("  {:.<30} {:>6}".format("Migrated (old -> ID)", report["tags_migrated"]))
print("  {:.<30} {:>6}".format("Kept (already valid ID)", report["tags_kept"]))
print("  {:.<30} {:>6}".format("Deduplicated", report["tags_deduped"]))
print("  {:.<30} {:>6}".format("Manual review needed", report["tags_manual_review"]))
print("  {:.<30} {:>6}".format("Unknown (no mapping)", report["tags_unknown"]))

# 逐条详细变更
for e in report["per_entry"]:
    if not e["changes"]:
        continue
    has_changes = any(c["action"] not in ("keep",) for c in e["changes"])
    if not has_changes:
        continue

    print("\n  -- {} --".format(e["title"]))
    print("  Before: {}".format(e["tags_before"]))
    print("  After:  {}".format(e["tags_after"]))
    for ch in e["changes"]:
        if ch["action"] == "keep":
            continue
        marker = {
            "migrate":       "  -> ",
            "dedup":         "  ~~ ",
            "manual_review": "  ?? ",
            "unknown":       "  !! ",
        }.get(ch["action"], "  ?  ")
        lang_suffix = " [EN]" if ch.get("lang") == "en" else ""
        print("    {}{} | {}{}".format(marker, ch["old"], ch["detail"], lang_suffix))

# 手动确认项
if report["tags_manual_review"] > 0:
    print("\n  {} MANUAL REVIEW REQUIRED".format(divider[:40]))
    print("  These tags were kept unchanged. Please decide:")
    for e in report["per_entry"]:
        for ch in e["changes"]:
            if ch["action"] == "manual_review":
                print("    - '{}' in '{}'".format(ch["old"], e["title"]))
    print()

print("\n" + divider)

# 备份提示
if not DRY_RUN:
    print("  Backup saved: {}".format(os.path.basename(BACKUP_PATH)))
    print("  Rollback: copy entries.before-migration.json -> entries.json")
else:
    print("  DRY RUN — no files modified.")
print(divider)
