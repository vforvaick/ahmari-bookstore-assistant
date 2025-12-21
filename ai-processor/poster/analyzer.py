"""
CoverAnalyzer - AI-powered cover detection and analysis.

Uses Gemini Vision API to:
1. Detect individual book covers in source images
2. Return bounding boxes for precise cropping
3. Extract dominant colors for background matching
"""

import json
import logging
import base64
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any
from dataclasses import dataclass, field
from PIL import Image
import io

import google.generativeai as genai

logger = logging.getLogger(__name__)


@dataclass
class BoundingBox:
    """Bounding box for a detected cover."""
    x: int          # Left edge
    y: int          # Top edge
    width: int      # Width
    height: int     # Height
    confidence: float = 1.0
    
    @property
    def coords(self) -> Tuple[int, int, int, int]:
        """Return (left, top, right, bottom) for PIL crop."""
        return (self.x, self.y, self.x + self.width, self.y + self.height)
    
    @property
    def center(self) -> Tuple[int, int]:
        """Return center point."""
        return (self.x + self.width // 2, self.y + self.height // 2)


@dataclass
class DetectedCover:
    """A detected book cover with its bounding box and metadata."""
    bbox: BoundingBox
    source_image_index: int  # Which source image this came from
    order: int = 0           # Order in final layout (0-indexed)
    title: Optional[str] = None  # Detected title if any


@dataclass 
class AnalysisResult:
    """Result of analyzing source images."""
    covers: List[DetectedCover] = field(default_factory=list)
    dominant_colors: List[str] = field(default_factory=list)  # Hex colors
    suggested_background: Optional[str] = None  # AI suggestion
    series_title: Optional[str] = None  # Detected series name
    error: Optional[str] = None


class CoverAnalyzer:
    """
    Analyzes source images to detect book covers using Gemini Vision.
    
    This component does NOT modify images - it only analyzes them
    to provide bounding boxes for the renderer to crop precisely.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize analyzer with Gemini API key.
        
        Args:
            api_key: Gemini API key. If None, reads from environment.
        """
        import os
        self.api_key = api_key or os.getenv('GEMINI_API_KEY')
        if not self.api_key:
            # Try getting from comma-separated keys
            keys_str = os.getenv('GEMINI_API_KEYS', '')
            if keys_str:
                self.api_key = keys_str.split(',')[0].strip()
        
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is required")
        
        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash')
        
    def _image_to_base64(self, image: Image.Image) -> str:
        """Convert PIL Image to base64 string."""
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    def _load_image(self, source: str | Path | Image.Image) -> Image.Image:
        """Load image from path or return if already PIL Image."""
        if isinstance(source, Image.Image):
            return source
        return Image.open(source)
    
    async def detect_covers(
        self,
        images: List[str | Path | Image.Image],
    ) -> AnalysisResult:
        """
        Detect book covers in source images.
        
        Args:
            images: List of image paths or PIL Images
            
        Returns:
            AnalysisResult with detected covers and their bounding boxes
        """
        result = AnalysisResult()
        
        try:
            # Load all images
            pil_images = [self._load_image(img) for img in images]
            
            # Build prompt for Gemini Vision
            prompt = """Analyze these images containing book covers.

For EACH book cover you can see, provide:
1. Its bounding box (x, y, width, height in pixels from top-left)
2. Which image it's in (0-indexed)
3. The book title if readable

Also provide:
- List of dominant colors (as hex codes) from the book covers
- A brief suggestion for matching background style

IMPORTANT: Count carefully and don't miss any covers!

Respond in this exact JSON format:
{
    "covers": [
        {
            "image_index": 0,
            "x": 100,
            "y": 50,
            "width": 200,
            "height": 250,
            "title": "Book Title Here"
        }
    ],
    "dominant_colors": ["#FF5733", "#3498DB"],
    "background_suggestion": "Colorful gradient with science icons",
    "series_title": "Baby University" 
}

Only respond with valid JSON, no other text."""

            # Prepare image parts for Gemini
            image_parts = []
            for i, img in enumerate(pil_images):
                # Convert to bytes
                buffer = io.BytesIO()
                img.save(buffer, format='PNG')
                image_parts.append({
                    "mime_type": "image/png",
                    "data": buffer.getvalue()
                })
            
            # Call Gemini Vision
            response = self.model.generate_content(
                [prompt] + image_parts,
                generation_config={
                    "temperature": 0.1,  # Low for precise detection
                    "max_output_tokens": 4096,
                }
            )
            
            # Parse response
            response_text = response.text.strip()
            
            # Clean up response (remove markdown code blocks if present)
            if response_text.startswith('```'):
                lines = response_text.split('\n')
                response_text = '\n'.join(lines[1:-1])
            
            data = json.loads(response_text)
            
            # Convert to DetectedCover objects
            for i, cover_data in enumerate(data.get('covers', [])):
                bbox = BoundingBox(
                    x=cover_data['x'],
                    y=cover_data['y'],
                    width=cover_data['width'],
                    height=cover_data['height']
                )
                cover = DetectedCover(
                    bbox=bbox,
                    source_image_index=cover_data.get('image_index', 0),
                    order=i,
                    title=cover_data.get('title')
                )
                result.covers.append(cover)
            
            result.dominant_colors = data.get('dominant_colors', [])
            result.suggested_background = data.get('background_suggestion')
            result.series_title = data.get('series_title')
            
            logger.info(f"Detected {len(result.covers)} covers across {len(images)} images")
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response: {e}")
            result.error = f"Failed to parse cover detection response: {e}"
        except Exception as e:
            logger.error(f"Cover detection failed: {e}")
            result.error = str(e)
        
        return result
    
    async def analyze_colors(
        self,
        images: List[str | Path | Image.Image]
    ) -> List[str]:
        """
        Extract dominant colors from images (code-based, no AI).
        
        Args:
            images: List of images to analyze
            
        Returns:
            List of hex color codes
        """
        colors = []
        
        for source in images:
            img = self._load_image(source)
            # Resize for faster processing
            img_small = img.resize((100, 100))
            img_small = img_small.convert('RGB')
            
            # Get pixel colors
            pixels = list(img_small.getdata())
            
            # Simple: get corners and center colors
            width, height = img_small.size
            sample_points = [
                (0, 0),                    # Top-left
                (width-1, 0),              # Top-right
                (0, height-1),             # Bottom-left
                (width-1, height-1),       # Bottom-right
                (width//2, height//2),     # Center
            ]
            
            for x, y in sample_points:
                idx = y * width + x
                if idx < len(pixels):
                    r, g, b = pixels[idx][:3]
                    hex_color = f"#{r:02x}{g:02x}{b:02x}"
                    if hex_color not in colors:
                        colors.append(hex_color)
        
        return colors[:10]  # Return max 10 colors
