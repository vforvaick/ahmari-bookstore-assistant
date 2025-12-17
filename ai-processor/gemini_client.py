"""
GeminiClient - Simplified Review-Only Implementation

Uses gemini-2.5-flash model with round-robin API key rotation.
Now only generates review paragraph + optional publisher guess.
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


class AIReviewResponse(BaseModel):
    """Response from Gemini containing review and optional publisher guess."""
    publisher_guess: Optional[str] = None
    review: str


class GeminiClient:
    """
    Gemini API client with built-in round-robin key rotation and fallback.
    
    Now simplified to ONLY generate:
    1. Publisher guess (if not parsed from raw text)
    2. Review paragraph in Indonesian "racun belanja" style
    
    All formatting is handled by OutputFormatter (rule-based).
    
    Environment Variables:
        GEMINI_API_KEYS: Comma-separated list of API keys (preferred)
        GEMINI_API_KEY: Single API key (fallback)
        GEMINI_MODEL: Model to use (default: gemini-2.5-flash)
    """
    
    # Class-level counter for round-robin (shared across instances)
    _request_counter = 0
    _counter_lock = threading.Lock()
    
    def __init__(self, api_keys: Optional[List[str]] = None):
        """
        Initialize client with one or more API keys.
        
        Args:
            api_keys: List of API keys. If None, reads from environment.
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
        # Default to gemini-2.5-flash which is confirmed working
        self.model_name = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
        
        logger.info(f"GeminiClient initialized with {len(self.api_keys)} API keys, model: {self.model_name}")
    
    def _get_next_key_index(self) -> int:
        """Get the next API key index using thread-safe round-robin."""
        with self._counter_lock:
            index = self._request_counter % len(self.api_keys)
            GeminiClient._request_counter += 1
        return index
    
    def _get_model_with_key(self, api_key: str) -> genai.GenerativeModel:
        """Get a GenerativeModel configured with a specific API key."""
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(self.model_name)
    
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

    def _build_review_prompt(self, parsed: ParsedBroadcast, user_edit: Optional[str] = None) -> str:
        """
        Build focused prompt for review paragraph generation only.
        
        The prompt asks AI to produce:
        1. Publisher guess (if not already known)
        2. Review paragraph in Indonesian "racun belanja" style
        """
        
        publisher_instruction = ""
        if not parsed.publisher:
            publisher_instruction = """
- Tebak publisher berdasarkan judul buku (misal: "That's not my..." = Usborne, "Britannica" = Britannica Books)
- Isi publisher_guess dengan nama publisher hasil tebakanmu
- Jika tidak yakin, isi null"""
        else:
            publisher_instruction = f"- Publisher sudah diketahui: {parsed.publisher}. Isi publisher_guess dengan null."
        
        user_edit_instruction = ""
        if user_edit:
            user_edit_instruction = f"""
INSTRUKSI KHUSUS DARI USER:
"{user_edit}"
PENTING: Kamu WAJIB mengikuti instruksi ini dalam menulis review."""

        prompt = f"""ROLE: Kamu adalah copywriter untuk "Ahmari Bookstore", toko buku anak impor.

TUGAS: Tulis 1 paragraf review persuasif untuk buku ini.

INFORMASI BUKU:
- Judul: {parsed.title or 'Tidak diketahui'}
- Publisher: {parsed.publisher or 'Tidak diketahui'}
- Format: {parsed.format or 'Tidak disebutkan'}
- Deskripsi (English): {parsed.description_en or 'Tidak ada deskripsi'}

{user_edit_instruction}

INSTRUKSI PUBLISHER:
{publisher_instruction}

GAYA PENULISAN:
- Bahasa Indonesia santai, target: moms gen Z
- Tone "racun belanja" - persuasif tapi natural, kayak ngobrol sama temen
- Gunakan kata-kata seperti: "murmer", "lucuu", "bagus bgtt", "wajib punya"
- Emoji secukupnya (jangan berlebihan)
- Maksimal 1 paragraf (3-5 kalimat)
- JANGAN translate literal dari English, tulis ulang dengan gaya sendiri
- JANGAN mulai dengan sapaan "Halo moms", "Gaisss", dll
- Langsung fokus ke isi buku dan kenapa bagus untuk anak

CONTOH REVIEW YANG BAGUS:
"Buku detektif yang seru banget! 🕵️‍♀️ Ceritanya tentang misteri hilangnya resep kue di hotel mewah. Cocok banget buat melatih logika si Kecil sambil menikmati ilustrasi yang memukau. Wajib dikoleksi!"

"Serinya poppy and sam ini selalu jadi favorit para parents. Karena bukunya macem-macem banget dan bagus-bagus. Kali ini soundbook tentang hewan-hewan yang ada di peternakan. Murmer inii😍"

FORMAT OUTPUT (WAJIB JSON):
{{
  "publisher_guess": "Nama Publisher" atau null,
  "review": "Paragraf review dalam Bahasa Indonesia..."
}}

HANYA OUTPUT JSON, tanpa penjelasan tambahan."""
        
        return prompt

    async def generate_review(
        self,
        parsed: ParsedBroadcast,
        user_edit: Optional[str] = None
    ) -> AIReviewResponse:
        """
        Generate Indonesian review paragraph from parsed data.
        
        Uses round-robin key rotation with automatic fallback on quota errors.
        If a key fails with 429 (quota exceeded), tries the next key.
        
        Args:
            parsed: ParsedBroadcast object with book information.
            user_edit: Optional user edit request to incorporate.
            
        Returns:
            AIReviewResponse with publisher_guess and review.
            
        Raises:
            Exception: If all keys fail.
        """
        logger.info(f"Starting review generation for: {parsed.title}")
        
        prompt = self._build_review_prompt(parsed, user_edit)
        logger.debug(f"Built prompt, length: {len(prompt)} chars")
        
        generation_config = {
            "temperature": 0.8,  # Slightly more creative for review
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 1024,  # Increased to prevent truncation
        }
        
        # Get starting index for round-robin
        start_index = self._get_next_key_index()
        last_error = None
        
        # Try each key until one succeeds
        for i in range(len(self.api_keys)):
            key_index = (start_index + i) % len(self.api_keys)
            api_key = self.api_keys[key_index]
            key_suffix = api_key[-6:] if len(api_key) > 6 else api_key
            
            try:
                logger.info(f"Trying API key ...{key_suffix} (attempt {i+1}/{len(self.api_keys)})")
                
                model = self._get_model_with_key(api_key)
                
                # Use synchronous call (google-generativeai doesn't have native async)
                response = model.generate_content(
                    prompt,
                    generation_config=generation_config
                )
                
                # Check if response has text
                if not response.text:
                    logger.warning(f"Empty response from API key ...{key_suffix}")
                    if response.prompt_feedback:
                        logger.warning(f"Prompt feedback: {response.prompt_feedback}")
                    continue
                
                result_text = response.text.strip()
                logger.info(f"Success with API key ...{key_suffix}, response length: {len(result_text)}")
                
                # Parse JSON response
                try:
                    # Clean up response (remove markdown code blocks if present)
                    if result_text.startswith('```'):
                        result_text = result_text.split('```')[1]
                        if result_text.startswith('json'):
                            result_text = result_text[4:]
                    result_text = result_text.strip()
                    
                    result_json = json.loads(result_text)
                    return AIReviewResponse(
                        publisher_guess=result_json.get('publisher_guess'),
                        review=result_json.get('review', '')
                    )
                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse JSON response: {e}")
                    # Fallback: try to extract review from malformed JSON
                    review_text = self._extract_review_from_malformed(result_text)
                    if review_text:
                        return AIReviewResponse(
                            publisher_guess=None,
                            review=review_text
                        )
                    # If extraction failed, generate a simple fallback
                    logger.warning("Using fallback review generation")
                    return AIReviewResponse(
                        publisher_guess=None,
                        review=f"Buku edukatif yang seru untuk si Kecil! 📚 Yuk eksplorasi bersama keluarga. Wajib masuk wishlist! 🌟"
                    )
                
            except google_exceptions.ResourceExhausted as e:
                logger.warning(f"API key ...{key_suffix} quota exceeded (429), trying next key...")
                last_error = e
                continue
                
            except Exception as e:
                error_str = str(e)
                logger.error(f"API key ...{key_suffix} error: {error_str}")
                logger.debug(f"Full traceback:\n{traceback.format_exc()}")
                
                if "429" in error_str or "quota" in error_str.lower():
                    logger.warning(f"Quota error detected, trying next key...")
                    last_error = e
                    continue
                else:
                    # For non-quota errors, log but still try next key
                    last_error = e
                    continue
        
        # All keys failed
        error_msg = f"All {len(self.api_keys)} API keys failed. Last error: {last_error}"
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
