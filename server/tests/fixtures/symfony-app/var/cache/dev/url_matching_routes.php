<?php

/**
 * This file has been auto-generated
 * by the Symfony Routing Component.
 */

return [
    false, // $matchHost
    [ // $staticRoutes
        '/_acme/ping' => [[['_route' => 'acme_ping', '_controller' => 'Acme\\FooBundle\\Controller\\PingController::ping'], null, ['GET' => 0, 'HEAD' => 1], null, false, false, null]],
        '/' => [[['_route' => 'app_home', '_controller' => 'App\\Controller\\HomeController::index'], null, null, null, false, false, null]],
    ],
    [ // $regexpList
        0 => '{^(?|/_(?|wdt/([^/]++)(*:24)|profiler/([^/]++)(*:50))|/blog/([a-z\\-]+)(*:75))/?$}sDu',
    ],
    [ // $dynamicRoutes
        24 => [[['_route' => '_wdt', '_controller' => 'web_profiler.controller.profiler::toolbarAction'], ['token'], null, null, false, true, null]],
        50 => [[['_route' => '_profiler', '_controller' => 'web_profiler.controller.profiler::panelAction'], ['token'], null, null, false, true, null]],
        75 => [
            [['_route' => 'blog_show', '_controller' => 'App\\Controller\\BlogController::show'], ['slug'], ['GET' => 0], null, false, true, null],
            [null, null, null, null, false, false, 0],
        ],
    ],
    null, // $checkCondition
];
