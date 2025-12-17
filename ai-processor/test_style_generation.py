
import asyncio
import os
from gemini_client import GeminiClient
from models import ParsedBroadcast

async def main():
    # Load .env manually
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()

    # Mock data for testing
    parsed_book = ParsedBroadcast(
        title="USBORNE LOOK INSIDE SPACE",
        price_main=185000,
        description_en="A lift-the-flap book about space with over 70 flaps to lift. Children can discover rockets, planets, and galaxies. Great for curious little minds.",
        format="Board Book",
        eta="Akhir November",
        close_date="25 Oktober"
    )
    
    parsed_activity = ParsedBroadcast(
        title="MAISY'S BUSY DAY STICKER BOOK",
        price_main=85000,
        description_en="Join Maisy for a busy day in this sticker book. Includes over 100 stickers. Perfect for travel entertainment.",
        format="Paperback",
        eta="Desember Awal"
    )

    client = GeminiClient()
    
    print("\n--- TEST 1: EDUCATION BOOK ---")
    try:
        result1 = await client.generate_broadcast(parsed_book)
        print(result1)
    except Exception as e:
        print(f"Error: {e}")

    print("\n\n--- TEST 2: ACTIVITY BOOK ---")
    try:
        result2 = await client.generate_broadcast(parsed_activity)
        print(result2)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
