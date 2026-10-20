<?php

namespace App\Vending;

/** Which checks block vending. The API always uses the defaults; the in-app console may try others. */
final class ValidationRules
{
    public function __construct(
        public bool $blockKycIncomplete = true,
        public bool $blockTamper = true,
        public bool $blockSuspended = true,
        /** Warn (not block) when the meter has been silent at least this many days. */
        public int $offlineWarnDays = 2,
    ) {}

    public static function fromArray(array $a): self
    {
        $d = new self;

        return new self(
            (bool) ($a['blockKycIncomplete'] ?? $d->blockKycIncomplete),
            (bool) ($a['blockTamper'] ?? $d->blockTamper),
            (bool) ($a['blockSuspended'] ?? $d->blockSuspended),
            max(0, (int) ($a['offlineWarnDays'] ?? $d->offlineWarnDays)),
        );
    }

    public function toArray(): array
    {
        return get_object_vars($this);
    }
}
