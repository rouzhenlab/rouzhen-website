#!/usr/bin/env python3
"""
ROUZHEN Publisher - Content distribution toolkit

Brand: 安静、克制、东方审美、自然观察
       技术隐藏在自然之后，不炫耀，表现人与自然的关系

Four content personas — not four summaries of the same article,
but four different editors writing for four different platforms.
"""

import os
import re
import json
import shutil
from pathlib import Path
from datetime import datetime


# ── Parsing ──────────────────────────────────────────────────────────────────

def parse_article(html_path):
    """Parse HTML article file and return structured content."""
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()

    title_match = re.search(r'<meta property="og:title" content="([^"]*)"', content)
    desc_match = re.search(r'<meta property="og:description" content="([^"]*)"', content)
    image_match = re.search(r'<meta property="og:image" content="([^"]*)"', content)

    # Date: meta > filename > content
    date = ''
    meta_date = re.search(r'<meta name="article-date" content="([^"]*)"', content)
    if meta_date:
        date = meta_date.group(1).strip()
    if not date:
        fn_date = re.search(r'(\d{4}-\d{2}-\d{2})', html_path)
        if fn_date:
            d = fn_date.group(1)
            date = f"{d[:4]}.{d[5:7]}.{d[8:10]}"
    if not date:
        content_date = re.search(r'<div class="article-date[^"]*">([^<]*)</div>', content)
        if content_date:
            date = content_date.group(1).strip()

    tags = re.findall(r'<span class="article-tag[^"]*">([^<]*)</span>', content)

    # Body paragraphs
    body_match = re.search(r'<div class="article-body[^>]*>(.*?)</div>\s*<footer', content, re.DOTALL)
    paragraphs = []
    if body_match:
        paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', body_match.group(1), re.DOTALL)
        paragraphs = [re.sub(r'<[^>]+>', '', p).strip() for p in paragraphs if p.strip()]

    # Pull quote
    quote_match = re.search(r'<div class="article-pull-quote[^>]*>(.*?)</div>', content, re.DOTALL)
    pull_quote = re.sub(r'<[^>]+>', '', quote_match.group(1)).strip() if quote_match else ''

    # Reflection lines
    reflection_match = re.search(r'<div class="article-reflection[^>]*>(.*?)</div>', content, re.DOTALL)
    reflection_lines = []
    if reflection_match:
        reflection_lines = re.findall(r'<p[^>]*>(.*?)</p>', reflection_match.group(1), re.DOTALL)
        reflection_lines = [re.sub(r'<[^>]+>', '', p).strip() for p in reflection_lines if p.strip()]

    lang_match = re.search(r'<html lang="([^"]*)"', content)
    lang = 'en' if '-en.html' in html_path or (lang_match and 'en' in lang_match.group(1)) else 'cn'

    return {
        'title': title_match.group(1) if title_match else '',
        'description': desc_match.group(1) if desc_match else '',
        'image': image_match.group(1) if image_match else '',
        'date': date,
        'tags': tags,
        'paragraphs': paragraphs,
        'pull_quote': pull_quote,
        'reflection_lines': reflection_lines,
        'lang': lang,
        'source': html_path
    }


# ── Brand Tags ───────────────────────────────────────────────────────────────

# Brand tag vocabulary — these are SEO assets, not generic words
_BRAND_TAGS_CN = ['ROUZHEN', '柔真', '苔藓美学', '云雾生态', '自然设计']
_BRAND_TAGS_EN = ['ROUZHEN', 'BetweenCloudAndMoss', 'MossArt', 'CloudEcology', 'NatureDesign']


def get_brand_tags(lang, with_hash=True):
    """Brand-asset hashtags — not generic words."""
    tags = _BRAND_TAGS_CN if lang == 'cn' else _BRAND_TAGS_EN
    if with_hash:
        return ['#' + t for t in tags]
    return tags


# ── Paragraph Intelligence ───────────────────────────────────────────────────

def _match_any(text, keywords, case_insensitive=False):
    """Check if text contains any of the keywords."""
    t = text.lower() if case_insensitive else text
    for kw in keywords:
        k = kw.lower() if case_insensitive else kw
        if k in t:
            return True
    return False


def _dedup(parts, new_item):
    """Skip new_item if it's too similar to any existing part."""
    for p in parts:
        if new_item == p or new_item in p or p in new_item:
            return False
    return True


