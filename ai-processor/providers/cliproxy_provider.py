"""
CLIProxyAPI Provider - Primary LLM Provider

Uses OpenAI-compatible API to access CLIProxyAPI gateway which provides:
- Antigravity (Gemini models) with 5 accounts round-robin
- Kiro (Claude models via AWS)

Endpoint: http://43.134.1.135:8317/v1
"""

import os
import logging
import base64
from typing import Optional

from openai import AsyncOpenAI
from openai import APIError, APIConnectionError, RateLimitError

from .base import LLMProvider, TaskType, GenerationConfig, LLMResponse

logger = logging.getLogger(__name__)

# Default models per task type
DEFAULT_MODELS = {
    TaskType.TEXT_GENERATION: "gemini-2.5-flash",
    TaskType.VISION: "gemini-3-pro-image-preview",
    TaskType.RESEARCH: "kiro-claude-sonnet-4-5",
    TaskType.SIMPLE: "gemini-2.5-flash-lite",
}


class CLIProxyProvider(LLMProvider):
    """
    Primary LLM provider using CLIProxyAPI gateway.
    
    Features:
    - OpenAI-compatible API
    - Automatic account rotation (5 Antigravity + 1 Kiro)
    - Task-based model selection
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        models: Optional[dict] = None
    ):
        """
        Initialize CLIProxyAPI provider.
        
        Args:
            base_url: CLIProxyAPI base URL (default from env)
            api_key: API key (default from env)
            models: Override model mapping per TaskType
        """
        self.base_url = base_url or os.getenv(
            "CLIPROXY_BASE_URL", 
            "http://43.134.1.135:8317/v1"
        )
        self.api_key = api_key or os.getenv(
            "CLIPROXY_API_KEY",
            ""  # No default - must be set in environment
        )
        
        # Model mapping
        self.models = DEFAULT_MODELS.copy()
        if models:
            self.models.update(models)
        
        # Initialize OpenAI client
        self._client: Optional[AsyncOpenAI] = None
        
        logger.info(f"CLIProxyProvider initialized with base_url={self.base_url}")
    
    @property
    def name(self) -> str:
        return "cliproxy"
    
    @property
    def client(self) -> AsyncOpenAI:
        """Lazy initialization of OpenAI client."""
        if self._client is None:
            self._client = AsyncOpenAI(
                base_url=self.base_url,
                api_key=self.api_key
            )
        return self._client
    
    def is_available(self) -> bool:
        """Check if CLIProxyAPI is configured."""
        return bool(self.base_url and self.api_key)
    
    def get_model_for_task(self, task_type: TaskType) -> str:
        """Get optimal model for task type."""
        return self.models.get(task_type, DEFAULT_MODELS[TaskType.TEXT_GENERATION])
    
    async def generate_text(
        self,
        prompt: str,
        model: Optional[str] = None,
        config: Optional[GenerationConfig] = None
    ) -> LLMResponse:
        """
        Generate text using CLIProxyAPI.
        
        Args:
            prompt: Text prompt
            model: Model name (default: gemini-2.5-flash)
            config: Generation config
            
        Returns:
            LLMResponse with generated text
        """
        if config is None:
            config = GenerationConfig()
        
        model_name = model or self.get_model_for_task(TaskType.TEXT_GENERATION)
        
        try:
            logger.info(f"CLIProxy generate_text: model={model_name}")
            
            response = await self.client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=config.temperature,
                top_p=config.top_p,
                max_tokens=config.max_tokens,
            )
            
            text = response.choices[0].message.content or ""
            tokens = response.usage.total_tokens if response.usage else None
            
            logger.info(f"CLIProxy success: {len(text)} chars, {tokens} tokens")
            
            return LLMResponse(
                text=text,
                model_used=model_name,
                provider=self.name,
                tokens_used=tokens
            )
            
        except RateLimitError as e:
            logger.warning(f"CLIProxy rate limit: {e}")
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error=f"rate_limit: {str(e)}"
            )
            
        except APIConnectionError as e:
            logger.error(f"CLIProxy connection error: {e}")
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error=f"connection_error: {str(e)}"
            )
            
        except APIError as e:
            logger.error(f"CLIProxy API error: {e}")
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error=f"api_error: {str(e)}"
            )
            
        except Exception as e:
            logger.error(f"CLIProxy unexpected error: {e}")
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error=f"unexpected: {str(e)}"
            )
    
    async def analyze_image(
        self,
        image_data: bytes,
        prompt: str,
        model: Optional[str] = None
    ) -> LLMResponse:
        """
        Analyze image using CLIProxyAPI vision model.
        
        Args:
            image_data: Image bytes (JPEG/PNG)
            prompt: Analysis prompt
            model: Vision model (default: gemini-3-pro-image-preview)
            
        Returns:
            LLMResponse with analysis result
        """
        model_name = model or self.get_model_for_task(TaskType.VISION)
        
        try:
            logger.info(f"CLIProxy analyze_image: model={model_name}, size={len(image_data)} bytes")
            
            # Encode image to base64
            base64_image = base64.b64encode(image_data).decode('utf-8')
            
            # Detect image type
            if image_data[:4] == b'\x89PNG':
                media_type = "image/png"
            else:
                media_type = "image/jpeg"
            
            response = await self.client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{media_type};base64,{base64_image}"
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ]
                    }
                ],
                max_tokens=4096
            )
            
            text = response.choices[0].message.content or ""
            tokens = response.usage.total_tokens if response.usage else None
            
            logger.info(f"CLIProxy vision success: {len(text)} chars")
            
            return LLMResponse(
                text=text,
                model_used=model_name,
                provider=self.name,
                tokens_used=tokens
            )
            
        except Exception as e:
            logger.error(f"CLIProxy vision error: {e}")
            return LLMResponse(
                text="",
                model_used=model_name,
                provider=self.name,
                error=f"vision_error: {str(e)}"
            )
