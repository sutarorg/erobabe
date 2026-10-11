-- NOWPayments provider migration (additive — preserves all history).
--
-- The active crypto provider moves from Bcon Global to NOWPayments:
--  - `provider` distinguishes old ('bcon') from new ('nowpayments') rows.
--    Existing rows default to 'bcon' and are never relabeled.
--  - NOWPayments payments are correlated by `provider_payment_id` (unique)
--    and by `invoice_number` (sent as the provider `order_id`).
--  - `provider_status` keeps the raw NOWPayments status (`waiting`,
--    `confirming`, `confirmed`, `sending`, `partially_paid`, `finished`,
--    `failed`, `refunded`, `expired`) while `status` keeps the internal
--    lifecycle (`pending`, `awaiting_confirmation`, `partially_confirmed`,
--    `confirmed`, `failed`, `expired`, `underpaid`, `overpaid`, `refunded`).
--    Only a verified `finished` maps to `confirmed`.
--  - `pay_currency` stores the exact NOWPayments asset identifier
--    (`usdterc20`, `btc`, …); `payment_currency`/`chain` keep the checkout
--    display values.
--  - `provider_response` stores NOWPayments payloads for the audit trail.
--    `bcon_response` is retained untouched for historical Bcon rows.
--
-- RLS: the existing payments policies apply to the whole row, so no policy
-- change is needed. Provider payloads stay server-side: advertisers read
-- only their own rows, and the IPN path uses the service role.

alter table public.payments
  add column if not exists provider text not null default 'bcon',
  add column if not exists provider_payment_id text,
  add column if not exists provider_status text,
  add column if not exists pay_currency text,
  add column if not exists provider_response jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_provider_check'
  ) then
    alter table public.payments
      add constraint payments_provider_check check (provider in ('bcon', 'nowpayments'));
  end if;
end $$;

-- One internal payment per NOWPayments payment id (NULLs are distinct, so
-- historical Bcon rows are unaffected).
create unique index if not exists idx_payments_provider_payment_id
  on public.payments (provider_payment_id)
  where provider_payment_id is not null;

create index if not exists idx_payments_provider on public.payments (provider);
create index if not exists idx_payments_provider_status on public.payments (provider_status);

comment on column public.payments.provider is 'Payment provider: bcon (historical) or nowpayments (active).';
comment on column public.payments.provider_payment_id is 'NOWPayments payment_id; unique per payment, NULL for historical Bcon rows.';
comment on column public.payments.provider_status is 'Raw NOWPayments status; fulfillment requires finished plus verification.';
comment on column public.payments.pay_currency is 'Exact NOWPayments asset identifier (e.g. usdterc20, btc).';
comment on column public.payments.provider_response is 'NOWPayments API/IPN payloads for audit; server-side only.';
comment on column public.payments.bcon_response is 'Historical Bcon payloads. Retained for audit; unused by the NOWPayments flow.';
