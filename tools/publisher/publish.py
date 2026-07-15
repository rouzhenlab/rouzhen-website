#!/usr/bin/env python3
"""
ROUZHEN Publisher - Content distribution toolkit
Converts journal entries to platform-specific formats.
"""

import os
import re
import json
import shutil
from pathlib import Path
from html.parser import HTMLParser
from datetime import datetime


class ArticleParser(HTMLParser):
    """Parse HTML article and extract content."""
    
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.in_body = False
        self.in_p = False
        self.in_img = False
        self.current_tag = None
        self.title = ""
        self.description = ""
        self.body_paragraphs = []
        self.images = []
        self.tags = []
        self.date = ""
        self.current_text = ""
        self.current_attrs = {}
        
    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        self.current_attrs = dict(attrs)
        
        if tag == "title":
            self.in_title = True
        elif tag == "h1" and 'article-title' in dict(attrs).get('class', ''):
            self.in_body = True
        elif tag == "p" and 'article-body' in self._get_parent_context():
            self.in_p = True
        elif tag == "img":
            src = dict(attrs).get('src', '')
            alt = dict(attrs).get('alt', '')
            if src:
                self.images.append({'src': src, 'alt': alt})
        elif tag == "span" and 'article-tag' in dict(attrs).get('class', ''):
            self.in_tag = True
        elif tag == "div" and 'article-date' in dict(attrs).get('class', ''):
            self.in_date = True
            
        if tag == "meta":
            attrs_dict = dict(attrs)
            if attrs_dict.get('property') == 'og:title':
                self.title = attrs_dict.get('content', '')
            elif attrs_dict.get('property') == 'og:description':
                self.description = attrs_dict.get('content', '')
            elif attrs_dict.get('property') == 'og:image':
                self.images.append({'src': attrs_dict.get('content', ''), 'alt': ''})
    
    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "h1":
            self.in_body = False
        elif tag == "p":
            self.in_p = False
            if self.current_text.strip():
                self.body_paragraphs.append(self.current_text.strip())
            self.current_text = ""
        elif tag == "span":
            self.in_tag = False
            if self.current_text.strip() and hasattr(self, 'in_tag') and self.in_tag:
                self.tags.append(self.current_text.strip())
        elif tag == "div":
            self.in_date = False
            
    def handle_data(self, data):
        if self.in_p:
            self.current_text += data
        elif hasattr(self, 'in_tag') and self.in_tag:
            self.current_text += data
        elif hasattr(self, 'in_date') and self.in_date:
            self.date = data.strip()
            
    def _get_parent_context(self):
        return ""


def parse_article(html_path):
    """Parse HTML article file and return structured content."""
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Simple regex extraction for meta tags
    title_match = re.search(r'<meta property="og:title" content="([^"]*)"', content)
    desc_match = re.search(r'<meta property="og:description" content="([^"]*)"', content)
    image_match = re.search(r'<meta property="og:image" content="([^"]*)"', content)
    date_match = re.search(r'<div class="article-date[^"]*">([^<]*)</div>', content)
    
    # Extract tags
    tags = re.findall(r'<span class="article-tag[^"]*">([^<]*)</span>', content)
    
    # Extract body paragraphs
    body_match = re.search(r'<div class="article-body[^>]*>(.*?)</div>\s*<footer', content, re.DOTALL)
    paragraphs = []
    if body_match:
        paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', body_match.group(1), re.DOTALL)
        paragraphs = [re.sub(r'<[^>]+>', '', p).strip() for p in paragraphs if p.strip()]
    
    # Detect language from filename or html lang attribute
    lang_match = re.search(r'<html lang="([^"]*)"', content)
    lang = 'en' if '-en.html' in html_path or (lang_match and 'en' in lang_match.group(1)) else 'cn'
    
    return {
        'title': title_match.group(1) if title_match else '',
        'description': desc_match.group(1) if desc_match else '',
        'image': image_match.group(1) if image_match else '',
        'date': date_match.group(1).strip() if date_match else '',
        'tags': tags,
        'paragraphs': paragraphs,
        'lang': lang,
        'source': html_path
    }


