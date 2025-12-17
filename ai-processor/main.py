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
from models import ParsedBroadcast, GenerateRequest, GenerateResponse

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Settings(BaseSettings):
    gemini_api_keys: Optional[str] = None  # Comma-separated API keys
    price_markup: int = 20000  # Default price markup

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()
app = FastAPI(title="AI Processor", version="2.0.0")

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
        "version": "2.0.0",
        "description": "Hybrid rule-based + AI broadcast generator",
        "endpoints": ["/parse", "/generate", "/config", "/health"],
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
