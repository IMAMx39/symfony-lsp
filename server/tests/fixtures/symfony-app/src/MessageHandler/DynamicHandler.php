<?php

namespace App\MessageHandler;

use App\Message\Unhandled;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(handles: self::MESSAGE)]
final class DynamicHandler
{
    private const MESSAGE = Unhandled::class;

    public function __invoke(Unhandled $message): void
    {
    }

    #[AsMessageHandler]
    public function untyped($message): void
    {
    }

    #[AsMessageHandler]
    public function intersection(Unhandled&\Countable $message): void
    {
    }
}
