<?php

namespace App\Event;

final class OrderEvents
{
    public const PLACED = OrderPlacedEvent::class;
    public const CANCELLED = 'order.cancelled';
    public const NOT_AN_EVENT = 42;
}
