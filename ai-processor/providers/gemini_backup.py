"""
Gemini Backup Provider - Fallback LLM Provider

Direct Gemini SDK implementation for use when CLIProxyAPI is unavailable.
Refactored from the original gemini_client.py to implement LLMProvider interface.
"""

import os
import logging
import traceback
from typing import Optional, List
import io

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from PIL import Image

from .base import LLMProvider, TaskType, GenerationConfig, LLMResponse

logger = logging.getLogger(__name__)

# Available models for rotation
BACKUP_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
]


class GeminiBackupProvider(LLMProvider):
    """
    Backup LLM provider using direct Gemini SDK.
    
    Used as fallback when CLIProxyAPI is unavailable.
    Implements multi-key rotation for quota management.
    """
    
    def __init__(self, api_keys: Optional[List[str]] = None):
        """
        Initialize Gemini backup provider.
        
        Args:
            api_keys: List of Gemini API keys (default from env)
        """
        if api_keys is None:
            keys_str = os.getenv('GEMINI_API_KEYS', '')
            if keys_str:
                api_keys = [k.strip() for k in keys_str.split(',') if k.strip()]
            else:
                single_key = os.getenv('GEMINI_API_KEY', '')
                api_keys = [single_key] if single_key else []
        
        self.api_keys = api_keys
        self._current_key_idx = 0
        self._failed_keys: set = set()
        
        logger.info(f"GeminiBackupProvider initialized with {len(self.api_keys)} API keys")
    
    @property
    def name(self) -> str:
        return "gemini_backup"
    
    def is_available(self) -> bool:
        """Check if at least one API key is configured.""" 
        return len(self.api_keys) > 0
    
    def get_model_for_task(self, task_type: TaskType) -> str:
        """Get model for task type."""
        if task_type == TaskType.VISION:
            return "gemini-2.0-flash"  # Vision capable
        elif task_type == TaskType.SIMPLE:
            return "gemini-2.5-flash-lite"
        else:
            return "gemini-2.5-flash"
    
    def _get_current_key(self) -> Optional[str]:
        """Get current API key, rotating if needed."""
        available_keys = [k for k in self.api_keys if k not in self._failed_keys]
        if not available_keys:
            # Reset failed keys and try again
            self._failed_keys.clear()
            available_keys = self.api_keys
        
        if not available_keys:
            return None
            
        self._current_key_idx = self._current_key_idx % len(available_keys)
        return available_keys[self._current_key_idx]
    
    def _rotate_key(self):
        """Rotate to next API key."""
        self._current_key_idx += 1
        logger.info(f"Rotated to key index {self._current_key_idx}")
    
    def _mark_key_failed(self, key: str):
        """Mark a key as failed (rate limited)."""
        self._failed_keys.add(key)
        logger.warning(f"Marked key ...{key[-6:]} as failed")
    
    async def generate_text(
        self,
        prompt: str,
        model: Optional[str] = None,
        config: Optional[GenerationConfig] = None
    ) -> LLMResponse:
        """
        Generate text using direct Gemini SDK.
        
        Args:
            prompt: Text prompt
            model: Model name
            config: Generation config
            
        Returns:
            LLMResponse with generated text
        """
        if config is None:
            config = GenerationConfig()
        
        model_name = model or self.get_model_for_task(TaskType.TEXT_GENERATION)
        
        # Try each key until one works
        for attempt in range(len(self.api_keys)):
            api_key = self._get_current_key()
            if not api_key:
                return LLMResponse(
                    text="",
                    model_used=model_name,
                    provider=self.name,
                    error="no_api_keys_available"
                )
            
            try:
                logger.info(f"Gemini backup: model={model_name}, key=...{api_key[-6:]}")
                
                genai.configure(api_key=api_key)
                gmodel = genai.GenerativeModel(model_name)
                
                response = gmodel.generate_content(
                    prompt,
                    generation_config={
                        "temperature": config.temperature,
                        "top_p": config.top_p,
                        "top_k": config.top_k,
                        "max_output_tokens": config.max_tokens,
                    }
                )
                
                if not response.text:
                    logger.warning("Empty response from Gemini")
                    self._rotate_key()
                    continue
                
                text = response.text.strip()
                logger.info(f"Gemini backup success: {len(text)} chars")
                
                return LLMResponse(
                    text=text,
                    model_used=model_name,
                    provider=self.name
                )
                
            except google_exceptions.ResourceExhausted as e:
                logger.warning(f"Gemini rate limited: {e}")
                self._mark_key_failed(api_key)
                self._rotate_key()
                continue
                
            except Exception as e:
                error_str = str(e)
                logger.error(f"Gemini error: {error_str}")
                
                if "429" in error_str or "quota" in error_str.lower():
                    self._mark_key_failed(api_key)
                    self._rotate_key()
                    continue
                    
                return LLMResponse(
                    text="",
                    model_used=model_name,
                    provider=self.name,
                    error=f"gemini_error: {error_str}"
                )
        
        return LLMResponse(
            text="",
            model_used=model_name,
            provider=self.name,
            error="all_keys_exhausted"
        )
    
    async def analyze_image(
        self,
        image_data: bytes,
        prompt: str,
        model: Optional[str] = None
    ) -> LLMResponse:
        """
        Analyze image using Gemini Vision.
        
        Args:
            image_data: Image bytes
            prompt: Analysis prompt
            model: Vision model
            
        Returns:
            LLMResponse with analysis result
        """
        model_name = model or self.get_model_for_task(TaskType.VISION)
        
        api_key = self._get_current_key()
        if not api_key:
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error="no_api_keys_available"
            )
        
        try:
            logger.info(f"Gemini vision: model={model_name}, size={len(image_data)} bytes")
            
            genai.configure(api_key=api_key)
            gmodel = genai.GenerativeModel(model_name)
            
            # Convert bytes to PIL Image
            image = Image.open(io.BytesIO(image_data))
            
            response = gmodel.generate_content([prompt, image])
            
            if not response.text:
                return LLMResponse(
                    text="",
                    model_used=model_name,
                    provider=self.name,
                    error="empty_response"
                )
            
            text = response.text.strip()
            logger.info(f"Gemini vision success: {len(text)} chars")
            
            return LLMResponse(
                text=text,
                model_used=model_name,
                provider=self.name
            )
            
        except Exception as e:
            logger.error(f"Gemini vision error: {e}")
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error=f"vision_error: {str(e)}"
            )
