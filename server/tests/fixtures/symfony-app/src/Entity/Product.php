<?php

namespace App\Entity;

use App\Repository\ProductRepository;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: ProductRepository::class)]
#[ORM\Table(name: 'product')]
class Product extends BaseEntity
{
    use TimestampableTrait;

    #[ORM\Column(length: 255)]
    private ?string $name = null;

    #[ORM\Column(type: 'decimal', precision: 10, scale: 2)]
    private ?string $price = null;

    #[ORM\ManyToOne(inversedBy: 'products')]
    private ?Category $category = null;

    #[ORM\ManyToMany(targetEntity: Tag::class)]
    private Collection $tags;

    #[ORM\Embedded(class: Address::class)]
    private Address $warehouse;

    private ?string $notMapped = null;

    public function __construct(
        #[ORM\Column]
        private bool $published = false,
    ) {
    }
}
