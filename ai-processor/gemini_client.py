"""
GeminiClient with Round-Robin API Key Rotation and Fallback

Supports multiple Gemini API keys for load balancing and quota management.
Keys are rotated in round-robin fashion, with automatic fallback to next key
on quota errors (429).
"""

import json
import os
import threading
import logging
import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from pathlib import Path
from typing import Optional, List
from models import ParsedBroadcast

logger = logging.getLogger(__name__)


class GeminiClient:
    """
    Gemini API client with built-in round-robin key rotation and fallback.
    
    Environment Variables:
        GEMINI_API_KEYS: Comma-separated list of API keys (preferred)
        GEMINI_API_KEY: Single API key (fallback)
        GEMINI_MODEL: Model to use (default: gemini-1.5-flash)
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
        self.model_name = os.getenv('GEMINI_MODEL', 'gemini-1.5-flash')
        
        logger.info(f"GeminiClient initialized with {len(self.api_keys)} API keys, model: {self.model_name}")
        
        # Load style profile
        style_path = Path(__file__).parent / "config/style-profile.json"
        with open(style_path, 'r', encoding='utf-8') as f:
            self.style_profile = json.load(f)
    
    def _get_next_key_index(self) -> int:
        """
        Get the next API key index using thread-safe round-robin.
        
        Returns:
            Index of the next API key.
        """
        with self._counter_lock:
            index = self._request_counter % len(self.api_keys)
            GeminiClient._request_counter += 1
        return index
    
    def _get_model_with_key(self, api_key: str) -> genai.GenerativeModel:
        """
        Get a GenerativeModel configured with a specific API key.
        
        Args:
            api_key: The API key to use.
            
        Returns:
            Configured GenerativeModel instance.
        """
        genai.configure(api_key=api_key)
        return genai.GenerativeModel(self.model_name)

    def _build_prompt(self, parsed: ParsedBroadcast, user_edit: Optional[str] = None) -> str:
        """Build prompt for Gemini"""

        # Format price display
        price_display = f"Rp {parsed.price_main:,}".replace(',', '.')
        if parsed.price_secondary:
            price_secondary_display = f"Rp {parsed.price_secondary:,}".replace(',', '.')
            price_display = f"HB: {price_display} / PB: {price_secondary_display}"

        # Build structured info
        structured_info = f"""
INFORMASI BUKU:
- Judul: {parsed.title}
- Format: {parsed.format}
- Harga: {price_display}
- Min Order: {parsed.min_order or 'Tidak ada minimum'}
- ETA: {parsed.eta or 'Tidak disebutkan'}
- Close: {parsed.close_date or 'Tidak disebutkan'}
- Type: {parsed.type or 'Tidak disebutkan'}
- Deskripsi (English): {parsed.description_en}
- Tags: {', '.join(parsed.tags) if parsed.tags else 'Tidak ada'}
- Jumlah foto: {parsed.media_count}
"""

        # Build style guide from profile
        style_guide = f"""
STYLE GUIDE (Dr. Findania - Ahmari Bookstore):
- Tone: {self.style_profile['tone']} - {self.style_profile['style_notes']}
- Greeting options: {', '.join(self.style_profile['greetings'])}
- Emoji usage: {self.style_profile['emoji_usage']['frequency']} - gunakan: {', '.join(self.style_profile['emoji_usage']['common'])}
- Casual words:
  * Untuk "very/sangat": {', '.join(self.style_profile['casual_words']['very'])}
  * Untuk "beautiful/bagus": {', '.join(self.style_profile['casual_words']['beautiful'])}
  * Untuk "cheap/murah": {', '.join(self.style_profile['casual_words']['cheap'])}
  * Untuk "good/bagus": {', '.join(self.style_profile['casual_words']['good'])}
- Struktur:
  * Mulai dengan greeting casual
  * Emoji sebelum harga: {'Ya' if self.style_profile['structure_preference']['emoji_before_price'] else 'Tidak'}
  * Include rekomendasi usia: {'Ya' if self.style_profile['structure_preference']['include_age_recommendation'] else 'Tidak'}
  * Include manfaat buku: {'Ya' if self.style_profile['structure_preference']['include_benefits'] else 'Tidak'}
"""

        user_edit_section = ""
        if user_edit:
            user_edit_section = f"""
USER EDIT REQUEST:
{user_edit}

IMPORTANT: Incorporate the user's edit request into the broadcast.
"""

        prompt = f"""{structured_info}

{style_guide}

{user_edit_section}

TASK:
Generate a WhatsApp broadcast message in Indonesian for Ahmari Bookstore (toko buku) promoting this book.

REQUIREMENTS:
1. Start with a casual, friendly greeting (pilih salah satu dari greeting options)
2. Translate the description to Indonesian with casual, conversational style
3. Include price, format, ETA, and close date
4. Use emoji naturally (jangan berlebihan)
5. Use casual Indonesian words from the style guide
6. Keep it informative but friendly ("selow tapi serius dan insightful")
7. If possible, add insight about age suitability or book benefits
8. Keep the format clean and easy to read
9. Don't use asterisks for bold (WhatsApp formatting will be handled separately)
10. End naturally (no need for separator emoji)

Generate ONLY the broadcast message, no explanations or meta-commentary.
"""

        return prompt

    async def generate_broadcast(
        self,
        parsed: ParsedBroadcast,
        user_edit: Optional[str] = None
    ) -> str:
        """
        Generate Indonesian broadcast from parsed data.
        
        Uses round-robin key rotation with automatic fallback on quota errors.
        If a key fails with 429 (quota exceeded), tries the next key.
        
        Args:
            parsed: ParsedBroadcast object with book information.
            user_edit: Optional user edit request.
            
        Returns:
            Generated broadcast message.
            
        Raises:
            Exception: If all keys fail.
        """
        prompt = self._build_prompt(parsed, user_edit)
        
        generation_config = {
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 1024,
        }
        
        # Get starting index for round-robin
        start_index = self._get_next_key_index()
        last_error = None
        
        # Try each key until one succeeds
        for i in range(len(self.api_keys)):
            key_index = (start_index + i) % len(self.api_keys)
            api_key = self.api_keys[key_index]
            key_suffix = api_key[-6:] if len(api_key) > 6 else api_key  # Last 6 chars for logging
            
            try:
                logger.info(f"Trying API key ...{key_suffix} (attempt {i+1}/{len(self.api_keys)})")
                
                model = self._get_model_with_key(api_key)
                response = model.generate_content(
                    prompt,
                    generation_config=generation_config
                )
                
                logger.info(f"Success with API key ...{key_suffix}")
                return response.text.strip()
                
            except google_exceptions.ResourceExhausted as e:
                # 429 - Quota exceeded, try next key
                logger.warning(f"API key ...{key_suffix} quota exceeded (429), trying next key...")
                last_error = e
                continue
                
            except Exception as e:
                # Other errors - log but still try next key
                error_str = str(e)
                if "429" in error_str or "quota" in error_str.lower():
                    logger.warning(f"API key ...{key_suffix} quota error, trying next key...")
                    last_error = e
                    continue
                else:
                    # For non-quota errors, raise immediately
                    logger.error(f"API key ...{key_suffix} failed with non-quota error: {e}")
                    raise
        
        # All keys failed
        logger.error(f"All {len(self.api_keys)} API keys exhausted. Last error: {last_error}")
        raise Exception(f"All API keys quota exceeded. Please wait for quota reset or upgrade plan. Last error: {last_error}")
