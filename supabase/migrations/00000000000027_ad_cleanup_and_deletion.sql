-- Advertising cleanup.
--
-- 1. “About you” is optional in the guest checkout, so an order may carry an
--    empty description.
-- 2. An admin can delete an advertisement permanently. The order row and its
--    banner are removed (the revenue card sums the orders that still exist, so
--    a deleted ad — even one deleted before its 30 days — is no longer counted
--    in “Verified Ad Revenue”); the audit log keeps a reconciliation record.
-- 3. Legacy operator transitions for advertisers and campaigns are retired:
--    there are no advertiser accounts and no /admin/campaigns page anymore.
begin;

alter table public.ad_orders drop constraint if exists ad_orders_contact_length;
alter table public.ad_orders add constraint ad_orders_contact_length check (
  length(ad_name) between 1 and 160
  and length(contact_name) between 1 and 120
  and length(email) between 3 and 320
  and length(coalesce(about_advertiser, '')) between 0 and 2000
  and (company_name is null or length(company_name) <= 160)
);

-- Deleting an ad writes one audit row per removal; the dashboard reads those
-- rows back to show how much verified money a deletion took out of the total.
create index if not exists idx_audit_logs_ad_order_deleted
  on public.audit_logs (created_at desc)
  where action = 'ad_order_deleted';

create or replace function public.admin_transition(p_admin uuid, p_id uuid, p_action text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from profiles where id = p_admin and role = 'admin' and status = 'active') then
    raise exception 'Active admin required';
  end if;

  if p_action in ('review_report', 'resolve_report', 'dismiss_report') then
    update reports
    set status = case p_action
      when 'review_report' then 'in_review'
      when 'resolve_report' then 'resolved'
      else 'dismissed'
    end
    where id = p_id;
    if not found then
      raise exception 'Report not found';
    end if;
  else
    -- suspend_user / restore_user / campaign and creative approvals are gone.
    raise exception 'Unknown operator action';
  end if;

  insert into audit_logs(actor_id, action, target_type, target_id, level)
  values (p_admin, p_action, 'operator_transition', p_id::text, 'info');
end $$;

revoke all on function public.admin_transition(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_transition(uuid, uuid, text) to service_role;

commit;
