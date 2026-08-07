# Supabase foundation

This folder contains the database foundation for managed accounts and remote device pairing. It is not active until a Supabase project is created and the migration is applied.

## Setup required from the project owner

1. Create a Supabase project.
2. Enable Email (magic-link) authentication.
3. Create a Google OAuth client and enable Google authentication in Supabase.
4. Add the hosted mobile-app callback URL once the PWA is deployed.
5. Apply `migrations/20260807_remote_pairing_foundation.sql` through the Supabase SQL editor or CLI.

Share only the Project URL and anon/public key with application developers. Keep the service-role key and Google OAuth client secret only in Supabase server/Edge Function configuration.
