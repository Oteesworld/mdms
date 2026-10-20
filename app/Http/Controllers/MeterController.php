<?php

namespace App\Http\Controllers;

use App\Metering\MeterAddress;
use App\Metering\MeterSimulator;
use App\Models\Meter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Register Kalahari meters on the platform and keep their network and installation details. */
class MeterController extends Controller
{
    public const CHECKS = ['ns_registered', 'reporting_enabled', 'ciu_bound', 'valve_tested'];

    public function store(Request $request): RedirectResponse
    {
        $data = $this->validated($request, null);
        $meter = Meter::create([
            ...$data,
            'network_status' => 'registered',
            'model' => config('kalahari.model'),
            'registered_by' => $request->user()->id,
            'total_m3' => null,
            'last_seen' => '',
            'online' => false,
        ]);

        return redirect('/meters/'.$meter->serial)->with('toast', "{$meter->serial} registered. Add it to the network server with the same keys.");
    }

    public function update(Request $request, Meter $meter): RedirectResponse
    {
        $data = $this->validated($request, $meter);
        if (($data['app_key'] ?? null) === null) {
            unset($data['app_key']); // blank keeps the stored key
        }
        $decommission = $request->boolean('decommissioned');
        $data['network_status'] = $decommission ? 'decommissioned'
            : ($meter->network_status === 'decommissioned' ? ($meter->hasTelemetry() ? 'reporting' : 'registered') : $meter->network_status);
        $meter->update($data);

        return redirect('/meters/'.$meter->serial)->with('toast', "{$meter->serial} updated");
    }

    /** Demo mode only: send 24 hours of simulated uplinks through the ingestion pipeline. */
    public function simulate(Meter $meter, MeterSimulator $sim): RedirectResponse
    {
        abort_unless(config('mdms.demo'), 404);
        $from = $meter->last_uplink_at ? $meter->readings()->max('read_at') : now()->subDay();
        $from = \Illuminate\Support\Carbon::parse($from)->addHour();
        if ($meter->network_status === 'registered') {
            $meter->update(['network_status' => 'joined', 'joined_at' => $from]);
        }
        $n = $sim->run($meter->refresh(), $from->max(now()->subDays(14)), now());

        return back()->with('toast', $n ? "Simulated {$n} uplink(s) for {$meter->serial}" : 'Already up to date');
    }

    private function validated(Request $request, ?Meter $meter): array
    {
        foreach (['meter_address', 'dev_eui', 'join_eui', 'app_key'] as $k) {
            if (is_string($request->input($k))) {
                $request->merge([$k => strtoupper(preg_replace('/[\s:-]/', '', $request->input($k)))]);
            }
        }
        $request->merge(['serial' => strtoupper(trim((string) $request->input('serial', $meter?->serial)))]);

        $data = $request->validate([
            'serial' => ['required', 'regex:/^WM-\d{6}$/', Rule::unique('meters')->ignore($meter)],
            'meter_address' => ['required', 'regex:/^\d{13}$/', Rule::unique('meters')->ignore($meter),
                fn ($a, $v, $fail) => MeterAddress::valid($v) || $fail('This meter address fails its check digit. Re-read it from the meter label.')],
            'dev_eui' => ['required', 'regex:/^[0-9A-F]{16}$/', 'not_in:0000000000000000', Rule::unique('meters')->ignore($meter)],
            'join_eui' => ['required', 'regex:/^[0-9A-F]{16}$/'],
            'app_key' => [$meter ? 'nullable' : 'required', 'regex:/^[0-9A-F]{32}$/'],
            'lorawan_region' => ['required', Rule::in(config('kalahari.regions'))],
            'device_class' => ['required', 'in:A,C'],
            'reporting_hours' => ['required', 'integer', Rule::in(config('kalahari.reporting_hours'))],
            'sampling_minutes' => ['required', 'integer', Rule::in(config('kalahari.sampling_minutes'))],
            'sts_sgc' => ['required', 'regex:/^\d{6}$/'],
            'sts_krn' => ['required', 'integer', 'between:1,9'],
            'sts_ti' => ['required', 'regex:/^\d{2}$/'],
            'plot' => ['nullable', 'string', 'max:120'],
            'suburb' => ['nullable', 'string', 'max:60'],
            'lat' => ['nullable', 'numeric', 'between:-27,-17.5', 'required_with:lng'],
            'lng' => ['nullable', 'numeric', 'between:19.9,29.5', 'required_with:lat'],
            'installed_at' => ['nullable', 'date', 'before_or_equal:today'],
            'initial_reading' => ['required', 'numeric', 'min:0', 'max:99999'],
            'seal_no' => ['nullable', 'string', 'max:32'],
            'valve' => ['required', 'in:open,closed'],
            'client_id' => ['nullable', 'string', Rule::exists('meters', 'client_id')],
            'occupant' => ['nullable', 'string', 'max:120'],
            'vending_party' => ['required', 'in:occupant,owner,none'],
            'commissioning' => ['array'],
            'commissioning.*' => ['boolean'],
        ], [
            'serial.regex' => 'Use WM- followed by six digits.',
            'meter_address.regex' => 'The meter address is the 13-digit number on the meter label.',
            'dev_eui.regex' => 'DevEUI is 16 hexadecimal characters.',
            'join_eui.regex' => 'JoinEUI is 16 hexadecimal characters.',
            'app_key.regex' => 'AppKey is 32 hexadecimal characters.',
            'lat.between' => 'That latitude is outside Botswana.',
            'lng.between' => 'That longitude is outside Botswana.',
        ], [
            'dev_eui' => 'DevEUI', 'join_eui' => 'JoinEUI', 'app_key' => 'AppKey', 'meter_address' => 'meter address',
            'sts_sgc' => 'SGC', 'sts_krn' => 'KRN', 'sts_ti' => 'tariff index', 'client_id' => 'account',
        ]);

        // Copy the account details from the client's other meters.
        $account = $data['client_id'] ? Meter::where('client_id', $data['client_id'])->first() : null;
        $data += [
            'client_name' => $account?->client_name,
            'type' => $account?->type ?? 'domestic',
            'kyc' => $account?->kyc ?? 'Pending',
            'account_status' => $account?->account_status ?? 'Active',
            'owner' => $account?->client_name,
        ];
        $data['occupant'] = $account ? ($data['occupant'] ?: $account->client_name) : null;
        $data['vending_party'] = $account ? $data['vending_party'] : 'none';
        $data['commissioning'] = array_intersect_key(array_map('boolval', $data['commissioning'] ?? []), array_flip(self::CHECKS));

        return $data;
    }
}
