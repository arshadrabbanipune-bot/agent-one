-- Google OAuth does not supply application-specific demographic fields.
-- Keep age and gender mandatory in the email signup UI, but allow OAuth
-- identities to be created without fabricated profile data.
alter table public.profiles alter column age drop not null;
alter table public.profiles alter column gender drop not null;
