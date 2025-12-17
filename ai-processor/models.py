from pydantic import BaseModel, Field
from typing import Optional, List

class ParsedBroadcast(BaseModel):
    """Parsed FGB broadcast data"""
    type: Optional[str] = None  # Remainder or Request
    eta: Optional[str] = None
    close_date: Optional[str] = None
    title: Optional[str] = None
    title_en: Optional[str] = None
    publisher: Optional[str] = None  # Publisher name (extracted or AI-guessed)
    format: Optional[str] = None  # HB, PB, BB
    price_main: Optional[int] = None
    price_secondary: Optional[int] = None
    min_order: Optional[str] = None
    description_en: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    preview_links: List[str] = Field(default_factory=list)
    separator_emoji: Optional[str] = None
    media_count: int = 0
    raw_text: str = ""

class GenerateRequest(BaseModel):
    """Request to generate Indonesian broadcast"""
    parsed_data: ParsedBroadcast
    user_edit: Optional[str] = None

class GenerateResponse(BaseModel):
    """Generated broadcast in Indonesian"""
    draft: str
    parsed_data: ParsedBroadcast
