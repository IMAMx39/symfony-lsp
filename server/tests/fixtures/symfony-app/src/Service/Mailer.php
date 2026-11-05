<?php

namespace App\Service;

use Acme\FooBundle\Mailer\Transport;
use Psr\Log\LoggerInterface;

final class Mailer
{
    public function __construct(
        private readonly string $sender,
        private readonly Transport $transport,
        private readonly LoggerInterface $defaultLogger,
    ) {
    }
}