def shorten(text, max_len=60):
    """Truncate text, preserving meaning."""
    if len(text) <= max_len:
        return text
    cut = text[:max_len]
    for sep in ['。', '，', '；', '.', ',', ';', '—']:
        idx = cut.rfind(sep)
        if idx > max_len // 2:
            return text[:idx + 1].rstrip()
    return cut + "..."


def find_conflict(paragraphs, description, lang):
    """Find the opening conflict — human doubt, not object description.

    Must begin with a person's question, not with technical nouns.
    Preferred: I thought / I wondered / I wanted to know
    Avoid: Technical nouns as first sentence.
    """
    # Priority: human conflict sentences (first person, inner question)
    cn_human = ['我以为', '我一直想', '我一直在找', '我想找到', '我想要',
                '我曾经以为', '我总以为', '我一直在寻找', '我想弄清楚',
                '我想知道', '我在想', '我好奇']
    en_human = ['I thought', 'I wondered', 'I wanted to know', 'I kept trying',
                'I wanted to create', 'I was looking for', 'I wanted to find',
                'I had been looking', 'I wondered if']
    human_kw = cn_human if lang == 'cn' else en_human

    for p in paragraphs:
        if len(p) > 80:
            continue
        if _match_any(p, human_kw, case_insensitive=(lang == 'en')):
            return p

    # Fallback: any conflict keyword
    cn_kw = ['以为', '想弄清楚', '想造', '一直在寻找', '想找到', '想知道',
             '如果', '什么', '为什么', '壁垒', '足够坚固']
    en_kw = ['wanted to know', 'kept trying', 'if there was',
             'wanted to create', 'looking for', 'wondered if']
    keywords = cn_kw if lang == 'cn' else en_kw

    for p in paragraphs:
        if len(p) > 80:
            continue
        if _match_any(p, keywords, case_insensitive=(lang == 'en')):
            return p
    return ''


def find_search(paragraphs, lang):
    """Find the search/action phase — what the author did."""
    cn_kw = ['查', '看', '研究', '一份一份', '云雾发生', '雾化', '导流']
    en_kw = ['reading', 'looking', 'one after', 'fog generator', 'atomization']
    keywords = cn_kw if lang == 'cn' else en_kw

    for p in paragraphs:
        if len(p) > 70:
            continue
        if _match_any(p, keywords, case_insensitive=(lang == 'en')):
            return p
    return ''


def find_discovery(paragraphs, lang):
    """Find the turning point — the moment of understanding."""
    cn_kw = ['明白了', '才发现', '原来', '那一刻', '忽然', '后来想起',
             '重新思考', '不再', '安静', '踏实']
    en_kw = ['realized', 'understood', 'changed', 'that moment',
             'quietly changed', 'brought me closer', 'forgot why']
    keywords = cn_kw if lang == 'cn' else en_kw

    for p in paragraphs:
        if len(p) > 80:
            continue
        if _match_any(p, keywords, case_insensitive=(lang == 'en')):
            return p
    return ''


def find_moment(paragraphs, lang):
    """Find a shareable visual moment — quiet, sensory, poetic."""
    cn_kw = ['看了很久', '站', '渗', '慢慢', '安静', '犹豫', '贴着', '散开',
             '呼吸', '节奏', '简单']
    en_kw = ['stood', 'watched', 'slowly', 'quiet', 'silence', 'hesitantly',
             'clung', 'seeped', 'breathe', 'rhythm', 'simple']
    keywords = cn_kw if lang == 'cn' else en_kw

    for p in paragraphs:
        if len(p) > 70:
            continue
        if _match_any(p, keywords, case_insensitive=(lang == 'en')):
            return p
    return ''


def find_viewpoint(paragraphs, description, lang):
    """Extract one core viewpoint — the thesis, not the title."""
    cn_kw = ['不是', '而是', '从来', '区别', '在于', '真正', '无法', '从不',
             '从来不', '差异']
    en_kw = ['never', 'difference', 'cannot', 'truly', 'what differs',
             'has never been', 'far more difficult']
    keywords = cn_kw if lang == 'cn' else en_kw

    for p in paragraphs:
        if len(p) > 60:
            continue
        if _match_any(p, keywords, case_insensitive=(lang == 'en')):
            return p

    return description


