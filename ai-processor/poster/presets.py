"""
Platform dimension presets for poster generation.

Supports common social media formats:
- Instagram Story/Reels
- Instagram Feed (Square, Portrait)
- WhatsApp Status
- Custom dimensions
"""

from enum import Enum
from typing import Tuple, Optional
from dataclasses import dataclass


class PlatformPresets(Enum):
    """Common platform dimension presets."""
    
    # Instagram
    IG_STORY = "ig_story"           # 9:16 vertical
    IG_FEED_SQUARE = "ig_square"    # 1:1
    IG_FEED_PORTRAIT = "ig_portrait" # 4:5
    IG_FEED_LANDSCAPE = "ig_landscape" # 1.91:1
    
    # WhatsApp
    WA_STATUS = "wa_status"         # 9:16 (same as IG Story)
    WA_CHAT = "wa_chat"             # Flexible, max 2048px
    
    # General
    CUSTOM = "custom"


@dataclass
class DimensionSpec:
    """Specification for poster dimensions."""
    width: int
    height: int
    aspect_ratio: str
    description: str
    
    @property
    def size(self) -> Tuple[int, int]:
        return (self.width, self.height)


# Preset dimensions mapping
PRESET_DIMENSIONS = {
    PlatformPresets.IG_STORY: DimensionSpec(
        width=1080, height=1920, 
        aspect_ratio="9:16",
        description="Instagram Story / Reels"
    ),
    PlatformPresets.IG_FEED_SQUARE: DimensionSpec(
        width=1080, height=1080,
        aspect_ratio="1:1",
        description="Instagram Feed (Square)"
    ),
    PlatformPresets.IG_FEED_PORTRAIT: DimensionSpec(
        width=1080, height=1350,
        aspect_ratio="4:5",
        description="Instagram Feed (Portrait)"
    ),
    PlatformPresets.IG_FEED_LANDSCAPE: DimensionSpec(
        width=1080, height=566,
        aspect_ratio="1.91:1",
        description="Instagram Feed (Landscape)"
    ),
    PlatformPresets.WA_STATUS: DimensionSpec(
        width=1080, height=1920,
        aspect_ratio="9:16",
        description="WhatsApp Status"
    ),
    PlatformPresets.WA_CHAT: DimensionSpec(
        width=2048, height=2048,
        aspect_ratio="flexible",
        description="WhatsApp Chat (max size)"
    ),
}


def get_dimensions(
    preset: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None
) -> Tuple[int, int]:
    """
    Get poster dimensions from preset or custom values.
    
    Args:
        preset: Platform preset name (e.g., "ig_story", "wa_status")
        width: Custom width (used with CUSTOM preset)
        height: Custom height (used with CUSTOM preset)
        
    Returns:
        Tuple of (width, height)
        
    Examples:
        >>> get_dimensions(preset="ig_story")
        (1080, 1920)
        >>> get_dimensions(width=2160, height=3840)
        (2160, 3840)
    """
    if preset:
        # Try to match preset name
        preset_lower = preset.lower().replace("-", "_").replace(" ", "_")
        
        for p, spec in PRESET_DIMENSIONS.items():
            if p.value == preset_lower:
                return spec.size
        
        # Try parsing "WxH" format
        if "x" in preset_lower:
            try:
                w, h = preset_lower.split("x")
                return (int(w), int(h))
            except ValueError:
                pass
    
    # Custom dimensions
    if width and height:
        return (width, height)
    
    # Default to IG Story
    return PRESET_DIMENSIONS[PlatformPresets.IG_STORY].size


def get_preset_options() -> list:
    """Get list of available preset options for user selection."""
    return [
        {
            "id": spec.value,
            "name": dim.description,
            "dimensions": f"{dim.width}x{dim.height}",
            "aspect_ratio": dim.aspect_ratio
        }
        for spec, dim in PRESET_DIMENSIONS.items()
        if spec != PlatformPresets.CUSTOM
    ]


def parse_dimension_string(dim_str: str) -> Optional[Tuple[int, int]]:
    """
    Parse dimension string like "1080x1920" or "2160 x 3840".
    
    Args:
        dim_str: Dimension string in WxH format
        
    Returns:
        Tuple of (width, height) or None if parsing fails
    """
    import re
    
    # Match patterns like "1080x1920", "1080 x 1920", "1080×1920"
    match = re.match(r'(\d+)\s*[x×]\s*(\d+)', dim_str.strip(), re.IGNORECASE)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    
    return None
