"""
AI Parser - AI-based fallback parser for unknown broadcast formats.

Used when rule-based parsers (FGBParser, LitterazyParser) fail to extract
complete data from a broadcast message.

Uses structured extraction via LLM to best-effort parse any format.
"""

import json
import logging
import re
from typing import Optional
from models import ParsedBroadcast
from providers.router import get_router
from providers.base import TaskType, GenerationConfig

logger = logging.getLogger(__name__)

# Structured extraction prompt template
EXTRACTION_PROMPT = """Kamu adalah parser broadcast buku. Ekstrak informasi berikut dari pesan broadcast ini.

PESAN BROADCAST:
{text}

---

Ekstrak field berikut dalam format JSON:
- title: Judul buku (tanpa format/jenis binding)
- type: Jenis buku (Remainderbook, Request, Ready, dll) atau null jika tidak ada
- format: Format binding (HB=Hardcover, PB=Paperback, BB=Board Book) atau null
- pages: Jumlah halaman (integer) atau null
- price: Harga dalam integer (hapus titik/koma, contoh: 120.000 → 120000)
- stock: Jumlah stok (integer) atau null
- description: Deskripsi/sinopsis buku
- tags: Array tag khusus (Award winner, New, dll)
- preview_links: Array URL preview (Instagram, YouTube, dll)
- eta: Perkiraan waktu tiba jika ada (contoh: "Mei '25") atau null
- close_date: Tanggal close order jika ada atau null
- publisher: Nama penerbit jika diketahui atau null

PENTING:
- Hanya return JSON object, tanpa penjelasan lain
- Untuk field yang tidak ditemukan, gunakan null
- Price harus integer (bukan string)
- preview_links dan tags harus array (bisa kosong [])

Contoh output:
{{"title": "Nana in the City", "type": "Remainderbook", "format": "HB", "pages": 40, "price": 120000, "stock": 28, "description": "Seorang anak...", "tags": ["Caldecott Honor Award Winner"], "preview_links": ["https://instagram.com/..."], "eta": null, "close_date": null, "publisher": null}}

Return HANYA JSON:"""


class AIParser:
    """AI-based parser for unknown/changed broadcast formats."""
    
    def __init__(self):
        self.router = get_router()
    
    async def parse(self, text: str, media_count: int = 0) -> ParsedBroadcast:
        """
        Use LLM to extract book fields from freeform text.
        
        Args:
            text: Raw broadcast text
            media_count: Number of media attachments
            
        Returns:
            ParsedBroadcast with extracted fields
        """
        logger.info("AI Parser: Starting extraction from freeform text")
        
        prompt = EXTRACTION_PROMPT.format(text=text)
        
        try:
            config = GenerationConfig(
                temperature=0.1,  # Low temperature for structured extraction
                top_p=0.9,
                max_tokens=1024
            )
            
            response = await self.router.generate_text(
                prompt=prompt,
                task_type=TaskType.TEXT_GENERATION,
                config=config
            )
            
            if response.error:
                logger.error(f"AI Parser: LLM error: {response.error}")
                return self._create_fallback(text, media_count)
            
            # Parse JSON response
            result = self._parse_json_response(response.text)
            if result:
                logger.info(f"AI Parser: Successfully extracted fields for '{result.get('title', 'Unknown')}'")
                return self._to_parsed_broadcast(result, text, media_count)
            else:
                logger.warning("AI Parser: Failed to parse JSON from LLM response")
                return self._create_fallback(text, media_count)
                
        except Exception as e:
            logger.error(f"AI Parser: Exception during parsing: {e}")
            return self._create_fallback(text, media_count)
    
    def _parse_json_response(self, response_text: str) -> Optional[dict]:
        """Extract and parse JSON from LLM response."""
        response_text = response_text.strip()
        
        # Try direct JSON parse first
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            pass
        
        # Try to find JSON object in response
        json_match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # Try to find JSON between code blocks
        code_block_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', response_text, re.DOTALL)
        if code_block_match:
            try:
                return json.loads(code_block_match.group(1))
            except json.JSONDecodeError:
                pass
        
        return None
    
    def _to_parsed_broadcast(self, data: dict, raw_text: str, media_count: int) -> ParsedBroadcast:
        """Convert extracted dict to ParsedBroadcast model."""
        
        # Normalize format to standard abbreviations
        format_val = data.get('format')
        if format_val:
            format_map = {
                'hardcover': 'HB', 'hb': 'HB', 'hc': 'HB',
                'paperback': 'PB', 'pb': 'PB',
                'board book': 'BB', 'bb': 'BB', 'boardbook': 'BB'
            }
            format_val = format_map.get(format_val.lower(), format_val.upper())
        
        return ParsedBroadcast(
            raw_text=raw_text,
            media_count=media_count,
            title=data.get('title'),
            title_en=data.get('title'),  # Same as title for now
            type=data.get('type'),
            format=format_val,
            price_main=data.get('price'),
            stock=data.get('stock'),
            description_en=data.get('description'),
            tags=data.get('tags') or [],
            preview_links=data.get('preview_links') or [],
            eta=data.get('eta'),
            close_date=data.get('close_date'),
            publisher=data.get('publisher'),
            pages=data.get('pages'),
            ai_fallback=True  # Mark as AI-parsed
        )
    
    def _create_fallback(self, text: str, media_count: int) -> ParsedBroadcast:
        """Create minimal ParsedBroadcast when all parsing fails."""
        # Try to extract at least the first line as title
        lines = text.strip().split('\n')
        title = lines[0][:100] if lines else "Unknown"
        
        # Clean title of common prefixes
        title = re.sub(r'^\*?\[?\s*(READY|Remainderbook|Request)\s*\]?\s*[-–:]?\s*', '', title, flags=re.IGNORECASE)
        title = title.strip('*').strip()
        
        return ParsedBroadcast(
            raw_text=text,
            media_count=media_count,
            title=title,
            title_en=title,
            description_en=text,
            tags=[],
            preview_links=[],
            ai_fallback=True
        )


# Singleton instance
_ai_parser_instance: Optional[AIParser] = None


def get_ai_parser() -> AIParser:
    """Get or create singleton AIParser instance."""
    global _ai_parser_instance
    if _ai_parser_instance is None:
        _ai_parser_instance = AIParser()
    return _ai_parser_instance
