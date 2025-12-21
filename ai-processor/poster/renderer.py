"""
PosterRenderer - Pillow-based image manipulation for poster generation.

Handles:
1. Cropping covers from source images
2. Resizing covers uniformly
3. Creating canvas with background
4. Placing covers on canvas
5. Adding title text
6. Exporting final image
"""

import io
import logging
from pathlib import Path
from typing import List, Tuple, Optional, Union
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont, ImageFilter

from .layout import LayoutSpec, GridLayout
from .analyzer import BoundingBox

logger = logging.getLogger(__name__)


@dataclass
class BackgroundStyle:
    """Background style configuration."""
    style: str  # "solid", "gradient", "stripes", "image"
    primary_color: str = "#FFFFFF"
    secondary_color: Optional[str] = None
    colors: Optional[List[str]] = None  # For stripes
    image: Optional[Image.Image] = None


@dataclass
class TitleStyle:
    """Title text styling."""
    text: str
    font_size: int = 80
    font_path: Optional[str] = None
    color: str = "#000000"
    colors: Optional[List[str]] = None  # For multi-color letters
    shadow: bool = True
    shadow_color: str = "#00000066"


class PosterRenderer:
    """
    Renders posters using Pillow.
    
    This is the CODE component that handles all image manipulation.
    Covers are NEVER modified by AI - only cropped and resized precisely.
    """
    
    def __init__(self):
        """Initialize renderer."""
        self._default_font = None
    
    def _get_font(self, size: int, font_path: Optional[str] = None) -> ImageFont.FreeTypeFont:
        """Get font for text rendering."""
        if font_path:
            try:
                return ImageFont.truetype(font_path, size)
            except Exception as e:
                logger.warning(f"Failed to load font {font_path}: {e}")
        
        # Try common system fonts
        font_paths = [
            "/System/Library/Fonts/Helvetica.ttc",  # macOS
            "/System/Library/Fonts/SFNSDisplay.ttf",  # macOS SF
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
            "C:\\Windows\\Fonts\\arial.ttf",  # Windows
        ]
        
        for fp in font_paths:
            try:
                return ImageFont.truetype(fp, size)
            except:
                continue
        
        # Fallback to default
        return ImageFont.load_default()
    
    def crop_cover(
        self,
        source: Image.Image,
        bbox: BoundingBox
    ) -> Image.Image:
        """
        Crop a single cover from source image.
        
        Args:
            source: Source PIL Image
            bbox: Bounding box to crop
            
        Returns:
            Cropped cover image
        """
        # Validate bounds
        width, height = source.size
        x1, y1, x2, y2 = bbox.coords
        
        # Clamp to image bounds
        x1 = max(0, min(x1, width))
        y1 = max(0, min(y1, height))
        x2 = max(0, min(x2, width))
        y2 = max(0, min(y2, height))
        
        if x2 <= x1 or y2 <= y1:
            logger.warning(f"Invalid bbox after clamping: ({x1}, {y1}, {x2}, {y2})")
            # Return a small placeholder
            return Image.new('RGB', (100, 100), '#cccccc')
        
        return source.crop((x1, y1, x2, y2))
    
    def resize_cover(
        self,
        cover: Image.Image,
        target_width: int,
        target_height: int,
        maintain_aspect: bool = True
    ) -> Image.Image:
        """
        Resize cover to target dimensions.
        
        Args:
            cover: Cover image to resize
            target_width: Target width
            target_height: Target height
            maintain_aspect: If True, fit within bounds maintaining aspect
            
        Returns:
            Resized cover image
        """
        if maintain_aspect:
            cover.thumbnail((target_width, target_height), Image.Resampling.LANCZOS)
            # Center in target size
            result = Image.new('RGBA', (target_width, target_height), (0, 0, 0, 0))
            x = (target_width - cover.width) // 2
            y = (target_height - cover.height) // 2
            result.paste(cover, (x, y))
            return result
        else:
            return cover.resize((target_width, target_height), Image.Resampling.LANCZOS)
    
    def create_background(
        self,
        width: int,
        height: int,
        style: BackgroundStyle
    ) -> Image.Image:
        """
        Create background image.
        
        Args:
            width: Canvas width
            height: Canvas height
            style: Background style configuration
            
        Returns:
            Background image
        """
        if style.style == "image" and style.image:
            # Use provided image as background
            bg = style.image.resize((width, height), Image.Resampling.LANCZOS)
            return bg.convert('RGBA')
        
        elif style.style == "gradient":
            # Vertical gradient
            bg = Image.new('RGBA', (width, height))
            draw = ImageDraw.Draw(bg)
            
            # Parse colors
            c1 = self._parse_color(style.primary_color)
            c2 = self._parse_color(style.secondary_color or style.primary_color)
            
            for y in range(height):
                ratio = y / height
                r = int(c1[0] + (c2[0] - c1[0]) * ratio)
                g = int(c1[1] + (c2[1] - c1[1]) * ratio)
                b = int(c1[2] + (c2[2] - c1[2]) * ratio)
                draw.line([(0, y), (width, y)], fill=(r, g, b, 255))
            
            return bg
        
        elif style.style == "stripes" and style.colors:
            # Vertical stripes
            bg = Image.new('RGBA', (width, height))
            draw = ImageDraw.Draw(bg)
            
            stripe_width = width // len(style.colors)
            for i, color in enumerate(style.colors):
                x1 = i * stripe_width
                x2 = (i + 1) * stripe_width if i < len(style.colors) - 1 else width
                draw.rectangle([(x1, 0), (x2, height)], fill=color)
            
            return bg
        
        else:
            # Solid color
            return Image.new('RGBA', (width, height), style.primary_color)
    
    def _parse_color(self, color: str) -> Tuple[int, int, int]:
        """Parse hex color to RGB tuple."""
        color = color.lstrip('#')
        if len(color) == 3:
            color = ''.join(c * 2 for c in color)
        return tuple(int(color[i:i+2], 16) for i in (0, 2, 4))
    
    def render_title(
        self,
        canvas: Image.Image,
        style: TitleStyle,
        y_position: int,
        area_height: int
    ) -> Image.Image:
        """
        Render title text on canvas.
        
        Args:
            canvas: Canvas to draw on
            style: Title styling
            y_position: Y position for title center
            area_height: Height of title area
            
        Returns:
            Canvas with title
        """
        draw = ImageDraw.Draw(canvas)
        font = self._get_font(style.font_size, style.font_path)
        
        # Calculate text size
        bbox = draw.textbbox((0, 0), style.text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Center horizontally
        x = (canvas.width - text_width) // 2
        y = y_position + (area_height - text_height) // 2
        
        if style.colors and len(style.colors) > 1:
            # Multi-color text (letter by letter)
            current_x = x
            for i, char in enumerate(style.text):
                color = style.colors[i % len(style.colors)]
                
                if style.shadow:
                    # Draw shadow
                    draw.text((current_x + 3, y + 3), char, font=font, fill=style.shadow_color)
                
                draw.text((current_x, y), char, font=font, fill=color)
                
                # Advance X
                char_bbox = draw.textbbox((0, 0), char, font=font)
                current_x += char_bbox[2] - char_bbox[0]
        else:
            # Single color
            if style.shadow:
                draw.text((x + 3, y + 3), style.text, font=font, fill=style.shadow_color)
            draw.text((x, y), style.text, font=font, fill=style.color)
        
        return canvas
    
    def render_poster(
        self,
        covers: List[Image.Image],
        layout: GridLayout,
        background: BackgroundStyle,
        title: Optional[TitleStyle] = None,
        cover_border: bool = True,
        border_color: str = "#FFFFFF",
        border_width: int = 3
    ) -> Image.Image:
        """
        Render complete poster.
        
        Args:
            covers: List of cover images (already cropped)
            layout: Grid layout specification
            background: Background style
            title: Optional title styling
            cover_border: Whether to add border to covers
            border_color: Border color
            border_width: Border width in pixels
            
        Returns:
            Complete poster image
        """
        # Create canvas with background
        canvas = self.create_background(
            layout.canvas_width,
            layout.canvas_height,
            background
        )
        
        # Add title if specified
        if title and layout.title_height > 0:
            canvas = self.render_title(canvas, title, 0, layout.title_height)
        
        # Place covers
        for i, spec in enumerate(layout.cover_specs):
            if i >= len(covers):
                logger.warning(f"Not enough covers: expected {len(layout.cover_specs)}, got {len(covers)}")
                break
            
            cover = covers[i]
            
            # Resize cover to spec dimensions
            resized = self.resize_cover(cover, spec.width, spec.height, maintain_aspect=True)
            
            # Add border if requested
            if cover_border:
                bordered = Image.new('RGBA', 
                    (spec.width + border_width * 2, spec.height + border_width * 2),
                    border_color
                )
                bordered.paste(resized, (border_width, border_width))
                resized = bordered
                # Adjust position for border
                x = spec.x - border_width
                y = spec.y - border_width
            else:
                x = spec.x
                y = spec.y
            
            # Paste cover on canvas
            if resized.mode == 'RGBA':
                canvas.paste(resized, (x, y), resized)
            else:
                canvas.paste(resized, (x, y))
        
        return canvas
    
    def export(
        self,
        image: Image.Image,
        output_path: Optional[str] = None,
        format: str = "PNG",
        quality: int = 95
    ) -> Union[bytes, str]:
        """
        Export poster to file or bytes.
        
        Args:
            image: Poster image
            output_path: Optional file path. If None, returns bytes.
            format: Image format (PNG, JPEG, WEBP)
            quality: JPEG/WEBP quality (1-100)
            
        Returns:
            File path if output_path given, else bytes
        """
        if output_path:
            # Convert RGBA to RGB for JPEG
            if format.upper() == 'JPEG' and image.mode == 'RGBA':
                rgb_image = Image.new('RGB', image.size, (255, 255, 255))
                rgb_image.paste(image, mask=image.split()[3])
                image = rgb_image
            
            image.save(output_path, format=format, quality=quality)
            logger.info(f"Exported poster to {output_path}")
            return output_path
        else:
            buffer = io.BytesIO()
            image.save(buffer, format=format, quality=quality)
            return buffer.getvalue()
