<?php

namespace App\EventSubscriber;

use App\Event\OrderEvents;
use App\Event\OrderPlacedEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\KernelEvents;

final class OrderSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [
            OrderPlacedEvent::class => 'onPlaced',
            OrderEvents::CANCELLED => ['onCancelled', 10],
            KernelEvents::REQUEST => [['onRequestEarly', 100], ['onRequestLate', -100]],
            'kernel.response' => 'onResponse',
            self::class => 'onSelf',
        ];
    }

    public function onPlaced(OrderPlacedEvent $event): void
    {
    }

    public function onCancelled(object $event): void
    {
    }

    public function onRequestEarly(object $event): void
    {
    }

    public function onRequestLate(object $event): void
    {
    }

    public function onResponse(object $event): void
    {
    }

    public function onSelf(self $event): void
    {
    }
}
