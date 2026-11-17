H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(node -e "console.log(require('$H/keys.json').anonKey)")
