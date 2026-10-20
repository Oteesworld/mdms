/*
 * Shapes of the meter validation the external vending system calls before it issues an
 * STS token. The rules run on the server (app/Vending/MeterValidator.php); the browser
 * calls POST /vending/check, and the vending system calls POST /api/vending/validate.
 */
export type ValidationCode =
  | 'OK'
  | 'INVALID_FORMAT'
  | 'METER_NOT_FOUND'
  | 'ACCOUNT_SUSPENDED'
  | 'KYC_INCOMPLETE'
  | 'TAMPER_HOLD'
  | 'VENDING_NOT_PERMITTED'
  | 'PURCHASER_NOT_PERMITTED';

export interface ValidationRequest {
  /** Meter serial as printed on the meter, e.g. WM-104882. */
  meter: string;
  /** Who is buying: the occupant (tenant) or the property owner. Optional. */
  purchaser?: 'occupant' | 'owner';
  /** Amount the customer intends to pay, Pula incl. VAT. Optional, echoed back. */
  amount?: number;
  /** Vending system's own reference for this attempt. Optional, echoed back. */
  vendorRef?: string;
}

export interface ValidationRules {
  blockKycIncomplete: boolean;
  blockTamper: boolean;
  blockSuspended: boolean;
  /** Warn (not block) when the meter has been silent longer than this. */
  offlineWarnDays: number;
}

export interface ValidationResponse {
  result: 'APPROVED' | 'DECLINED';
  code: ValidationCode;
  message: string;
  meter?: { serial: string; devEui: string; status: 'online' | 'offline'; lastSeen: string; property: string };
  account?: {
    clientId: string;
    clientName: string;
    type: 'domestic' | 'business';
    owner: string;
    occupant: string;
    /** Who the MDMS allows to buy against this meter. */
    vendingParty: 'occupant' | 'owner' | 'none';
    kyc: string;
    status: string;
  };
  /** STS parameters the vending system needs to generate the token. */
  sts?: { supplyGroupCode: string; keyRevision: number; tariffIndex: string; tokenTech: string; algorithm: string };
  tariff?: { name: string; ratePerKl: number; vatRate: number };
  warnings: string[];
  request: { amount?: number; vendorRef?: string; purchaser?: string };
  validatedAt: string;
}

/** A validation as the Vending screen's log shows it (built by app/Vending/VendingPage.php). */
export interface LogEntry {
  id: string;
  t: string;
  date: string;
  vendor: string;
  meter: string;
  amount: number | null;
  source: 'API' | 'Console' | 'Portal';
  res: ValidationResponse;
}
