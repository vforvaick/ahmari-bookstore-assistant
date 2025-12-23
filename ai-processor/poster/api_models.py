"""
Poster API models for FastAPI endpoints.
"""

from pydantic import BaseModel
from typing import Optional, List


class PosterGenerateRequest(BaseModel):
    """Request for poster generation."""
    platform: Optional[str] = "ig_story"  # ig_story, ig_square, wa_status, etc.
    dimensions: Optional[str] = None  # Custom "WxH" format
    title: Optional[str] = None  # Title text for poster
    background_style: str = "gradient"  # ai_creative, gradient, stripes, solid
    layout: Optional[str] = None  # Custom layout like "3-3-3"
    cover_type: Optional[str] = None  # "single" or "multi" - skips AI detection if set


class PosterOptionsResponse(BaseModel):
    """Response with available poster options."""
    platforms: List[dict]
    backgrounds: List[dict]


class PosterGenerateResponse(BaseModel):
    """Response from poster generation."""
    status: str
    poster_path: Optional[str] = None
    poster_url: Optional[str] = None
    error: Optional[str] = None
    dimensions: Optional[str] = None
    cover_count: Optional[int] = None
