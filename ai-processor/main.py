from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from pydantic_settings import BaseSettings
from typing import Optional
import logging
import os

from parser import FGBParser
from gemini_client import GeminiClient
from output_formatter import OutputFormatter
from book_researcher import BookResearcher
from models import (
    ParsedBroadcast, GenerateRequest, GenerateResponse,
    BookSearchRequest, BookSearchResult, BookSearchResponse, ResearchGenerateRequest
)

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    gemini_api_keys: Optional[str] = None  # Comma-separated API keys
    price_markup: int = 20000  # Default price markup

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()
app = FastAPI(title="AI Processor", version="2.1.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
parser = FGBParser()
gemini_client = GeminiClient()  # Reads API keys from environment
formatter = OutputFormatter(price_markup=settings.price_markup)
book_researcher = BookResearcher()  # For /research endpoint

class ParseRequest(BaseModel):
    text: str
    media_count: int = 0

class ConfigUpdateRequest(BaseModel):
    price_markup: Optional[int] = None

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-processor"}

@app.get("/")
async def root():
    return {
        "service": "AI Processor",
        "version": "2.1.0",
        "description": "Hybrid rule-based + AI broadcast generator with web research",
        "endpoints": ["/parse", "/generate", "/research", "/research/generate", "/config", "/health"],
        "config": {
            "price_markup": formatter.price_markup
        }
    }

@app.get("/config")
async def get_config():
    """Get current configuration."""
    return {
        "price_markup": formatter.price_markup,
        "model": gemini_client.model_name,
        "api_keys_count": len(gemini_client.api_keys)
    }

@app.post("/config")
async def update_config(request: ConfigUpdateRequest):
    """Update configuration (e.g., price markup)."""
    global formatter
    
    if request.price_markup is not None:
        formatter = OutputFormatter(price_markup=request.price_markup)
        logger.info(f"Price markup updated to: {request.price_markup}")
    
    return {
        "status": "updated",
        "price_markup": formatter.price_markup
    }

@app.post("/parse", response_model=ParsedBroadcast)
async def parse_broadcast(request: ParseRequest):
    """Parse FGB broadcast text into structured data"""
    try:
        logger.info(f"Parsing broadcast, text length: {len(request.text)}")
        result = parser.parse(request.text, request.media_count)
        logger.info(f"Parsed successfully: {result.title}")
        return result
    except Exception as e:
        logger.error(f"Parse error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Parsing failed: {str(e)}")

@app.post("/generate", response_model=GenerateResponse)
async def generate_broadcast(request: GenerateRequest):
    """
    Generate Indonesian broadcast from parsed data using hybrid approach.
    
    Workflow:
    1. AI generates review paragraph + publisher guess
    2. Rule-based formatter builds final output with:
       - Price markup (configurable)
       - Template structure
       - Link cleanup
    """
    import traceback
    
    try:
        logger.info(f"Generating broadcast for: {request.parsed_data.title} (level={request.level})")
        logger.debug(f"Parsed data: {request.parsed_data.model_dump()}")

        # Step 1: Get AI-generated review with level-specific tone
        ai_response = await gemini_client.generate_review(
            request.parsed_data,
            level=request.level,
            user_edit=request.user_edit
        )
        
        logger.info(f"AI review generated, length: {len(ai_response.review)}")
        if ai_response.publisher_guess:
            logger.info(f"AI guessed publisher: {ai_response.publisher_guess}")

        # Step 2: Determine publisher (parsed > AI guess)
        publisher = request.parsed_data.publisher or ai_response.publisher_guess
        
        # Step 3: Format final broadcast using rule-based formatter
        draft = formatter.format_broadcast(
            request.parsed_data,
            ai_response.review,
            publisher_override=publisher,
            level=request.level
        )

        logger.info(f"Generated successfully, length: {len(draft)}")

        return GenerateResponse(
            draft=draft,
            parsed_data=request.parsed_data
        )
    except Exception as e:
        error_msg = str(e)
        tb = traceback.format_exc()
        logger.error(f"Generation error: {error_msg}")
        logger.error(f"Traceback:\n{tb}")
        
        # Return a more detailed error message
        raise HTTPException(
            status_code=500, 
            detail=f"Generation failed: {error_msg}"
        )

@app.post("/extract-style")
async def extract_style():
    """Extract style profile from chat export (placeholder for now)"""
    return {
        "status": "not_implemented",
        "message": "Style extraction will be implemented in future task"
    }


# ==================== BOOK RESEARCH ENDPOINTS ====================

@app.post("/research", response_model=BookSearchResponse)
async def search_books(request: BookSearchRequest):
    """
    Search for books using Google Custom Search.
    
    Use this when no FGB raw material is available and you need to
    create promotional material from scratch.
    
    Requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX environment variables.
    """
    import traceback
    
    try:
        logger.info(f"Searching for books: '{request.query}'")
        
        results = await book_researcher.search_books(
            query=request.query,
            max_results=request.max_results
        )
        
        logger.info(f"Found {len(results)} books")
        
        # Convert to response model
        return BookSearchResponse(
            query=request.query,
            results=[BookSearchResult(**r.model_dump()) for r in results],
            count=len(results)
        )
        
    except ValueError as e:
        # Configuration error (missing API keys)
        logger.error(f"Configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Search error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(status_code=500, detail=f"Book search failed: {e}")


@app.post("/research/generate", response_model=GenerateResponse)
async def generate_from_research(request: ResearchGenerateRequest):
    """
    Generate promotional broadcast from web-researched book info.
    
    This endpoint takes a BookSearchResult (from /research) plus
    user-provided details (price, format, ETA) and generates a
    promotional message using the same format as FGB conversions.
    
    Workflow:
    1. AI generates review paragraph based on book description
    2. Rule-based formatter builds final output with price markup
    """
    import traceback
    
    try:
        logger.info(f"Generating promo for researched book: '{request.book.title}' (level={request.level})")
        
        # Step 1: Create a ParsedBroadcast-like structure from research data
        # This allows us to reuse the existing AI review generator
        parsed_for_ai = ParsedBroadcast(
            title=request.book.title,
            publisher=request.book.publisher,
            description_en=request.book.description or request.book.snippet,
            format=request.format,
            price_main=request.price_main,
            eta=request.eta,
            close_date=request.close_date,
            min_order=request.min_order,
            preview_links=[request.book.source_url] if request.book.source_url else [],
            raw_text=f"Web research: {request.book.title}"
        )
        
        # Step 2: Generate AI review (reuse existing method)
        ai_response = await gemini_client.generate_review(
            parsed_for_ai,
            level=request.level
        )
        
        logger.info(f"AI review generated, length: {len(ai_response.review)}")
        
        # Step 3: Determine publisher (provided > AI guess)
        publisher = request.book.publisher or ai_response.publisher_guess
        
        # Step 4: Format final broadcast
        draft = formatter.format_broadcast(
            parsed_for_ai,
            ai_response.review,
            publisher_override=publisher,
            level=request.level
        )
        
        logger.info(f"Generated successfully, length: {len(draft)}")
        
        return GenerateResponse(
            draft=draft,
            parsed_data=parsed_for_ai
        )
        
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Research generation error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(
            status_code=500,
            detail=f"Generation from research failed: {e}"
        )


@app.post("/research/download-image")
async def download_research_image(image_url: str):
    """
    Download book cover image from URL.
    
    Returns the local file path where the image was saved.
    """
    try:
        logger.info(f"Downloading image: {image_url[:80]}...")
        
        filepath = await book_researcher.download_image(image_url)
        
        if filepath:
            return {"status": "success", "filepath": filepath}
        else:
            raise HTTPException(status_code=400, detail="Failed to download image")
            
    except Exception as e:
        logger.error(f"Image download error: {e}")
        raise HTTPException(status_code=500, detail=f"Image download failed: {e}")
