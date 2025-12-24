"""
Littlerazy Parser

Parses book broadcast format from Littlerazy supplier.
Format: TITLE FORMAT PRICE ETA MONTH EMOJI Description...
Example: Plastic Sucks HC 130.000 ETA MEI 🌸🌸🌸 How can YOU help...
"""

import re
from typing import Optional
from models import ParsedBroadcast


class LitterazyParser:
    """Parser for Littlerazy supplier format"""
    
    # Regex to match inline metadata
    # Pattern: Title (optional subtitle) FORMAT PRICE ETA MONTH EMOJI
    HEADER_PATTERN = re.compile(
        r'^'
        r'(?P<title>.+?)'                           # Title (non-greedy)
        r'\s+'
        r'(?P<format>HC|HB|PB|BB)'                  # Format
        r'\s+'
        r'(?P<price>[\d\.]+)'                       # Price (e.g., 130.000)
        r'\s+'
        r'ETA\s+(?P<eta>\w+)'                       # ETA month (e.g., MEI)
        r'\s+'
        r'(?P<emoji>[🌸🌺🌷🌹💐🌻🌼]+)'             # Flower emojis
        r'\s*'
        r'(?P<description>.*)',                     # Description (rest of line)
        re.IGNORECASE | re.DOTALL
    )
    
    def parse(self, text: str, media_count: int = 0) -> ParsedBroadcast:
        """Parse Littlerazy broadcast text into structured data"""
        result = ParsedBroadcast(
            raw_text=text,
            media_count=media_count
        )
        
        # Try to match header pattern
        match = self.HEADER_PATTERN.match(text.strip())
        
        if match:
            # Extract title (may include subtitle in parentheses)
            raw_title = match.group('title').strip()
            result.title = self._clean_title(raw_title)
            result.title_en = result.title
            
            # Extract format
            result.format = match.group('format').upper()
            
            # Extract price (convert 130.000 to 130000)
            price_str = match.group('price')
            result.price_main = int(price_str.replace('.', '').replace(',', ''))
            
            # Extract ETA
            eta_month = match.group('eta').upper()
            result.eta = self._format_eta(eta_month)
            
            # Extract description
            description = match.group('description').strip()
            result.description_en = self._clean_description(description)
            
            # Set separator emoji
            result.separator_emoji = match.group('emoji')
            
            # Littlerazy broadcasts are typically requests
            result.type = 'Request'
            
            # Default tags
            result.tags = []
            
        else:
            # Fallback: try simpler parsing
            result = self._fallback_parse(text, media_count)
        
        return result
    
    def _clean_title(self, title: str) -> str:
        """Clean and format title"""
        # Remove extra whitespace
        title = re.sub(r'\s+', ' ', title).strip()
        # Capitalize properly (Title Case)
        return title.title()
    
    def _format_eta(self, month: str) -> str:
        """Format ETA month to standard format"""
        month_map = {
            'JAN': "Jan '25", 'FEB': "Feb '25", 'MAR': "Mar '25",
            'APR': "Apr '25", 'MEI': "Mei '25", 'MAY': "May '25",
            'JUN': "Jun '25", 'JUL': "Jul '25", 'AUG': "Aug '25",
            'AGU': "Aug '25", 'SEP': "Sep '25", 'OKT': "Oct '25",
            'OCT': "Oct '25", 'NOV': "Nov '25", 'DES': "Dec '25",
            'DEC': "Dec '25"
        }
        return month_map.get(month.upper(), f"{month} '25")
    
    def _clean_description(self, description: str) -> str:
        """Clean description text"""
        # Remove multiple newlines
        description = re.sub(r'\n{3,}', '\n\n', description)
        # Remove extra whitespace
        description = re.sub(r'[ \t]+', ' ', description)
        return description.strip()
    
    def _fallback_parse(self, text: str, media_count: int) -> ParsedBroadcast:
        """Fallback parsing when header pattern doesn't match"""
        result = ParsedBroadcast(
            raw_text=text,
            media_count=media_count
        )
        
        # Try to extract at least the title (first line or first sentence)
        lines = text.strip().split('\n')
        if lines:
            first_line = lines[0].strip()
            # Take first part before common separators
            title_match = re.match(r'^([^🌸🌺🌷💐]+)', first_line)
            if title_match:
                result.title = title_match.group(1).strip()[:100]
                result.title_en = result.title
        
        # Try to extract price (any number like 130.000)
        price_match = re.search(r'\b(\d{2,3})\.(\d{3})\b', text)
        if price_match:
            result.price_main = int(price_match.group(1) + price_match.group(2))
        
        # Use full text as description
        result.description_en = text
        
        return result


# Singleton instance
_parser_instance: Optional[LitterazyParser] = None

def get_littlerazy_parser() -> LitterazyParser:
    """Get or create singleton parser instance"""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = LitterazyParser()
    return _parser_instance
