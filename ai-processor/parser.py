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
        """Extract description (text after separator emoji, before Preview/links)"""
        
        # FGB format: separator emoji (🦊🦊🦊 or 🌳🌳🌳) marks START of description
        separator_match = re.search(r'(🌳|🦊){2,}', text)
        
        if separator_match:
            # Description starts after separator
            start_pos = separator_match.end()
        else:
            # Fallback: try after price line
            price_match = re.search(r'🏷️.*?(?:\n|$)', text, re.MULTILINE)
            if not price_match:
                return ""
            start_pos = price_match.end()

        # Find the end (before Preview: or links)
        remaining_text = text[start_pos:]
        
        # Look for "Preview" marker or first link
        preview_match = re.search(r'_?Preview\s*:?_?', remaining_text, re.IGNORECASE)
        link_match = re.search(r'\*?\s*https?://', remaining_text)
        
        end_positions = []
        if preview_match:
            end_positions.append(preview_match.start())
        if link_match:
            end_positions.append(link_match.start())
        
        if end_positions:
            end_pos = min(end_positions)
            description = remaining_text[:end_pos].strip()
        else:
            description = remaining_text.strip()
        
        # Clean up asterisks, underscores, and extra whitespace
        description = re.sub(r'[\*_]+', '', description)
        description = re.sub(r'\s+', ' ', description)
        description = description.strip()

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
        result.publisher = self._extract_field(text, 'publisher')
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
