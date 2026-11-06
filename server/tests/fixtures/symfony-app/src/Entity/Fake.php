<?php

namespace App\Entity;

use App\Attribute\Entity;

/** Not a Doctrine attribute. */
#[Entity(repositoryClass: \App\Repository\ProductRepository::class)]
class Fake
{
}
