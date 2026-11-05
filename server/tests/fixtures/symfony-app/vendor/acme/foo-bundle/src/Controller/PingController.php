<?php

namespace Acme\FooBundle\Controller;

use Symfony\Component\HttpFoundation\Response;

/** Route declared in the bundle's own routing file: only known through the compiled cache. */
final class PingController
{
    public function ping(): Response
    {
        return new Response('pong');
    }
}
