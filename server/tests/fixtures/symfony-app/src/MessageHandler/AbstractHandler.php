<?php

namespace App\MessageHandler;

use App\Message\Unhandled;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
abstract class AbstractHandler
{
    public function __invoke(Unhandled $message): void
    {
    }
}
