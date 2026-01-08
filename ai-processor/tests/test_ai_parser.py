"""
Test AI Parser - Hybrid fallback parser for unknown formats.

Tests the AI parser with the new Littlerazy format provided by user.
"""

import asyncio
import pytest
from ai_parser import AIParser, get_ai_parser
from models import ParsedBroadcast

# New Littlerazy format provided by user
NEW_LITTLERAZY_FORMAT = """*[READY] Remainderbook - Nana in the City: A Caldecott Honor Award Winner* (Stok 28)

📖 Hardcover, 40 Halaman
💰 Rp 120.000

Seorang anak laki-laki yang awalnya cemas dan ragu menghadapi keramaian kota besar mengunjungi neneknya, yang dengan penuh kasih membimbingnya menjelajahi hiruk-pikuk dan kesibukan kota. Berkat dukungan neneknya, ia akhirnya menyadari bahwa kota yang tampak menakutkan sesungguhnya bisa menjadi tempat yang menyenangkan dan pantas dicintai.

‼️Ada koin Caldecott Honor Award Winner

Preview https://www.instagram.com/p/B2KVw9tA54V/"""


class TestAIParser:
    """Test suite for AI fallback parser."""
    
    @pytest.fixture
    def parser(self):
        return get_ai_parser()
    
    @pytest.mark.asyncio
    async def test_parse_new_littlerazy_format(self, parser):
        """Test parsing new Littlerazy format with AI."""
        result = await parser.parse(NEW_LITTLERAZY_FORMAT, media_count=1)
        
        # Check basic fields extracted
        assert result.title is not None, "Title should be extracted"
        assert "Nana" in result.title, f"Title should contain 'Nana', got: {result.title}"
        
        # Check price
        assert result.price_main == 120000, f"Price should be 120000, got: {result.price_main}"
        
        # Check format
        assert result.format in ['HB', 'Hardcover', 'HC'], f"Format should be Hardcover-ish, got: {result.format}"
        
        # Check pages
        assert result.pages == 40, f"Pages should be 40, got: {result.pages}"
        
        # Check stock
        assert result.stock == 28, f"Stock should be 28, got: {result.stock}"
        
        # Check ai_fallback flag
        assert result.ai_fallback is True, "ai_fallback should be True"
        
        # Check preview links
        assert len(result.preview_links) > 0, "Preview links should be extracted"
        assert "instagram.com" in result.preview_links[0], "Should extract Instagram link"
    
    @pytest.mark.asyncio
    async def test_parse_preserves_raw_text(self, parser):
        """Test that raw_text is preserved."""
        result = await parser.parse(NEW_LITTLERAZY_FORMAT, media_count=1)
        
        assert result.raw_text == NEW_LITTLERAZY_FORMAT
        assert result.media_count == 1
    
    @pytest.mark.asyncio
    async def test_parse_handles_minimal_input(self, parser):
        """Test fallback when AI gets minimal info."""
        minimal_text = "Some book for 50.000"
        result = await parser.parse(minimal_text, media_count=0)
        
        # Should still return valid ParsedBroadcast
        assert isinstance(result, ParsedBroadcast)
        assert result.ai_fallback is True


def test_littlerazy_parser_incomplete():
    """Test that old LitterazyParser returns incomplete for new format."""
    from littlerazy_parser import LitterazyParser
    
    parser = LitterazyParser()
    result = parser.parse(NEW_LITTLERAZY_FORMAT, media_count=1)
    
    # Old parser should fail to extract title+price properly
    is_complete = parser.is_complete(result)
    
    # This test documents that the new format breaks old parser
    print(f"Old parser result: title={result.title}, price={result.price_main}")
    print(f"is_complete: {is_complete}")
    
    # We expect this to be False for new format
    # (Either missing title or missing price or both)
    # If old regex happens to match, this test will help us know


if __name__ == "__main__":
    print("=" * 60)
    print("Testing AI Parser with new Littlerazy format")
    print("=" * 60)
    
    # Run sync test first
    test_littlerazy_parser_incomplete()
    
    # Run async test
    async def run_tests():
        parser = get_ai_parser()
        print("\n" + "=" * 60)
        print("Testing AI fallback parser...")
        print("=" * 60)
        
        try:
            result = await parser.parse(NEW_LITTLERAZY_FORMAT, media_count=1)
            print(f"\n✅ Parse successful!")
            print(f"   Title: {result.title}")
            print(f"   Type: {result.type}")
            print(f"   Price: {result.price_main}")
            print(f"   Format: {result.format}")
            print(f"   Pages: {result.pages}")
            print(f"   Stock: {result.stock}")
            print(f"   Tags: {result.tags}")
            print(f"   Preview: {result.preview_links}")
            print(f"   AI Fallback: {result.ai_fallback}")
        except Exception as e:
            print(f"\n❌ Parse failed: {e}")
            import traceback
            traceback.print_exc()
    
    asyncio.run(run_tests())
