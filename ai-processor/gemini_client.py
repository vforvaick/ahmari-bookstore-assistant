"""
GeminiClient - Multi-Model Rotation with API Key Fallback

Strategy: Rotate through models FIRST, then switch API key when all models exhausted.
Models: gemini-2.5-flash → gemini-2.5-flash-lite → gemini-2.0-flash
This maximizes quota usage across different model rate limits.

Only generates review paragraph + optional publisher guess.
Formatting is handled by OutputFormatter (rule-based).
"""

import json
import os
import threading
import logging
import traceback
import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from pathlib import Path
from typing import Optional, List
from pydantic import BaseModel
from models import ParsedBroadcast

# Configure logging with more detail
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Available models for rotation (in priority order)
# gemini-2.5-flash: Primary, best quality
# gemini-2.5-flash-lite: Faster, good for simple tasks
# gemini-2.0-flash: Stable fallback model
AVAILABLE_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
]



class AIReviewResponse(BaseModel):
    """Response from Gemini containing review and optional publisher guess."""
    publisher_guess: Optional[str] = None
    cleaned_title: Optional[str] = None
    review: str


class GeminiClient:
    """
    Gemini API client with multi-model rotation and API key fallback.
    
    Rotation Strategy:
    1. Try all models with current API key
    2. If all models exhausted (rate limited), switch to next API key
    3. Repeat until success or all combinations exhausted
    
    This maximizes quota usage by leveraging per-model rate limits.
    
    Environment Variables:
        GEMINI_API_KEYS: Comma-separated list of API keys (preferred)
        GEMINI_API_KEY: Single API key (fallback)
        GEMINI_MODELS: Comma-separated list of models (optional, uses default list)
    """
    
    # Class-level counters for round-robin (shared across instances)
    _model_counter = 0
    _key_counter = 0
    _counter_lock = threading.Lock()
    
    def __init__(self, api_keys: Optional[List[str]] = None, models: Optional[List[str]] = None):
        """
        Initialize client with one or more API keys and models.
        
        Args:
            api_keys: List of API keys. If None, reads from environment.
            models: List of models to rotate through. If None, uses AVAILABLE_MODELS.
        """
        if api_keys is None:
            # Try comma-separated keys first, then single key
            keys_str = os.getenv('GEMINI_API_KEYS', '')
            if keys_str:
                api_keys = [k.strip() for k in keys_str.split(',') if k.strip()]
            else:
                single_key = os.getenv('GEMINI_API_KEY', '')
                api_keys = [single_key] if single_key else []
        
        if not api_keys:
            raise ValueError("At least one GEMINI_API_KEY is required")
        
        self.api_keys = api_keys
        
        # Initialize model list - can be overridden via env or param
        if models is None:
            models_str = os.getenv('GEMINI_MODELS', '')
            if models_str:
                self.models = [m.strip() for m in models_str.split(',') if m.strip()]
            else:
                self.models = AVAILABLE_MODELS.copy()
        else:
            self.models = models
        
        # Track failed model+key combinations for this session
        self._failed_combos: set = set()
        
        logger.info(f"GeminiClient initialized with {len(self.api_keys)} API keys, {len(self.models)} models")
        logger.info(f"Models: {', '.join(self.models)}")
    
    def _get_next_rotation(self) -> tuple[int, int]:
        """
        Get next model and key indices using round-robin.
        Strategy: Rotate models first within same key, then switch key.
        
        Returns:
            Tuple of (model_index, key_index)
        """
        with self._counter_lock:
            model_idx = GeminiClient._model_counter % len(self.models)
            key_idx = GeminiClient._key_counter % len(self.api_keys)
            
            # Increment model counter
            GeminiClient._model_counter += 1
            
            # When we've cycled through all models, increment key counter
            if GeminiClient._model_counter % len(self.models) == 0:
                GeminiClient._key_counter += 1
        
        return model_idx, key_idx
    
    def _get_model_with_key(self, api_key: str, model_name: str) -> genai.GenerativeModel:
        """Get a GenerativeModel configured with a specific API key and model."""
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(model_name)
    
    def _extract_review_from_malformed(self, text: str) -> Optional[str]:
        """
        Try to extract review text from malformed/truncated JSON.
        
        Handles cases like: {"publisher_guess": null, "review": "Moms...
        """
        import re
        
        # Try to find review content after "review":
        match = re.search(r'"review"\s*:\s*"([^"]*)', text)
        if match:
            review = match.group(1)
            # Only use if we got meaningful content (>20 chars)
            if len(review) > 20:
                return review
        
        # Try to find any text in Indonesian that looks like a review
        # Look for common review patterns
        if 'Moms' in text or 'si Kecil' in text or 'buku' in text.lower():
            # Extract the text between quotes if possible
            quotes = re.findall(r'"([^"]{20,})"', text)
            if quotes:
                return max(quotes, key=len)  # Return longest match
        
        return None

    def _build_review_prompt(self, parsed: ParsedBroadcast, level: int = 1, user_edit: Optional[str] = None) -> str:
        """
        Build prompt for review based on recommendation level.
        
        Levels:
        - 1: Standard - light hard-sell, informative
        - 2: Recommended - medium hard-sell, more persuasive
        - 3: Top Pick - strong "racun", very persuasive
        """
        
        publisher_instruction = ""
        if not parsed.publisher:
            publisher_instruction = "Jika kamu tau publisher-nya berdasarkan judul, tulis di baris pertama: PUBLISHER: [nama]. Jika tidak tau, skip."
        
        user_edit_instruction = ""
        if user_edit:
            user_edit_instruction = f"\nINSTRUKSI KHUSUS: {user_edit}\n"

        description_text = parsed.description_en or "Tidak ada deskripsi"
        if len(description_text) > 500:
            description_text = description_text[:500] + "..."

        if level == 1:
            style = """GAYA Level 1 - Soft Informative (Friendly):
- Tone: Akrab & hangat (Moms persona), BUKAN kaku/formal seperti robot korporat.
- Sapaan: Wajib pakai "Moms" atau sapaan akrab.
- Struktur: Intro santai ("Moms, buku ini membahas...") → isi edukatif → closing ringan.
- Kata: "seru", "menarik", "cocok buat", "isinya bagus", "membantu anak"
- HINDARI: "wajib", "must have", "racun", bahasa baku/kaku
- Selling: Santai (edukasi dulu, jualan belakangan)
- Emoji: 1-2 simple emoji
- Target: Informative friend sharing knowledge"""

        elif level == 2:
            style = """GAYA Level 2 - Persuasive Recommendation:
- Tone: Antusias & recommendation-driven, kayak sharing favorit yang proven bagus
- Struktur: Hook interest → highlight unique value → strong call-to-action
- Kata: "recommended banget", "worth it", "bagus", "anak pasti suka", "ga nyesel"
- Selling: Moderate (show value + social proof vibes)
- Emoji: 2 emoji strategis
- Target: Create interest + desire"""

        else:  # level == 3
            style = """GAYA Level 3 - RACUN MODE (FOMO-driven):
- Tone: VERY enthusiastic, urgency, fear of missing out
- Struktur: Exciting hook → multiple value points → STRONG urgency close
- Kata WAJIB pakai: "wajib punya", "favorit Ahmari", "recommended bgtt", "limited", "jarang", "cepet habis"
- Urgency phrases: "Grab fast!", "Stock terbatas!", "PO bentar lagi close!"
- Emoji: 3-4 ekspresif emoji
- Selling: AGGRESSIVE (make them feel they'll regret NOT buying)
- Target: FOMO + instant buy decision"""

        prompt = f"""Tulis 1 paragraf LENGKAP review buku \"{parsed.title}\" dalam Bahasa Indonesia.
PANJANG TARGET: Minimal 3-5 kalimat LENGKAP (jangan terpotong di tengah).
{user_edit_instruction}
DESKRIPSI BUKU: {description_text}

{style}

{publisher_instruction}

IMPORTANT: Pastikan paragraf selesai sempurna dengan kalimat penutup yang kuat. JANGAN berhenti di tengah kalimat!
TULIS LANGSUNG REVIEW-NYA, jangan pakai format JSON, TITLE:, atau penjelasan lain."""
        
        return prompt

    async def generate_review(
        self,
        parsed: ParsedBroadcast,
        level: int = 1,
        user_edit: Optional[str] = None
    ) -> AIReviewResponse:
        """
        Generate Indonesian review paragraph from parsed data.
        
        Multi-model rotation strategy:
        1. Try all models with current API key
        2. If all models rate limited, switch to next API key
        3. Repeat until success or all combinations exhausted
        
        Args:
            parsed: ParsedBroadcast object with book information.
            level: Recommendation level (1=Standard, 2=Recommended, 3=Top Pick).
            user_edit: Optional user edit request to incorporate.
            
        Returns:
            AIReviewResponse with publisher_guess and review.
            
        Raises:
            Exception: If all model+key combinations fail.
        """
        logger.info(f"Starting review generation for: {parsed.title} (level={level})")
        
        prompt = self._build_review_prompt(parsed, level, user_edit)
        logger.debug(f"Built prompt, length: {len(prompt)} chars")
        
        generation_config = {
            "temperature": 0.8,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 4096,
        }
        
        last_error = None
        total_combinations = len(self.models) * len(self.api_keys)
        attempt = 0
        
        # Strategy: try all models per key, then switch key
        for key_idx in range(len(self.api_keys)):
            api_key = self.api_keys[key_idx]
            key_suffix = api_key[-6:] if len(api_key) > 6 else api_key
            
            for model_idx in range(len(self.models)):
                model_name = self.models[model_idx]
                attempt += 1
                combo_id = f"{model_name}:{key_suffix}"
                
                # Skip if this combo already failed this session
                if combo_id in self._failed_combos:
                    logger.debug(f"Skipping known failed combo: {combo_id}")
                    continue
                
                try:
                    logger.info(f"[{attempt}/{total_combinations}] Trying {model_name} with key ...{key_suffix}")
                    
                    model = self._get_model_with_key(api_key, model_name)
                    
                    response = model.generate_content(
                        prompt,
                        generation_config=generation_config
                    )
                    
                    # Check if response has text
                    if not response.text:
                        logger.warning(f"Empty response from {model_name}")
                        if response.prompt_feedback:
                            logger.warning(f"Prompt feedback: {response.prompt_feedback}")
                        continue
                    
                    result_text = response.text.strip()
                    logger.info(f"✓ Success with {model_name} (key ...{key_suffix}), response: {len(result_text)} chars")
                    
                    # Parse response
                    publisher_guess = None
                    cleaned_title = None
                    review = result_text
                    
                    import re
                    publisher_match = re.match(r'^PUBLISHER:\s*(.+?)\n', result_text)
                    if publisher_match:
                        publisher_guess = publisher_match.group(1).strip()
                        review = result_text[publisher_match.end():].strip()
                    
                    title_match = re.match(r'^TITLE:\s*(.+?)\n', review)
                    if title_match:
                        cleaned_title = title_match.group(1).strip()
                        review = review[title_match.end():].strip()
                    
                    if review.startswith('{') and '"review"' in review:
                        try:
                            result_json = json.loads(review)
                            review = result_json.get('review', review)
                            if not publisher_guess:
                                publisher_guess = result_json.get('publisher_guess')
                        except:
                            pass
                    
                    if review.startswith('"') and review.endswith('"'):
                        review = review[1:-1]
                    
                    logger.info(f"Parsed review: {len(review)} chars, publisher: {publisher_guess}")
                    
                    return AIReviewResponse(
                        publisher_guess=publisher_guess,
                        cleaned_title=cleaned_title,
                        review=review
                    )
                    
                except google_exceptions.ResourceExhausted as e:
                    logger.warning(f"⚠ {model_name} rate limited (429), marking combo and trying next...")
                    self._failed_combos.add(combo_id)
                    last_error = e
                    continue
                    
                except Exception as e:
                    error_str = str(e)
                    logger.error(f"✗ {model_name} error: {error_str}")
                    logger.debug(f"Full traceback:\n{traceback.format_exc()}")
                    
                    if "429" in error_str or "quota" in error_str.lower():
                        logger.warning(f"Quota error detected, marking combo...")
                        self._failed_combos.add(combo_id)
                        last_error = e
                        continue
                    elif "not found" in error_str.lower() or "does not exist" in error_str.lower():
                        # Model doesn't exist - mark as permanent failure
                        logger.warning(f"Model {model_name} not available, marking as failed")
                        self._failed_combos.add(combo_id)
                        last_error = e
                        continue
                    else:
                        last_error = e
                        continue
        
        # All combinations exhausted
        error_msg = f"All {total_combinations} model+key combinations exhausted. Last error: {last_error}"
        logger.error(error_msg)
        raise Exception(error_msg)


    # Keep legacy method for backward compatibility during transition
    async def generate_broadcast(
        self,
        parsed: ParsedBroadcast,
        user_edit: Optional[str] = None
    ) -> str:
        """
        Legacy method - generates full broadcast.
        Now internally uses generate_review + OutputFormatter.
        
        Deprecated: Use generate_review() instead and format with OutputFormatter.
        """
        from output_formatter import OutputFormatter
        
        # Get AI review
        ai_response = await self.generate_review(parsed, user_edit)
        
        # Update publisher if AI guessed it
        publisher = ai_response.publisher_guess if not parsed.publisher else parsed.publisher
        
        # Format with rule-based formatter
        formatter = OutputFormatter()
        return formatter.format_broadcast(
            parsed,
            ai_response.review,
            publisher_override=publisher
        )
