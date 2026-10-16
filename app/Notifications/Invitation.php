<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Sent when an administrator invites someone; the link sets their first password. */
class Invitation extends Notification
{
    public function __construct(public string $token) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $url = route('password.reset', ['token' => $this->token, 'email' => $notifiable->getEmailForPasswordReset(), 'invite' => 1]);
        $hours = round(config('auth.passwords.users.expire') / 60);

        return (new MailMessage)
            ->subject('You have been invited to Amplified IoT')
            ->greeting("Hello {$notifiable->name},")
            ->line('An administrator has created an Amplified IoT account for you ('.$notifiable->role->label().').')
            ->action('Set your password', $url)
            ->line("This link expires in {$hours} hours. Ask your administrator for a new one if it does.");
    }
}
