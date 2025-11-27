import re
import yaml
from pathlib import Path
from typing import Dict, List, Any
from models import ParsedBroadcast

class FGBParser:
    def __init__(self, config_path: str = "config/parser-rules.yaml"):
        config_file = Path(__file__).parent / config_path
        with open(config_file, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)

        self.patterns = self.config.get('patterns', {})
        self.skip_rules = self.config.get('skip_rules', {})

    def _extract_field(self, text: str, field_name: str) -> Any:
        """Extract a field from text using configured patterns"""
        if self.skip_rules.get(field_name, False):
            return None

        field_patterns = self.patterns.get(field_name, [])

        for pattern_config in field_patterns:
            regex = pattern_config['regex']
            group = pattern_config.get('group', 0)
            transform = pattern_config.get('transform')
            multi = pattern_config.get('multi', False)

            if multi:
                matches = re.findall(regex, text, re.IGNORECASE | re.MULTILINE)
                if matches:
                    return matches if isinstance(matches[0], str) else [m[group] if isinstance(m, tuple) else m for m in matches]
            else:
                match = re.search(regex, text, re.IGNORECASE | re.MULTILINE)
                if match:
                    value = match.group(group)
                    if transform == 'remove_separators':
                        value = int(value.replace('.', '').replace(',', ''))
                    return value

        return None

    def _extract_description(self, text: str) -> str:
        """Extract description (text between price and tags/separator)"""
        # Find the start (after min order or price)
        price_match = re.search(r'🏷️.*?(?:\n|$)', text, re.MULTILINE)
        if not price_match:
            return ""

        start_pos = price_match.end()

        # Find the end (before tags or separator)
        tag_match = re.search(r'_New\s+\w+_', text[start_pos:])
        separator_match = re.search(r'(🌳|🦊){2,}', text[start_pos:])
        link_match = re.search(r'https?://', text[start_pos:])

        end_positions = [
            tag_match.start() if tag_match else len(text),
            separator_match.start() if separator_match else len(text),
            link_match.start() if link_match else len(text)
        ]
        end_pos = start_pos + min(end_positions)

        description = text[start_pos:end_pos].strip()
        # Clean up asterisks and extra whitespace
        description = re.sub(r'\*+', '', description)
        description = re.sub(r'\s+', ' ', description)

        return description

    def parse(self, text: str, media_count: int = 0) -> ParsedBroadcast:
        """Parse FGB broadcast text into structured data"""
        result = ParsedBroadcast(
            raw_text=text,
            media_count=media_count
        )

        # Extract all fields
        result.type = self._extract_field(text, 'type')
        result.eta = self._extract_field(text, 'eta')
        result.close_date = self._extract_field(text, 'close_date')
        result.title = self._extract_field(text, 'title')
        result.format = self._extract_field(text, 'format')
        result.price_main = self._extract_field(text, 'price_main')
        result.price_secondary = self._extract_field(text, 'price_secondary')
        result.min_order = self._extract_field(text, 'min_order')
        result.separator_emoji = self._extract_field(text, 'separator')

        # Extract multi-value fields
        tags = self._extract_field(text, 'tags')
        result.tags = tags if tags else []

        links = self._extract_field(text, 'preview_links')
        result.preview_links = links if links else []

        # Extract description
        result.description_en = self._extract_description(text)

        # Set title_en as same as title
        result.title_en = result.title

        return result
