<?php

namespace App\MessageHandler;

use App\Message;
use Symfony\Component\Messenger\Attribute as Messenger;

final class OrderHandlers
{
    #[Messenger\AsMessageHandler(priority: 10)]
    public function onCancel(Message\CancelOrder $message): void
    {
    }

    #[Messenger\AsMessageHandler]
    public function onAnyOrder(?Message\OrderMessage $message): void
    {
    }

    #[Messenger\AsMessageHandler(bus: 'command.bus')]
    public function onUnion(Message\CreateOrder|Message\CancelOrder $message): void
    {
    }

    public function notAHandler(Message\Unhandled $message): void
    {
    }
}