def find_visual_fragment(paragraphs, lang, existing=None):
    """Find a short, purely visual/sensory/philosophical fragment.

    For Photo (Instagram): NO research process, NO author's inner monologue.
    Only: visual, feeling, nature, philosophy.
    """
    existing = existing or []

    cn_visual = ['云', '雾', '苔', '石', '水', '光', '慢慢', '安静',
                 '呼吸', '节奏', '简单', '自然', '生命', '浮', '渗',
                 '贴', '散开', '相遇']
    en_visual = ['quiet', 'slowly', 'never', 'simply', 'always', 'rhythm',
                 'breathe', 'mist', 'moss', 'water', 'stone', 'light',
                 'nature', 'life', 'form', 'silence', 'new']

    # Hard skip: anything about research / engineering / doubt process
    # Also skip transition/narrative words: but, however, until, then
    cn_skip = ['专利', '查', '看', '烦躁', '慌', '系统', '技术', '研发',
               '参数', '结构', '导流', '雾化', '壁垒', '想弄', '想知道',
               '想造', '以为', '发现', '明白', '开始', '如果', '什么',
               '为什么', '只不过', '几十年', '专门', '造园', '假山',
               '盆景', '做陶', '泥土', '念头', '软管', '谁都可以',
               '照着', '照着摆', '不好意思', '材料', '堆',
               '可是', '但是', '然而', '不过', '后来', '直到',
               '终于', '原来', '其实', '后来']
    en_skip = ['patent', 'reading', 'read', 'atomization', 'system', 'parameter',
               'structure', 'airflow', 'moat', 'wondered', 'realized',
               'thought', 'wanted', 'decades', 'career', 'reverse',
               'replicated', 'engineered', 'protect', 'protecting',
               'tube', 'anyone', 'same tube', 'same materials',
               'but', 'however', 'until', 'then', 'finally',
               'actually', 'turned out', 'i realized', 'i thought',
               'i wanted', 'i wondered', 'i discovered']

    visual_kw = cn_visual if lang == 'cn' else en_visual
    skip_kw = cn_skip if lang == 'cn' else en_skip

    for p in paragraphs:
        if _match_any(p, skip_kw, case_insensitive=(lang == 'en')):
            continue
        if len(p) > 90:
            continue

        # Split into fragments
        if lang == 'cn':
            fragments = re.split(r'[。；\n]', p)
        else:
            fragments = re.split(r'[.;\n]', p)

        for frag in fragments:
            frag = frag.strip()
            # Skip dialogue
            if frag.startswith('"') or frag.startswith('\u201c'):
                continue
            frag = frag.rstrip('"\u201d,')
            min_len = 6 if lang == 'cn' else 8
            max_len = 40 if lang == 'cn' else 55
            if min_len <= len(frag) <= max_len:
                if not _match_any(frag, skip_kw, case_insensitive=(lang == 'en')):
                    if _match_any(frag, visual_kw, case_insensitive=(lang == 'en')):
                        if _dedup(existing, frag):
                            return frag
    return ''


# ── 1. Long — 创作者文章 ──────────────────────────────────────────────────────

def generate_long(article):
    """Long-form: complete thought and narrative. Brand archive.

    Not a summary. Full article with frontmatter.
    Tags use brand vocabulary for SEO, not generic words.
    """
    lang = article['lang']
    lines = []

    # Frontmatter
    lines.append("---")
    lines.append(f"title: {article['title']}")
    lines.append(f"date: {article['date']}")
    if article['image']:
        lines.append(f"cover: {article['image']}")
    # Brand tags in YAML list format (SEO assets)
    brand_tags = get_brand_tags(lang, with_hash=False)
    lines.append("tags:")
    for tag in brand_tags[:4]:
        lines.append(f"  - {tag}")
    lines.append("---")
    lines.append("")

    # Title
    lines.append(f"# {article['title']}")
    lines.append("")

    # Introduction
    lines.append(f"> {article['description']}")
    lines.append("")

    # Full body
    for p in article['paragraphs']:
        lines.append(p)
        lines.append("")

    # Tags at end (brand tags)
    lines.append("---")
    lines.append("")
    lines.append("Tags: " + " · ".join(get_brand_tags(lang)[:4]))

    return "\n".join(lines)


# ── 2. Image — 小红书 Story ──────────────────────────────────────────────────

