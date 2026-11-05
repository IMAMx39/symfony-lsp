<?php

namespace App\Service;

interface MailerAware
{
    public function setMailer(Mailer $mailer): void;
}
