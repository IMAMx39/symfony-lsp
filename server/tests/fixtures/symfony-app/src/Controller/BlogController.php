<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/blog', name: 'blog_')]
class BlogController extends AbstractController
{
    #[Route('', name: 'index', methods: ['GET'])]
    public function index(): Response
    {
        return $this->render('base.html.twig');
    }

    #[Route('/{slug}', name: 'show', requirements: ['slug' => '[a-z\-]+'])]
    public function show(string $slug): Response
    {
        return $this->redirectToRoute('blog_archive', ['year' => 2024, 'month' => 1]);
    }

    #[Route('/{year<\d{4}>}/{month?1}', name: 'archive', methods: 'GET')]
    public function archive(int $year, int $month): Response
    {
        return $this->redirectToRoute('blog_show', ['slug' => 'hello']);
    }

    /** Unnamed: default name "blog_app_blog_feed" (prefix + generated name). */
    #[Route('/feed.{_format}')]
    public function feedAction(): Response
    {
        return new Response();
    }

    #[Route('/debug', name: 'debug', env: 'prod')]
    public function debug(): Response
    {
        return new Response();
    }
}
