from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from pydantic_settings import BaseSettings
from typing import Optional, List
import logging
import os

from parser import FGBParser
from gemini_client import GeminiClient
from output_formatter import OutputFormatter
from book_researcher import BookResearcher
from models import (
    ParsedBroadcast, GenerateRequest, GenerateResponse,
    BookSearchRequest, BookSearchResult, BookSearchResponse, ResearchGenerateRequest,
    CaptionAnalysisResult, CaptionGenerateRequest, CaptionGenerateResponse
)

# Poster module imports
from poster import PosterGenerator, get_dimensions, get_background_options
from poster.presets import get_preset_options
from poster.api_models import PosterGenerateRequest, PosterOptionsResponse, PosterGenerateResponse

# Caption analyzer import
from caption_analyzer import CaptionAnalyzer

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    gemini_api_keys: Optional[str] = None  # Comma-separated API keys
    price_markup: int = 20000  # Default price markup

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()
app = FastAPI(title="AI Processor", version="2.2.0")

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
poster_generator = PosterGenerator()  # For /poster endpoints
caption_analyzer = CaptionAnalyzer()  # For /caption endpoints

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
        # Accept both camelCase (from TypeScript) and snake_case
        user_feedback = request.user_edit or request.userEdit
        ai_response = await gemini_client.generate_review(
            parsed_for_ai,
            level=request.level,
            user_edit=user_feedback
        )
        
        logger.info(f"AI review generated, length: {len(ai_response.review)}")
        
        # Step 3: Determine publisher (provided > AI guess)
        publisher = request.book.publisher or ai_response.publisher_guess
        
        # Update title if clean version provided by AI
        if ai_response.cleaned_title:
            logger.info(f"Using cleaned title from AI: '{ai_response.cleaned_title}'")
            parsed_for_ai.title = ai_response.cleaned_title
        
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


@app.post("/research/search-links")
async def search_preview_links(book_title: str, max_links: int = 2):
    """
    Search for valid preview links for a given book.
    
    Uses Google Custom Search to find links, then validates each with HTTP HEAD.
    Only returns links that respond with status 200.
    
    Args:
        book_title: Book title to search preview links for
        max_links: Maximum number of valid links to return (default: 2)
    
    Returns:
        List of valid URLs
    """
    try:
        logger.info(f"Searching preview links for: '{book_title}'")
        
        links = await book_researcher.search_preview_links(
            book_title=book_title,
            max_links=max_links
        )
        
        return {
            "status": "success",
            "book_title": book_title,
            "links": links,
            "count": len(links)
        }
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Link search error: {e}")
        raise HTTPException(status_code=500, detail=f"Link search failed: {e}")


@app.post("/research/search-images")
async def search_book_images(book_title: str, max_images: int = 5):
    """
    Search for book cover images using Google Image Search.
    
    Returns multiple image URLs for user to choose from.
    
    Args:
        book_title: Book title to search images for
        max_images: Maximum number of images to return (default: 5)
    
    Returns:
        List of image URLs with metadata
    """
    import traceback
    
    try:
        logger.info(f"Searching images for: '{book_title}'")
        
        images = await book_researcher.search_images(
            query=book_title,
            max_images=max_images
        )
        
        return {
            "status": "success",
            "book_title": book_title,
            "images": images,
            "count": len(images)
        }
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Image search error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(status_code=500, detail=f"Image search failed: {e}")


