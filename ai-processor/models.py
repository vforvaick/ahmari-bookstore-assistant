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
    level: int = 1  # Recommendation level: 1=Standard, 2=Recommended, 3=Top Pick

class GenerateResponse(BaseModel):
    """Generated broadcast in Indonesian"""
    draft: str
    parsed_data: ParsedBroadcast


# ============== Book Research Models ==============

class BookSearchRequest(BaseModel):
    """Request to search for books"""
    query: str
    max_results: int = 5


class BookSearchResult(BaseModel):
    """A single book search result from the web"""
    title: str
    author: Optional[str] = None
    publisher: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    source_url: str
    snippet: Optional[str] = None


class BookSearchResponse(BaseModel):
    """Response containing book search results"""
    query: str
    results: List[BookSearchResult]
    count: int


class ResearchGenerateRequest(BaseModel):
    """Request to generate promo from researched book"""
    book: BookSearchResult              # Selected book from search
    price_main: int                     # User-confirmed price (without markup)
    format: str = "HB"                  # HB/PB/BB
    eta: Optional[str] = None           # e.g., "Jan '26"
    close_date: Optional[str] = None    # e.g., "25 Des"
    min_order: Optional[str] = None     # e.g., "3 pcs"
    level: int = 2                      # Recommendation level
    custom_image_path: Optional[str] = None  # If user sends own image
    user_edit: Optional[str] = None     # User feedback for regeneration
    userEdit: Optional[str] = None      # Alias for camelCase from TypeScript


# ============== Caption Generator Models ==============

class CaptionAnalysisResult(BaseModel):
    """Result of analyzing an image for caption generation"""
    is_series: bool = False             # True if multiple books detected
    series_name: Optional[str] = None   # "Baby University" for series
    publisher: Optional[str] = None     # "Sourcebook Explore"
    book_titles: List[str] = Field(default_factory=list)  # All detected titles
    description: str = ""               # AI-generated description
    title: Optional[str] = None         # For single book: main title
    author: Optional[str] = None        # For single book: author if detected
    error: Optional[str] = None


class CaptionGenerateRequest(BaseModel):
    """Request to generate caption/promo text from analyzed image"""
    analysis: CaptionAnalysisResult     # From /caption/analyze
    price: int                          # Price in Rupiah (without markup)
    format: str = "HB"                  # HB/PB/BB
    eta: Optional[str] = None           # e.g., "April'26"
    close_date: Optional[str] = None    # e.g., "20 Desember'25"
    level: int = 2                      # Recommendation level 1/2/3
    preview_links: List[dict] = Field(default_factory=list)  # Optional links per book


class CaptionGenerateResponse(BaseModel):
    """Generated caption/promo text"""
    draft: str
    analysis: CaptionAnalysisResult

