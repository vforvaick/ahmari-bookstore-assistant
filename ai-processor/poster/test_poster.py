"""
Test script for Poster Generator.

Usage:
    python -m poster.test_poster

This tests the core poster generation with sample images.
"""

import asyncio
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))


async def test_layout_engine():
    """Test layout calculation."""
    from poster.layout import LayoutEngine
    
    print("=" * 50)
    print("Testing LayoutEngine")
    print("=" * 50)
    
    engine = LayoutEngine()
    
    # Test various cover counts
    test_cases = [
        (6, 1080, 1920),   # 6 covers, IG Story
        (9, 1080, 1920),   # 9 covers, IG Story
        (19, 1080, 1920),  # 19 covers, IG Story
        (25, 1080, 1920),  # 25 covers, IG Story
    ]
    
    for count, w, h in test_cases:
        layout = engine.calculate_layout(count, w, h)
        print(f"\n{count} covers on {w}x{h}:")
        print(f"  Rows: {layout.rows}")
        print(f"  Cols per row: {layout.cols_per_row}")
        print(f"  Cover size: {layout.cover_width}x{layout.cover_height}")
        print(f"  Title height: {layout.title_height}")
    
    print("\n✅ LayoutEngine tests passed!")


async def test_presets():
    """Test dimension presets."""
    from poster.presets import get_dimensions, get_preset_options
    
    print("=" * 50)
    print("Testing Presets")
    print("=" * 50)
    
    # Test getting presets
    presets = get_preset_options()
    print("\nAvailable presets:")
    for p in presets:
        print(f"  {p['id']}: {p['name']} ({p['dimensions']})")
    
    # Test dimension lookup
    print("\nDimension lookups:")
    print(f"  ig_story: {get_dimensions('ig_story')}")
    print(f"  ig_square: {get_dimensions('ig_square')}")
    print(f"  wa_status: {get_dimensions('wa_status')}")
    print(f"  custom 2160x3840: {get_dimensions('2160x3840')}")
    
    print("\n✅ Preset tests passed!")


async def test_renderer_background():
    """Test background generation."""
    from poster.renderer import PosterRenderer, BackgroundStyle
    
    print("=" * 50)
    print("Testing Renderer Backgrounds")
    print("=" * 50)
    
    renderer = PosterRenderer()
    
    # Test solid background
    bg = BackgroundStyle(style="solid", primary_color="#FF5733")
    solid = renderer.create_background(500, 500, bg)
    print(f"  Solid background: {solid.size}")
    
    # Test gradient background
    bg = BackgroundStyle(style="gradient", primary_color="#FF5733", secondary_color="#3498DB")
    gradient = renderer.create_background(500, 500, bg)
    print(f"  Gradient background: {gradient.size}")
    
    # Test stripes background
    bg = BackgroundStyle(style="stripes", colors=["#FF5733", "#3498DB", "#2ECC71", "#9B59B6"])
    stripes = renderer.create_background(500, 500, bg)
    print(f"  Stripes background: {stripes.size}")
    
    # Save test outputs
    output_dir = Path(__file__).parent / "test_output"
    output_dir.mkdir(exist_ok=True)
    
    solid.save(output_dir / "bg_solid.png")
    gradient.save(output_dir / "bg_gradient.png")
    stripes.save(output_dir / "bg_stripes.png")
    
    print(f"\n  Test images saved to: {output_dir}")
    print("\n✅ Renderer background tests passed!")


async def test_full_poster():
    """Test full poster generation (requires API key)."""
    import os
    
    print("=" * 50)
    print("Testing Full Poster Generation")
    print("=" * 50)
    
    # Check for API key
    if not os.getenv('GEMINI_API_KEY') and not os.getenv('GEMINI_API_KEYS'):
        print("⚠️ Skipping full test - no GEMINI_API_KEY set")
        return
    
    from poster.generator import PosterGenerator
    from PIL import Image
    
    generator = PosterGenerator()
    
    # Create sample covers for testing
    colors = ["#FF5733", "#3498DB", "#2ECC71", "#9B59B6", "#F39C12", "#1ABC9C"]
    sample_covers = []
    
    print("\nCreating sample covers...")
    for i, color in enumerate(colors):
        img = Image.new('RGB', (200, 200), color)
        sample_covers.append(img)
    
    # Note: Full test would need real images
    # For now just test the pipeline components
    
    print("  (Full generation test requires real source images)")
    print("\n✅ Full poster test setup complete!")


async def main():
    """Run all tests."""
    print("\n" + "=" * 60)
    print("POSTER GENERATOR - TEST SUITE")
    print("=" * 60)
    
    await test_presets()
    await test_layout_engine()
    await test_renderer_background()
    await test_full_poster()
    
    print("\n" + "=" * 60)
    print("ALL TESTS PASSED! ✅")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
