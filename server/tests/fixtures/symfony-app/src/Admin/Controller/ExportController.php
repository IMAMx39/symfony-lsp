<?php

namespace App\Admin\Controller;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

/** Invokable, imported by config/routes.yaml with prefix /admin and name_prefix admin_. */
#[Route('/export/{format}', name: 'export', methods: 'POST')]
final class ExportController
{
    public function __invoke(string $format): Response
    {
        return new Response();
    }
}
