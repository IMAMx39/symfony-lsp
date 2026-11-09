<?php

namespace App\EventListener;

use App\Event\OrderPlacedEvent;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;

#[AsEventListener]
final class InvokableListener
{
    public function __invoke(OrderPlacedEvent $event): void
    {
    }
}
