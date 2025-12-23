"""
PosterGenerator - Main orchestrator for poster generation.

Combines:
- CoverAnalyzer: AI-based cover detection
- LayoutEngine: Grid calculation
- PosterRenderer: Image manipulation
- BackgroundGenerator: AI/Code background generation

This is the main entry point for the poster feature.
"""

import logging
from pathlib import Path
from typing import List, Optional, Union, Tuple
from PIL import Image
import io

from .analyzer import CoverAnalyzer, AnalysisResult
from .layout import LayoutEngine, GridLayout
from .renderer import PosterRenderer, BackgroundStyle, TitleStyle
from .presets import get_dimensions, parse_dimension_string
from .background import BackgroundGenerator, BackgroundType, BackgroundRequest

logger = logging.getLogger(__name__)


class PosterGenerator:
    """
    Main orchestrator for poster generation.
    
    Workflow:
    1. Analyze source images (AI detects covers)
    2. Calculate layout (Code-based grid math)
    3. Crop covers from sources (Code, pixel-precise)
    4. Create background (Code or AI-generated)
    5. Composite final poster (Code)
    """
    
    def __init__(self):
        """Initialize generator with all components."""
        self.analyzer = CoverAnalyzer()
        self.layout_engine = LayoutEngine()
        self.renderer = PosterRenderer()
        self.bg_generator = BackgroundGenerator()
    
    async def generate(
        self,
        source_images: List[Union[str, Path, Image.Image]],
        prompt: Optional[str] = None,
        platform: Optional[str] = None,
        dimensions: Optional[Tuple[int, int]] = None,
        title_text: Optional[str] = None,
        background_style: str = "gradient",
        custom_layout: Optional[List[int]] = None,
        cover_type: Optional[str] = None,  # "single" or "multi" - skips AI detection
    ) -> Image.Image:
        """
        Generate poster from source images.
        
        Args:
            source_images: List of source images containing book covers
            prompt: Optional user prompt for parsing instructions
            platform: Platform preset (e.g., "ig_story", "wa_status")
            dimensions: Custom dimensions (width, height)
            title_text: Title text for the poster
            background_style: "solid", "gradient", "stripes"
            custom_layout: Optional custom layout (e.g., [3, 3, 3])
            cover_type: "single" (each image = 1 cover) or "multi" (AI detects)
            
        Returns:
            Generated poster as PIL Image
        """
        logger.info(f"Starting poster generation with {len(source_images)} source images")
        
        # Step 1: Determine dimensions
        if dimensions:
            width, height = dimensions
        else:
            width, height = get_dimensions(preset=platform)
        
        logger.info(f"Target dimensions: {width}x{height}")
        
        # Step 2: Load source images
        pil_images = []
        for source in source_images:
            if isinstance(source, Image.Image):
                pil_images.append(source)
            else:
                pil_images.append(Image.open(source))
        
        # Step 3: Analyze images to detect covers
        # Skip AI detection if user specified cover_type
        covers = []
        analysis = AnalysisResult()  # Empty result for color extraction
        
        if cover_type == "single":
            # User says each image is a single cover - skip AI detection entirely
            logger.info(f"Cover type 'single' specified - skipping AI detection, using {len(pil_images)} images directly")
            covers = pil_images.copy()
            # Use code-based color detection
            analysis.dominant_colors = await self.analyzer.analyze_colors(pil_images)
        else:
            # Auto-detect covers using AI (or use images directly if AI fails)
            logger.info("Analyzing source images for cover detection...")
            analysis = await self.analyzer.detect_covers(pil_images)
            
            if analysis.error or len(analysis.covers) == 0:
                # Fallback: treat each source image as a single cover
                logger.warning(f"AI detection unavailable ({analysis.error or 'no covers found'}), using images directly")
                covers = pil_images.copy()
                # Use code-based color detection
                if not analysis.dominant_colors:
                    analysis.dominant_colors = await self.analyzer.analyze_colors(pil_images)
            else:
                logger.info(f"Detected {len(analysis.covers)} covers")
                # Crop covers from sources based on AI-detected bounding boxes
                for detected in analysis.covers:
                    source_img = pil_images[detected.source_image_index]
                    cropped = self.renderer.crop_cover(source_img, detected.bbox)
                    covers.append(cropped)
        
        logger.info(f"Using {len(covers)} covers from sources")
        
        # Step 5: Calculate layout
        layout = self.layout_engine.calculate_layout(
            cover_count=len(covers),
            canvas_width=width,
            canvas_height=height,
            custom_rows=custom_layout,
            include_title=bool(title_text)
        )
        
        logger.info(f"Layout: {layout.rows} rows, {layout.cols_per_row}")
        
        # Step 6: Create background
        bg_colors = analysis.dominant_colors or ["#4A90D9", "#87CEEB"]
        logger.info(f"Background colors: {bg_colors}, style: {background_style}")
        
        if background_style == "ai_creative":
            # Use AI to generate creative background
            bg_request = BackgroundRequest(
                width=width,
                height=height,
                bg_type=BackgroundType.AI_CREATIVE,
                dominant_colors=bg_colors,
                theme_description=analysis.suggested_background
            )
            bg_result = await self.bg_generator.generate(bg_request)
            background = BackgroundStyle(
                style="image",
                image=bg_result.image
            )
        elif background_style == "gradient":
            background = BackgroundStyle(
                style="gradient",
                primary_color=bg_colors[0] if bg_colors else "#4A90D9",
                secondary_color=bg_colors[1] if len(bg_colors) > 1 else bg_colors[0]
            )
        elif background_style == "stripes":
            background = BackgroundStyle(
                style="stripes",
                colors=bg_colors[:8]  # Max 8 stripes
            )
        else:
            background = BackgroundStyle(
                style="solid",
                primary_color=bg_colors[0] if bg_colors else "#FFFFFF"
            )
        
        # Step 7: Configure title
        title = None
        if title_text:
            # Use multi-color if we have colors from analysis
            title_colors = bg_colors[:len(title_text)] if bg_colors else None
            title = TitleStyle(
                text=title_text,
                font_size=int(layout.title_height * 0.6),
                colors=title_colors,
                shadow=True
            )
        
        # Step 8: Render final poster
        poster = self.renderer.render_poster(
            covers=covers,
            layout=layout,
            background=background,
            title=title,
            cover_border=True,
            border_color="#FFFFFF",
            border_width=3
        )
        
        logger.info("Poster generation complete!")
        return poster
    
    async def generate_from_prelaid(
        self,
        source_image: Union[str, Path, Image.Image],
        platform: Optional[str] = None,
        dimensions: Optional[Tuple[int, int]] = None,
        title_text: Optional[str] = None,
        background_style: str = "gradient",
    ) -> Image.Image:
        """
        Generate poster from pre-laid source (just change background).
        
        This is for Use Case 4 type - source already has covers laid out,
        we just need to change the background.
        
        Args:
            source_image: Pre-laid source image
            platform: Platform preset
            dimensions: Custom dimensions
            title_text: Title text
            background_style: Background style
            
        Returns:
            Generated poster
        """
        # For pre-laid images, we detect covers but preserve their relative positions
        # This is a simplified version - full implementation would need more work
        
        if isinstance(source_image, Image.Image):
            pil_image = source_image
        else:
            pil_image = Image.open(source_image)
        
        # Get target dimensions
        if dimensions:
            width, height = dimensions
        else:
            width, height = get_dimensions(preset=platform)
        
        # For now, resize the entire image and add title
        # Full implementation would detect covers and re-composite
        resized = pil_image.resize((width, int(height * 0.88)), Image.Resampling.LANCZOS)
        
        # Create canvas with background
        bg = BackgroundStyle(style="gradient", primary_color="#4A90D9", secondary_color="#87CEEB")
        canvas = self.renderer.create_background(width, height, bg)
        
        # Add title if specified
        title_height = int(height * 0.12) if title_text else 0
        if title_text:
            title = TitleStyle(
                text=title_text,
                font_size=int(title_height * 0.6),
                shadow=True
            )
            canvas = self.renderer.render_title(canvas, title, 0, title_height)
        
        # Paste source image (centered)
        x = (width - resized.width) // 2
        y = title_height
        canvas.paste(resized, (x, y))
        
        return canvas
    
    def export(
        self,
        poster: Image.Image,
        output_path: Optional[str] = None,
        format: str = "PNG"
    ) -> Union[bytes, str]:
        """
        Export poster to file or bytes.
        
        Args:
            poster: Generated poster
            output_path: Optional file path
            format: Image format
            
        Returns:
            File path or image bytes
        """
        return self.renderer.export(poster, output_path, format)
