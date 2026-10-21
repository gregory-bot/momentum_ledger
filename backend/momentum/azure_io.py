"""Azure Event Hubs (ingest) and Cosmos DB (ledger + overlay store) adapters.

SDKs are imported lazily so the local demo runs without them installed.
"""

from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Iterable

from .config import Settings
from .models import Event


def publish_events(settings: Settings, events: Iterable[Event], speed: float = 0.0, batch_size: int = 50) -> int:
    """Stream events into Event Hubs. speed=0 sends as fast as possible, otherwise match-time / speed."""
    from azure.eventhub import EventData, EventHubProducerClient

    producer = EventHubProducerClient.from_connection_string(settings.eventhub_connection,
                                                             eventhub_name=settings.eventhub_name)
    sent, prev_t = 0, None
    with producer:
        batch = producer.create_batch(partition_key=None)
        pending = 0
        for e in events:
            if speed and prev_t is not None and e.t > prev_t:
                if pending:
                    producer.send_batch(batch)
                    batch, pending = producer.create_batch(), 0
                time.sleep((e.t - prev_t) / speed)
            prev_t = e.t
            data = EventData(json.dumps(e.to_dict()))
            data.properties = {"match_id": e.match_id, "type": e.type}
            try:
                batch.add(data)
            except ValueError:  # batch full
                producer.send_batch(batch)
                batch = producer.create_batch()
                batch.add(data)
                pending = 0
            pending += 1
            sent += 1
            if pending >= batch_size:
                producer.send_batch(batch)
                batch, pending = producer.create_batch(), 0
        if pending:
            producer.send_batch(batch)
    return sent


async def consume_events(settings: Settings, match_id: str | None = None,
                         consumer_group: str = "$Default") -> AsyncIterator[Event]:
    """Yield events from Event Hubs as they arrive (from the start of the retained stream)."""
    import asyncio

    from azure.eventhub.aio import EventHubConsumerClient

    queue: asyncio.Queue[Event] = asyncio.Queue()
    client = EventHubConsumerClient.from_connection_string(
        settings.eventhub_connection, consumer_group=consumer_group, eventhub_name=settings.eventhub_name)

    async def on_event(partition_context: Any, event: Any) -> None:
        if event is None:
            return
        e = Event.from_dict(json.loads(event.body_as_str()))
        if match_id is None or e.match_id == match_id:
            await queue.put(e)

    task = asyncio.create_task(client.receive(on_event=on_event, starting_position="-1"))
    try:
        while True:
            e = await queue.get()
            yield e
            if e.type == "full_time":
                break
    finally:
        task.cancel()
        await client.close()


class CosmosStore:
    """Containers: `events` (the raw ledger) and `overlays` (verified output), keyed by match_id."""

    def __init__(self, settings: Settings):
        from azure.cosmos import CosmosClient, PartitionKey

        if settings.cosmos_key:
            client = CosmosClient(settings.cosmos_endpoint, credential=settings.cosmos_key)
        else:
            from azure.identity import DefaultAzureCredential

            client = CosmosClient(settings.cosmos_endpoint, credential=DefaultAzureCredential())
        db = client.create_database_if_not_exists(settings.cosmos_database)
        self.events = db.create_container_if_not_exists("events", PartitionKey("/match_id"))
        self.overlays = db.create_container_if_not_exists("overlays", PartitionKey("/match_id"))
        self.meta = db.create_container_if_not_exists("matches", PartitionKey("/match_id"))

    def put_events(self, events: Iterable[Event]) -> None:
        for e in events:
            self.events.upsert_item(e.to_dict())  # id = event id, so redelivery is idempotent

    def load_events(self, match_id: str) -> list[Event]:
        rows = self.events.query_items("SELECT * FROM c WHERE c.match_id = @m ORDER BY c.seq",
                                       parameters=[{"name": "@m", "value": match_id}], partition_key=match_id)
        return [Event.from_dict({k: v for k, v in r.items() if not k.startswith("_")}) for r in rows]

    def put_overlay(self, match_id: str, overlay: dict[str, Any]) -> None:
        self.overlays.upsert_item({**overlay, "match_id": match_id})

    def overlays_since(self, match_id: str, t: float) -> list[dict[str, Any]]:
        rows = self.overlays.query_items(
            "SELECT * FROM c WHERE c.match_id = @m AND c.trigger.t > @t ORDER BY c.trigger.t",
            parameters=[{"name": "@m", "value": match_id}, {"name": "@t", "value": t}], partition_key=match_id)
        return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
