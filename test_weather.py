import sys
sys.path.append('d:/SkyGuard-AI')
import asyncio, httpx, json
from backend.app.services.weather_service import weather_service

async def main():
    async with httpx.AsyncClient() as client:
        await weather_service._sync_fleet(client)
    # Convert sets or other non-serializable objects if any, though live_state is usually a dict
    def default_serializer(obj):
        return str(obj)
    print(json.dumps(weather_service.live_state, indent=2, default=default_serializer))

asyncio.run(main())
