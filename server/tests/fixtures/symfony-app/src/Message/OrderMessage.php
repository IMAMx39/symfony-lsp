<?php

namespace App\Message;

use Acme\FooBundle\Messenger\AuditableMessage;

abstract class OrderMessage implements AuditableMessage
{
    public function __construct(public readonly int $orderId)
    {
    }
}