def generate_long(article):
    """Generate long-form content (blog, 公众号)."""
    lines = []
    lines.append(f"# {article['title']}")
    lines.append("")
    lines.append(f"*{article['date']}*")
    lines.append("")
    lines.append(f"> {article['description']}")
    lines.append("")
    
    for p in article['paragraphs']:
        lines.append(p)
        lines.append("")
    
    if article['tags']:
        lines.append("---")
        lines.append("")
        lines.append("Tags: " + " · ".join(article['tags']))
    
    return "\n".join(lines)


def generate_image(article):
    """Generate image-centric content (小红书, 微博)."""
    lines = []
    lines.append(article['title'])
    lines.append("")
    lines.append(article['description'])
    lines.append("")
    
    # First paragraph as intro
    if article['paragraphs']:
        lines.append(article['paragraphs'][0][:200] + "...")
        lines.append("")
    
    if article['tags']:
        lines.append(" ".join(["#" + t for t in article['tags']]))
    
    lines.append("")
    lines.append(f"[配图: {article['image']}]")
    
    return "\n".join(lines)


def generate_photo(article):
    """Generate photo-centric content (Instagram)."""
    lines = []
    lines.append(article['title'])
    lines.append("")
    lines.append(article['description'])
    lines.append("")
    
    if article['tags']:
        lines.append(" ".join(["#" + t for t in article['tags']]))
    
    lines.append("")
    lines.append(f"[主图: {article['image']}]")
    
    return "\n".join(lines)


def generate_micro(article):
    """Generate micro-content (Twitter/X)."""
    # Title + short desc + tags, max ~280 chars
    text = f"{article['title']}\n\n{article['description']}"
    
    if article['tags']:
        tag_str = " " + " ".join(["#" + t for t in article['tags']])
        remaining = 280 - len(text) - len(tag_str) - 20
        if remaining > 0:
            text += tag_str
    
    return text


def main():
    """Main entry point."""
    # Paths
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    entries_dir = repo_root / "journal" / "entries"
    publish_dir = repo_root / "publish"
    
    # Clean and create output directories
    for category in ['Long', 'Image', 'Photo', 'Micro']:
        cat_dir = publish_dir / category
        if cat_dir.exists():
            shutil.rmtree(cat_dir)
        cat_dir.mkdir(parents=True, exist_ok=True)
    
    # Find all article HTML files
    articles = []
    for html_file in entries_dir.glob("*.html"):
        if html_file.name.startswith('.'):
            continue
        article = parse_article(str(html_file))
        article['filename'] = html_file.stem
        articles.append(article)
    
    # Sort by date
    articles.sort(key=lambda x: x['date'], reverse=True)
    
    # Generate outputs
    manifest = {'generated': datetime.now().isoformat(), 'articles': []}
    
    for article in articles:
        filename = article['filename']
        lang = article['lang']
        
        # Long format
        long_content = generate_long(article)
        long_path = publish_dir / 'Long' / f"{filename}.md"
        long_path.write_text(long_content, encoding='utf-8')
        
        # Image format
        image_content = generate_image(article)
        image_path = publish_dir / 'Image' / f"{filename}.txt"
        image_path.write_text(image_content, encoding='utf-8')
        
        # Photo format
        photo_content = generate_photo(article)
        photo_path = publish_dir / 'Photo' / f"{filename}.txt"
        photo_path.write_text(photo_content, encoding='utf-8')
        
        # Micro format
        micro_content = generate_micro(article)
        micro_path = publish_dir / 'Micro' / f"{filename}.txt"
        micro_path.write_text(micro_content, encoding='utf-8')
        
        # Add to manifest
        manifest['articles'].append({
            'source': f"journal/entries/{filename}.html",
            'title': article['title'],
            'date': article['date'],
            'lang': lang,
            'outputs': {
                'Long': f"publish/Long/{filename}.md",
                'Image': f"publish/Image/{filename}.txt",
                'Photo': f"publish/Photo/{filename}.txt",
                'Micro': f"publish/Micro/{filename}.txt"
            }
        })
    
    # Write manifest
    manifest_path = publish_dir / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    
    print(f"Generated publish content for {len(articles)} articles")
    print(f"Output: {publish_dir}")
    
    # Print summary
    for cat in ['Long', 'Image', 'Photo', 'Micro']:
        cat_dir = publish_dir / cat
        files = list(cat_dir.glob('*'))
        print(f"  {cat}: {len(files)} files")


if __name__ == "__main__":
    main()