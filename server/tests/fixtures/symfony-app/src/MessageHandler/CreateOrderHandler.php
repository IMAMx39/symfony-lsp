<?php

namespace App\MessageHandler;

use App\Message\CreateOrder;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
final class CreateOrderHandler
{
    public function __invoke(CreateOrder $message): void
    {
    }
}
