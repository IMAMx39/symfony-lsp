<?php

return [
    Symfony\Bundle\FrameworkBundle\FrameworkBundle::class => ['all' => true],
    Symfony\Bundle\TwigBundle\TwigBundle::class => ['all' => true],
    Acme\FooBundle\AcmeFooBundle::class => ['all' => true],
    Acme\LegacyBundle\AcmeLegacyBundle::class => ['dev' => true, 'test' => true],
    Acme\TestOnlyBundle\AcmeTestOnlyBundle::class => ['test' => true],
];
