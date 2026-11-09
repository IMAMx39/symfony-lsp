<?php

namespace App\MessageHandler;

use App\Message\Unhandled;

/** Its #[AsMessageHandler] was removed after the last container dump. */
final class StaleHandler
{
    public function __invoke(Unhandled $message): void
    {
    }
}
