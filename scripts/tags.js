/* ────────────────────────────────────────────────────────────────
   TagResolver v1.0
   标签系统运行时唯一数据源。
   所有标签的 Display Name / URL / Category 均通过本模块获取。
   ── 设计原则：
   1. tags.json 是 Single Source of Truth
   2. migration.map 仅做字符串→ID 转换（临时桥接）
   3. 未知 Tag 返回 null → 调用方 graceful fallback
   ──────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var TAG_DICT = {};       // { id: { cn, en, slug, category, ... } }
  var MIGRATION_MAP = {};  // { "old-string": "id" }
  var LOADED = false;
  var PENDING_CALLBACKS = [];

  /** ── 加载 tags.json ── */
  function load() {
    return fetch('/journal/data/tags.json')
      .then(function (res) {
        if (!res.ok) throw new Error('tags.json HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        // 构建 ID → tag 字典
        (data.tags || []).forEach(function (t) {
          TAG_DICT[t.id] = t;
        });

        // 加载 migration map
        var map = (data.migration && data.migration.map) || {};
        Object.keys(map).forEach(function (k) {
          if (map[k] && map[k] !== 'MANUAL_REVIEW') {
            MIGRATION_MAP[k] = map[k];
          }
        });

        LOADED = true;
        PENDING_CALLBACKS.forEach(function (cb) { cb(); });
        PENDING_CALLBACKS = [];

        return TAG_DICT;
      })
      .catch(function (err) {
        console.warn('[TagResolver] Failed to load tags.json:', err.message);
        TAG_DICT = {};
        MIGRATION_MAP = {};
        LOADED = true;
        PENDING_CALLBACKS.forEach(function (cb) { cb(); });
        PENDING_CALLBACKS = [];
      });
  }

  function onReady(cb) {
    if (LOADED) { cb(); return; }
    PENDING_CALLBACKS.push(cb);
  }

  /**
   * 将原始标签字符串解析为统一 Tag ID
   * @param {string} raw — 如 "#AI"、"AI"、"ai-general"
   * @returns {{ id:string, tag:object } | null}
   */
  function resolve(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var trimmed = raw.trim();
    if (!trimmed) return null;

    // 1. 直接 ID 匹配
    if (TAG_DICT[trimmed]) {
      return { id: trimmed, tag: TAG_DICT[trimmed] };
    }

    // 2. migration map 转换
    var mapped = MIGRATION_MAP[trimmed];
    if (mapped && TAG_DICT[mapped]) {
      return { id: mapped, tag: TAG_DICT[mapped] };
    }

    // 3. 未知标签
    return null;
  }

  /**
   * 获取 Display Name
   * @param {string} id
   * @param {'cn'|'en'} lang
   * @returns {string}
   */
  function displayName(id, lang) {
    var tag = TAG_DICT[id];
    if (!tag) return id; // fallback: 显示 ID 本身
    return tag[lang] || tag.en || tag.cn || id;
  }

  /**
   * 获取筛选 URL
   * @param {string} id
   * @returns {string}
   */
  function getUrl(id) {
    return '/journal/index.html?tag=' + encodeURIComponent(id);
  }

  /**
   * 批量解析 + 去重
   * @param {string[]} rawTags
   * @returns {string[]} — 唯一 Tag ID 列表
   */
  function resolveMany(rawTags) {
    if (!Array.isArray(rawTags)) return [];
    var seen = {};
    var ids = [];
    rawTags.forEach(function (raw) {
      var r = resolve(raw);
      if (r && !seen[r.id]) {
        seen[r.id] = true;
        ids.push(r.id);
      } else if (!r && raw && raw.trim()) {
        console.warn('[TagResolver] Unknown tag:', JSON.stringify(raw));
      }
    });
    return ids;
  }

  function isLoaded() { return LOADED; }

  /* ── 暴露 API ── */
  global.TagResolver = {
    load: load,
    onReady: onReady,
    resolve: resolve,
    resolveMany: resolveMany,
    displayName: displayName,
    getUrl: getUrl,
    isLoaded: isLoaded,
    // 只读，调试用
    _tagCount: function () { return Object.keys(TAG_DICT).length; }
  };

})(window);
