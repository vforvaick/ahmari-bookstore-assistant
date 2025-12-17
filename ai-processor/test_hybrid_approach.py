"""
Test script for the hybrid approach.
Tests: parser -> output_formatter with sample FGB input.
"""

import asyncio
from parser import FGBParser
from output_formatter import OutputFormatter
from gemini_client import GeminiClient

# Sample FGB raw text (from docs/plans/usage-result.json)
SAMPLE_RAW = """WoEB | ETA : Apr '26

_(close : 20 Dec)_

*How Teach Grown Ups About Pluto* (HB)

🏷️ Rp 155.000

🦊🦊🦊

Pluto has not been a planet since 2006. But this tiny world still inspires people of all ages while sparking controversy. In this delightfully witty book, astronomer Dean Regas teaches you how to educate your grown-up about the cutting-edge science of space, most crucially the reason why Pluto is NOT a planet any more.

_Preview :_

* https://amzn.eu/d/hYFHQ1V

* https://youtu.be/p3_l5ZWjpwg?si=26e6lBZ_T7BgsyCC
"""

def test_parser():
    """Test parser extraction."""
    print("=" * 60)
    print("1. TESTING PARSER")
    print("=" * 60)
    
    parser = FGBParser()
    parsed = parser.parse(SAMPLE_RAW)
    
    print(f"Title: {parsed.title}")
    print(f"Publisher: {parsed.publisher}")
    print(f"Format: {parsed.format}")
    print(f"Price Main: {parsed.price_main}")
    print(f"ETA: {parsed.eta}")
    print(f"Close Date: {parsed.close_date}")
    print(f"Preview Links: {parsed.preview_links}")
    print(f"Description: {parsed.description_en[:100]}..." if parsed.description_en else "No description")
    
    return parsed


def test_formatter(parsed):
    """Test output formatter (rule-based)."""
    print("\n" + "=" * 60)
    print("2. TESTING OUTPUT FORMATTER (Rule-based)")
    print("=" * 60)
    
    formatter = OutputFormatter(price_markup=20000)
    
    # Test individual functions
    print(f"\nPrice (original): Rp {parsed.price_main:,}".replace(',', '.'))
    print(f"Price (with +20.000 markup): {formatter.format_price(parsed.price_main)}")
    
    print(f"\nLink cleanup test:")
    for link in parsed.preview_links:
        if 'instagram' in link:
            print(f"  IG: {link} -> {formatter.cleanup_instagram_link(link)}")
        elif 'youtu' in link:
            print(f"  YT: {link} -> {formatter.cleanup_youtube_link(link)}")
    
    # Test full format with mock review
    mock_review = "Moms, pernah nggak sih si kecil nanya kenapa Pluto bukan planet lagi, terus kita jadi bingung jawabnya? 😅 Nah, buku super *witty* karya astronom Dean Regas ini bakal bikin si kecil jadi \"guru\" buat orang dewasa! Wajib masuk wishlist! 🚀🪐"
    
    # Manually set publisher for test (AI would guess this)
    parsed.publisher = "Britannica Books"
    
    output = formatter.format_broadcast(parsed, mock_review)
    
    print("\n" + "-" * 40)
    print("FORMATTED OUTPUT:")
    print("-" * 40)
    print(output)
    
    return output


async def test_full_integration():
    """Test full integration with Gemini AI."""
    print("\n" + "=" * 60)
    print("3. TESTING FULL INTEGRATION (with AI)")
    print("=" * 60)
    
    try:
        parser = FGBParser()
        parsed = parser.parse(SAMPLE_RAW)
        
        client = GeminiClient()
        
        print("\nGenerating with Gemini AI...")
        result = await client.generate_broadcast(parsed)
        
        print("\n" + "-" * 40)
        print("AI-GENERATED BROADCAST:")
        print("-" * 40)
        print(result)
        
    except Exception as e:
        print(f"\n⚠️ AI integration test skipped: {e}")
        print("(This is expected if no API key is configured)")


if __name__ == "__main__":
    # Test 1: Parser
    parsed = test_parser()
    
    # Test 2: Formatter (rule-based)
    test_formatter(parsed)
    
    # Test 3: Full integration (optional, requires API key)
    print("\n" + "=" * 60)
    print("Run full AI integration test? (requires GEMINI_API_KEY)")
    print("=" * 60)
    asyncio.run(test_full_integration())