def generate_image(article):
    """小红书: 「发现一个美好事物的故事」

    Story arc: 怀疑 → 寻找 → 发现 → 顿悟
    Must open with conflict, not realization.
    """
    lang = article['lang']
    brand_tags = get_brand_tags(lang)
    paras = article['paragraphs']

    lines = []
    story_parts = []

    # 1. Conflict opening — doubt, question, or false assumption
    max_story = 80 if lang == 'en' else 50
    conflict = find_conflict(paras, article['description'], lang)
    if conflict:
        story_parts.append(shorten(conflict, max_story))
    else:
        # Fallback: pull quote or description, but NOT a realization
        if article['pull_quote']:
            story_parts.append(shorten(article['pull_quote'], max_story))
        else:
            story_parts.append(shorten(article['description'], max_story))

    # 2. Search — what the author did
    search = find_search(paras, lang)
    if search and _dedup(story_parts, search):
        story_parts.append(shorten(search, max_story))

    # 3. Discovery — visual moment
    mom = find_moment(paras, lang)
    if mom and _dedup(story_parts, mom):
        story_parts.append(shorten(mom, max_story))

    # 4. Epiphany — the insight
    view = find_viewpoint(paras, article['description'], lang)
    if view and _dedup(story_parts, view):
        story_parts.append(shorten(view, max_story))

    # Fill if too short
    if len(story_parts) < 3:
        for p in paras:
            if len(p) <= 60 and _dedup(story_parts, p):
                story_parts.append(p)
                if len(story_parts) >= 5:
                    break

    for part in story_parts[:6]:
        lines.append(part)
        lines.append("")

    # Brand tags
    lines.append(" ".join(brand_tags[:4]))
    lines.append("")

    # Image reference
    if article['image']:
        label = "[Image:" if lang == 'en' else "[配图:"
        lines.append(f"{label} {article['image']}]")

    return "\n".join(lines)


# ── 3. Photo — Instagram Caption ─────────────────────────────────────────────

def generate_photo(article):
    """Instagram: 「视觉作品说明」

    The photo is the main character. Not the R&D process.
    Only: visual, feeling, nature, philosophy.

    NO: patents, research, engineering, author's inner monologue.
    """
    lang = article['lang']
    brand_tags = get_brand_tags('en')  # Instagram: always English hashtags
    paras = article['paragraphs']

    lines = []

    # Opening — one poetic/visual line
    # Try pull quote first (most poetic), then find a visual fragment
    opening = ''
    if article['pull_quote']:
        opening = shorten(article['pull_quote'], 60)
    else:
        # Find the most visual one-liner
        cn_visual = ['云', '雾', '苔', '安静', '呼吸', '节奏', '简单']
        en_visual = ['quiet', 'slowly', 'never', 'simply', 'always',
                     'rhythm', 'breathe', 'mist', 'moss']
        visual_kw = cn_visual if lang == 'cn' else en_visual
        for p in paras:
            if len(p) <= 60 and _match_any(p, visual_kw, case_insensitive=(lang == 'en')):
                opening = p
                break
        if not opening:
            opening = shorten(article['description'], 60)

    lines.append(opening)
    lines.append("")

    # 2-4 short poetic fragments — ONLY visual/sensory/philosophical
    # NO research process, NO doubt, NO engineering
    poetic_lines = []
    for _ in range(4):
        frag = find_visual_fragment(paras, lang, existing=[opening] + poetic_lines)
        if frag:
            poetic_lines.append(frag)
        else:
            break

    for pl in poetic_lines:
        lines.append(pl)
        lines.append("")

    # English hashtags
    lines.append(" ".join(brand_tags))
    lines.append("")

    # Photo reference
    if article['image']:
        lines.append(f"[Photo: {article['image']}]")

    return "\n".join(lines)


# ── 4. Micro — X / Threads ───────────────────────────────────────────────────

