"""
Base LLM Provider Interface

Abstract base class for all LLM providers (CLIProxyAPI, Gemini, etc.)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Any
from enum import Enum


class TaskType(Enum):
    """Types of tasks for model selection."""
    TEXT_GENERATION = "text_gen"      # Review writing, copywriting
    VISION = "vision"                  # Image analysis
    RESEARCH = "research"              # Web research synthesis
    SIMPLE = "simple"                  # Greetings, chitchat


@dataclass
class GenerationConfig:
    """Configuration for text generation."""
    temperature: float = 0.8
    top_p: float = 0.95
    top_k: int = 40
    max_tokens: int = 4096


@dataclass
class LLMResponse:
    """Unified response from LLM providers."""
    text: str
    model_used: str
    provider: str
    tokens_used: Optional[int] = None
    error: Optional[str] = None


class LLMProvider(ABC):
    """
    Abstract base class for LLM providers.
    
    All providers (CLIProxyAPI, Gemini, etc.) must implement this interface.
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging."""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider is available and configured."""
        pass
    
    @abstractmethod
    async def generate_text(
        self,
        prompt: str,
        model: Optional[str] = None,
        config: Optional[GenerationConfig] = None
    ) -> LLMResponse:
        """
        Generate text response from prompt.
        
        Args:
            prompt: Text prompt
            model: Optional model override
            config: Generation configuration
            
        Returns:
            LLMResponse with generated text
        """
        pass
    
    @abstractmethod
    async def analyze_image(
        self,
        image_data: bytes,
        prompt: str,
        model: Optional[str] = None
    ) -> LLMResponse:
        """
        Analyze image and generate response.
        
        Args:
            image_data: Image bytes (JPEG/PNG)
            prompt: Analysis prompt
            model: Optional model override
            
        Returns:
            LLMResponse with analysis result
        """
        pass
    
    def get_model_for_task(self, task_type: TaskType) -> str:
        """
        Get the best model for a given task type.
        Override in subclasses for provider-specific model selection.
        """
        # Default implementation - subclasses should override
        return "default"
