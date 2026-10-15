-- Read-only preflight; run as an authorized operator on a backup-restored staging DB.
-- Zero rows expected for conflicts / unsafe publications. Do not auto-delete rows.
select c1.id first_campaign,c2.id second_campaign,c1.slot_id
from campaigns c1 join campaigns c2 on c1.id<c2.id and c1.slot_id=c2.slot_id
where c1.status in ('pending_payment','pending_review','active','paused')
 and c2.status in ('pending_payment','pending_review','active','paused')
 and daterange(c1.start_date,c1.end_date,'[)') && daterange(c2.start_date,c2.end_date,'[)');
select id,advertiser_id,invoice_number,status,provider_payment_id from payments
where provider='nowpayments' and (external_id is null or (status in ('confirmed','awaiting_confirmation') and provider_payment_id is null));
select c.id,c.status,c.payment_id from campaigns c left join payments p on p.id=c.payment_id
where c.status='active' and (p.id is null or p.status<>'confirmed' or p.advertiser_id<>c.advertiser_id);
select id,status,rights_status,moderation_status from videos where status='published'
and (requires_reupload or visibility<>'public' or rights_status<>'cleared' or moderation_status<>'approved');
select id,status,destination_url from ad_creatives where destination_url !~ '^https?://' or (image_url is not null and image_url !~ '^https://');
select version from supabase_migrations.schema_migrations order by version;

-- Historical standalone terminal updates may have stranded invoice state.
-- Inspect/verify against provider truth; never auto-mark paid from this report.
select p.id,p.invoice_number,p.status payment_status,i.id invoice_id,i.status invoice_status
from payments p left join invoices i on i.payment_id=p.id
where p.provider='nowpayments' and p.status in ('confirmed','failed','expired','refunded')
 and (i.id is null or i.status is distinct from case when p.status='confirmed' then 'paid' else p.status end);

-- Malformed bound quotes need operator review, not replacement by a retry.
select id,invoice_number,provider_payment_id,status from payments
where provider='nowpayments' and provider_payment_id is not null
 and (provider_payment_id !~ '^[0-9]{1,40}$' or payment_address is null
      or length(payment_address) not between 1 and 512 or payment_address ~ '[[:space:]]'
      or case when expected_amount ~ '^[0-9]{1,40}([.][0-9]{1,18})?$' then expected_amount::numeric<=0 else true end);