def generate_micro(article):
    """X / Threads: 「思想碎片」

    Must sound like brand philosophy, not personal diary.
    Avoid first person (I, me, my).
    Avoid quotation / dialogue.
    One viewpoint extracted from the article, not the title.
    """
    lang = article['lang']
    brand_tags = get_brand_tags(lang)[:3]

    # Extract viewpoint
    viewpoint = find_viewpoint(article['paragraphs'], article['description'], lang)

    # Strip first person / dialogue lines — brand philosophy, not diary
    def _clean_micro_line(text):
        """Remove personal/diary language. Keep it brand philosophy."""
        text = text.strip('"\u201c\u201d')
        # Skip lines that are purely personal
        personal_kw_cn = ['我觉得', '我感到', '我发现', '我明白', '我的']
        personal_kw_en = ['i felt', 'i feel', 'i realized', 'i discovered',
                          'i thought', 'i wondered', 'i wanted', 'i decided',
                          'my ', 'me ']
        if lang == 'cn':
            if _match_any(text, personal_kw_cn):
                return ''
        else:
            text_lower = text.lower()
            for kw in personal_kw_en:
                if kw in text_lower:
                    # Allow if the line still makes sense without the personal part
                    # e.g. "Very little in nature is truly new." — no personal, ok
                    # e.g. "I realized this road..." — personal, strip
                    if text_lower.startswith(kw):
                        return ''
        return text

    viewpoint = _clean_micro_line(viewpoint)
    if not viewpoint:
        viewpoint = article['description']

    # Try to find a complementary second line
    if lang == 'en':
        en_skip_micro = ['read', 'patent', 'reading', 'atomization', 'system',
                         'structure', 'airflow', 'wondered', 'thought',
                         'i felt', 'i feel', 'i realized', 'i discovered']
        for p in article['paragraphs']:
            if len(p) <= 60 and p != viewpoint:
                if _match_any(p, en_skip_micro, case_insensitive=True):
                    continue
                if _match_any(p, ['nature', 'always', 'never', 'new', 'truly',
                                  'simple', 'quiet', 'breathe', 'rhythm',
                                  'mist', 'moss', 'silence'], case_insensitive=True):
                    cleaned = _clean_micro_line(p)
                    if cleaned:
                        viewpoint = f"{viewpoint}\n{cleaned}"
                        break
    else:
        cn_skip_micro = ['查', '看', '烦躁', '慌', '专利', '系统', '雾化', '导流']
        for p in article['paragraphs']:
            if len(p) <= 50 and p != viewpoint:
                if _match_any(p, cn_skip_micro):
                    continue
                if _match_any(p, ['不再', '慢慢', '安静', '呼吸', '节奏', '简单',
                                  '云', '雾', '苔', '生命', '自然']):
                    cleaned = _clean_micro_line(p)
                    if cleaned:
                        viewpoint = f"{viewpoint}\n{cleaned}"
                        break

    tag_str = " " + " ".join(brand_tags)

    # Length control
    max_len = 150 if lang == 'cn' else 280
    if len(viewpoint) + len(tag_str) <= max_len:
        text = viewpoint + tag_str
    else:
        available = max_len - len(tag_str) - 3
        text = shorten(viewpoint, available) + tag_str

    return text


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    """Generate all publish content from journal entries."""
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    entries_dir = repo_root / "journal" / "entries"
    publish_dir = repo_root / "publish"

    # Clean output
    for category in ['Long', 'Image', 'Photo', 'Micro']:
        cat_dir = publish_dir / category
        if cat_dir.exists():
            shutil.rmtree(cat_dir)
        cat_dir.mkdir(parents=True, exist_ok=True)

    # Parse articles
    articles = []
    for html_file in entries_dir.glob("*.html"):
        if html_file.name.startswith('.'):
            continue
        article = parse_article(str(html_file))
        article['filename'] = html_file.stem
        articles.append(article)

    articles.sort(key=lambda x: x['date'], reverse=True)

    # Generate
    manifest = {'generated': datetime.now().isoformat(), 'articles': []}

    generators = [
        ('Long', generate_long, '.md'),
        ('Image', generate_image, '.txt'),
        ('Photo', generate_photo, '.txt'),
        ('Micro', generate_micro, '.txt'),
    ]

    for article in articles:
        filename = article['filename']
        lang = article['lang']

        for cat, gen_fn, ext in generators:
            content = gen_fn(article)
            path = publish_dir / cat / f"{filename}{ext}"
            path.write_text(content, encoding='utf-8')

        manifest['articles'].append({
            'source': f"journal/entries/{filename}.html",
            'title': article['title'],
            'date': article['date'],
            'lang': lang,
            'outputs': {
                cat: f"publish/{cat}/{filename}{ext}"
                for cat, _, ext in generators
            }
        })

    # Manifest
    manifest_path = publish_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')

    print(f"Generated publish content for {len(articles)} articles")
    print(f"Output: {publish_dir}")
    for cat, _, _ in generators:
        count = len(list((publish_dir / cat).glob('*')))
        print(f"  {cat}: {count} files")


if __name__ == "__main__":
    main()
