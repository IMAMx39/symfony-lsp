<?php

namespace Acme\FooBundle\Messenger;

final class AuditHandler
{
    public function __invoke(AuditableMessage $message): void
    {
    }

    public function logCancel(object $message): void
    {
    }
}
