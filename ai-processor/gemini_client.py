"""
GeminiClient - Simplified and Robust Implementation

Uses gemini-2.5-flash model with round-robin API key rotation.
Fixed async/await usage and improved error handling.
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
from models import ParsedBroadcast

# Configure logging with more detail
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class GeminiClient:
    """
    Gemini API client with built-in round-robin key rotation and fallback.
    
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
        
        # Load style profile
        style_path = Path(__file__).parent / "config/style-profile.json"
        try:
            with open(style_path, 'r', encoding='utf-8') as f:
                self.style_profile = json.load(f)
            logger.info("Style profile loaded successfully")
        except Exception as e:
            logger.warning(f"Failed to load style profile: {e}, using defaults")
            self.style_profile = self._get_default_style_profile()
    
    def _get_default_style_profile(self) -> dict:
        """Return default style profile if file not found."""
        return {
            "greetings": ["Halooo moms!", "Ada buku bagus nih!"],
            "emoji_usage": {"frequency": "medium", "common": ["😍", "📚", "💰"]},
            "tone": "friendly_informative",
            "casual_words": {
                "very": ["banget", "bgtt"],
                "beautiful": ["bagus bgtt", "cakep"],
                "cheap": ["murmer", "murah"],
                "good": ["bagus", "oke nih"]
            },
            "structure_preference": {
                "conversational_intro": True,
                "emoji_before_price": True,
                "include_age_recommendation": True,
                "include_benefits": True
            },
            "style_notes": "Casual Indonesian style"
        }
    
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

    def _build_prompt(self, parsed: ParsedBroadcast, user_edit: Optional[str] = None) -> str:
        """Build prompt for Gemini with few-shot examples."""
        
        # Format price display with null safety
        if parsed.price_main:
            price_display = f"Rp {parsed.price_main:,}".replace(',', '.')
        else:
            price_display = "Harga belum tersedia"
            
        if parsed.price_secondary:
            price_secondary_display = f"Rp {parsed.price_secondary:,}".replace(',', '.')
            price_display = f"HB: {price_display} / PB: {price_secondary_display}"

        # Build structured info
        structured_info = f"""
INFORMASI BUKU TARGET:
- Judul: {parsed.title or 'Tidak ada judul'}
- Format: {parsed.format or 'Tidak disebutkan'}
- Harga: {price_display}
- Min Order: {parsed.min_order or 'Tidak ada minimum'}
- ETA: {parsed.eta or 'Tidak disebutkan'}
- Close: {parsed.close_date or 'Tidak disebutkan'}
- Deskripsi Asli: {parsed.description_en or 'Tidak ada deskripsi'}
"""

        # Few-Shot Examples (Extracted from chat history)
        few_shot_examples = """
CONTOH GAYA PENULISAN (TIRU STYLE INI):

Contoh 1 (Untuk Buku Seri/Koleksi):
"SERI GOOD NIGHT 

https://link...

Seri ini best seller banget nih gais!🤩 ada macem2 hewannya. Bagus untuk anak under 1 th. Cocok untuk dongeng sebelum tidur. Kl gambar magic cat gausa diragukan lagi😁"

Contoh 2 (Untuk Activity Book/Mainan):
"SERI MONSTER

https://link...

Buku ini selalu jd incaran mama mama karena murmer <50k dan bisa diputer2 dimainin😆"

Contoh 3 (Untuk Buku Edukasi/Science):
"The Big Beyond 

https://link...

Warna2 gambarnya solid, bagus untuk story time baby. Tulisan sedikit. Menceritakan ttg ada apa saja diatas langit dan luar angkasa"

Contoh 4 (Review Personal/Opinion):
"Buku Miles Kelly😍 buku fiksi yg bagus untuk melatih imajinasi anak. Karena banyak tulisannya buku ini mungkin lebih cocok utk anak yg udh agak gede an >3th tp kalo mau buat story time buat dibacakan sblm tidur juga okee bgt!"

Contoh 5 (Tone "Racun"/"Jastip"):
"Jujur yaa gais ini yg bagus2 justru yg bukan usborne. Karena usborne nya habis jd lebih keliatan buku2 lain kek punya priddy nii emg bagus2😍"
"""

        user_edit_section = ""
        if user_edit:
            user_edit_section = f"""
USER EDIT REQUEST:
"{user_edit}"
IMPORTANT: You MUST incorporate this specific request into the message.
"""

        prompt = f"""
ROLE:
Kamu adalah admin grup WhatsApp "Ahmari Bookstore" yang bernama "Dr. Findania" (atau dipanggil "Ndan", "Findan", "Mom", "Moms").
Kamu sedang meracuni (mempromosikan) buku import anak ke member grup yang berisi ibu-ibu muda.

STYLE GUIDELINES:
1.  **Vibe**: Antusias, personal, jujur, seperti teman ngobrol, "racun" belanja.
2.  **Vocabulary Wajib**:
    -   Gunakan "bgtt" (bukan banget), "banyakk", "lucuu" (dobel huruf akhir utk penekanan).
    -   Kata sapaan: "gais", "moms", "temen2".
    -   Istilah khusus: "murmer" (murah meriah), "ghoib" (barang langka), "hilalnya" (tanda kehadiran barang), "cakep", "best seller".
3.  **Struktur Pesan**:
    -   [Judul Buku] (Langsung to the point, kadang Capslock).
    -   [Link] (Placeholder saja).
    -   [Review/Komentar Pribadi]: Ini bagian terpenting! Jelaskan kenapa buku ini bagus, cocok untuk usia berapa, atau fitur uniknya (bisa diputar, diintip, dll).
    -   Jangan terlalu formal/kaku. Jangan seperti robot sales.
4.  **Emoji**: Gunakan emoji secara natural (😍, 😆, 🤩, 📚). Jangan spam emoji di awal kalimat.

{few_shot_examples}

{structured_info}

{user_edit_section}

TASK:
Buatskan broadcast WhatsApp untuk buku di "INFORMASI BUKU TARGET" di atas.
TIRU GAYA BICARA di "CONTOH GAYA PENULISAN".
Jangan sebut "Halo haloo" di awal jika tidak perlu, langsung judul buku juga boleh seperti Contoh 1 & 2.
Jika deskripsi asli bahasa Inggris, ceritakan ulang intinya dalam bahasa Indonesia yang santai (jangan terjemahan kaku).

OUTPUT:
Hanya teks pesan WhatsApp saja.
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
        logger.info(f"Starting broadcast generation for: {parsed.title}")
        
        prompt = self._build_prompt(parsed, user_edit)
        logger.debug(f"Built prompt, length: {len(prompt)} chars")
        
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
            key_suffix = api_key[-6:] if len(api_key) > 6 else api_key
            
            try:
                logger.info(f"Trying API key ...{key_suffix} (attempt {i+1}/{len(self.api_keys)})")
                
                model = self._get_model_with_key(api_key)
                
                # Use synchronous call (google-generativeai doesn't have native async)
                # but this is fine for the current use case
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
                
                result = response.text.strip()
                logger.info(f"Success with API key ...{key_suffix}, response length: {len(result)}")
                return result
                
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
        logger.debug(f"Last error traceback:\n{traceback.format_exc()}")
        raise Exception(error_msg)
