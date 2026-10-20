<?php

namespace App\Enums;

enum UserStatus: string
{
    /** Invited; has not set a password yet. */
    case Pending = 'Pending';
    case Active = 'Active';
    case Suspended = 'Suspended';
}
