<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Embeddable]
class Address
{
    #[ORM\Column]
    private ?string $city = null;

    #[ORM\Column]
    private ?string $zip = null;
}
