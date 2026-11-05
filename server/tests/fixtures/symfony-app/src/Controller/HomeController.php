<?php

namespace App\Controller;

use Symfony\Bridge\Twig\Attribute\Template;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class HomeController extends AbstractController
{
    #[Route('/', name: 'app_home')]
    public function index(): Response
    {
        return $this->render('home/index.html.twig', ['title' => 'Home']);
    }

    #[Route('/hero', name: 'app_hero')]
    public function hero(): Response
    {
        return $this->renderBlock('home/_hero.html.twig', 'hero');
    }

    #[Route('/dashboard', name: 'app_dashboard')]
    #[Template('admin/dashboard.html.twig')]
    public function dashboard(): array
    {
        return [];
    }

    #[Route('/missing', name: 'app_missing')]
    public function missing(): Response
    {
        return $this->render('home/missing.html.twig');
    }
}
