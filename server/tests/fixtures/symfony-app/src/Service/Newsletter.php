<?php

namespace App\Service;

class Newsletter
{
    public function __construct(private readonly Mailer $mailer)
    {
    }
}
