import json
import google.generativeai as genai
from pathlib import Path
from typing import Optional
from models import ParsedBroadcast

class GeminiClient:
    def __init__(self, api_key: Optional[str] = None):
        if api_key is None:
            import os
            api_key = os.getenv('GEMINI_API_KEY')

        if not api_key:
            raise ValueError("GEMINI_API_KEY is required")

        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')

        # Load style profile
        style_path = Path(__file__).parent / "config/style-profile.json"
        with open(style_path, 'r', encoding='utf-8') as f:
            self.style_profile = json.load(f)

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
        """Generate Indonesian broadcast from parsed data"""

        prompt = self._build_prompt(parsed, user_edit)

        generation_config = {
            "temperature": 0.7,
            "top_p": 0.95,
            "top_k": 40,
            "max_output_tokens": 1024,
        }

        response = self.model.generate_content(
            prompt,
            generation_config=generation_config
        )

        return response.text.strip()
