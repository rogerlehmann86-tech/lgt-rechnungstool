-- LGT Rechnungstool / Supabase PostgreSQL 17+
-- Ziel: bestehendes Lehmann Werbetool. Ausschliesslich neue lgt_-Objekte; contacts bleibt unverändert.
-- Benutzende werden ausschliesslich vom Administrator via Supabase Auth angelegt.
-- Nach dem Anlegen: INSERT INTO public.lgt_staff(user_id) VALUES ('<UUID AUS AUTH USERS>');

create table if not exists public.lgt_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  added_at timestamptz not null default now()
);
create table if not exists public.lgt_invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^[0-9]{3,10}$'),
  invoice_date date not null,
  customer_name text not null check (length(btrim(customer_name)) > 0),
  customer_number text not null default '',
  contact_id bigint, -- Logische Referenz auf contacts.id; kein FK, damit ERP-Importe ungestört bleiben.
  machine text not null default '',
  original_net_cents bigint not null,
  original_vat_cents bigint not null,
  original_total_cents bigint not null,
  additional_trade_gross_cents bigint not null default 0 check (additional_trade_gross_cents >= 0),
  trade_discount_net_cents bigint not null default 0 check (trade_discount_net_cents >= 0),
  net_cents bigint not null,
  vat_cents bigint not null,
  total_cents bigint not null,
  vat_bps integer not null check (vat_bps between 1 and 9999),
  source_has_trade boolean not null default false,
  original_pdf_path text not null,
  issued_pdf_path text not null,
  files_ready boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint lgt_totals_match check (net_cents + vat_cents = total_cents or (additional_trade_gross_cents=0 and net_cents=original_net_cents and vat_cents=original_vat_cents and total_cents=original_total_cents and abs(total_cents-net_cents-vat_cents)<=5)),
  constraint lgt_source_totals_match check (abs(original_total_cents-original_net_cents-original_vat_cents)<=5),
  constraint lgt_discount_match check (original_net_cents - trade_discount_net_cents = net_cents),
  constraint lgt_trade_only_if_not_already check (not source_has_trade or additional_trade_gross_cents = 0)
);
create table if not exists public.lgt_claims (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.lgt_invoices(id) on delete restrict,
  supplier text not null default 'Husqvarna',
  claimed_amount_cents bigint not null check (claimed_amount_cents > 0),
  received_amount_cents bigint not null default 0 check (received_amount_cents >= 0),
  status text not null default 'open' check (status in ('open','claimed','partial','paid')),
  claimed_on date,
  received_on date,
  reference text,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(invoice_id, supplier),
  constraint lgt_received_within_claim check (received_amount_cents <= claimed_amount_cents),
  constraint lgt_paid_full check (status <> 'paid' or received_amount_cents = claimed_amount_cents),
  constraint lgt_claimed_date check (status = 'open' or claimed_on is not null)
);
create table if not exists public.lgt_claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.lgt_claims(id) on delete restrict,
  actor_id uuid not null default auth.uid() references auth.users(id),
  action text not null check (action in ('claimed','partial','paid','note')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lgt_invoice_date_idx on public.lgt_invoices(invoice_date desc);
create index if not exists lgt_invoice_customer_idx on public.lgt_invoices(customer_name);
create index if not exists lgt_claim_status_idx on public.lgt_claims(status);
create index if not exists lgt_claim_invoice_idx on public.lgt_claims(invoice_id);
create index if not exists lgt_claim_event_claim_idx on public.lgt_claim_events(claim_id,created_at desc);

alter table public.lgt_staff enable row level security;
alter table public.lgt_invoices enable row level security;
alter table public.lgt_claims enable row level security;
alter table public.lgt_claim_events enable row level security;

-- Keine öffentliche Registrierung/Leseberechtigung. Mitarbeitendenliste nur per Supabase Dashboard pflegen.
revoke all on public.lgt_staff, public.lgt_invoices, public.lgt_claims, public.lgt_claim_events from anon, authenticated;
grant select on public.lgt_staff to authenticated;
grant select, insert on public.lgt_invoices to authenticated;
grant update(files_ready) on public.lgt_invoices to authenticated;
grant select, insert on public.lgt_claims to authenticated;
grant update(status, claimed_on, received_on, received_amount_cents, reference, note) on public.lgt_claims to authenticated;
grant select, insert on public.lgt_claim_events to authenticated;

create policy "lgt_staff_can_read_self" on public.lgt_staff
  for select to authenticated using (user_id=(select auth.uid()));

-- LGT-Mitarbeitende sehen firmenweit dieselben Rechnungen (gemeinsame Buchhaltung).
create policy "lgt_invoice_read" on public.lgt_invoices for select to authenticated
  using (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create policy "lgt_invoice_insert" on public.lgt_invoices for insert to authenticated
  with check (created_by=(select auth.uid()) and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create policy "lgt_invoice_update_pending" on public.lgt_invoices for update to authenticated
  using (files_ready=false and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active))
  with check (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));

create policy "lgt_claim_read" on public.lgt_claims for select to authenticated
  using (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create policy "lgt_claim_insert" on public.lgt_claims for insert to authenticated
  with check (created_by=(select auth.uid()) and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create policy "lgt_claim_update" on public.lgt_claims for update to authenticated
  using (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active))
  with check (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));

create policy "lgt_events_read" on public.lgt_claim_events for select to authenticated
  using (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create policy "lgt_events_insert" on public.lgt_claim_events for insert to authenticated
  with check (actor_id=(select auth.uid()) and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));

-- Private Speicherung: keine anonymen Downloads, öffentliche URLs oder Überschreibungen.
insert into storage.buckets(id,name,public)
values('lgt-rechnungen','lgt-rechnungen',false)
;
create policy "lgt_pdfs_read" on storage.objects for select to authenticated
  using(bucket_id='lgt-rechnungen' and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create policy "lgt_pdfs_upload" on storage.objects for insert to authenticated
  with check(bucket_id='lgt-rechnungen' and name like 'invoices/%' and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
-- Kundennummer aus dem ERP mit dem vorhandenen Kundenstamm verbinden, ohne diesen zu ändern.
create index lgt_invoice_contact_idx on public.lgt_invoices(contact_id);
create function public.lgt_link_contact() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.contact_id := null;
  if new.customer_number ~ '^[0-9]{1,18}$' then
    select c.id into new.contact_id from public.contacts c where c.id = new.customer_number::bigint;
  end if;
  return new;
end; $$;
revoke all on function public.lgt_link_contact() from public, anon, authenticated;
create trigger lgt_link_contact_before_insert before insert on public.lgt_invoices for each row execute function public.lgt_link_contact();


-- Two-phase deletion: mark first, remove PDFs through Storage API, then delete invoice and dependent records.
alter table public.lgt_invoices add column deletion_pending boolean not null default false;
alter table public.lgt_claims drop constraint lgt_claims_invoice_id_fkey, add constraint lgt_claims_invoice_id_fkey foreign key(invoice_id) references public.lgt_invoices(id) on delete cascade;
alter table public.lgt_claim_events drop constraint lgt_claim_events_claim_id_fkey, add constraint lgt_claim_events_claim_id_fkey foreign key(claim_id) references public.lgt_claims(id) on delete cascade;
grant update(deletion_pending) on public.lgt_invoices to authenticated;
grant delete on public.lgt_invoices to authenticated;
alter policy lgt_invoice_update_pending on public.lgt_invoices
using (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active))
with check (exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active));
create function public.lgt_guard_invoice_update() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (old.files_ready or old.deletion_pending or new.deletion_pending) and new.files_ready is distinct from old.files_ready then
    raise exception 'Finalisierte oder zur Löschung markierte Rechnung darf nicht geändert werden.';
  end if;
  if old.deletion_pending and not new.deletion_pending then
    raise exception 'Begonnene Löschung muss abgeschlossen werden.';
  end if;
  return new;
end; $$;
revoke all on function public.lgt_guard_invoice_update() from public, anon, authenticated;
create trigger lgt_guard_invoice_update before update on public.lgt_invoices for each row execute function public.lgt_guard_invoice_update();
create policy lgt_invoice_delete on public.lgt_invoices for delete to authenticated
using (deletion_pending and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active)
  and not exists(select 1 from storage.objects o where o.bucket_id='lgt-rechnungen' and o.name in (lgt_invoices.original_pdf_path,lgt_invoices.issued_pdf_path)));
create policy lgt_pdfs_delete on storage.objects for delete to authenticated
using (bucket_id='lgt-rechnungen' and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active)
  and exists(select 1 from public.lgt_invoices i where i.deletion_pending and storage.objects.name in (i.original_pdf_path,i.issued_pdf_path)
  and storage.objects.name like 'invoices/'||i.id::text||'/%'));
alter policy lgt_pdfs_upload on storage.objects
with check (bucket_id='lgt-rechnungen' and exists(select 1 from public.lgt_staff s where s.user_id=(select auth.uid()) and s.active)
 and exists(select 1 from public.lgt_invoices i where not i.deletion_pending and not i.files_ready and storage.objects.name in (i.original_pdf_path,i.issued_pdf_path)
 and storage.objects.name like 'invoices/'||i.id::text||'/%'));
