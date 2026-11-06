<?php

namespace App\Entity;

use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping\Column;
use Doctrine\ORM\Mapping\Entity;
use Doctrine\ORM\Mapping\OneToMany;

/** Positional, string repositoryClass and attributes imported by their own name. */
#[Entity('App\Repository\CategoryRepository')]
class Category
{
    #[Column]
    private ?string $title = null;

    #[OneToMany(targetEntity: Product::class, mappedBy: 'category')]
    private Collection $products;
}
