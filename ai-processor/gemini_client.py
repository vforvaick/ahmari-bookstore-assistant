"""
GeminiClient with Round-Robin API Key Rotation

Supports multiple Gemini API keys for load balancing and quota management.
Keys are rotated in round-robin fashion to distribute load evenly.
"""

import json
import os
import threading
import google.generativeai as genai
from pathlib import Path
from typing import Optional, List
from models import ParsedBroadcast


class GeminiClient:
    """
    Gemini API client with built-in round-robin key rotation.
    
    Environment Variables:
        GEMINI_API_KEYS: Comma-separated list of API keys (preferred)
        GEMINI_API_KEY: Single API key (fallback)
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
        self.model_name = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash-exp')
        
        # Load style profile
        style_path = Path(__file__).parent / "config/style-profile.json"
        with open(style_path, 'r', encoding='utf-8') as f:
            self.style_profile = json.load(f)
    
    def _get_next_key(self) -> str:
        """
        Get the next API key using thread-safe round-robin.
        
        Returns:
            The next API key in rotation.
        """
        with self._counter_lock:
            key = self.api_keys[self._request_counter % len(self.api_keys)]
            GeminiClient._request_counter += 1
        return key
    
    def _get_model(self) -> genai.GenerativeModel:
        """
        Get a GenerativeModel configured with the next API key.
        
        Returns:
            Configured GenerativeModel instance.
        """
        api_key = self._get_next_key()
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
        
        Uses round-robin key rotation automatically.
        
        Args:
            parsed: ParsedBroadcast object with book information.
            user_edit: Optional user edit request.
            
        Returns:
            Generated broadcast message.
        """
        prompt = self._build_prompt(parsed, user_edit)
        
        # Get model with next API key in rotation
        model = self._get_model()

        generation_config = {
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 1024,
        }

        response = model.generate_content(
            prompt,
            generation_config=generation_config
        )

        return response.text.strip()
