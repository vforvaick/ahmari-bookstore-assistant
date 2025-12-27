"""
CaptionAnalyzer - AI-powered image analysis for caption generation.

Analyzes images to detect:
1. Series posters (multiple book covers) → Series promo
2. Single book covers → Single book promo

Primary: CLIProxyAPI via Provider Router (gemini-3-pro-image-preview)
Fallback: Direct Gemini Vision API
"""

import json
import logging
import os
import io
import base64
from pathlib import Path
from typing import Optional, List
from dataclasses import dataclass
from PIL import Image

import google.generativeai as genai

# Import provider router for CLIProxyAPI → Gemini failover
from providers.router import get_router
from providers.base import TaskType

logger = logging.getLogger(__name__)


@dataclass
class CaptionAnalysis:
    """Result of analyzing an image for caption generation."""
    is_series: bool           # True if multiple books detected
    series_name: Optional[str]    # "Baby University" or None for single
    publisher: Optional[str]      # "Sourcebook Explore"
    book_titles: List[str]        # List of detected book titles
    description: str              # AI-generated description
    title: Optional[str]          # For single book: main title
    author: Optional[str]         # For single book: author if detected
    error: Optional[str] = None


class CaptionAnalyzer:
    """
    Analyzes poster/cover images using Gemini Vision.
    
    Detects whether input is a series poster or single cover,
    extracts relevant information, and generates description.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize analyzer with Gemini API key(s)."""
        self.api_keys: List[str] = []
        self.current_key_index = 0
        
        if api_key:
            self.api_keys = [api_key]
        else:
            # Try single key first
            single_key = os.getenv('GEMINI_API_KEY')
            if single_key:
                self.api_keys = [single_key]
            else:
                # Try comma-separated keys
                keys_str = os.getenv('GEMINI_API_KEYS', '')
                if keys_str:
                    self.api_keys = [k.strip() for k in keys_str.split(',') if k.strip()]
        
        if not self.api_keys:
            raise ValueError("GEMINI_API_KEY or GEMINI_API_KEYS is required")
        
        logger.info(f"CaptionAnalyzer initialized with {len(self.api_keys)} API key(s)")
        self._configure_current_key()
    
    def _configure_current_key(self):
        """Configure genai with current API key."""
        genai.configure(api_key=self.api_keys[self.current_key_index])
        model_name = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
        self.model = genai.GenerativeModel(model_name)
        logger.info(f"Configured with API key index {self.current_key_index}, model: {model_name}")
    
    def _rotate_key(self):
        """Rotate to next API key on rate limit."""
        old_index = self.current_key_index
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys)
        logger.info(f"Rotating API key: {old_index} -> {self.current_key_index}")
        self._configure_current_key()
    
    def _load_image(self, source: str | Path | Image.Image) -> Image.Image:
        """Load image from path or return if already PIL Image."""
        if isinstance(source, Image.Image):
            return source
        return Image.open(source)
    
    async def analyze(self, image_path: str | Path) -> CaptionAnalysis:
        """
        Analyze image to extract book information for caption generation.
        
        Args:
            image_path: Path to poster or cover image
            
        Returns:
            CaptionAnalysis with detected information
        """
        try:
            img = self._load_image(image_path)
            
            prompt = """Analyze this image of book(s) to extract information for a bookstore.

Determine if this is:
A) A POSTER with MULTIPLE book covers (series/collection)
B) A SINGLE book cover

For MULTIPLE books (poster/collage):
- Extract the series name (usually at top or prominent text)
- List ALL visible book titles (be thorough, don't miss any!)
- Identify the publisher if visible on covers
- Write a SHORT 1 sentence describing the series topic/theme (factual, not marketing)

For SINGLE book:
- Extract the book title
- Extract author if visible
- Identify publisher if visible
- Write a SHORT 1 sentence describing the book topic (factual, not marketing)

IMPORTANT for description:
- Keep it SHORT and FACTUAL (what is this book about?)
- Example good: "Interactive board books with lights and sounds for toddlers"
- Example bad: "This is a delightful series of interactive children's books designed to engage young readers..."

Respond in this exact JSON format:
{
    "is_series": true/false,
    "series_name": "Series Name" or null,
    "publisher": "Publisher Name" or null,
    "book_titles": ["Title 1", "Title 2"],
    "title": "Book Title" or null (for single book),
    "author": "Author Name" or null,
    "description": "Short factual description of the book(s)"
}

Be thorough with book titles - don't miss any visible in the image!
Respond ONLY with valid JSON, no other text."""

            # Convert image to bytes for Gemini
            buffer = io.BytesIO()
            img.save(buffer, format='PNG')
            image_data = buffer.getvalue()
            
            # ===== TRY CLIPROXY FIRST (Primary Provider) =====
            try:
                router = get_router()
                logger.info("Attempting CLIProxyAPI vision (primary)...")
                
                response = await router.analyze_image(
                    image_data=image_data,
                    prompt=prompt
                )
                
                if not response.error and response.text:
                    logger.info(f"✓ CLIProxyAPI vision success via {response.provider}/{response.model_used}")
                    response_text = response.text.strip()
                    
                    # Clean up markdown code blocks
                    if response_text.startswith('```'):
                        lines = response_text.split('\n')
                        response_text = '\n'.join(lines[1:-1])
                    
                    data = json.loads(response_text)
                    
                    logger.info(f"Analysis complete: is_series={data.get('is_series')}, "
                               f"titles={len(data.get('book_titles', []))}")
                    
                    return CaptionAnalysis(
                        is_series=data.get('is_series', False),
                        series_name=data.get('series_name'),
                        publisher=data.get('publisher'),
                        book_titles=data.get('book_titles', []),
                        description=data.get('description', ''),
                        title=data.get('title'),
                        author=data.get('author'),
                    )
                else:
                    logger.warning(f"CLIProxyAPI vision error: {response.error}, falling back...")
            except Exception as e:
                logger.warning(f"CLIProxyAPI vision failed: {e}, falling back to direct Gemini...")
            
            # ===== FALLBACK: Direct Gemini SDK =====
            logger.info("Using direct Gemini Vision fallback...")
            
            # Try with key rotation on rate limit
            max_retries = len(self.api_keys)
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    response = self.model.generate_content(
                        [
                            prompt,
                            {"mime_type": "image/png", "data": image_data}
                        ],
                        generation_config={
                            "temperature": 0.2,
                            "max_output_tokens": 4096,
                        }
                    )
                    
                    # Parse response
                    response_text = response.text.strip()
                    
                    # Clean up markdown code blocks
                    if response_text.startswith('```'):
                        lines = response_text.split('\n')
                        response_text = '\n'.join(lines[1:-1])
                    
                    data = json.loads(response_text)
                    
                    logger.info(f"Analysis complete: is_series={data.get('is_series')}, "
                               f"titles={len(data.get('book_titles', []))}")
                    
                    return CaptionAnalysis(
                        is_series=data.get('is_series', False),
                        series_name=data.get('series_name'),
                        publisher=data.get('publisher'),
                        book_titles=data.get('book_titles', []),
                        description=data.get('description', ''),
                        title=data.get('title'),
                        author=data.get('author'),
                    )
                    
                except Exception as e:
                    last_error = e
                    error_str = str(e)
                    
                    if '429' in error_str or 'quota' in error_str.lower():
                        logger.warning(f"Rate limit on key {self.current_key_index}, rotating...")
                        self._rotate_key()
                        continue
                    else:
                        raise
            
            # All retries failed
            if last_error:
                raise last_error
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response: {e}")
            return CaptionAnalysis(
                is_series=False,
                series_name=None,
                publisher=None,
                book_titles=[],
                description="",
                title=None,
                author=None,
                error=f"Failed to parse response: {e}"
            )
        except Exception as e:
            logger.error(f"Image analysis failed: {e}")
            return CaptionAnalysis(
                is_series=False,
                series_name=None,
                publisher=None,
                book_titles=[],
                description="",
                title=None,
                author=None,
                error=str(e)
            )
