<?php

namespace App\Entity;

use Doctrine\ORM\Mapping\Entity;

/** Positional, string repositoryClass and an attribute imported by its own name. */
#[Entity('App\Repository\CategoryRepository')]
class Category
{
}
