<?php

namespace App\MessageHandler;

use App\Message\CancelOrder;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(handles: CancelOrder::class, method: 'process')]
final class ExplicitHandler
{
    public function process(object $message): void
    {
    }
}
