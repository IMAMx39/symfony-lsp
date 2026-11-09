<?php

namespace App\EventListener;

use App\Event\OrderPlacedEvent;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

#[AsEventListener]
abstract class AbstractListener
{
    public function __invoke(OrderPlacedEvent $event): void
    {
    }
}

/** onOrderPlaced() may be inherited: the method is unknown. */
#[AsEventListener(event: 'order.placed')]
final class InheritingListener extends \stdClass
{
    public function __invoke(object $event): void
    {
    }
}

/** Event-less listener tags are skipped on a subscriber; a computed array is not read. */
final class DynamicSubscriber implements EventSubscriberInterface
{
    #[AsEventListener]
    public function onPlaced(OrderPlacedEvent $event): void
    {
    }

    public static function getSubscribedEvents(): array
    {
        $events = [OrderPlacedEvent::class => 'onPlaced'];

        return $events;
    }
}
