"""
BackgroundGenerator - AI-powered background generation.

Uses Gemini 2.0 Flash for generating creative backgrounds
that match the theme and colors of book covers.

Supports multiple background styles:
- AI Creative: Full AI-generated themed backgrounds
- Gradient: Code-generated gradients from extracted colors
- Stripes: Code-generated vertical stripes
- Solid: Single color background
"""

import io
import base64
import logging
from typing import List, Optional, Tuple, Union
from dataclasses import dataclass
from enum import Enum
from PIL import Image

import google.generativeai as genai

logger = logging.getLogger(__name__)


class BackgroundType(Enum):
    """Available background types."""
    AI_CREATIVE = "ai_creative"  # AI generates themed background
    GRADIENT = "gradient"        # Code-generated gradient
    STRIPES = "stripes"          # Code-generated stripes  
    SOLID = "solid"              # Single color
    USER_IMAGE = "user_image"    # User-provided image


@dataclass
class BackgroundRequest:
    """Request for background generation."""
    width: int
    height: int
    bg_type: BackgroundType
    dominant_colors: List[str] = None  # Hex colors from covers
    theme_description: str = None  # AI prompt for creative BG
    user_image: Image.Image = None  # For USER_IMAGE type


@dataclass
class BackgroundResult:
    """Result of background generation."""
    image: Image.Image
    bg_type: BackgroundType
    error: Optional[str] = None


