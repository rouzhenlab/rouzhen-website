# ROUZHEN Publisher

Content distribution toolkit for multi-platform publishing.

## Overview

Automatically converts journal entries into platform-specific formats:
- **Long**: Full articles for blogs, 公众号 (Markdown)
- **Image**: Image-centric posts for 小红书, 微博 (TXT)
- **Photo**: Photo-centric posts for Instagram (TXT)
- **Micro**: Short posts for Twitter/X (TXT)

## Usage

```bash
# Generate all formats
python3 tools/publisher/publish.py
```

## Output Structure

```
publish/
├── Long/          # Blog articles (.md)
├── Image/         # 小红书/微博 (.txt)
├── Photo/         # Instagram (.txt)
├── Micro/         # Twitter/X (.txt)
└── manifest.json  # Article manifest
```

## GitHub Actions

Automatically runs on:
- Push to `main` with changes in `journal/entries/`
- Manual workflow dispatch

## Functions

- Content extraction from HTML articles
- Platform-specific format adaptation
- Bilingual support (Chinese/English)
- Automatic manifest generation
