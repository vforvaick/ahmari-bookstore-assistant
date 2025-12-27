"""
Provider Router - Automatic Failover Between LLM Providers

Routes requests to CLIProxyAPI (primary) with automatic fallback to Gemini (backup).
"""

import logging
from typing import Optional

from .base import LLMProvider, TaskType, GenerationConfig, LLMResponse
from .cliproxy_provider import CLIProxyProvider
from .gemini_backup import GeminiBackupProvider

logger = logging.getLogger(__name__)


class ProviderRouter:
    """
    Routes LLM requests with automatic failover.
    
    Primary: CLIProxyAPI (OpenAI-compatible gateway)
    Fallback: Direct Gemini SDK
    
    Usage:
        router = ProviderRouter()
        response = await router.generate_text(prompt, task_type=TaskType.TEXT_GENERATION)
    """
    
    def __init__(
        self,
        primary: Optional[LLMProvider] = None,
        fallback: Optional[LLMProvider] = None
    ):
        """
        Initialize router with providers.
        
        Args:
            primary: Primary provider (default: CLIProxyProvider)
            fallback: Fallback provider (default: GeminiBackupProvider)
        """
        self.primary = primary or CLIProxyProvider()
        self.fallback = fallback or GeminiBackupProvider()
        
        # Track consecutive failures for circuit breaker pattern
        self._primary_failures = 0
        self._primary_failure_threshold = 3
        self._primary_disabled = False
        
        logger.info(f"ProviderRouter initialized: primary={self.primary.name}, fallback={self.fallback.name}")
    
    def _reset_primary(self):
        """Reset primary provider status."""
        self._primary_failures = 0
        self._primary_disabled = False
        logger.info("Primary provider reset")
    
    def _record_primary_failure(self):
        """Record a primary provider failure."""
        self._primary_failures += 1
        if self._primary_failures >= self._primary_failure_threshold:
            self._primary_disabled = True
            logger.warning(f"Primary provider disabled after {self._primary_failures} failures")
    
    def get_active_provider(self) -> LLMProvider:
        """Get the currently active provider."""
        if self._primary_disabled:
            return self.fallback
        if not self.primary.is_available():
            return self.fallback
        return self.primary
    
    async def generate_text(
        self,
        prompt: str,
        task_type: TaskType = TaskType.TEXT_GENERATION,
        model: Optional[str] = None,
        config: Optional[GenerationConfig] = None
    ) -> LLMResponse:
        """
        Generate text with automatic failover.
        
        Args:
            prompt: Text prompt
            task_type: Task type for model selection
            model: Optional model override
            config: Generation config
            
        Returns:
            LLMResponse from whichever provider succeeds
        """
        # Try primary first (unless disabled)
        if not self._primary_disabled and self.primary.is_available():
            model_name = model or self.primary.get_model_for_task(task_type)
            
            logger.info(f"Trying primary ({self.primary.name}) with model {model_name}")
            response = await self.primary.generate_text(prompt, model_name, config)
            
            if not response.error:
                self._primary_failures = 0  # Reset on success
                return response
            
            logger.warning(f"Primary failed: {response.error}")
            self._record_primary_failure()
        
        # Fallback to backup
        if self.fallback.is_available():
            model_name = model or self.fallback.get_model_for_task(task_type)
            
            logger.info(f"Falling back to {self.fallback.name} with model {model_name}")
            response = await self.fallback.generate_text(prompt, model_name, config)
            
            return response
        
        # Both failed
        return LLMResponse(
            text="",
            model_used="none",
            provider="none",
            error="all_providers_unavailable"
        )
    
    async def analyze_image(
        self,
        image_data: bytes,
        prompt: str,
        model: Optional[str] = None
    ) -> LLMResponse:
        """
        Analyze image with automatic failover.
        
        Args:
            image_data: Image bytes
            prompt: Analysis prompt
            model: Optional model override
            
        Returns:
            LLMResponse from whichever provider succeeds
        """
        # Try primary first
        if not self._primary_disabled and self.primary.is_available():
            model_name = model or self.primary.get_model_for_task(TaskType.VISION)
            
            logger.info(f"Trying primary vision ({self.primary.name}) with model {model_name}")
            response = await self.primary.analyze_image(image_data, prompt, model_name)
            
            if not response.error:
                self._primary_failures = 0
                return response
            
            logger.warning(f"Primary vision failed: {response.error}")
            self._record_primary_failure()
        
        # Fallback
        if self.fallback.is_available():
            model_name = model or self.fallback.get_model_for_task(TaskType.VISION)
            
            logger.info(f"Falling back to {self.fallback.name} for vision")
            response = await self.fallback.analyze_image(image_data, prompt, model_name)
            
            return response
        
        return LLMResponse(
            text="",
            model_used="none",
            provider="none",
            error="all_providers_unavailable"
        )


# Global router instance (lazy initialization)
_router: Optional[ProviderRouter] = None


def get_router() -> ProviderRouter:
    """Get or create the global provider router."""
    global _router
    if _router is None:
        _router = ProviderRouter()
    return _router
