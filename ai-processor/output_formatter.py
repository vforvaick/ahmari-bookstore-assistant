"""
OutputFormatter - Rule-based WhatsApp broadcast formatter.

Handles precise formatting that should NOT rely on AI:
- Price markup (+20.000 by default, configurable)
- Template structure
- Link cleanup (Instagram share IDs, etc.)
"""

import os
import re
from typing import Optional, List
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode


class OutputFormatter:
    """
    Rule-based WhatsApp broadcast formatter.
    
    Output Format:
    *Title Here* | Publisher: Publisher Name
    
    PO Close [Date] | ETA [Month Year]
    [Format] | Rp [Price + markup]
    
    [AI-generated review paragraph]
    
    Preview:
    - [link1]
    - [link2]
    """
    
    def __init__(self, price_markup: Optional[int] = None):
        """
        Initialize formatter.
        
        Args:
            price_markup: Price markup in IDR. Defaults to PRICE_MARKUP env var or 20000.
        """
        if price_markup is not None:
            self.price_markup = price_markup
        else:
            self.price_markup = int(os.getenv('PRICE_MARKUP', '20000'))
    
    def format_price(self, price: int) -> str:
        """Format price with markup and Indonesian format (dots as thousand separators)."""
        final_price = price + self.price_markup
        # Format with dots: 175000 -> 175.000
        return f"Rp {final_price:,}".replace(',', '.')
    
    def cleanup_instagram_link(self, url: str) -> str:
        """
        Remove Instagram share parameters from URL.
        
        Example:
            https://www.instagram.com/p/CgbLiwoMR0z/?igshid=abc123
            -> https://www.instagram.com/p/CgbLiwoMR0z
        """
        if 'instagram.com' not in url:
            return url
        
        # Parse URL
        parsed = urlparse(url)
        
        # Remove query parameters
        cleaned = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip('/'),  # Also remove trailing slash
            '',  # params
            '',  # query - remove all
            ''   # fragment
        ))
        
        return cleaned
    
    def cleanup_youtube_link(self, url: str) -> str:
        """
        Clean up YouTube share links.
        
        Removes tracking parameters like si=...
        """
        if 'youtube.com' not in url and 'youtu.be' not in url:
            return url
        
        parsed = urlparse(url)
        
        # For youtu.be short links, keep only the video ID
        if 'youtu.be' in url:
            # Keep everything before ? or just the path
            cleaned = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                '',
                '',  # Remove query params
                ''
            ))
            return cleaned
        
        # For youtube.com, keep only 'v' parameter
        if 'youtube.com' in url:
            query_params = parse_qs(parsed.query)
            if 'v' in query_params:
                new_query = urlencode({'v': query_params['v'][0]})
                cleaned = urlunparse((
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path,
                    '',
                    new_query,
                    ''
                ))
                return cleaned
        
        return url
    
    def format_preview_links(self, links: List[str]) -> str:
        """
        Format preview links as bullet points with cleanup.
        
        Returns:
            Formatted string with bullet points.
        """
        if not links:
            return ""
        
        cleaned_links = []
        for link in links:
            # Clean up links
            link = self.cleanup_instagram_link(link)
            link = self.cleanup_youtube_link(link)
            # Remove markdown artifacts (escaped underscores, etc.)
            link = link.replace('\\', '')
            cleaned_links.append(f"- {link}")
        
        return "\n".join(cleaned_links)
    
    def format_title_line(self, title: str, publisher: Optional[str] = None) -> str:
        """
        Format title line with publisher.
        
        Returns:
            *Title Here* | Publisher: Publisher Name
            or just *Title Here* if no publisher
        """
        # Clean up title (remove extra asterisks, clean whitespace)
        title = title.strip().strip('*')
        
        if publisher:
            return f"*{title}* | Publisher: {publisher}"
        else:
            return f"*{title}*"
    
    def format_date_line(self, close_date: Optional[str], eta: Optional[str]) -> str:
        """
        Format PO Close and ETA line.
        
        Returns:
            PO Close 20 Dec | ETA Apr '26
        """
        parts = []
        
        if close_date:
            parts.append(f"PO Close {close_date}")
        
        if eta:
            parts.append(f"ETA {eta}")
        
        return " | ".join(parts) if parts else ""
    
    def format_price_line(self, format_type: Optional[str], price_main: Optional[int], 
                          price_secondary: Optional[int] = None) -> str:
        """
        Format book format and price line.
        
        Returns:
            HB | Rp 175.000
            or HB Rp 175.000 / PB Rp 145.000 for dual pricing
        """
        if not price_main:
            return ""
        
        if price_secondary:
            # Dual pricing (HB and PB)
            hb_price = self.format_price(price_main)
            pb_price = self.format_price(price_secondary)
            return f"HB {hb_price} / PB {pb_price}"
        else:
            # Single format
            format_str = format_type or ""
            price_str = self.format_price(price_main)
            
            if format_str:
                return f"{format_str} | {price_str}"
            else:
                return price_str
    
    def format_broadcast(
        self, 
        parsed_data,  # ParsedBroadcast
        review_paragraph: str,
        publisher_override: Optional[str] = None,
        level: int = 1
    ) -> str:
        """
        Combine parsed data + AI review into final WhatsApp message.
        
        Args:
            parsed_data: ParsedBroadcast object with extracted fields
            review_paragraph: AI-generated review paragraph
            publisher_override: Override publisher (e.g., from AI guess)
            level: Recommendation level (1=Standard, 2=Recommended, 3=Top Pick)
            
        Returns:
            Formatted WhatsApp broadcast message
        """
        lines = []
        
        # 1. Title Line
        publisher = publisher_override or parsed_data.publisher
        title_line = self.format_title_line(parsed_data.title or "Untitled", publisher)
        lines.append(title_line)
        
        # 1b. Top Pick marker for level 3
        if level == 3:
            lines.append("⭐ Top Pick Ahmari Bookstore")
        
        lines.append("")  # Blank line
        
        # 2. Date Line
        date_line = self.format_date_line(parsed_data.close_date, parsed_data.eta)
        if date_line:
            lines.append(date_line)
        
        # 3. Price Line  
        price_line = self.format_price_line(
            parsed_data.format, 
            parsed_data.price_main,
            parsed_data.price_secondary
        )
        if price_line:
            lines.append(price_line)
        
        lines.append("")  # Blank line
        
        # 4. Review Paragraph (from AI)
        if review_paragraph:
            lines.append(review_paragraph.strip())
        
        lines.append("")  # Blank line
        
        # 5. Preview Links
        if parsed_data.preview_links:
            lines.append("Preview:")
            links_formatted = self.format_preview_links(parsed_data.preview_links)
            lines.append(links_formatted)
        
        return "\n".join(lines)


# Quick test
if __name__ == "__main__":
    formatter = OutputFormatter(price_markup=20000)
    
    # Test price formatting
    print("Price test:", formatter.format_price(155000))  # Should be Rp 175.000
    
    # Test link cleanup
    ig_link = "https://www.instagram.com/p/CgbLiwoMR0z/?igshid=NTc4MTIwNjQ2YQ=="
    print("IG cleanup:", formatter.cleanup_instagram_link(ig_link))
    
    yt_link = "https://youtu.be/p3_l5ZWjpwg?si=26e6lBZ_T7BgsyCC"
    print("YT cleanup:", formatter.cleanup_youtube_link(yt_link))