class BackgroundGenerator:
    """
    Generates backgrounds for posters using AI or code-based methods.
    
    The hybrid approach:
    - AI Creative: Uses Gemini 2.0 Flash to generate themed backgrounds
    - Others: Pure code-based generation for reliability
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize background generator.
        
        Args:
            api_key: Gemini API key. If None, reads from environment.
        """
        import os
        self.api_key = api_key or os.getenv('GEMINI_API_KEY')
        if not self.api_key:
            keys_str = os.getenv('GEMINI_API_KEYS', '')
            if keys_str:
                self.api_key = keys_str.split(',')[0].strip()
        
        if self.api_key:
            genai.configure(api_key=self.api_key)
            # Use gemini-2.0-flash for image generation
            self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
        else:
            self.model = None
            logger.warning("No API key - AI background generation disabled")
    
    async def generate(self, request: BackgroundRequest) -> BackgroundResult:
        """
        Generate background based on request type.
        
        Args:
            request: BackgroundRequest with type and parameters
            
        Returns:
            BackgroundResult with generated image
        """
        try:
            if request.bg_type == BackgroundType.AI_CREATIVE:
                return await self._generate_ai_creative(request)
            elif request.bg_type == BackgroundType.GRADIENT:
                return self._generate_gradient(request)
            elif request.bg_type == BackgroundType.STRIPES:
                return self._generate_stripes(request)
            elif request.bg_type == BackgroundType.USER_IMAGE:
                return self._process_user_image(request)
            else:
                return self._generate_solid(request)
        except Exception as e:
            logger.error(f"Background generation failed: {e}")
            # Fallback to solid color
            return BackgroundResult(
                image=self._create_solid(request.width, request.height, "#4A90D9"),
                bg_type=BackgroundType.SOLID,
                error=str(e)
            )
    
    async def _generate_ai_creative(self, request: BackgroundRequest) -> BackgroundResult:
        """Generate creative background using Gemini AI."""
        if not self.model:
            logger.warning("AI unavailable, falling back to gradient")
            return self._generate_gradient(request)
        
        # Build prompt for background generation
        colors_hint = ""
        if request.dominant_colors:
            color_list = ", ".join(request.dominant_colors[:5])
            colors_hint = f"Use these dominant colors from the book covers: {color_list}. "
        
        theme = request.theme_description or "colorful, child-friendly, educational"
        
        prompt = f"""Generate a decorative background image for a children's book poster.

Dimensions: {request.width}x{request.height} pixels
Style: {theme}
{colors_hint}

Requirements:
- Create a visually appealing background with patterns or gradients
- Should complement book covers that will be placed on top
- Keep it not too busy - covers should stand out
- Use soft, inviting colors appropriate for children's books
- Can include subtle patterns like stripes, gradients, or abstract shapes

Generate ONLY the background image, no text or book covers."""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.9,
                    "max_output_tokens": 8192,
                }
            )
            
            # Check if response contains an image
            if hasattr(response, 'candidates') and response.candidates:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'inline_data') and part.inline_data:
                        # Decode the image
                        image_data = base64.b64decode(part.inline_data.data)
                        image = Image.open(io.BytesIO(image_data))
                        
                        # Resize to requested dimensions
                        image = image.resize(
                            (request.width, request.height),
                            Image.Resampling.LANCZOS
                        )
                        
                        logger.info("AI background generated successfully")
                        return BackgroundResult(
                            image=image,
                            bg_type=BackgroundType.AI_CREATIVE
                        )
            
            # No image in response, fall back
            logger.warning("AI didn't return image, falling back to gradient")
            return self._generate_gradient(request)
            
        except Exception as e:
            logger.error(f"AI background generation failed: {e}")
            return self._generate_gradient(request)
    
    def _generate_gradient(self, request: BackgroundRequest) -> BackgroundResult:
        """Generate gradient background from colors."""
        colors = request.dominant_colors or ["#4A90D9", "#87CEEB"]
        
        # Use first two colors for gradient
        c1 = self._parse_color(colors[0])
        c2 = self._parse_color(colors[1] if len(colors) > 1 else colors[0])
        
        image = Image.new('RGBA', (request.width, request.height))
        
        for y in range(request.height):
            ratio = y / request.height
            r = int(c1[0] + (c2[0] - c1[0]) * ratio)
            g = int(c1[1] + (c2[1] - c1[1]) * ratio)
            b = int(c1[2] + (c2[2] - c1[2]) * ratio)
            
            for x in range(request.width):
                image.putpixel((x, y), (r, g, b, 255))
        
        return BackgroundResult(image=image, bg_type=BackgroundType.GRADIENT)
    
    def _generate_stripes(self, request: BackgroundRequest) -> BackgroundResult:
        """Generate vertical stripes background."""
        colors = request.dominant_colors or [
            "#FF5733", "#3498DB", "#2ECC71", "#9B59B6", "#F39C12"
        ]
        
        from PIL import ImageDraw
        image = Image.new('RGBA', (request.width, request.height))
        draw = ImageDraw.Draw(image)
        
        stripe_width = request.width // len(colors)
        
        for i, color in enumerate(colors):
            x1 = i * stripe_width
            x2 = (i + 1) * stripe_width if i < len(colors) - 1 else request.width
            draw.rectangle([(x1, 0), (x2, request.height)], fill=color)
        
        return BackgroundResult(image=image, bg_type=BackgroundType.STRIPES)
    
    def _generate_solid(self, request: BackgroundRequest) -> BackgroundResult:
        """Generate solid color background."""
        color = request.dominant_colors[0] if request.dominant_colors else "#FFFFFF"
        image = self._create_solid(request.width, request.height, color)
        return BackgroundResult(image=image, bg_type=BackgroundType.SOLID)
    
    def _process_user_image(self, request: BackgroundRequest) -> BackgroundResult:
        """Process user-provided background image."""
        if not request.user_image:
            return self._generate_solid(request)
        
        # Resize to fit
        image = request.user_image.resize(
            (request.width, request.height),
            Image.Resampling.LANCZOS
        )
        
        return BackgroundResult(image=image, bg_type=BackgroundType.USER_IMAGE)
    
    def _create_solid(self, width: int, height: int, color: str) -> Image.Image:
        """Create solid color image."""
        return Image.new('RGBA', (width, height), color)
    
    def _parse_color(self, color: str) -> Tuple[int, int, int]:
        """Parse hex color to RGB tuple."""
        color = color.lstrip('#')
        if len(color) == 3:
            color = ''.join(c * 2 for c in color)
        return tuple(int(color[i:i+2], 16) for i in (0, 2, 4))


def get_background_options() -> List[dict]:
    """Get available background options for user selection."""
    return [
        {
            "id": "ai_creative",
            "name": "🎨 AI Creative",
            "description": "AI generates themed background matching your covers"
        },
        {
            "id": "gradient", 
            "name": "🌈 Gradient",
            "description": "Smooth gradient from cover colors"
        },
        {
            "id": "stripes",
            "name": "📊 Stripes",
            "description": "Vertical stripes with cover colors"
        },
        {
            "id": "solid",
            "name": "⬜ Solid",
            "description": "Single color background"
        },
        {
            "id": "user_image",
            "name": "🖼️ Custom Image",
            "description": "Use your own background image"
        }
    ]
