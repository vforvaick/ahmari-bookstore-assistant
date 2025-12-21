"""
LayoutEngine - Grid calculation for poster layouts.

Handles:
1. Grid calculation based on cover count
2. Equal spacing and sizing
3. Title area reservation
4. Support for custom row configurations
"""

import math
from typing import List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class LayoutSpec:
    """Specification for a single cover's position in the layout."""
    index: int
    x: int              # Left position
    y: int              # Top position
    width: int          # Cover width
    height: int         # Cover height
    row: int            # Which row (0-indexed)
    col: int            # Which column (0-indexed)


@dataclass
class GridLayout:
    """Complete grid layout specification."""
    canvas_width: int
    canvas_height: int
    title_height: int
    cover_specs: List[LayoutSpec]
    cover_width: int
    cover_height: int
    padding: int
    rows: int
    cols_per_row: List[int]  # Number of columns in each row


class LayoutEngine:
    """
    Calculates optimal grid layouts for poster generation.
    
    Features:
    - Auto-calculates optimal grid configuration
    - Supports uneven rows (e.g., 7-6-6 for 19 covers)
    - Reserves space for title
    - Maintains aspect ratio of covers
    """
    
    DEFAULT_COVER_ASPECT = 1.0  # Square covers by default
    
    def __init__(
        self,
        padding: int = 20,
        title_height_ratio: float = 0.12,  # 12% of height for title
        cover_aspect_ratio: float = 1.0,
    ):
        """
        Initialize layout engine.
        
        Args:
            padding: Padding between covers in pixels
            title_height_ratio: Ratio of canvas height for title area
            cover_aspect_ratio: Width/Height ratio of covers (1.0 = square)
        """
        self.padding = padding
        self.title_height_ratio = title_height_ratio
        self.cover_aspect_ratio = cover_aspect_ratio
    
    def calculate_grid_config(
        self,
        cover_count: int,
        canvas_width: int,
        canvas_height: int,
        custom_rows: Optional[List[int]] = None
    ) -> Tuple[int, List[int]]:
        """
        Calculate optimal grid configuration.
        
        Args:
            cover_count: Number of covers to place
            canvas_width: Canvas width in pixels
            canvas_height: Canvas height in pixels
            custom_rows: Optional custom row configuration (e.g., [7, 6, 6])
            
        Returns:
            Tuple of (num_rows, cols_per_row list)
        """
        if custom_rows:
            # Validate custom config
            if sum(custom_rows) != cover_count:
                raise ValueError(f"Custom rows sum ({sum(custom_rows)}) != cover count ({cover_count})")
            return len(custom_rows), custom_rows
        
        # Calculate optimal grid based on canvas aspect ratio
        canvas_aspect = canvas_width / canvas_height
        
        # For vertical posters (IG Story), prefer more rows
        # For square/horizontal, prefer more columns
        
        if cover_count <= 4:
            # Small grids
            if cover_count == 1:
                return 1, [1]
            elif cover_count == 2:
                return 1, [2] if canvas_aspect >= 1.5 else [1, 1]
            elif cover_count == 3:
                return 1, [3] if canvas_aspect >= 2 else [3]  # 1 row of 3
            elif cover_count == 4:
                return 2, [2, 2]
        
        # For larger counts, calculate based on aspect ratio
        # Try to make covers square-ish in the available space
        
        # Account for title area
        usable_height = canvas_height * (1 - self.title_height_ratio)
        usable_area = canvas_width * usable_height
        
        # Estimate cover size for different row counts
        best_config = None
        best_cover_size = 0
        
        for num_rows in range(1, cover_count + 1):
            # Distribute covers evenly across rows
            base_cols = cover_count // num_rows
            extra = cover_count % num_rows
            
            cols_per_row = []
            remaining = cover_count
            for r in range(num_rows):
                if extra > 0:
                    cols_per_row.append(base_cols + 1)
                    extra -= 1
                    remaining -= base_cols + 1
                else:
                    cols_per_row.append(min(base_cols, remaining))
                    remaining -= base_cols
            
            # Filter out empty rows
            cols_per_row = [c for c in cols_per_row if c > 0]
            actual_rows = len(cols_per_row)
            
            if actual_rows == 0:
                continue
            
            max_cols = max(cols_per_row)
            
            # Calculate cover size with this config
            available_width = canvas_width - (max_cols + 1) * self.padding
            available_height = usable_height - (actual_rows + 1) * self.padding
            
            cover_width = available_width / max_cols
            cover_height = available_height / actual_rows
            
            # Constrain by aspect ratio
            if self.cover_aspect_ratio:
                if cover_width / cover_height > self.cover_aspect_ratio:
                    cover_width = cover_height * self.cover_aspect_ratio
                else:
                    cover_height = cover_width / self.cover_aspect_ratio
            
            cover_size = cover_width * cover_height
            
            if cover_size > best_cover_size:
                best_cover_size = cover_size
                best_config = (actual_rows, cols_per_row)
        
        return best_config or (1, [cover_count])
    
    def calculate_layout(
        self,
        cover_count: int,
        canvas_width: int,
        canvas_height: int,
        custom_rows: Optional[List[int]] = None,
        include_title: bool = True
    ) -> GridLayout:
        """
        Calculate complete grid layout.
        
        Args:
            cover_count: Number of covers
            canvas_width: Canvas width
            canvas_height: Canvas height
            custom_rows: Optional custom row configuration
            include_title: Whether to reserve space for title
            
        Returns:
            GridLayout with all positioning information
        """
        # Get grid configuration
        num_rows, cols_per_row = self.calculate_grid_config(
            cover_count, canvas_width, canvas_height, custom_rows
        )
        
        # Calculate title area
        title_height = int(canvas_height * self.title_height_ratio) if include_title else 0
        
        # Calculate available space for covers
        usable_height = canvas_height - title_height
        
        max_cols = max(cols_per_row)
        
        # Calculate cover size
        available_width = canvas_width - (max_cols + 1) * self.padding
        available_height = usable_height - (num_rows + 1) * self.padding
        
        cover_width = int(available_width / max_cols)
        cover_height = int(available_height / num_rows)
        
        # Apply aspect ratio constraint
        if self.cover_aspect_ratio:
            if cover_width / cover_height > self.cover_aspect_ratio:
                cover_width = int(cover_height * self.cover_aspect_ratio)
            else:
                cover_height = int(cover_width / self.cover_aspect_ratio)
        
        # Calculate positions for each cover
        cover_specs = []
        cover_index = 0
        
        for row_idx, cols_in_row in enumerate(cols_per_row):
            # Center this row horizontally
            row_width = cols_in_row * cover_width + (cols_in_row - 1) * self.padding
            row_start_x = (canvas_width - row_width) // 2
            
            # Calculate Y position
            y = title_height + self.padding + row_idx * (cover_height + self.padding)
            
            for col_idx in range(cols_in_row):
                x = row_start_x + col_idx * (cover_width + self.padding)
                
                spec = LayoutSpec(
                    index=cover_index,
                    x=x,
                    y=y,
                    width=cover_width,
                    height=cover_height,
                    row=row_idx,
                    col=col_idx
                )
                cover_specs.append(spec)
                cover_index += 1
        
        return GridLayout(
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            title_height=title_height,
            cover_specs=cover_specs,
            cover_width=cover_width,
            cover_height=cover_height,
            padding=self.padding,
            rows=num_rows,
            cols_per_row=cols_per_row
        )
    
    def parse_layout_instruction(self, instruction: str, cover_count: int) -> Optional[List[int]]:
        """
        Parse layout instruction from user prompt.
        
        Examples:
            "3x3 grid" -> [3, 3, 3]
            "7-6-6" -> [7, 6, 6]
            "2 rows" -> calculated evenly
            
        Args:
            instruction: User's layout instruction
            cover_count: Total number of covers
            
        Returns:
            List of columns per row, or None for auto
        """
        import re
        
        instruction = instruction.lower().strip()
        
        # Match "NxM" grid pattern
        grid_match = re.match(r'(\d+)\s*[x×]\s*(\d+)\s*(grid)?', instruction)
        if grid_match:
            cols = int(grid_match.group(1))
            rows = int(grid_match.group(2))
            if cols * rows == cover_count:
                return [cols] * rows
        
        # Match "N-N-N" pattern (e.g., "7-6-6")
        dash_match = re.match(r'^[\d\-]+$', instruction.replace(' ', ''))
        if dash_match:
            numbers = [int(n) for n in instruction.replace(' ', '').split('-') if n]
            if sum(numbers) == cover_count:
                return numbers
        
        # Match "N rows" pattern
        rows_match = re.match(r'(\d+)\s*rows?', instruction)
        if rows_match:
            num_rows = int(rows_match.group(1))
            base = cover_count // num_rows
            extra = cover_count % num_rows
            return [base + (1 if i < extra else 0) for i in range(num_rows)]
        
        return None  # Auto-calculate