@app.post("/research/enrich")
async def enrich_book_description(book_title: str, current_description: str = "", max_sources: int = 3):
    """
    Enrich book description by aggregating from multiple search sources.
    
    Searches for more information about the book and combines snippets
    to create a richer context for AI review generation.
    
    Args:
        book_title: Book title to search for
        current_description: Existing description (will be included)
        max_sources: Maximum number of sources to aggregate (default: 3)
    
    Returns:
        Enriched description combining multiple sources
    """
    import traceback
    
    try:
        logger.info(f"Enriching description for: '{book_title}'")
        
        enriched = await book_researcher.enrich_description(
            book_title=book_title,
            current_description=current_description,
            max_sources=max_sources
        )
        
        return {
            "status": "success",
            "book_title": book_title,
            "enriched_description": enriched["description"],
            "sources_used": enriched["sources_count"]
        }
        
    except ValueError as e:
        logger.error(f"Configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Enrichment error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(status_code=500, detail=f"Description enrichment failed: {e}")


@app.post("/research/display-title")
async def get_display_title(title: str, source_url: str, publisher: str = None):
    """
    Get clean display title with publisher: 'Book Title | Publisher: X'
    
    Args:
        title: Raw book title
        source_url: Source URL for publisher extraction
        publisher: Optional publisher override
    
    Returns:
        Formatted display title
    """
    from book_researcher import BookSearchResult
    
    result = BookSearchResult(
        title=title,
        source_url=source_url,
        publisher=publisher
    )
    
    display_title = book_researcher.get_display_title(result)
    
    return {
        "status": "success",
        "display_title": display_title
    }


# ==================== CAPTION GENERATOR ENDPOINTS ====================

@app.post("/caption/analyze", response_model=CaptionAnalysisResult)
async def analyze_image_for_caption(file: UploadFile = File(...)):
    """
    Analyze poster or cover image to extract book information.
    
    Detects whether input is:
    - A series poster (multiple books) → returns is_series=True, series_name, book_titles
    - A single book cover → returns is_series=False, title, author
    
    Args:
        file: Image file (JPEG, PNG, etc.)
        
    Returns:
        CaptionAnalysisResult with detected book information
    """
    import traceback
    from pathlib import Path
    import uuid
    
    try:
        logger.info(f"Analyzing image for caption: {file.filename}")
        
        # Save uploaded file temporarily
        temp_dir = Path("/tmp/caption_uploads")
        temp_dir.mkdir(exist_ok=True)
        
        temp_path = temp_dir / f"{uuid.uuid4().hex}_{file.filename}"
        
        content = await file.read()
        with open(temp_path, "wb") as f:
            f.write(content)
        
        # Analyze with CaptionAnalyzer
        result = await caption_analyzer.analyze(temp_path)
        
        # Clean up temp file
        try:
            temp_path.unlink()
        except:
            pass
        
        if result.error:
            raise HTTPException(status_code=500, detail=result.error)
        
        logger.info(f"Caption analysis complete: is_series={result.is_series}, titles={len(result.book_titles)}")
        
        return CaptionAnalysisResult(
            is_series=result.is_series,
            series_name=result.series_name,
            publisher=result.publisher,
            book_titles=result.book_titles,
            description=result.description,
            title=result.title,
            author=result.author,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Caption analysis error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(
            status_code=500,
            detail=f"Image analysis failed: {e}"
        )


@app.post("/caption/generate", response_model=CaptionGenerateResponse)
async def generate_caption(request: CaptionGenerateRequest):
    """
    Generate promotional text from analyzed image data.
    
    Takes CaptionAnalysisResult (from /caption/analyze) plus user-provided
    details (price, format, ETA) and generates promotional text.
    
    For series: Generates series-style promo with all book titles
    For single: Generates single-book promo
    """
    import traceback
    
    try:
        analysis = request.analysis
        is_series = analysis.is_series
        
        logger.info(f"Generating caption: series={is_series}, level={request.level}")
        
        # Determine title for AI
        if is_series:
            title = analysis.series_name or "Book Series"
            description = analysis.description
        else:
            title = analysis.title or analysis.book_titles[0] if analysis.book_titles else "Book"
            description = analysis.description
        
        # Create ParsedBroadcast-like structure for AI
        parsed_for_ai = ParsedBroadcast(
            title=title,
            publisher=analysis.publisher,
            description_en=description,
            format=request.format,
            price_main=request.price,
            eta=request.eta,
            close_date=request.close_date,
            raw_text=f"Caption from image: {title}"
        )
        
        # Generate AI review
        ai_response = await gemini_client.generate_review(
            parsed_for_ai,
            level=request.level
        )
        
        # Format final caption
        draft = formatter.format_broadcast(
            parsed_for_ai,
            ai_response.review,
            publisher_override=analysis.publisher or ai_response.publisher_guess,
            level=request.level
        )
        
        # For series, prepend "Random PO" and add book list at end
        if is_series and analysis.book_titles:
            # Insert series info after first line
            lines = draft.split('\n')
            
            # Build books list
            books_section = "\n*Judul tersedia:*"
            for book_title in analysis.book_titles[:15]:  # Max 15 titles
                books_section += f"\n- {book_title}"
            
            # Add to end before preview links (if any)
            draft = draft + "\n" + books_section
        
        logger.info(f"Caption generated successfully, length: {len(draft)}")
        
        return CaptionGenerateResponse(
            draft=draft,
            analysis=analysis
        )
        
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Caption generation error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(
            status_code=500,
            detail=f"Caption generation failed: {e}"
        )


# ==================== POSTER GENERATOR ENDPOINTS ====================

@app.get("/poster/options", response_model=PosterOptionsResponse)
async def get_poster_options():
    """
    Get available options for poster generation.
    
    Returns available platform presets and background styles.
    """
    return PosterOptionsResponse(
        platforms=get_preset_options(),
        backgrounds=get_background_options()
    )


@app.post("/poster/generate")
async def generate_poster(
    images: List[UploadFile] = File(...),
    platform: str = "ig_story",
    title: str = None,
    background_style: str = "gradient",
    custom_layout: str = None,
    cover_type: str = None  # "single" or "multi" - skips AI detection if set
):
    """
    Generate poster from uploaded cover images.
    
    Args:
        images: List of source images containing book covers
        platform: Platform preset (ig_story, ig_square, wa_status, etc.)
        title: Optional title text for the poster
        background_style: ai_creative, gradient, stripes, solid
        custom_layout: Optional layout like "3-3-3" for 9 covers in 3 rows
        cover_type: "single" (each image = 1 cover) or None (AI detects)
        
    Returns:
        Generated poster as image file
    """
    import traceback
    from pathlib import Path
    from PIL import Image
    import io
    import uuid
    
    try:
        logger.info(f"Generating poster with {len(images)} images, platform={platform}, bg={background_style}, cover_type={cover_type}")
        
        # Load uploaded images
        pil_images = []
        for upload in images:
            content = await upload.read()
            img = Image.open(io.BytesIO(content))
            pil_images.append(img)
        
        # Parse dimensions
        width, height = get_dimensions(preset=platform)
        
        # Parse custom layout
        layout = None
        if custom_layout:
            try:
                layout = [int(x) for x in custom_layout.split("-")]
            except:
                pass
        
        # Generate poster
        poster = await poster_generator.generate(
            source_images=pil_images,
            platform=platform,
            dimensions=(width, height),
            title_text=title,
            background_style=background_style,
            custom_layout=layout,
            cover_type=cover_type  # Pass to skip AI detection
        )
        
        # Save to temp file
        output_dir = Path("/tmp/posters")
        output_dir.mkdir(exist_ok=True)
        
        filename = f"poster_{uuid.uuid4().hex[:8]}.png"
        output_path = output_dir / filename
        
        poster.save(output_path, format="PNG")
        
        logger.info(f"Poster generated: {output_path}")
        
        return FileResponse(
            path=str(output_path),
            media_type="image/png",
            filename=filename
        )
        
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Poster generation error: {e}")
        logger.error(f"Traceback:\n{tb}")
        raise HTTPException(
            status_code=500,
            detail=f"Poster generation failed: {e}"
        )
