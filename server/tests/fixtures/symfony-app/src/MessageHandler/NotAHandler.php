<?php

namespace App\MessageHandler;

use App\Attribute\AsMessageHandler;
use App\Message\Unhandled;

#[AsMessageHandler]
final class NotAHandler
{
    public function __invoke(Unhandled $message): void
    {
    }
}
