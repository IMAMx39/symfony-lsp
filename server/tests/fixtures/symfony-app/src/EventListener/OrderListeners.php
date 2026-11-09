<?php

namespace App\EventListener;

use App\Event\OrderEvents;
use App\Event\OrderPlacedEvent;
use Symfony\Component\EventDispatcher\Attribute as Event;
use Symfony\Component\HttpKernel\Event\RequestEvent;

#[Event\AsEventListener(event: OrderEvents::CANCELLED)]
#[Event\AsEventListener(event: RequestEvent::class, priority: 5)]
final class OrderListeners
{
    #[Event\AsEventListener(priority: 20)]
    public function onPlaced(OrderPlacedEvent|RequestEvent $event): void
    {
    }

    #[Event\AsEventListener('kernel.response')]
    public function onResponse(object $event): void
    {
    }

    #[Event\AsEventListener(event: OrderEvents::CANCELLED . '.late')]
    public function onDynamic(object $event): void
    {
    }

    #[Event\AsEventListener]
    public function onUntyped($event): void
    {
    }

    public function onOrderCancelled(object $event): void
    {
    }

    public function onKernelRequest(RequestEvent $event): void
    {
    }
}
