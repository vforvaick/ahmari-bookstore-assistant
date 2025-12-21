"""
BookResearcher - Web research module for finding book information.

Uses Google Custom Search API to find book details from the web
when no FGB raw material is available.
"""

import os
import re
import httpx
import logging
from typing import Optional, List
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class BookSearchResult(BaseModel):
    """A single book search result from the web."""
    title: str
    author: Optional[str] = None
    publisher: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    source_url: str
    snippet: Optional[str] = None  # Search result snippet


class BookResearcher:
    """
    Web research client for finding book information.
    
    Uses Google Custom Search API to search for books and extract
    relevant information for promotional material creation.
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        search_engine_id: Optional[str] = None
    ):
        """
        Initialize the researcher.
        
        Args:
            api_key: Google Custom Search API key. Defaults to GOOGLE_SEARCH_API_KEY env var.
            search_engine_id: Custom Search Engine ID. Defaults to GOOGLE_SEARCH_CX env var.
        """
        self.api_key = api_key or os.getenv('GOOGLE_SEARCH_API_KEY')
        self.search_engine_id = search_engine_id or os.getenv('GOOGLE_SEARCH_CX')
        self.base_url = "https://www.googleapis.com/customsearch/v1"
        
        if not self.api_key:
            logger.warning("GOOGLE_SEARCH_API_KEY not set - book research will fail")
        if not self.search_engine_id:
            logger.warning("GOOGLE_SEARCH_CX not set - book research will fail")
    
    def _clean_title(self, raw_title: str) -> str:
        """Extract clean book title from search result title.
        
        Handles formats like:
        - "Alley Cat Rally: Trickartt, Ricky" -> "Alley Cat Rally"
        - "Alley Cat Rally: 1 : Ricky Trickartt, Ricky Trickartt: Amazon.co.uk: Books" -> "Alley Cat Rally"
        - "Alley Cat Rally – Ricky Trickartt – The Klaus Flugge Prize" -> "Alley Cat Rally"
        - "Alley Cat Rally by Ricky Trickartt" -> "Alley Cat Rally"
        - "Ricky Trickartt on Alley Cat Rally" -> "Alley Cat Rally" (interview)
        - "Alley Cat Rally is a children's picture book by..." -> "Alley Cat Rally"
        """
        title = raw_title.strip()
        
        # Step 0: Remove Amazon suffix first (colon-based)
        # "Alley Cat Rally: 1 : Ricky Trickartt, Ricky Trickartt: Amazon.co.uk: Books"
        amazon_patterns = [
            r':?\s*Amazon\.co\.uk:?\s*:?\s*Books?\s*$',
            r':?\s*Amazon\.com:?\s*:?\s*Books?\s*$',
            r':?\s*Amazon\.[a-z.]+.*$',
        ]
        for pattern in amazon_patterns:
            title = re.sub(pattern, '', title, flags=re.IGNORECASE)
        
        # Step 1: Handle "Author on Title" format (interview)
        on_match = re.match(r'^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+on\s+(.+)$', title)
        if on_match:
            title = on_match.group(2)
        
        # Step 2: Remove "is a children's picture book" and similar descriptors
        descriptor_patterns = [
            r'\s+is\s+a\s+children\'?s?\s+(?:picture\s+)?book.*$',
            r'\s+is\s+a\s+(?:picture\s+)?book.*$',
        ]
        for pattern in descriptor_patterns:
            title = re.sub(pattern, '', title, flags=re.IGNORECASE)
        
        # Step 3: Remove site name suffixes (dash/pipe based)
        site_patterns = [
            r'\s*[-|–]\s*Amazon\.com.*$',
            r'\s*[-|–]\s*Amazon\.co\.uk.*$',
            r'\s*[-|–]\s*Goodreads.*$',
            r'\s*[-|–]\s*Barnes\s*[&\+]\s*Noble.*$',
            r'\s*[-|–]\s*Google Books.*$',
            r'\s*[-|–]\s*Waterstones.*$',
            r'\s*[-|–]\s*Book Depository.*$',
            r'\s*[-|–]\s*The\s+\w+\s+Prize.*$',
            r'\s*[-|–]\s*\w+\s+Prize.*$',
            r'\s*\|\s*Official.*$',
        ]
        for pattern in site_patterns:
            title = re.sub(pattern, '', title, flags=re.IGNORECASE)
        
        # Step 4: Remove volume numbers like ": 1 :" or ": Vol 1"
        title = re.sub(r':\s*\d+\s*:', ':', title)
        title = re.sub(r':\s*(?:Vol\.?\s*)?\d+\s*$', '', title, flags=re.IGNORECASE)
        
        # Step 5: Handle "Title: Author, Author" or "Title : Author" patterns
        # Look for ": Firstname, Firstname" or ": Firstname Lastname, Firstname Lastname"
        author_colon = re.match(r'^(.+?):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z][a-z]+)', title)
        if author_colon:
            title = author_colon.group(1)
        
        # Step 6: Try "by Author" pattern
        by_match = re.match(r'^(.+?)\s+by\s+[A-Z]', title, re.IGNORECASE)
        if by_match:
            title = by_match.group(1)
        
        # Step 7: Handle multiple dashes/pipes - take first segment if it's a real title
        dash_parts = re.split(r'\s*[-–|]\s*', title)
        if len(dash_parts) > 1:
            first = dash_parts[0].strip()
            words = first.split()
            if len(words) >= 2:
                # Not just "Firstname Lastname"
                is_author_name = (
                    len(words) == 2 and 
                    all(w[0].isupper() and len(w) > 1 and w[1:].islower() for w in words if w)
                )
                if not is_author_name:
                    title = first
        
        # Step 8: Final cleanup
        title = re.sub(r'[\s:|\-–]+$', '', title)  # trailing punctuation
        title = re.sub(r'^[\s:|\-–]+', '', title)  # leading punctuation
        
        return title.strip()
    
    def _normalize_for_dedup(self, title: str) -> str:
        """Normalize title for deduplication comparison."""
        # Lowercase, remove all non-alphanumeric
        return re.sub(r'[^a-z0-9]', '', title.lower())
    
    def _extract_publisher_from_url(self, url: str) -> Optional[str]:
        """Extract publisher name from source URL domain."""
        publisher_domains = {
            'flyingeyebooks.com': 'Flying Eye Books',
            'wideeyededitions.com': 'Wide Eyed Editions',
            'bigpicturepress.net': 'Big Picture Press',
            'nosycrow.com': 'Nosy Crow',
            'walker.co.uk': 'Walker Books',
            'walkerbooks.com': 'Walker Books',
            'templar.co.uk': 'Templar Publishing',
            'usborne.com': 'Usborne',
            'dk.com': 'DK Publishing',
            'scholastic.com': 'Scholastic',
            'britannica.com': 'Britannica',
            'phaidon.com': 'Phaidon',
            'chroniclebooks.com': 'Chronicle Books',
            'candlewick.com': 'Candlewick Press',
            'quartoknows.com': 'Quarto',
            'harpercollins.com': 'HarperCollins',
            'simonandschuster.com': 'Simon & Schuster',
            'bloomsbury.com': 'Bloomsbury',
        }
        
        url_lower = url.lower()
        for domain, publisher in publisher_domains.items():
            if domain in url_lower:
                return publisher
        
        return None
    
    def get_display_title(self, result: 'BookSearchResult') -> str:
        """Get formatted display title: 'Book Title | Publisher: X'"""
        title = result.title
        
        # Try to get publisher from URL first, then from extracted publisher
        publisher = self._extract_publisher_from_url(result.source_url)
        if not publisher:
            publisher = result.publisher
        
        if publisher:
            return f"{title} | Publisher: {publisher}"
        else:
            return title
    
    def _extract_author(self, snippet: str, title: str) -> Optional[str]:
        """Try to extract author name from snippet."""
        # Common patterns: "by Author Name", "Author: Name"
        patterns = [
            r'by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})',
            r'Author:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, snippet)
            if match:
                return match.group(1)
        
        return None
    
    def _extract_publisher(self, snippet: str) -> Optional[str]:
        """Try to extract publisher from snippet."""
        # Check for known children's book publishers
        known_publishers = [
            'Usborne', 'DK Publishing', 'Dorling Kindersley', 
            'Britannica', 'National Geographic', 'Scholastic',
            'Penguin', 'HarperCollins', 'Simon & Schuster',
            'Macmillan', 'Hachette', 'Oxford University Press',
            'Candlewick', 'Chronicle Books', 'Phaidon'
        ]
        
        for publisher in known_publishers:
            if publisher.lower() in snippet.lower():
                return publisher
        
        # Try to extract from "Publisher: X" pattern
        match = re.search(r'Publisher:\s*([A-Za-z\s&]+)', snippet)
        if match:
            return match.group(1).strip()
        
        return None
    
    async def search_books(
        self,
        query: str,
        max_results: int = 5
    ) -> List[BookSearchResult]:
        """
        Search for books using Google Custom Search.
        
        Args:
            query: Book title or search query
            max_results: Maximum number of results to return (1-10)
            
        Returns:
            List of BookSearchResult objects
        """
        if not self.api_key or not self.search_engine_id:
            raise ValueError(
                "Google Search API not configured. "
                "Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX environment variables."
            )
        
        # Enhance query for book search
        # If query seems specific (has publisher), trust it more.
        # Otherwise, help it focus on children's books and filter noise.
        base_query = f"{query} children's book"
        
        # Exclude common noise sites
        exclusions = "-site:reddit.com -site:pinterest.com -site:youtube.com -site:quora.com"
        
        search_query = f"{base_query} {exclusions}"
        
        params = {
            'key': self.api_key,
            'cx': self.search_engine_id,
            'q': search_query,
            'num': min(max_results, 10),  # API limit is 10
            'searchType': None,  # Standard web search to find metadatarich pages (amazon, goodreads, publisher sites)
        }
        # Remove None values
        params = {k: v for k, v in params.items() if v is not None}
        
        logger.info(f"Searching for books: '{query}' (enhanced: '{search_query}')")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(self.base_url, params=params)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as e:
            logger.error(f"Google Search API error: {e}")
            raise RuntimeError(f"Book search failed: {e}")
        
        results = []
        items = data.get('items', [])
        
        logger.info(f"Found {len(items)} search results")
        
        for item in items:
            raw_title = item.get('title', '')
            snippet = item.get('snippet', '')
            link = item.get('link', '')
            
            # Try to get image from pagemap
            image_url = None
            pagemap = item.get('pagemap', {})
            
            # Check cse_image first (most reliable)
            cse_images = pagemap.get('cse_image', [])
            if cse_images:
                image_url = cse_images[0].get('src')
            
            # Fallback to cse_thumbnail
            if not image_url:
                thumbnails = pagemap.get('cse_thumbnail', [])
                if thumbnails:
                    image_url = thumbnails[0].get('src')
            
            # Fallback to metatags og:image
            if not image_url:
                metatags = pagemap.get('metatags', [])
                if metatags:
                    image_url = metatags[0].get('og:image')
            
            # Extract publisher from URL (preferred) or snippet (fallback)
            publisher = self._extract_publisher_from_url(link) or self._extract_publisher(snippet)
            
            result = BookSearchResult(
                title=self._clean_title(raw_title),
                author=self._extract_author(snippet, raw_title),
                publisher=publisher,
                description=snippet,
                image_url=image_url,
                source_url=link,
                snippet=snippet
            )
            results.append(result)
            
            logger.debug(f"Result: {result.title} | Image: {bool(image_url)}")
        
        # Deduplicate by normalized title (keep first with image, or first overall)
        seen_titles = {}
        deduped = []
        for result in results:
            key = self._normalize_for_dedup(result.title)
            if key not in seen_titles:
                seen_titles[key] = result
                deduped.append(result)
            elif result.image_url and not seen_titles[key].image_url:
                # Replace with this one since it has an image
                idx = deduped.index(seen_titles[key])
                deduped[idx] = result
                seen_titles[key] = result
        
        logger.info(f"Deduplicated {len(results)} results to {len(deduped)} unique titles")
        return deduped
    
    async def download_image(
        self,
        image_url: str,
        save_dir: str = './media'
    ) -> Optional[str]:
        """
        Download an image from URL and save locally.
        
        Args:
            image_url: URL of the image to download
            save_dir: Directory to save the image
            
        Returns:
            Local file path if successful, None otherwise
        """
        if not image_url:
            return None
        
        try:
            # Ensure save directory exists
            os.makedirs(save_dir, exist_ok=True)
            
            # Generate filename from URL or timestamp
            import time
            import hashlib
            
            # Create a hash-based filename
            url_hash = hashlib.md5(image_url.encode()).hexdigest()[:12]
            timestamp = int(time.time())
            
            # Determine extension from URL
            ext = 'jpg'  # Default
            if '.png' in image_url.lower():
                ext = 'png'
            elif '.webp' in image_url.lower():
                ext = 'webp'
            
            filename = f"research_{timestamp}_{url_hash}.{ext}"
            filepath = os.path.join(save_dir, filename)
            
            logger.info(f"Downloading image: {image_url[:80]}...")
            
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(image_url)
                response.raise_for_status()
                
                with open(filepath, 'wb') as f:
                    f.write(response.content)
            
            logger.info(f"Image saved: {filepath}")
            return filepath
            
        except Exception as e:
            logger.error(f"Failed to download image: {e}")
            return None
    
    async def search_preview_links(
        self,
        book_title: str,
        max_links: int = 3
    ) -> List[str]:
        """
        Search for valid preview links for a book.
        
        Args:
            book_title: Book title to search for
            max_links: Maximum number of valid links to return
            
        Returns:
            List of validated URLs (only those returning 200 status)
        """
        if not self.api_key or not self.search_engine_id:
            raise ValueError("Google Search API not configured.")
        
        # Search query optimized for preview/read links
        search_query = f"{book_title} preview read online book"
        
        params = {
            'key': self.api_key,
            'cx': self.search_engine_id,
            'q': search_query,
            'num': 10,  # Get more results to filter valid ones
        }
        
        logger.info(f"Searching preview links for: '{book_title}'")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(self.base_url, params=params)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as e:
            logger.error(f"Google Search API error: {e}")
            raise RuntimeError(f"Link search failed: {e}")
        
        items = data.get('items', [])
        logger.info(f"Found {len(items)} search results, validating links...")
        
        valid_links = []
        
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            for item in items:
                if len(valid_links) >= max_links:
                    break
                
                link = item.get('link', '')
                if not link:
                    continue
                
                # Skip certain domains that are not useful for preview
                skip_domains = ['pinterest.', 'facebook.', 'twitter.', 'instagram.', 'youtube.', 'reddit.']
                if any(d in link.lower() for d in skip_domains):
                    continue
                
                # Validate link with HEAD request
                try:
                    head_response = await client.head(link)
                    if head_response.status_code == 200:
                        valid_links.append(link)
                        logger.info(f"Valid link: {link[:60]}...")
                    else:
                        logger.debug(f"Invalid link (status {head_response.status_code}): {link[:60]}...")
                except Exception as e:
                    logger.debug(f"Link validation failed: {link[:60]}... - {e}")
                    continue
        
        logger.info(f"Returning {len(valid_links)} valid preview links")
        return valid_links
    
    async def search_images(
        self,
        query: str,
        max_images: int = 5
    ) -> List[dict]:
        """
        Search for book cover images using Google Image Search.
        
        Args:
            query: Book title to search images for
            max_images: Maximum number of images to return
            
        Returns:
            List of dicts with image info: {url, width, height, source}
        """
        if not self.api_key or not self.search_engine_id:
            raise ValueError("Google Search API not configured.")
        
        # Search for book cover images
        search_query = f"{query} book cover"
        
        params = {
            'key': self.api_key,
            'cx': self.search_engine_id,
            'q': search_query,
            'num': min(max_images + 5, 10),  # Get extra to filter
            'searchType': 'image',  # Image search!
            'imgType': 'photo',
            'imgSize': 'large',
        }
        
        logger.info(f"Searching images for: '{query}'")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(self.base_url, params=params)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as e:
            logger.error(f"Google Image Search API error: {e}")
            raise RuntimeError(f"Image search failed: {e}")
        
        images = []
        items = data.get('items', [])
        
        logger.info(f"Found {len(items)} image results")
        
        for item in items:
            if len(images) >= max_images:
                break
            
            image_info = item.get('image', {})
            link = item.get('link', '')
            
            # Skip very small images
            width = image_info.get('width', 0)
            height = image_info.get('height', 0)
            if width < 200 or height < 200:
                continue
            
            images.append({
                'url': link,
                'width': width,
                'height': height,
                'thumbnail': image_info.get('thumbnailLink', ''),
                'source': item.get('displayLink', '')
            })
        
        logger.info(f"Returning {len(images)} valid images")
        return images
    
    async def enrich_description(
        self,
        book_title: str,
        current_description: str = "",
        max_sources: int = 3
    ) -> dict:
        """
        Enrich book description by aggregating snippets from multiple sources.
        
        Args:
            book_title: Book title to search for
            current_description: Existing description to include
            max_sources: Number of additional sources to aggregate
            
        Returns:
            Dict with enriched_description and sources_count
        """
        if not self.api_key or not self.search_engine_id:
            raise ValueError("Google Search API not configured.")
        
        # Search for detailed book information
        search_query = f"{book_title} book description synopsis review"
        
        params = {
            'key': self.api_key,
            'cx': self.search_engine_id,
            'q': search_query,
            'num': max_sources + 2,  # Get a few extra
        }
        
        logger.info(f"Enriching description for: '{book_title}'")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(self.base_url, params=params)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as e:
            logger.error(f"Google Search API error: {e}")
            raise RuntimeError(f"Enrichment search failed: {e}")
        
        items = data.get('items', [])
        logger.info(f"Found {len(items)} sources for enrichment")
        
        # Collect unique snippets
        snippets = []
        if current_description:
            snippets.append(current_description)
        
        seen_content = set()
        for item in items[:max_sources]:
            snippet = item.get('snippet', '')
            # Normalize for deduplication
            normalized = ' '.join(snippet.lower().split())
            
            # Skip if too similar to existing
            if normalized in seen_content or len(snippet) < 50:
                continue
            
            seen_content.add(normalized)
            snippets.append(snippet)
        
        # Combine snippets into enriched description
        enriched = '\n\n'.join(snippets)
        
        logger.info(f"Enriched with {len(snippets)} unique sources, length: {len(enriched)}")
        
        return {
            "description": enriched,
            "sources_count": len(snippets)
        }


# Simple test
if __name__ == "__main__":
    import asyncio
    
    async def test():
        researcher = BookResearcher()
        try:
            results = await researcher.search_books("Usborne Look Inside")
            for i, r in enumerate(results):
                print(f"{i+1}. {r.title}")
                print(f"   Author: {r.author}")
                print(f"   Publisher: {r.publisher}")
                print(f"   Image: {bool(r.image_url)}")
                print()
        except Exception as e:
            print(f"Error: {e}")
    
    asyncio.run(test())

